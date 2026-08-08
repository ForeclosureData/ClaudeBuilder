/**
 * Shared per-case derived-data regeneration logic, used by both the
 * 10-case pilot script (apps/web/scripts/pilot-regenerate-10.mts,
 * already run and reported in docs/DEPLOYMENT.md) and the 72-case bulk
 * regeneration script (apps/web/scripts/regenerate-remaining-72.mts).
 * Factored out so a safety fix here benefits both, and so the two scripts
 * can never drift apart on what "safe" means.
 *
 * Safety contract (unchanged from the pilot):
 *  - Never overwrites a notice-transcribed Property address. See
 *    attachCadEnrichment() -- deliberately narrower than the admin page's
 *    upsertPropertyFromAppraisalData(), which does overwrite
 *    propertyStreetAddress and is NOT reused here for that reason.
 *  - NO_ADDRESS_RESOLVED cases never get an automatic Property
 *    assignment, regardless of confidence -- candidates are stored for
 *    review only, matching the existing admin-approval design.
 *  - Every conflict/threshold safeguard in resolver.ts/scoring.ts (owner-
 *    conflict gating, subdivision-conflict gating, auto-accept/review/
 *    margin thresholds) is reused as-is via resolvePropertyAddress --
 *    nothing here re-implements or loosens any of it.
 *  - No ForeclosureCase/SourceDocument writes, no ingestion, no AI calls
 *    (resolvePropertyAddress is CAD-only by construction).
 */
import { prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, type ResolutionInput } from "@foreclosuredata/foreclosure-core";
import { getCountyAppraisalAdapter } from "../appraisal";

export type CadStatus = "CAD_PARCEL_CONFIRMED" | "REQUIRES_HUMAN_APPROVAL" | "NO_CAD_MATCH" | "SKIPPED_GLOBAL_BUDGET_EXHAUSTED" | "ERROR";

export interface CaseReport {
  foreclosureCaseId: string;
  caseNumber: string | null;
  addressResolvedFromNotice: boolean;
  existingNoticeAddress: string | null;
  owner: string | null;
  legalDescriptionSummary: string | null;
  cadRequestsUsed: number;
  candidatesReturned: number;
  selectedOrProposedCandidate: { sourcePropertyId: string; situsAddress: string | null; parcelId: string | null; geographicId: string | null } | null;
  confidence: number | null;
  matchedFields: string[];
  conflictingFields: string[];
  propertyId: string | null;
  geographicId: string | null;
  valuationYear: number | null;
  countyMarketValueCents: number | null;
  countyAppraisedValueCents: number | null;
  landValueCents: number | null;
  improvementValueCents: number | null;
  certified: boolean | null;
  manualApprovalRequired: boolean;
  existingProductionFieldChanged: boolean;
  cadStatus: CadStatus;
  notes: string;
}

export function blankErrorReport(caseId: string, message: string): CaseReport {
  return {
    foreclosureCaseId: caseId,
    caseNumber: null,
    addressResolvedFromNotice: false,
    existingNoticeAddress: null,
    owner: null,
    legalDescriptionSummary: null,
    cadRequestsUsed: 0,
    candidatesReturned: 0,
    selectedOrProposedCandidate: null,
    confidence: null,
    matchedFields: [],
    conflictingFields: [],
    propertyId: null,
    geographicId: null,
    valuationYear: null,
    countyMarketValueCents: null,
    countyAppraisedValueCents: null,
    landValueCents: null,
    improvementValueCents: null,
    certified: null,
    manualApprovalRequired: false,
    existingProductionFieldChanged: false,
    cadStatus: "ERROR",
    notes: message,
  };
}

/**
 * Deliberately narrower than the admin page's upsertPropertyFromAppraisalData:
 * only ever touches propertyIdNumber/geographicId/latitude/longitude on an
 * EXISTING Property row. Never writes propertyStreetAddress, city,
 * subdivision, lot, block, legalDescription, or classification -- those
 * are notice-transcribed ground truth and this pipeline is forbidden from
 * touching them without a human Approve.
 */
async function attachCadEnrichment(propertyId: string, data: { parcelId: string | null; geographicId: string | null; latitude: number | null; longitude: number | null }) {
  await prisma.property.update({
    where: { id: propertyId },
    data: {
      propertyIdNumber: data.parcelId ?? undefined,
      geographicId: data.geographicId ?? undefined,
      latitude: data.latitude ?? undefined,
      longitude: data.longitude ?? undefined,
    },
  });
}

