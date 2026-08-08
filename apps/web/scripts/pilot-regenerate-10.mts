/**
 * 10-case bounded derived-data regeneration pilot (2026-08-08), run via
 * GitHub Actions rather than a Netlify Function because CAD requests are
 * deliberately rate-limited (~2s/request; see hidalgoCadClient.ts's
 * REQUEST_DELAY_MS) and a 10-case run can take several minutes end to
 * end -- too long for a serverless function, same reasoning as
 * ci-ingest-hidalgo.mts.
 *
 * Scope, exactly as approved:
 *  - Exactly the 10 hard-coded ForeclosureCase IDs below. No discovery,
 *    no ingestion, no SourceDocument creation, no ForeclosureCase writes
 *    of any kind, no new county, no AI calls (resolvePropertyAddress
 *    never calls an LLM -- CAD-only by construction).
 *  - Existing notice-transcribed Property addresses (46 cases baseline-
 *    wide, 4 in this sample) are NEVER overwritten. CAD is enrichment/
 *    verification only for those: it may attach propertyIdNumber,
 *    geographicId, latitude/longitude, and AppraisalValueHistory rows,
 *    but never propertyStreetAddress/city/subdivision/lot/block/
 *    legalDescription/classification -- see attachCadEnrichment() below,
 *    which is a deliberately narrower write than the admin page's
 *    upsertPropertyFromAppraisalData() (that function overwrites
 *    propertyStreetAddress with the CAD address and is NOT reused here
 *    for that reason).
 *  - NO_ADDRESS_RESOLVED cases never get an automatic Property
 *    assignment, matching the existing admin design's human-Approve
 *    gate -- candidates are stored for review, never auto-applied,
 *    regardless of score.
 *  - Every conflict/threshold safeguard already in resolver.ts/scoring.ts
 *    (owner-conflict gating, subdivision-conflict gating, auto-accept/
 *    review/margin thresholds) is reused as-is via resolvePropertyAddress
 *    -- nothing here re-implements or loosens any of it.
 */
import { prisma } from "@foreclosuredata/database";
import { resolvePropertyAddress, buildLegalDescriptionCacheKey, type ResolutionInput } from "@foreclosuredata/foreclosure-core";
import { getCountyAppraisalAdapter } from "../lib/appraisal";

// ── Fixed pilot scope -- exactly these 10, documented before this script
// was ever run (see docs/DEPLOYMENT.md's pilot report). ──────────────────
const PILOT_CASE_IDS = [
  "28284986-a090-4414-abb3-d990a23fda08", // HID-117911 -- existing address
  "d8f8c8da-c2cd-447f-bb04-4d91b8ffabc0", // HID-117957 -- existing address
  "bd2083f9-eeb7-4b3c-86d5-258471c16459", // HID-118234 -- existing address (Buchanan Estates -- historically relevant)
  "21397060-b5d3-42e7-88b8-8e1cd96eb22d", // HID-118198 -- existing address (messy legal description, owner unrecoverable)
  "1d5254cc-e6be-4760-8a7b-2ade341df3c3", // HID-117925 -- NO_ADDRESS_RESOLVED
  "9d251e2f-dc28-4095-a3e5-eb352aec144b", // HID-118210 -- NO_ADDRESS_RESOLVED
  "bd14d37d-b457-423b-95ec-d66c118db475", // HID-117931 -- NO_ADDRESS_RESOLVED (messy legal description)
  "58614cf8-888a-428f-842a-4d650a1bfb2a", // HID-118201 -- NO_ADDRESS_RESOLVED (messy legal description)
  "ca0e4aaf-7a4a-4917-8852-4e813b9535c9", // HID-118228 -- NO_ADDRESS_RESOLVED (recurring subdivision name, POOR_TEXT_QUALITY)
  "7cf34318-5849-43cf-ab64-3cd7bf10d089", // HID-118156 -- NO_ADDRESS_RESOLVED
] as const;

const MAX_REQUESTS_PER_CASE = intEnv("PILOT_MAX_REQUESTS_PER_CASE", 10);
const MAX_GLOBAL_REQUESTS = intEnv("PILOT_MAX_GLOBAL_REQUESTS", 60);
const VALUATION_MAX_YEARS_BACK = intEnv("PILOT_VALUATION_MAX_YEARS_BACK", 2);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Strips anything that looks like a DB connection string or an API key before printing. */
function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"')]+/gi, "[REDACTED_DB_URL]").replace(/sk-ant-[A-Za-z0-9_\-]+/gi, "[REDACTED_API_KEY]");
}

