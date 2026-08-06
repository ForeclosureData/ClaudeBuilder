import { revalidatePath } from "next/cache";
import { prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, type ResolutionInput } from "@foreclosuredata/foreclosure-core";
import { getCurrentProfileId } from "@/lib/supabase/server";
import { getCountyAppraisalAdapter } from "@/lib/appraisal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/properties/empty-state";
import { formatCurrencyCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ADDRESS_REASONS = ["NO_ADDRESS_RESOLVED", "MULTIPLE_APPRAISAL_MATCHES"] as const;

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

    const propertyData = {
      propertyStreetAddress: candidate.situsAddress,
      city: candidate.city,
      legalDescription: candidate.legalDescription,
      subdivision: candidate.subdivision,
      lot: candidate.lot,
      block: candidate.block,
      acreage: candidate.acreage,
      propertyIdNumber: candidate.parcelId,
      geographicId: candidate.geographicId,
      classification: candidate.classification,
      appraisedValueCents: candidate.appraisedValueCents,
      assessedValueCents: candidate.assessedValueCents,
      estimatedMarketValueCents: candidate.marketValueCents,
      addressResolutionMethod: "MANUAL" as const,
      addressResolutionConfidence: 1,
      addressResolutionExplanation: "Manually approved by an administrator from a scored appraisal-district candidate.",
    };

    let propertyId = fc.propertyId;
    if (propertyId) {
      await tx.property.update({ where: { id: propertyId }, data: propertyData });
    } else {
      const county = await tx.county.findUnique({ where: { id: fc.countyId } });
      const created = await tx.property.create({ data: { countyId: fc.countyId, state: county?.state ?? "TX", ...propertyData } });
      propertyId = created.id;
      await tx.foreclosureCase.update({ where: { id: foreclosureCaseId }, data: { propertyId } });
    }

    if (candidate.taxYear && candidate.appraisedValueCents !== null) {
      await tx.appraisalValueHistory.upsert({
        where: { propertyId_taxYear: { propertyId, taxYear: candidate.taxYear } },
        create: {
          propertyId,
          taxYear: candidate.taxYear,
          landValueCents: candidate.landValueCents,
          improvementValueCents: candidate.improvementValueCents,
          appraisedValueCents: candidate.appraisedValueCents,
          assessedValueCents: candidate.assessedValueCents,
          marketValueCents: candidate.marketValueCents,
          homestead: candidate.homestead,
          sourceUrl: candidate.sourceUrl,
        },
        update: {
          landValueCents: candidate.landValueCents,
          improvementValueCents: candidate.improvementValueCents,
          appraisedValueCents: candidate.appraisedValueCents,
          assessedValueCents: candidate.assessedValueCents,
          marketValueCents: candidate.marketValueCents,
          homestead: candidate.homestead,
          sourceUrl: candidate.sourceUrl,
        },
      });
    }

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
  const ownerNames = [fc.borrower?.fullName, fc.grantor?.fullName, fc.currentOwner?.fullName, ...fc.coOwnerNames].filter((n): n is string => Boolean(n));

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
      foreclosureCase: {
        include: {
          county: true,
          property: true,
          borrower: true,
          grantor: true,
          currentOwner: true,
          legalDescriptions: { orderBy: { createdAt: "desc" }, take: 1 },
          appraisalCandidates: { orderBy: { score: "desc" } },
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

          return (
            <Card key={t.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Badge tone="warning">{t.reason.replace(/_/g, " ")}</Badge>
                  <p className="mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {fc.county.name} County &middot; Owner: {ownerNames}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">{legal?.rawText ?? fc.property?.legalDescription ?? "No legal description recorded."}</p>
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
                        </p>
                        {(c.matchedFields.length > 0 || c.conflictingFields.length > 0) && (
                          <p className="mt-1 text-xs text-neutral-400">
                            {c.matchedFields.length > 0 && <span>Matched: {c.matchedFields.join(", ")}</span>}
                            {c.conflictingFields.length > 0 && <span className="ml-2 text-danger-500">Conflicting: {c.conflictingFields.join(", ")}</span>}
                          </p>
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