/** Append-only per (propertyId, taxYear), never overwrites a different year, skips any year with no populated values ("do not fabricate zeroes"). */
async function upsertValuationHistory(
  propertyId: string,
  years: Array<{ taxYear: number; landValueCents: number | null; improvementValueCents: number | null; appraisedValueCents: number | null; assessedValueCents: number | null; marketValueCents: number | null; certified: boolean | null; populated: boolean; sourceUrl: string | null }>,
  homestead: boolean | null,
) {
  let written = 0;
  for (const y of years) {
    if (!y.populated) continue;
    await prisma.appraisalValueHistory.upsert({
      where: { propertyId_taxYear: { propertyId, taxYear: y.taxYear } },
      create: { propertyId, taxYear: y.taxYear, landValueCents: y.landValueCents, improvementValueCents: y.improvementValueCents, appraisedValueCents: y.appraisedValueCents, assessedValueCents: y.assessedValueCents, marketValueCents: y.marketValueCents, certified: y.certified, homestead, sourceUrl: y.sourceUrl },
      update: { landValueCents: y.landValueCents, improvementValueCents: y.improvementValueCents, appraisedValueCents: y.appraisedValueCents, assessedValueCents: y.assessedValueCents, marketValueCents: y.marketValueCents, certified: y.certified, homestead, sourceUrl: y.sourceUrl },
    });
    written++;
  }
  return written;
}

async function ensureReviewTask(foreclosureCaseId: string, reason: "CAD_OWNER_CONFLICT" | "MULTIPLE_APPRAISAL_MATCHES", notes: string): Promise<boolean> {
  const existing = await prisma.manualReviewTask.findFirst({ where: { foreclosureCaseId, reason, status: "OPEN" } });
  if (existing) {
    await prisma.manualReviewTask.update({ where: { id: existing.id }, data: { notes } });
    return false;
  }
  await prisma.manualReviewTask.create({ data: { foreclosureCaseId, reason, status: "OPEN", notes } });
  return true;
}

export interface RegenerateCaseOptions {
  /** Hard per-case cap on live CAD requests (searches + valuation-history lookup combined). */
  maxRequestsPerCase: number;
  /** How many years to walk backward looking for a populated/certified value (2027 -> 2026 -> ... ). */
  valuationMaxYearsBack: number;
  /** Short tag written into notes/explanations and audit logs to distinguish which run produced a given row (e.g. "PILOT-10", "BULK-72"). */
  runLabel: string;
}

