/**
 * Fix round 3 verification + targeted backfill (2026-08-09), scoped to
 * EXACTLY the four records named in the approved fix request -- no other
 * notice is touched, no new notices are ingested:
 *
 *  - HID-117888: total extraction failure (0/18 fields) on a previously
 *    unseen narrative template. Re-runs the full pipeline (now fixed) and
 *    backfills any field where the current stored value is null, OR is a
 *    demonstrable TRUNCATION of the corrected value (old value is a
 *    case-insensitive prefix of the new one -- the exact shape of the
 *    line-wrap/character-budget bugs this round fixed). A non-null value
 *    that is NOT a prefix relationship is left untouched and reported as
 *    skipped, per the same "never overwrite a value that isn't
 *    demonstrably wrong" policy as the Phase 1 backfill.
 *  - HID-117914: borrower-name line-wrap truncation. Same re-run +
 *    prefix-safe backfill policy.
 *  - HID-117729 / HID-117731: same real-world notice under two different
 *    county filing numbers. NEVER merged, NEVER archived, NO field on
 *    either case is touched. Only scores the pair with
 *    scoreDuplicateEvidence() and, if flagged, creates ONE
 *    PossibleDuplicateNoticeLink row (or updates it if a prior run already
 *    created it) plus a ManualReviewTask so it surfaces in the existing
 *    admin review queue too.
 *
 * DRY_RUN (default true) computes and reports every change without
 * writing anything. Only FIX_ROUND_3_DRY_RUN=false performs real writes.
 */
import { prisma } from "@foreclosuredata/database";
import { runExtractionPipeline, parseLegalDescription, scoreDuplicateEvidence, type DuplicateComparisonCaseSnapshot } from "@foreclosuredata/foreclosure-core";
import { DocumentProcessingStatus, OrganizationType } from "@foreclosuredata/database";

const CODE_VERSION = "fix-round-3-reeval@2026-08-09";
const DRY_RUN = process.env.FIX_ROUND_3_DRY_RUN !== "false";
const MAX_AI_CALLS = 4; // 2 records x up to 2 attempts each (bounded retry-on-total-failure)

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

function isPrefixTruncation(oldValue: string, newValue: string): boolean {
  const oldNorm = oldValue.trim().toUpperCase();
  const newNorm = newValue.trim().toUpperCase();
  return oldNorm.length > 0 && oldNorm.length < newNorm.length && newNorm.startsWith(oldNorm);
}