type CadStatus = "CAD_PARCEL_CONFIRMED" | "REQUIRES_HUMAN_APPROVAL" | "NO_CAD_MATCH" | "SKIPPED_GLOBAL_BUDGET_EXHAUSTED" | "ERROR";

interface CaseReport {
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

/**
 * Deliberately narrower than the admin page's upsertPropertyFromAppraisalData:
 * only ever touches propertyIdNumber/geographicId/latitude/longitude on an
 * EXISTING Property row. Never writes propertyStreetAddress, city,
 * subdivision, lot, block, legalDescription, or classification -- those
 * are notice-transcribed ground truth for the 46 existing-address cases
 * and this pilot is explicitly forbidden from touching them without a
 * human Approve.
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
async function upsertValuationHistory(propertyId: string, years: Array<{ taxYear: number; landValueCents: number | null; improvementValueCents: number | null; appraisedValueCents: number | null; assessedValueCents: number | null; marketValueCents: number | null; certified: boolean | null; populated: boolean; sourceUrl: string | null }>, homestead: boolean | null) {
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

async function processCase(caseId: string, globalBudget: { remaining: number }): Promise<CaseReport> {
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

  const perCaseBudget = { remaining: Math.min(MAX_REQUESTS_PER_CASE, globalBudget.remaining) };
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
      explanation: `[PILOT] ${outcome.resolution.explanation}`,
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
          years = await adapter.getValuationHistory(winner.sourcePropertyId, { maxYearsBack: VALUATION_MAX_YEARS_BACK, budget: valuationBudget });
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

      await prisma.auditLog.create({ data: { action: "PILOT_CAD_ENRICHMENT_ATTACHED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { sourcePropertyId: winner.sourcePropertyId, parcelId: winner.parcelId, geographicId: winner.geographicId } } });
    } else if (outcome.ownerConflictOnBestMatch) {
      report.cadStatus = "REQUIRES_HUMAN_APPROVAL";
      report.manualApprovalRequired = true;
      report.notes = "CAD's owner-of-record for the best-matching candidate conflicts with the notice borrower/grantor -- not auto-attached, routed to manual review.";
      const created = await ensureReviewTask(fc.id, "CAD_OWNER_CONFLICT", `[PILOT] ${report.notes} ${outcome.candidates.length} candidate(s) found this pass.`);
      await prisma.auditLog.create({ data: { action: "PILOT_CAD_OWNER_CONFLICT_FLAGGED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { candidateCount: outcome.candidates.length, newReviewTaskCreated: created } } });
    } else if (outcome.candidates.length > 0) {
      report.cadStatus = "REQUIRES_HUMAN_APPROVAL";
      report.manualApprovalRequired = true;
      report.notes = `${outcome.candidates.length} CAD candidate(s) found but no single unambiguous match -- routed to manual review, notice address left unchanged.`;
      const created = await ensureReviewTask(fc.id, "MULTIPLE_APPRAISAL_MATCHES", `[PILOT] ${report.notes}`);
      await prisma.auditLog.create({ data: { action: "PILOT_CAD_AMBIGUOUS_CANDIDATES_FLAGGED", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { candidateCount: outcome.candidates.length, newReviewTaskCreated: created } } });
    } else {
      report.cadStatus = "NO_CAD_MATCH";
      report.notes = "No CAD candidates found for this notice-resolved address. Notice address remains the only known location for this property.";
      await prisma.auditLog.create({ data: { action: "PILOT_NO_CAD_MATCH", entityType: "ForeclosureCase", entityId: fc.id } });
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
      if (openTask) await prisma.manualReviewTask.update({ where: { id: openTask.id }, data: { notes: `[PILOT] ${report.notes}` } });
      await prisma.auditLog.create({ data: { action: "PILOT_UNRESOLVED_CANDIDATES_FOUND", entityType: "ForeclosureCase", entityId: fc.id, afterJson: { candidateCount: outcome.candidates.length, hasSingleWinner: !!winner } } });
    } else {
      report.cadStatus = "NO_CAD_MATCH";
      report.notes = "No CAD candidates found this pass; case remains unresolved.";
      if (openTask) await prisma.manualReviewTask.update({ where: { id: openTask.id }, data: { notes: `[PILOT] ${report.notes}` } });
      await prisma.auditLog.create({ data: { action: "PILOT_UNRESOLVED_NO_MATCH", entityType: "ForeclosureCase", entityId: fc.id } });
    }
  }

  return report;
}

async function main() {
  const startedAt = Date.now();
  console.log(`=== 10-case CAD regeneration pilot (${new Date().toISOString()}) ===`);
  console.log(`Case count: ${PILOT_CASE_IDS.length} (hard-coded, no discovery)`);
  console.log(`Per-case CAD request cap: ${MAX_REQUESTS_PER_CASE}`);
  console.log(`Global CAD request cap: ${MAX_GLOBAL_REQUESTS}`);
  console.log(`Valuation year lookback: ${VALUATION_MAX_YEARS_BACK}`);
  console.log(`Rate limiting: inherited from hidalgoCadClient (single in-flight request, HIDALGO_CAD_REQUEST_DELAY_MS between requests)`);

  const globalBudget = { remaining: MAX_GLOBAL_REQUESTS };
  const reports: CaseReport[] = [];

  for (const caseId of PILOT_CASE_IDS) {
    try {
      const report = await processCase(caseId, globalBudget);
      reports.push(report);
      console.log(`\n[${report.caseNumber}] ${report.cadStatus} -- requests=${report.cadRequestsUsed}, candidates=${report.candidatesReturned}, propertyChanged=${report.existingProductionFieldChanged}`);
    } catch (err) {
      const message = err instanceof Error ? redact(err.message) : redact(String(err));
      console.error(`\n[${caseId}] ERROR: ${message}`);
      reports.push({
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
      });
      try {
        await prisma.auditLog.create({ data: { action: "PILOT_CASE_FAILED", entityType: "ForeclosureCase", entityId: caseId, afterJson: { error: message } } });
      } catch {
        // Isolation: even a failure to write the failure audit log must not abort the loop.
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const aggregates = {
    existingAddressCadConfirmed: reports.filter((r) => r.addressResolvedFromNotice && r.cadStatus === "CAD_PARCEL_CONFIRMED").length,
    unresolvedWithViableCandidate: reports.filter((r) => !r.addressResolvedFromNotice && r.cadStatus === "REQUIRES_HUMAN_APPROVAL").length,
    unresolvedStillUnresolved: reports.filter((r) => !r.addressResolvedFromNotice && r.cadStatus === "NO_CAD_MATCH").length,
    ownerConflicts: reports.filter((r) => r.conflictingFields.includes("ownerName")).length,
    subdivisionOrFieldConflicts: reports.filter((r) => r.conflictingFields.some((f) => f !== "ownerName")).length,
    ambiguousMatches: reports.filter((r) => r.cadStatus === "REQUIRES_HUMAN_APPROVAL" && !r.selectedOrProposedCandidate).length,
    valuationEnrichmentRate: reports.filter((r) => r.valuationYear !== null).length,
    totalCadRequests: reports.reduce((s, r) => s + r.cadRequestsUsed, 0),
    averageCadRequestsPerCase: reports.length ? reports.reduce((s, r) => s + r.cadRequestsUsed, 0) / reports.length : 0,
    maxCadRequestsSingleCase: reports.length ? Math.max(...reports.map((r) => r.cadRequestsUsed)) : 0,
    errors: reports.filter((r) => r.cadStatus === "ERROR").length,
    skippedGlobalBudget: reports.filter((r) => r.cadStatus === "SKIPPED_GLOBAL_BUDGET_EXHAUSTED").length,
    runtimeSeconds: elapsedMs / 1000,
  };

  console.log(`\n=== Pilot summary ===`);
  console.log(JSON.stringify({ reports, aggregates }, null, 2));

  await prisma.auditLog.create({
    data: {
      action: "PILOT_REGENERATION_10_CASE_RUN_SUMMARY",
      entityType: "PilotRun",
      entityId: "2026-08-08-10-case-pilot",
      afterJson: { aggregates, caseIds: PILOT_CASE_IDS },
    },
  });

  console.log(`\nTotal runtime: ${aggregates.runtimeSeconds.toFixed(1)}s`);
  console.log(`Anthropic cost: $0.00 (no AI calls in this pipeline stage)`);
}

main()
  .catch((err) => {
    console.error("FATAL:", err instanceof Error ? redact(err.message) : redact(String(err)));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