export async function regenerateCase(caseId: string, globalBudget: { remaining: number }, options: RegenerateCaseOptions): Promise<CaseReport> {
  const fc = await prisma.foreclosureCase.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      county: true,
      property: true,
      borrower: true,
      grantor: true,
      currentOwner: true,
      legalDescriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const legal = fc.legalDescriptions[0];
  const legalForInput = legal
    ? { rawText: legal.rawText, subdivision: legal.subdivision, lot: legal.lot, block: legal.block, acreage: null as number | null }
    : fc.property
      ? { rawText: fc.property.legalDescription, subdivision: fc.property.subdivision, lot: fc.property.lot, block: fc.property.block, acreage: fc.property.acreage }
      : null;
  const ownerNames = [fc.borrower?.fullName, fc.grantor?.fullName, fc.currentOwner?.fullName, ...fc.coOwnerNames].filter((n): n is string => Boolean(n));
  const hasExistingAddress = !!fc.propertyId && !!fc.property?.propertyStreetAddress;

  // Correctly triggers resolvePropertyAddress's enrichment-only branch for
  // already-resolved cases (the address is never re-derived or replaced,
  // only enriched) -- the admin page's searchAgain() omits this and always
  // takes the general candidate-scoring path even for known-address cases.
  const statedAddressMethod: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE" | null =
    fc.property?.addressResolutionMethod === "EXPLICIT_STATED" ? "EXPLICIT_STATED" : fc.property?.addressResolutionMethod === "COMMONLY_KNOWN_AS_PHRASE" ? "COMMONLY_KNOWN_AS_PHRASE" : null;

  const input: ResolutionInput = {
    statedPropertyAddress: fc.property?.propertyStreetAddress ?? null,
    statedAddressMethod,
    legalDescription: legalForInput,
    ownerNames,
    ownerMailingAddress: fc.borrower?.mailingAddress ?? null,
    propertyIdFromNotice: fc.property?.propertyIdNumber ?? null,
    geographicIdFromNotice: fc.property?.geographicId ?? null,
    city: fc.property?.city ?? null,
  };

  const report: CaseReport = {
    foreclosureCaseId: fc.id,
    caseNumber: fc.caseNumber,
    addressResolvedFromNotice: hasExistingAddress,
    existingNoticeAddress: fc.property?.propertyStreetAddress ?? null,
    owner: ownerNames[0] ?? null,
    legalDescriptionSummary: legalForInput ? `${legalForInput.subdivision ?? "?"} Lot ${legalForInput.lot ?? "?"}${legalForInput.block ? ` Block ${legalForInput.block}` : ""}` : null,
    cadRequestsUsed: 0,
    candidatesReturned: 0,
    selectedOrProposedCandidate: null,
    confidence: null,
    matchedFields: [],
    conflictingFields: [],
    propertyId: fc.propertyId,
    geographicId: fc.property?.geographicId ?? null,
    valuationYear: null,
    countyMarketValueCents: null,
    countyAppraisedValueCents: null,
    landValueCents: null,
    improvementValueCents: null,
    certified: null,
    manualApprovalRequired: false,
    existingProductionFieldChanged: false,
    cadStatus: "NO_CAD_MATCH",
    notes: "",
  };

  if (globalBudget.remaining <= 0) {
    report.cadStatus = "SKIPPED_GLOBAL_BUDGET_EXHAUSTED";
    report.notes = "Global CAD request budget was exhausted before this case could be processed.";
    return report;
  }

  const perCaseBudget = { remaining: Math.min(options.maxRequestsPerCase, globalBudget.remaining) };
  const adapter = getCountyAppraisalAdapter(fc.county.slug);
  const outcome = await resolvePropertyAddress(input, adapter, undefined, perCaseBudget);
  globalBudget.remaining -= outcome.requestsUsed;

  report.cadRequestsUsed = outcome.requestsUsed;
  report.candidatesReturned = outcome.candidates.length;
  report.matchedFields = outcome.resolution.matchedFields;
  report.conflictingFields = outcome.resolution.conflictingFields;

  // Always persist candidates as evidence, regardless of classification --
  // never touches Property.
  if (outcome.candidates.length > 0) {
    await prisma.appraisalPropertyCandidate.createMany({
      data: outcome.candidates.map((c) => ({
        foreclosureCaseId: fc.id,
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
  }
  await prisma.propertyResolutionAttempt.create({
    data: {
      foreclosureCaseId: fc.id,
      resolutionMethod: outcome.address.addressResolutionMethod,
      confidence: outcome.resolution.confidence,
      explanation: `[${options.runLabel}] ${outcome.resolution.explanation}`,
      matchedFields: outcome.resolution.matchedFields,
      conflictingFields: outcome.resolution.conflictingFields,
      candidateCount: outcome.resolution.candidateCount,
      requiresManualReview: outcome.resolution.requiresManualReview,
      selectedCandidateId: outcome.resolution.selectedCandidateId,
    },
  });

  const winner = outcome.selectedCandidate;

  if (hasExistingAddress) {
    if (winner) {
      report.cadStatus = "CAD_PARCEL_CONFIRMED";
      report.selectedOrProposedCandidate = { sourcePropertyId: winner.sourcePropertyId, situsAddress: winner.situsAddress, parcelId: winner.parcelId, geographicId: winner.geographicId };
      report.confidence = outcome.resolution.confidence;
      report.propertyId = winner.parcelId ?? fc.propertyId;
      report.geographicId = winner.geographicId;
      report.notes = "Single unambiguous CAD match found; attached parcel ID / GEO ID / lat-long as enrichment. Notice-transcribed address left unchanged.";

      await prisma.appraisalPropertyCandidate.updateMany({ where: { foreclosureCaseId: fc.id, sourcePropertyId: winner.sourcePropertyId }, data: { isSelected: true } });

      if (fc.propertyId) {
        await attachCadEnrichment(fc.propertyId, { parcelId: winner.parcelId, geographicId: winner.geographicId, latitude: winner.latitude, longitude: winner.longitude });
        report.existingProductionFieldChanged = true;

        let years: Awaited<ReturnType<NonNullable<typeof adapter.getValuationHistory>>> = [];
        if (adapter.getValuationHistory && globalBudget.remaining > 0) {
          const valuationBudget = { remaining: Math.min(perCaseBudget.remaining, globalBudget.remaining) };
          years = await adapter.getValuationHistory(winner.sourcePropertyId, { maxYearsBack: options.valuationMaxYearsBack, budget: valuationBudget });
          const used = Math.min(perCaseBudget.remaining, globalBudget.remaining) - valuationBudget.remaining;
          report.cadRequestsUsed += used;
          globalBudget.remaining -= used;
        }
        const populatedYear = years.find((y) => y.populated) ?? null;
        if (populatedYear) {
          await upsertValuationHistory(fc.propertyId, years, winner.homestead);
          report.valuationYear = populatedYear.taxYear;
          report.countyMarketValueCents = populatedYear.marketValueCents;
          report.countyAppraisedValueCents = populatedYear.appraisedValueCents;
          report.landValueCents = populatedYear.landValueCents;
          report.improvementValueCents = populatedYear.improvementValueCents;
          report.certified = populatedYear.certified;
        } else if (winner.taxYear && winner.appraisedValueCents !== null) {
          // Fall back to the single-year value already on the winning
          // candidate if the adapter has no getValuationHistory or it
          // returned nothing populated.
          await upsertValuationHistory(fc.propertyId, [{ taxYear: winner.taxYear, landValueCents: winner.landValueCents, improvementValueCents: winner.improvementValueCents, appraisedValueCents: winner.appraisedValueCents, assessedValueCents: winner.assessedValueCents, marketValueCents: winner.marketValueCents, certified: null, populated: true, sourceUrl: winner.sourceUrl ?? null }], winner.homestead);
          report.valuationYear = winner.taxYear;
          report.countyMarketValueCents = winner.marketValueCents;
          report.countyAppraisedValueCents = winner.appraisedValueCents;
          report.landValueCents = winner.landValueCents;
          report.improvementValueCents = winner.improvementValueCents;
        }
      }

      await prisma.auditLog.create({ data: { action: "CAD_ENRICHMENT_ATTACHED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel, sourcePropertyId: winner.sourcePropertyId, parcelId: winner.parcelId, geographicId: winner.geographicId } } });
    } else if (outcome.ownerConflictOnBestMatch) {
      report.cadStatus = "REQUIRES_HUMAN_APPROVAL";
      report.manualApprovalRequired = true;
      report.notes = "CAD's owner-of-record for the best-matching candidate conflicts with the notice borrower/grantor -- not auto-attached, routed to manual review.";
      const created = await ensureReviewTask(fc.id, "CAD_OWNER_CONFLICT", `[${options.runLabel}] ${report.notes} ${outcome.candidates.length} candidate(s) found this pass.`);
      await prisma.auditLog.create({ data: { action: "CAD_OWNER_CONFLICT_FLAGGED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel, candidateCount: outcome.candidates.length, newReviewTaskCreated: created } } });
    } else if (outcome.candidates.length > 0) {
      report.cadStatus = "REQUIRES_HUMAN_APPROVAL";
      report.manualApprovalRequired = true;
      report.notes = `${outcome.candidates.length} CAD candidate(s) found but no single unambiguous match -- routed to manual review, notice address left unchanged.`;
      const created = await ensureReviewTask(fc.id, "MULTIPLE_APPRAISAL_MATCHES", `[${options.runLabel}] ${report.notes}`);
      await prisma.auditLog.create({ data: { action: "CAD_AMBIGUOUS_CANDIDATES_FLAGGED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel, candidateCount: outcome.candidates.length, newReviewTaskCreated: created } } });
    } else {
      report.cadStatus = "NO_CAD_MATCH";
      report.notes = "No CAD candidates found for this notice-resolved address. Notice address remains the only known location for this property.";
      await prisma.auditLog.create({ data: { action: "NO_CAD_MATCH", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel } } });
    }
  } else {
    // NO_ADDRESS_RESOLVED case -- never auto-writes Property, matches the
    // existing admin-approval design regardless of confidence.
    const openTask = await prisma.manualReviewTask.findFirst({ where: { foreclosureCaseId: fc.id, reason: "NO_ADDRESS_RESOLVED", status: "OPEN" } });
    if (outcome.candidates.length > 0) {
      report.cadStatus = "REQUIRES_HUMAN_APPROVAL";
      report.manualApprovalRequired = true;
      if (winner) {
        report.selectedOrProposedCandidate = { sourcePropertyId: winner.sourcePropertyId, situsAddress: winner.situsAddress, parcelId: winner.parcelId, geographicId: winner.geographicId };
        report.confidence = outcome.resolution.confidence;
        report.notes = `High-confidence single CAD candidate found (score ${outcome.resolution.confidence.toFixed(2)}) -- stored for review, NOT auto-applied to Property (admin Approve required by design).`;
      } else {
        report.confidence = outcome.resolution.confidence;
        report.notes = `${outcome.candidates.length} CAD candidate(s) found, none unambiguous enough to auto-select -- stored for manual review.`;
      }
      if (openTask) await prisma.manualReviewTask.update({ where: { id: openTask.id }, data: { notes: `[${options.runLabel}] ${report.notes}` } });
      await prisma.auditLog.create({ data: { action: "UNRESOLVED_CANDIDATES_FOUND", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel, candidateCount: outcome.candidates.length, hasSingleWinner: !!winner } } });
    } else {
      report.cadStatus = "NO_CAD_MATCH";
      report.notes = "No CAD candidates found this pass; case remains unresolved.";
      if (openTask) await prisma.manualReviewTask.update({ where: { id: openTask.id }, data: { notes: `[${options.runLabel}] ${report.notes}` } });
      await prisma.auditLog.create({ data: { action: "UNRESOLVED_NO_MATCH", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { runLabel: options.runLabel } } });
    }
  }

  return report;
}