async function reEvalAndBackfillCase(filingNumber: string, budget: { hasHeadroom(n: number): Promise<boolean>; recordSpend(c: number): Promise<void> }) {
  const fc = await prisma.foreclosureCase.findFirst({
    where: { countyFilingNumber: filingNumber },
    include: {
      documents: { orderBy: { dateCollected: "desc" }, take: 1 },
      loan: { include: { originalLender: true, currentMortgagee: true, mortgageServicer: true } },
      sales: true,
      legalDescriptions: true,
      borrower: true,
    },
  });
  if (!fc) return { filingNumber, skipped: "Case not found", changes: [] as FieldChange[] };
  const doc = fc.documents[0];
  if (!doc?.rawText) return { filingNumber, skipped: "No SourceDocument.rawText available", changes: [] as FieldChange[] };

  const before18Fields = {
    borrowerNames: fc.borrower?.fullName ?? null,
    originalPrincipalAmountCents: fc.loan?.originalPrincipalAmountCents ?? null,
    deedOfTrustDate: fc.loan?.deedOfTrustDate ?? null,
    instrumentNumber: fc.loan?.instrumentNumber ?? null,
    recordingDate: fc.loan?.recordingDate ?? null,
    originalMortgagee: fc.loan?.originalLender?.name ?? null,
    currentMortgagee: fc.loan?.currentMortgagee?.name ?? null,
    mortgageServicer: fc.loan?.mortgageServicer?.name ?? null,
    saleDate: fc.sales[0]?.saleDate ?? null,
    saleTime: fc.sales[0]?.saleTime ?? null,
    saleLocation: fc.sales[0]?.saleLocation ?? null,
    legalDescription: fc.legalDescriptions[0]?.rawText ?? null,
  };

  const pipelineResult = await runExtractionPipeline(doc.rawText, budget, { model: process.env.AI_EXTRACTION_MODEL });
  const extracted = pipelineResult.extracted;
  const newSourceLabel = pipelineResult.usedAiFallback ? "deterministic+ai" : "deterministic";

  const changes: FieldChange[] = [];

  const newBorrowerJoined = (extracted.grantorNames.value ?? extracted.borrowerNames.value ?? []).join(", ") || null;
  const oldBorrowerName = fc.borrower?.fullName ?? null;
  if (newBorrowerJoined && (!oldBorrowerName || oldBorrowerName === "Unknown owner")) {
    changes.push({ field: "borrowerNames", oldValue: oldBorrowerName, newValue: newBorrowerJoined, reason: "Gap: old value was null/placeholder." });
  } else if (newBorrowerJoined && oldBorrowerName && isPrefixTruncation(oldBorrowerName, newBorrowerJoined)) {
    changes.push({ field: "borrowerNames", oldValue: oldBorrowerName, newValue: newBorrowerJoined, reason: "Truncation repair: old value is a prefix of the corrected value (real line-wrap defect)." });
  }

  const newLegal = extracted.legalDescription.value;
  const oldLegal = fc.legalDescriptions[0]?.rawText ?? null;
  if (newLegal && !oldLegal) {
    changes.push({ field: "legalDescription", oldValue: null, newValue: newLegal, reason: "Gap: no LegalDescription row existed." });
  } else if (newLegal && oldLegal && isPrefixTruncation(oldLegal, newLegal)) {
    changes.push({ field: "legalDescription", oldValue: oldLegal, newValue: newLegal, reason: "Truncation repair: old value is a prefix of the corrected value (real character-budget defect)." });
  }

  const newPrincipalCents = extracted.originalPrincipalAmount.value !== null ? Math.round(extracted.originalPrincipalAmount.value * 100) : null;
  if (newPrincipalCents !== null && fc.loan?.originalPrincipalAmountCents == null) {
    changes.push({ field: "originalPrincipalAmount", oldValue: null, newValue: newPrincipalCents, reason: "Gap: old value was null." });
  }

  if (fc.sales.length === 0 && extracted.saleDate.value) {
    changes.push({
      field: "saleDate/saleTime/saleLocation",
      oldValue: null,
      newValue: { saleDate: extracted.saleDate.value, saleTime: extracted.saleTime.value, saleLocation: extracted.saleLocation.value },
      reason: "Gap: no ForeclosureSale row existed.",
    });
  }

  const lenderChecks: Array<[string, string | null, string | null]> = [
    ["originalMortgagee", fc.loan?.originalLender?.name ?? null, extracted.originalMortgagee.value],
    ["currentMortgagee", fc.loan?.currentMortgagee?.name ?? null, extracted.currentMortgagee.value],
    ["mortgageServicer", fc.loan?.mortgageServicer?.name ?? null, extracted.mortgageServicer.value],
  ];
  for (const [field, oldVal, newVal] of lenderChecks) {
    if (!oldVal && newVal) changes.push({ field, oldValue: null, newValue: newVal, reason: "Gap: old value was null." });
  }

  if (!DRY_RUN && changes.length > 0) {
    await applyChanges(fc, changes, pipelineResult.overallConfidence, pipelineResult.usedAiFallback, doc.id);
  }

  return {
    filingNumber,
    caseId: fc.id,
    before: before18Fields,
    after: {
      borrowerNames: extracted.borrowerNames.value,
      lenderName: extracted.lenderName.value,
      originalMortgagee: extracted.originalMortgagee.value,
      currentMortgagee: extracted.currentMortgagee.value,
      originalPrincipalAmount: extracted.originalPrincipalAmount.value,
      deedOfTrustDate: extracted.deedOfTrustDate.value,
      instrumentNumber: extracted.instrumentNumber.value,
      legalDescription: extracted.legalDescription.value,
      saleDate: extracted.saleDate.value,
      saleTime: extracted.saleTime.value,
      saleLocation: extracted.saleLocation.value,
    },
    usedAiFallback: pipelineResult.usedAiFallback,
    aiFailureReason: pipelineResult.aiFailureReason,
    aiCostCents: pipelineResult.aiCostCents,
    changes,
  };
}

