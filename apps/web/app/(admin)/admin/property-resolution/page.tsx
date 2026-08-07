import { revalidatePath } from "next/cache";
import Link from "next/link";
import { prisma } from "@foreclosuredata/database";
import type { Prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, explainMatch, buildLegalDescriptionCacheKey, type ResolutionInput } from "@foreclosuredata/foreclosure-core";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getCountyAppraisalAdapter } from "@/lib/appraisal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/properties/empty-state";
import { formatCurrencyCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ADDRESS_REASONS = ["NO_ADDRESS_RESOLVED", "MULTIPLE_APPRAISAL_MATCHES"] as const;

/** A minimal, provider-agnostic shape covering both AppraisalPropertyCandidate rows and CountyAppraisalAdapter records — the one thing approveCandidate() and the cache-reuse path in searchAgain() both need to write to Property/AppraisalValueHistory. */
interface ResolvedAppraisalData {
  sourcePropertyId: string;
  sourceUrl?: string | null;
  situsAddress: string | null;
  city: string | null;
  legalDescription: string | null;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  parcelId: string | null;
  geographicId: string | null;
  classification: Prisma.PropertyCreateInput["classification"];
  appraisedValueCents: number | null;
  assessedValueCents: number | null;
  marketValueCents: number | null;
  landValueCents: number | null;
  improvementValueCents: number | null;
  homestead: boolean | null;
  taxYear: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** Shared by approveCandidate() (a human picked a candidate) and the cache-reuse path in searchAgain() (a prior successful match is being reused for the same legal description) — writes the property + append-only value-history rows, never overwriting a prior tax year. */
async function upsertPropertyFromAppraisalData(
  tx: Prisma.TransactionClient,
  params: { foreclosureCaseId: string; countyId: string; existingPropertyId: string | null; data: ResolvedAppraisalData; addressResolutionMethod: "MANUAL" | "CACHED_MATCH_REUSE"; addressResolutionConfidence: number; addressResolutionExplanation: string },
): Promise<string> {
  const { data } = params;
  const propertyData = {
    propertyStreetAddress: data.situsAddress,
    city: data.city,
    legalDescription: data.legalDescription,
    subdivision: data.subdivision,
    lot: data.lot,
    block: data.block,
    acreage: data.acreage,
    propertyIdNumber: data.parcelId,
    geographicId: data.geographicId,
    classification: data.classification,
    appraisedValueCents: data.appraisedValueCents,
    assessedValueCents: data.assessedValueCents,
    estimatedMarketValueCents: data.marketValueCents,
    latitude: data.latitude,
    longitude: data.longitude,
    addressResolutionMethod: params.addressResolutionMethod,
    addressResolutionConfidence: params.addressResolutionConfidence,
    addressResolutionExplanation: params.addressResolutionExplanation,
  };

  let propertyId = params.existingPropertyId;
  if (propertyId) {
    await tx.property.update({ where: { id: propertyId }, data: propertyData });
  } else {
    const county = await tx.county.findUnique({ where: { id: params.countyId } });
    const created = await tx.property.create({ data: { countyId: params.countyId, state: county?.state ?? "TX", ...propertyData } });
    propertyId = created.id;
    await tx.foreclosureCase.update({ where: { id: params.foreclosureCaseId }, data: { propertyId } });
  }

  if (data.taxYear && data.appraisedValueCents !== null) {
    await tx.appraisalValueHistory.upsert({
      where: { propertyId_taxYear: { propertyId, taxYear: data.taxYear } },
      create: {
        propertyId,
        taxYear: data.taxYear,
        landValueCents: data.landValueCents,
        improvementValueCents: data.improvementValueCents,
        appraisedValueCents: data.appraisedValueCents,
        assessedValueCents: data.assessedValueCents,
        marketValueCents: data.marketValueCents,
        homestead: data.homestead,
        sourceUrl: data.sourceUrl,
      },
      update: {
        landValueCents: data.landValueCents,
        improvementValueCents: data.improvementValueCents,
        appraisedValueCents: data.appraisedValueCents,
        assessedValueCents: data.assessedValueCents,
        marketValueCents: data.marketValueCents,
        homestead: data.homestead,
        sourceUrl: data.sourceUrl,
      },
    });
  }

  return propertyId;
}

/** Records (or refreshes) the reuse cache once a legal description has been successfully matched — powers "cache successful matches" / "reuse previous successful matches whenever appropriate." */
async function recordSuccessfulMatch(
  tx: Prisma.TransactionClient,
  params: { countyId: string; countyAppraisalSourceKey: string; sourcePropertyId: string; situsAddress: string | null; confidence: number; legal: { subdivision?: string | null; lot?: string | null; block?: string | null; rawText?: string | null } },
) {
  const normalizedKey = buildLegalDescriptionCacheKey(params.legal);
  if (!normalizedKey) return;
  await tx.resolvedLegalDescriptionMatch.upsert({
    where: { countyId_normalizedKey: { countyId: params.countyId, normalizedKey } },
    create: {
      countyId: params.countyId,
      normalizedKey,
      countyAppraisalSourceKey: params.countyAppraisalSourceKey,
      sourcePropertyId: params.sourcePropertyId,
      situsAddress: params.situsAddress,
      confidence: params.confidence,
    },
    update: {
      countyAppraisalSourceKey: params.countyAppraisalSourceKey,
      sourcePropertyId: params.sourcePropertyId,
      situsAddress: params.situsAddress,
      confidence: params.confidence,
      timesReused: { increment: 1 },
      lastConfirmedAt: new Date(),
    },
  });
}

async function approveCandidate(taskId: string, foreclosureCaseId: string, candidateId: string) {
  "use server";
  const actorId = await getCurrentProfileId();
  const candidate = await prisma.appraisalPropertyCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) return;

  const fc = await prisma.foreclosureCase.findUnique({ where: { id: foreclosureCaseId }, include: { property: true } });
  if (!fc) return;

  await prisma.$transaction(async (tx) => {
    await tx.appraisalPropertyCandidate.updateMany({ where: { foreclosureCaseId }, data: { isSelected: false } });
    await tx.appraisalPropertyCandidate.update({ where: { id: candidateId }, data: { isSelected: true } });

    const propertyId = await upsertPropertyFromAppraisalData(tx, {
      foreclosureCaseId,
      countyId: fc.countyId,
      existingPropertyId: fc.propertyId,
      data: candidate,
      addressResolutionMethod: "MANUAL",
      addressResolutionConfidence: 1,
      addressResolutionExplanation: "Manually approved by an administrator from a scored appraisal-district candidate.",
    });

    await recordSuccessfulMatch(tx, {
      countyId: fc.countyId,
      countyAppraisalSourceKey: candidate.countyAppraisalSourceKey,
      sourcePropertyId: candidate.sourcePropertyId,
      situsAddress: candidate.situsAddress,
      confidence: 1,
      legal: { subdivision: candidate.subdivision, lot: candidate.lot, block: candidate.block, rawText: candidate.legalDescription },
    });

    await tx.manualReviewTask.update({ where: { id: taskId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "APPROVE_PROPERTY_CANDIDATE",
        entityType: "AppraisalPropertyCandidate",
        entityId: candidateId,
        afterJson: { foreclosureCaseId, propertyId, sourcePropertyId: candidate.sourcePropertyId },
      },
    });
  });

  revalidatePath("/admin/property-resolution");
}

async function rejectAllCandidates(taskId: string, foreclosureCaseId: string) {
  "use server";
  const actorId = await getCurrentProfileId();
  await prisma.appraisalPropertyCandidate.updateMany({ where: { foreclosureCaseId }, data: { isSelected: false } });
  await prisma.manualReviewTask.update({ where: { id: taskId }, data: { notes: "All candidates rejected by an administrator; awaiting manual entry or a fresh search." } });
  await prisma.auditLog.create({ data: { actorId, action: "REJECT_ALL_PROPERTY_CANDIDATES", entityType: "ForeclosureCase", entityId: foreclosureCaseId } });
  revalidatePath("/admin/property-resolution");
}

async function markUnresolved(taskId: string, foreclosureCaseId: string) {
  "use server";
  const actorId = await getCurrentProfileId();
  const fc = await prisma.foreclosureCase.findUnique({ where: { id: foreclosureCaseId } });
  if (fc?.propertyId) {
    await prisma.property.update({
      where: { id: fc.propertyId },
      data: { addressResolutionMethod: "UNRESOLVED", addressResolutionConfidence: 0, addressResolutionExplanation: "Marked unresolved by an administrator — no reliable candidate found." },
    });
  }
  await prisma.manualReviewTask.update({ where: { id: taskId }, data: { status: "DISMISSED", resolvedAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId, action: "MARK_PROPERTY_UNRESOLVED", entityType: "ForeclosureCase", entityId: foreclosureCaseId } });
  revalidatePath("/admin/property-resolution");
}

async function searchAgain(taskId: string, foreclosureCaseId: string) {
  "use server";
  const actorId = await getCurrentProfileId();
  const fc = await prisma.foreclosureCase.findUnique({
    where: { id: foreclosureCaseId },
    include: { county: true, property: true, borrower: true, grantor: true, currentOwner: true, legalDescriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!fc) return;

  const legal = fc.legalDescriptions[0];
  const legalForCacheKey = legal
    ? { subdivision: legal.subdivision, lot: legal.lot, block: legal.block, rawText: legal.rawText }
    : { subdivision: fc.property?.subdivision, lot: fc.property?.lot, block: fc.property?.block, rawText: fc.property?.legalDescription };
  const ownerNames = [fc.borrower?.fullName, fc.grantor?.fullName, fc.currentOwner?.fullName, ...fc.coOwnerNames].filter((n): n is string => Boolean(n));

  // Do not repeatedly search the CAD for the same foreclosure: if this
  // exact legal description has already been successfully matched before
  // (auto-accepted or admin-approved, for this case or an earlier one),
  // reuse that match with a single getPropertyDetails() refresh instead of
  // re-running the full multi-strategy search.
  const cacheKey = buildLegalDescriptionCacheKey(legalForCacheKey);
  const cached = cacheKey ? await prisma.resolvedLegalDescriptionMatch.findUnique({ where: { countyId_normalizedKey: { countyId: fc.countyId, normalizedKey: cacheKey } } }) : null;

  if (cached) {
    try {
      const adapter = getCountyAppraisalAdapter(fc.county.slug);
      const record = await adapter.getPropertyDetails(cached.sourcePropertyId);
      await prisma.$transaction(async (tx) => {
        await tx.appraisalPropertyCandidate.updateMany({ where: { foreclosureCaseId }, data: { isSelected: false } });
        await tx.appraisalPropertyCandidate.create({
          data: {
            foreclosureCaseId,
            countyAppraisalSourceKey: cached.countyAppraisalSourceKey,
            sourcePropertyId: record.sourcePropertyId,
            sourceUrl: record.sourceUrl ?? null,
            ownerName: record.ownerName,
            situsAddress: record.situsAddress,
            city: record.city,
            zipCode: record.zipCode,
            parcelId: record.parcelId,
            geographicId: record.geographicId,
            legalDescription: record.legalDescription,
            subdivision: record.subdivision,
            lot: record.lot,
            block: record.block,
            acreage: record.acreage,
            classification: record.classification,
            landValueCents: record.landValueCents,
            improvementValueCents: record.improvementValueCents,
            appraisedValueCents: record.appraisedValueCents,
            assessedValueCents: record.assessedValueCents,
            marketValueCents: record.marketValueCents,
            homestead: record.homestead,
            taxYear: record.taxYear,
            latitude: record.latitude,
            longitude: record.longitude,
            score: cached.confidence,
            matchedFields: ["cachedLegalDescriptionMatch"],
            isSelected: true,
          },
        });
        await upsertPropertyFromAppraisalData(tx, {
          foreclosureCaseId,
          countyId: fc.countyId,
          existingPropertyId: fc.propertyId,
          data: record,
          addressResolutionMethod: "CACHED_MATCH_REUSE",
          addressResolutionConfidence: cached.confidence,
          addressResolutionExplanation: `Reused a previously confirmed match for this legal description (matched ${cached.timesReused + 1} time(s) total) instead of re-running a CAD search.`,
        });
        await recordSuccessfulMatch(tx, {
          countyId: fc.countyId,
          countyAppraisalSourceKey: cached.countyAppraisalSourceKey,
          sourcePropertyId: record.sourcePropertyId,
          situsAddress: record.situsAddress,
          confidence: cached.confidence,
          legal: legalForCacheKey,
        });
        await tx.propertyResolutionAttempt.create({
          data: {
            foreclosureCaseId,
            resolutionMethod: "CACHED_MATCH_REUSE",
            confidence: cached.confidence,
            explanation: `Reused a previously confirmed CAD match for this legal description instead of re-searching.`,
            matchedFields: ["cachedLegalDescriptionMatch"],
            conflictingFields: [],
            candidateCount: 1,
            requiresManualReview: false,
            selectedCandidateId: record.sourcePropertyId,
          },
        });
        await tx.manualReviewTask.update({ where: { id: taskId }, data: { status: "RESOLVED", resolvedAt: new Date(), notes: `Auto-resolved by reusing a cached match for this legal description.` } });
        await tx.auditLog.create({ data: { actorId, action: "CACHED_MATCH_AUTO_RESOLVED", entityType: "ForeclosureCase", entityId: foreclosureCaseId, afterJson: { sourcePropertyId: record.sourcePropertyId } } });
      });
      revalidatePath("/admin/property-resolution");
      return;
    } catch {
      // Cached property no longer resolves (renumbered/removed) — fall
      // through to a live search below rather than failing outright.
    }
  }

  const input: ResolutionInput = {
    statedPropertyAddress: fc.property?.propertyStreetAddress ?? null,
    statedAddressMethod: null,
    legalDescription: legal
      ? { rawText: legal.rawText, subdivision: legal.subdivision, lot: legal.lot, block: legal.block, acreage: legal.acreage }
      : fc.property?.legalDescription
        ? { rawText: fc.property.legalDescription, subdivision: fc.property.subdivision, lot: fc.property.lot, block: fc.property.block, acreage: fc.property.acreage }
        : null,
    ownerNames,
    ownerMailingAddress: fc.borrower?.mailingAddress ?? null,
    propertyIdFromNotice: fc.property?.propertyIdNumber ?? null,
    geographicIdFromNotice: fc.property?.geographicId ?? null,
    city: fc.property?.city ?? null,
  };

  try {
    const adapter = getCountyAppraisalAdapter(fc.county.slug);
    const outcome = await resolvePropertyAddress(input, adapter);

    await prisma.$transaction(async (tx) => {
      await tx.appraisalPropertyCandidate.createMany({
        data: outcome.candidates.map((c) => ({
          foreclosureCaseId,
          countyAppraisalSourceKey: adapter.countyCode,
          sourcePropertyId: c.sourcePropertyId,
          sourceUrl: c.sourceUrl ?? null,
          ownerName: c.ownerName,
          situsAddress: c.situsAddress,
          city: c.city,
          zipCode: c.zipCode,
          parcelId: c.parcelId,
          geographicId: c.geographicId,
          legalDescription: c.legalDescription,
          subdivision: c.subdivision,
          lot: c.lot,
          block: c.block,
          acreage: c.acreage,
          classification: c.classification,
          landValueCents: c.landValueCents,
          improvementValueCents: c.improvementValueCents,
          appraisedValueCents: c.appraisedValueCents,
          assessedValueCents: c.assessedValueCents,
          marketValueCents: c.marketValueCents,
          homestead: c.homestead,
          taxYear: c.taxYear,
          latitude: c.latitude,
          longitude: c.longitude,
        })),
      });
      await tx.propertyResolutionAttempt.create({
        data: {
          foreclosureCaseId,
          resolutionMethod: outcome.address.addressResolutionMethod,
          confidence: outcome.resolution.confidence,
          explanation: outcome.resolution.explanation,
          matchedFields: outcome.resolution.matchedFields,
          conflictingFields: outcome.resolution.conflictingFields,
          candidateCount: outcome.resolution.candidateCount,
          requiresManualReview: outcome.resolution.requiresManualReview,
          selectedCandidateId: outcome.resolution.selectedCandidateId,
        },
      });
      await tx.manualReviewTask.update({
        where: { id: taskId },
        data: { notes: `Re-searched ${adapter.sourceName}: ${outcome.candidates.length} candidate(s) found. ${outcome.resolution.explanation}` },
      });
      await tx.auditLog.create({ data: { actorId, action: "SEARCH_AGAIN_PROPERTY_CANDIDATES", entityType: "ForeclosureCase", entityId: foreclosureCaseId, afterJson: { candidateCount: outcome.candidates.length } } });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error re-running the appraisal-district search.";
    await prisma.manualReviewTask.update({ where: { id: taskId }, data: { notes: message } });
    await prisma.auditLog.create({ data: { actorId, action: "SEARCH_AGAIN_FAILED", entityType: "ForeclosureCase", entityId: foreclosureCaseId, afterJson: { error: message } } });
  }

  revalidatePath("/admin/property-resolution");
}

async function enterManually(taskId: string, foreclosureCaseId: string, formData: FormData) {
  "use server";
  const actorId = await getCurrentProfileId();
  const streetAddress = String(formData.get("streetAddress") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const zipCode = String(formData.get("zipCode") ?? "").trim();
  if (!streetAddress) return;

  const fc = await prisma.foreclosureCase.findUnique({ where: { id: foreclosureCaseId } });
  if (!fc) return;

  const propertyData = {
    propertyStreetAddress: streetAddress,
    city: city || null,
    zipCode: zipCode || null,
    addressResolutionMethod: "MANUAL" as const,
    addressResolutionConfidence: 1,
    addressResolutionExplanation: "Manually entered by an administrator.",
  };

  let propertyId = fc.propertyId;
  if (propertyId) {
    await prisma.property.update({ where: { id: propertyId }, data: propertyData });
  } else {
    const county = await prisma.county.findUnique({ where: { id: fc.countyId } });
    const created = await prisma.property.create({ data: { countyId: fc.countyId, state: county?.state ?? "TX", ...propertyData } });
    propertyId = created.id;
    await prisma.foreclosureCase.update({ where: { id: foreclosureCaseId }, data: { propertyId } });
  }

  await prisma.manualReviewTask.update({ where: { id: taskId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId, action: "ENTER_PROPERTY_ADDRESS_MANUALLY", entityType: "Property", entityId: propertyId, afterJson: propertyData } });
  revalidatePath("/admin/property-resolution");
}

export default async function PropertyResolutionPage() {
  const tasks = await prisma.manualReviewTask.findMany({
    where: { status: "OPEN", reason: { in: [...ADDRESS_REASONS] } },
    include: {
      sourceDocument: true,
      foreclosureCase: {
        include: {
          county: true,
          property: true,
          borrower: true,
          grantor: true,
          currentOwner: true,
          legalDescriptions: { orderBy: { createdAt: "desc" }, take: 1 },
          appraisalCandidates: { orderBy: { score: "desc" } },
          documents: { orderBy: { dateCollected: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Property address resolution</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Cases where a foreclosure notice did not state a property address. Approve a scored candidate, reject all and enter one manually, re-run the
        search, or mark the case unresolved.
      </p>
      <div className="space-y-4">
        {tasks.map((t) => {
          const fc = t.foreclosureCase;
          if (!fc) return null;
          const legal = fc.legalDescriptions[0];
          const ownerNames = [fc.borrower?.fullName, fc.grantor?.fullName, fc.currentOwner?.fullName].filter(Boolean).join(", ") || "Unknown";
          const candidates = fc.appraisalCandidates;
          const originalNotice = t.sourceDocument ?? fc.documents[0] ?? null;

          return (
            <Card key={t.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Badge tone="warning">{t.reason.replace(/_/g, " ")}</Badge>
                  <p className="mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {fc.county.name} County &middot; Owner: {ownerNames}
                  </p>
                  <p className="text-sm text-neutral-500">
                    Notice-stated address: {fc.property?.propertyStreetAddress ?? "None stated in notice"}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">{legal?.rawText ?? fc.property?.legalDescription ?? "No legal description recorded."}</p>
                  {originalNotice && (
                    <Link href={originalNotice.documentUrl} target="_blank" className="mt-1 inline-block text-xs text-brand-600 underline dark:text-brand-400">
                      View original foreclosure notice
                    </Link>
                  )}
                  {t.notes && <p className="mt-1 text-xs text-neutral-400">{t.notes}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={searchAgain.bind(null, t.id, fc.id)}>
                    <Button size="sm" variant="outline" type="submit">Search again</Button>
                  </form>
                  <form action={rejectAllCandidates.bind(null, t.id, fc.id)}>
                    <Button size="sm" variant="outline" type="submit">Reject all</Button>
                  </form>
                  <form action={markUnresolved.bind(null, t.id, fc.id)}>
                    <Button size="sm" variant="ghost" type="submit">Mark unresolved</Button>
                  </form>
                </div>
              </div>

              {candidates.length > 0 && (
                <div className="mb-3 space-y-2">
                  {candidates.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                      <div>
                        <p className="font-medium text-neutral-900 dark:text-neutral-50">
                          {c.situsAddress ?? "No situs address on record"} {c.isSelected && <Badge tone="success">Selected</Badge>}
                        </p>
                        <p className="text-neutral-500">
                          {c.ownerName ?? "Unknown owner"} &middot; {c.subdivision ?? "—"} Lot {c.lot ?? "—"} Blk {c.block ?? "—"} &middot;{" "}
                          {formatCurrencyCents(c.appraisedValueCents)}
                          {c.taxYear ? ` (${c.taxYear})` : ""}
                        </p>
                        <p className="mt-1 text-xs text-neutral-400">{explainMatch(c.matchedFields, c.conflictingFields)}</p>
                        {c.sourceUrl && (
                          <Link href={c.sourceUrl} target="_blank" className="mt-1 inline-block text-xs text-brand-600 underline dark:text-brand-400">
                            View on {fc.county.name} CAD
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {c.score !== null && <Badge tone={c.score >= 0.7 ? "success" : c.score >= 0.4 ? "warning" : "danger"}>{Math.round(c.score * 100)}%</Badge>}
                        <form action={approveCandidate.bind(null, t.id, fc.id, c.id)}>
                          <Button size="sm" type="submit">Approve</Button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form action={enterManually.bind(null, t.id, fc.id)} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <label className="text-xs text-neutral-500">
                  Street address
                  <input name="streetAddress" className="mt-1 block h-9 w-56 rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="text-xs text-neutral-500">
                  City
                  <input name="city" className="mt-1 block h-9 w-32 rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="text-xs text-neutral-500">
                  ZIP
                  <input name="zipCode" className="mt-1 block h-9 w-24 rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <Button size="sm" variant="secondary" type="submit">Enter manually</Button>
              </form>
            </Card>
          );
        })}
        {tasks.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState message="No open address-resolution tasks." hint="Every case either has a stated address or has already been reviewed." />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