async function applyChanges(
  fc: { id: string; borrowerPersonId: string | null; loan: { id: string } | null; countyFilingNumber: string | null },
  changes: FieldChange[],
  overallConfidence: number,
  usedAiFallback: boolean,
  sourceDocumentId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      if (change.field === "borrowerNames" && fc.borrowerPersonId) {
        await tx.person.update({ where: { id: fc.borrowerPersonId }, data: { fullName: change.newValue as string } });
      } else if (change.field === "legalDescription") {
        const rawText = change.newValue as string;
        const parsed = parseLegalDescription(rawText);
        const existing = await tx.legalDescription.findFirst({ where: { foreclosureCaseId: fc.id } });
        if (existing) {
          await tx.legalDescription.update({ where: { id: existing.id }, data: { rawText, subdivision: parsed?.subdivision ?? null, lot: parsed?.lot ?? null, block: parsed?.block ?? null } });
        } else {
          await tx.legalDescription.create({ data: { foreclosureCaseId: fc.id, sourceDocumentId, rawText, subdivision: parsed?.subdivision ?? null, lot: parsed?.lot ?? null, block: parsed?.block ?? null } });
        }
      } else if (change.field === "originalPrincipalAmount" && fc.loan) {
        await tx.loan.update({ where: { id: fc.loan.id }, data: { originalPrincipalAmountCents: change.newValue as number } });
      } else if (change.field === "saleDate/saleTime/saleLocation") {
        const v = change.newValue as { saleDate: string; saleTime: string | null; saleLocation: string | null };
        await tx.foreclosureSale.create({ data: { foreclosureCaseId: fc.id, sourceDocumentId, saleDate: new Date(v.saleDate), saleTime: v.saleTime, saleLocation: v.saleLocation, earliestSaleDate: new Date(v.saleDate) } });
      } else if (fc.loan && change.field === "originalMortgagee") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.LENDER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { originalLenderOrgId: org.id } });
      } else if (fc.loan && change.field === "currentMortgagee") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.LENDER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { currentMortgageeOrgId: org.id } });
      } else if (fc.loan && change.field === "mortgageServicer") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.SERVICER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { mortgageServicerOrgId: org.id } });
      }

      await tx.auditLog.create({
        data: {
          action: `FIX_ROUND_3_${change.field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
          entityType: "ForeclosureCase",
          entityId: fc.id,
          beforeJson: { filingNumber: fc.countyFilingNumber, field: change.field, value: change.oldValue as object } as never,
          afterJson: { filingNumber: fc.countyFilingNumber, field: change.field, value: change.newValue as object, reason: change.reason, codeVersion: CODE_VERSION } as never,
        },
      });
    }
    await tx.sourceDocument.update({
      where: { id: sourceDocumentId },
      data: { extractionConfidence: overallConfidence, status: usedAiFallback ? DocumentProcessingStatus.AI_EXTRACTED : DocumentProcessingStatus.DETERMINISTIC_EXTRACTED },
    });
  });
}

async function scoreAndLinkDuplicatePair(filingA: string, filingB: string) {
  const include = {
    documents: { orderBy: { dateCollected: "desc" as const }, take: 1 },
    loan: { include: { originalLender: true, currentMortgagee: true } },
    sales: { orderBy: { saleDate: "desc" as const }, take: 1 },
    legalDescriptions: true,
    borrower: true,
    property: true,
  };
  const [a, b] = await Promise.all([
    prisma.foreclosureCase.findFirst({ where: { countyFilingNumber: filingA }, include }),
    prisma.foreclosureCase.findFirst({ where: { countyFilingNumber: filingB }, include }),
  ]);
  if (!a || !b) return { filingA, filingB, skipped: "One or both cases not found" };

  function toSnapshot(fc: NonNullable<typeof a>): DuplicateComparisonCaseSnapshot {
    return {
      caseId: fc.id,
      borrowerNames: fc.borrower?.fullName ? fc.borrower.fullName.split(",").map((s) => s.trim()) : [],
      propertyAddress: fc.property?.propertyStreetAddress ?? null,
      subdivision: fc.legalDescriptions[0]?.subdivision ?? fc.property?.subdivision ?? null,
      lot: fc.legalDescriptions[0]?.lot ?? fc.property?.lot ?? null,
      block: fc.legalDescriptions[0]?.block ?? fc.property?.block ?? null,
      originalPrincipalAmountCents: fc.loan?.originalPrincipalAmountCents ?? null,
      saleDate: fc.sales[0]?.saleDate ? fc.sales[0].saleDate.toISOString().slice(0, 10) : null,
      deedOfTrustDate: fc.loan?.deedOfTrustDate ? fc.loan.deedOfTrustDate.toISOString().slice(0, 10) : null,
      lenderName: fc.loan?.currentMortgagee?.name ?? fc.loan?.originalLender?.name ?? null,
      rawText: fc.documents[0]?.rawText ?? null,
    };
  }

  const snapA = toSnapshot(a);
  const snapB = toSnapshot(b);
  const result = scoreDuplicateEvidence(snapA, snapB);

  if (result.confidence === null) {
    return { filingA, filingB, caseAId: a.id, caseBId: b.id, evidence: result, linkCreated: false };
  }

  const sortedIds = [a.id, b.id].sort();
  const caseAId = sortedIds[0]!;
  const caseBId = sortedIds[1]!;
  let linkWriteError: string | undefined;
  if (!DRY_RUN) {
    try {
      await prisma.$transaction(async (tx) => {
        const link = await tx.possibleDuplicateNoticeLink.upsert({
          where: { caseAId_caseBId: { caseAId, caseBId } },
          create: { caseAId, caseBId, confidence: result.confidence!, score: result.score, matchedFields: result.matchedFields, conflictingFields: result.conflictingFields, explanation: result.explanation },
          update: { confidence: result.confidence!, score: result.score, matchedFields: result.matchedFields, conflictingFields: result.conflictingFields, explanation: result.explanation },
        });
        // ManualReviewTask has no natural unique key on (foreclosureCaseId, reason) -- guard against duplicate tasks across re-runs by checking first.
        const existingTask = await tx.manualReviewTask.findFirst({ where: { foreclosureCaseId: caseBId, reason: "POSSIBLE_CONTENT_DUPLICATE" } });
        if (!existingTask) {
          await tx.manualReviewTask.create({ data: { foreclosureCaseId: caseBId, reason: "POSSIBLE_CONTENT_DUPLICATE", status: "OPEN", notes: `Possible duplicate of case ${caseAId} (${result.confidence}). ${result.explanation}` } });
        }
        await tx.auditLog.create({
          data: {
            action: "DUPLICATE_NOTICE_LINK_CREATED",
            entityType: "PossibleDuplicateNoticeLink",
            entityId: link.id,
            afterJson: { filingA, filingB, confidence: result.confidence, score: result.score, matchedFields: result.matchedFields, conflictingFields: result.conflictingFields } as never,
          },
        });
      });
    } catch (err) {
      // Isolated so a schema/table not being live yet (e.g. db:push not
      // reachable from this environment) doesn't crash the rest of the
      // run -- the 117888/117914 re-eval below only touches
      // already-existing tables and must still complete and be reported.
      linkWriteError = err instanceof Error ? err.message : String(err);
    }
  }

  return { filingA, filingB, caseAId: a.id, caseBId: b.id, evidence: result, linkCreated: !DRY_RUN && !linkWriteError, linkWriteError };
}

async function main() {
  console.log(`=== Fix round 3 re-evaluation (${new Date().toISOString()}) ===`);
  console.log(`DRY_RUN=${DRY_RUN}`);

  let aiCallCount = 0;
  const budget = {
    async hasHeadroom(): Promise<boolean> {
      return aiCallCount < MAX_AI_CALLS;
    },
    async recordSpend(): Promise<void> {
      aiCallCount++;
    },
  };

  const report117888 = await reEvalAndBackfillCase("117888", budget);
  const report117914 = await reEvalAndBackfillCase("117914", budget);
  const duplicateReport = await scoreAndLinkDuplicatePair("117729", "117731");

  console.log(JSON.stringify({ dryRun: DRY_RUN, aiCallsUsed: aiCallCount, report117888, report117914, duplicateReport }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
