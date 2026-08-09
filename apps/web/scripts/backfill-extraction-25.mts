/**
 * Phase 1 of the approved extraction-repair rollout (2026-08-09): backfills
 * the corrected extraction results onto the same 25 already-ingested
 * fresh-test notices, using their existing stored SourceDocument.rawText --
 * no re-ingestion, no new ForeclosureCase rows, no new SourceDocument rows.
 *
 * Safety model:
 * - Only ever fills a field that is currently null/placeholder, or replaces
 *   a demonstrably OCR-corrupted original-principal value (see currency
 *   safety below). A non-null, non-corrupted existing value is NEVER
 *   overwritten -- "only update where the new result is demonstrably
 *   better," never a judgment call between two plausible values.
 * - Currency safety: originalPrincipalAmount is in whole dollars on the
 *   ExtractedValue (texasTemplates.ts's own convention) and must be *100'd
 *   for the cents column -- the exact conversion ingestForeclosureNotices.ts
 *   uses, to avoid reintroducing the historical 100x bug. An old value
 *   under $1,000 is treated as OCR-corrupted (real Hidalgo principals are
 *   never that small) and is the one case a non-null old value CAN be
 *   replaced. A sanity guard additionally refuses to write a new value if
 *   old and new (both non-null, both "sane") differ by more than 50x in
 *   either direction -- that shape of disagreement means something is
 *   wrong with one of them, and this script isn't the place to guess which.
 * - Every write is paired with an AuditLog row carrying filing number,
 *   field, old/new value, old/new source+confidence, reason, and this
 *   script's identity as the "code version".
 * - DRY_RUN (default true) computes and reports every change without
 *   writing anything. Only BACKFILL_DRY_RUN=false performs real writes.
 */
import { prisma } from "@foreclosuredata/database";
import { runExtractionPipeline, parseLegalDescription } from "@foreclosuredata/foreclosure-core";
import { DocumentProcessingStatus, OrganizationType } from "@foreclosuredata/database";

const CODE_VERSION = "backfill-extraction-25@2026-08-09";
const RUN_LABEL = "EXTRACTION-BACKFILL-25";
const DRY_RUN = process.env.BACKFILL_DRY_RUN !== "false";
const MAX_AI_CALLS = 9;

const FRESH_25_FILING_NUMBERS = [
  "117630", "117631", "117632", "117633", "117634", "117635", "117642", "117643",
  "117648", "117651", "117652", "117658", "117659", "117660", "117661", "117675",
  "117695", "117697", "117698", "117700", "117701", "117702", "117707", "117708", "117710",
];

const MIN_SANE_PRINCIPAL_CENTS = 100_000; // $1,000 -- matches the deterministic layer's own OCR-corruption floor
const MAX_SANE_PRINCIPAL_CENTS = 5_000_000_000; // $50,000,000 -- no residential Hidalgo notice should exceed this
const SUSPICIOUS_RATIO = 50;

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  oldSource: string;
  newSource: string;
  newConfidence: number;
  reason: string;
}

interface CaseBackfillReport {
  filingNumber: string;
  caseId: string;
  skipped?: string;
  changes: FieldChange[];
  suspiciousSkips: FieldChange[];
}

async function main() {
  console.log(`=== Extraction backfill: same 25 fresh-test records (${new Date().toISOString()}) ===`);
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

  const cases = await prisma.foreclosureCase.findMany({
    where: { countyFilingNumber: { in: FRESH_25_FILING_NUMBERS } },
    include: {
      documents: true,
      loan: { include: { originalLender: true, currentMortgagee: true, mortgageServicer: true } },
      sales: true,
      legalDescriptions: true,
      borrower: true,
    },
  });

  if (cases.length !== 25) {
    throw new Error(`Expected 25 fresh-test cases, found ${cases.length}. Aborting -- refusing to run a partial/mismatched backfill.`);
  }

  const reports: CaseBackfillReport[] = [];

  for (const fc of cases) {
    const fn = fc.countyFilingNumber!;
    const doc = fc.documents[0];
    if (!doc || !doc.rawText) {
      reports.push({ filingNumber: fn, caseId: fc.id, skipped: "No SourceDocument.rawText available", changes: [], suspiciousSkips: [] });
      continue;
    }

    const pipelineResult = await runExtractionPipeline(doc.rawText, budget, { model: process.env.AI_EXTRACTION_MODEL });
    const extracted = pipelineResult.extracted;
    const newSourceLabel = pipelineResult.usedAiFallback ? "deterministic+ai" : "deterministic";

    const changes: FieldChange[] = [];
    const suspiciousSkips: FieldChange[] = [];

    // --- Borrower/grantor -> Person.fullName (shared by borrower/grantor/currentOwner FKs) ---
    const newBorrowerJoined = (extracted.grantorNames.value ?? extracted.borrowerNames.value ?? []).join(", ") || null;
    const oldBorrowerName = fc.borrower?.fullName ?? null;
    const oldIsPlaceholder = oldBorrowerName === null || oldBorrowerName === "Unknown owner";
    if (newBorrowerJoined && oldIsPlaceholder) {
      changes.push({
        field: "borrowerNames/grantorNames",
        oldValue: oldBorrowerName,
        newValue: newBorrowerJoined,
        oldSource: "deterministic (pre-fix) -- gap, no name recovered",
        newSource: newSourceLabel,
        newConfidence: extracted.grantorNames.value ? extracted.grantorNames.confidence : extracted.borrowerNames.confidence,
        reason: "Filled a real gap: old value was the ingestion-time placeholder, new pipeline recovered a real name.",
      });
    }

    // --- Original principal (currency-safety gated) -> Loan.originalPrincipalAmountCents ---
    const newPrincipalCents = extracted.originalPrincipalAmount.value !== null ? Math.round(extracted.originalPrincipalAmount.value * 100) : null;
    const oldPrincipalCents = fc.loan?.originalPrincipalAmountCents ?? null;
    const newIsSane = newPrincipalCents === null || (newPrincipalCents >= MIN_SANE_PRINCIPAL_CENTS && newPrincipalCents <= MAX_SANE_PRINCIPAL_CENTS);
    const oldLooksCorrupted = oldPrincipalCents !== null && oldPrincipalCents < MIN_SANE_PRINCIPAL_CENTS;
    if (!newIsSane) {
      // Never write an insane new value, regardless of what's currently stored.
    } else if (oldPrincipalCents === null && newPrincipalCents !== null) {
      changes.push({
        field: "originalPrincipalAmount",
        oldValue: null,
        newValue: newPrincipalCents,
        oldSource: "deterministic (pre-fix) -- gap, no amount recovered",
        newSource: newSourceLabel,
        newConfidence: extracted.originalPrincipalAmount.confidence,
        reason: "Filled a real gap: old value was null, new pipeline recovered a sane, in-range amount.",
      });
    } else if (oldLooksCorrupted && newPrincipalCents !== null) {
      changes.push({
        field: "originalPrincipalAmount",
        oldValue: oldPrincipalCents,
        newValue: newPrincipalCents,
        oldSource: "deterministic (pre-fix) -- OCR-corrupted (parsed as under $1,000, real Hidalgo principals are never that small)",
        newSource: newSourceLabel,
        newConfidence: extracted.originalPrincipalAmount.confidence,
        reason: `Currency safety: old value ($${(oldPrincipalCents / 100).toFixed(2)}) was below the $1,000 sanity floor -- an OCR-digit-grouping artifact (e.g. missing commas), not a real principal. Replaced with the corrected amount.`,
      });
    } else if (oldPrincipalCents !== null && newPrincipalCents !== null && oldPrincipalCents !== newPrincipalCents) {
      const ratio = Math.max(oldPrincipalCents, newPrincipalCents) / Math.min(oldPrincipalCents, newPrincipalCents);
      if (ratio >= SUSPICIOUS_RATIO) {
        suspiciousSkips.push({
          field: "originalPrincipalAmount",
          oldValue: oldPrincipalCents,
          newValue: newPrincipalCents,
          oldSource: "existing production value",
          newSource: newSourceLabel,
          newConfidence: extracted.originalPrincipalAmount.confidence,
          reason: `SKIPPED: old and new differ by ${ratio.toFixed(1)}x -- looks like a possible unit-conversion disagreement, not a confident correction. Left untouched for manual review rather than guessed.`,
        });
      }
      // Otherwise: both sane, both non-null, no extreme ratio -- old value is not demonstrably wrong, left untouched per "never replace a stronger existing value."
    }

    // --- Sale date/time/location -> create ForeclosureSale if none exists ---
    if (fc.sales.length === 0 && extracted.saleDate.value) {
      changes.push({
        field: "saleDate/saleTime/saleLocation",
        oldValue: null,
        newValue: { saleDate: extracted.saleDate.value, saleTime: extracted.saleTime.value, saleLocation: extracted.saleLocation.value },
        oldSource: "deterministic (pre-fix) -- gap, no ForeclosureSale row existed",
        newSource: newSourceLabel,
        newConfidence: extracted.saleDate.confidence,
        reason: "Filled a real gap: no sale record existed for this case; new pipeline recovered a sale date.",
      });
    }

    // --- Legal description -> create LegalDescription if none exists ---
    if (fc.legalDescriptions.length === 0 && extracted.legalDescription.value) {
      changes.push({
        field: "legalDescription",
        oldValue: null,
        newValue: extracted.legalDescription.value,
        oldSource: "deterministic (pre-fix) -- gap, no LegalDescription row existed",
        newSource: newSourceLabel,
        newConfidence: extracted.legalDescription.confidence,
        reason: "Filled a real gap: no legal-description record existed for this case; new pipeline (AI fallback) recovered the text.",
      });
    }

    // --- Lender-family + loan dates: only fill true gaps (old null -> new non-null); logic for these fields is unchanged by the repair, so a non-null old value is never touched ---
    const lenderFieldChecks: Array<[string, string | null | undefined, string | null]> = [
      ["originalMortgagee", fc.loan?.originalLender?.name ?? null, extracted.originalMortgagee.value],
      ["currentMortgagee", fc.loan?.currentMortgagee?.name ?? null, extracted.currentMortgagee.value],
      ["mortgageServicer", fc.loan?.mortgageServicer?.name ?? null, extracted.mortgageServicer.value],
    ];
    for (const [field, oldVal, newVal] of lenderFieldChecks) {
      if (!oldVal && newVal) {
        changes.push({
          field,
          oldValue: null,
          newValue: newVal,
          oldSource: "deterministic (pre-fix) -- gap",
          newSource: newSourceLabel,
          newConfidence: field === "originalMortgagee" ? extracted.originalMortgagee.confidence : field === "currentMortgagee" ? extracted.currentMortgagee.confidence : extracted.mortgageServicer.confidence,
          reason: "Filled a real gap: old value was null.",
        });
      }
    }
    const dateFieldChecks: Array<[string, Date | null | undefined, string | null]> = [
      ["deedOfTrustDate", fc.loan?.deedOfTrustDate, extracted.deedOfTrustDate.value],
      ["recordingDate", fc.loan?.recordingDate, extracted.recordingDate.value],
    ];
    for (const [field, oldVal, newVal] of dateFieldChecks) {
      if (!oldVal && newVal) {
        changes.push({
          field,
          oldValue: null,
          newValue: newVal,
          oldSource: "deterministic (pre-fix) -- gap",
          newSource: newSourceLabel,
          newConfidence: field === "deedOfTrustDate" ? extracted.deedOfTrustDate.confidence : extracted.recordingDate.confidence,
          reason: "Filled a real gap: old value was null.",
        });
      }
    }
    if (!fc.loan?.instrumentNumber && extracted.instrumentNumber.value) {
      changes.push({
        field: "instrumentNumber",
        oldValue: null,
        newValue: extracted.instrumentNumber.value,
        oldSource: "deterministic (pre-fix) -- gap",
        newSource: newSourceLabel,
        newConfidence: extracted.instrumentNumber.confidence,
        reason: "Filled a real gap: old value was null.",
      });
    }

    reports.push({ filingNumber: fn, caseId: fc.id, changes, suspiciousSkips });

    if (!DRY_RUN && changes.length > 0) {
      await applyChanges(fc, changes, pipelineResult.overallConfidence, pipelineResult.usedAiFallback, doc.id);
    }
  }

  const summary = {
    dryRun: DRY_RUN,
    codeVersion: CODE_VERSION,
    recordsWithChanges: reports.filter((r) => r.changes.length > 0).length,
    totalFieldChanges: reports.reduce((sum, r) => sum + r.changes.length, 0),
    totalSuspiciousSkips: reports.reduce((sum, r) => sum + r.suspiciousSkips.length, 0),
    aiCallsUsed: aiCallCount,
  };

  console.log(JSON.stringify({ summary, reports }, null, 2));
  await prisma.$disconnect();
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
      if (change.field === "borrowerNames/grantorNames" && fc.borrowerPersonId) {
        await tx.person.update({ where: { id: fc.borrowerPersonId }, data: { fullName: change.newValue as string } });
      } else if (change.field === "originalPrincipalAmount" && fc.loan) {
        await tx.loan.update({ where: { id: fc.loan.id }, data: { originalPrincipalAmountCents: change.newValue as number } });
      } else if (change.field === "saleDate/saleTime/saleLocation") {
        const v = change.newValue as { saleDate: string; saleTime: string | null; saleLocation: string | null };
        await tx.foreclosureSale.create({
          data: {
            foreclosureCaseId: fc.id,
            sourceDocumentId,
            saleDate: new Date(v.saleDate),
            saleTime: v.saleTime,
            saleLocation: v.saleLocation,
            earliestSaleDate: new Date(v.saleDate),
          },
        });
      } else if (change.field === "legalDescription") {
        const rawText = change.newValue as string;
        const parsed = parseLegalDescription(rawText);
        await tx.legalDescription.create({
          data: {
            foreclosureCaseId: fc.id,
            sourceDocumentId,
            rawText,
            subdivision: parsed?.subdivision ?? null,
            lot: parsed?.lot ?? null,
            block: parsed?.block ?? null,
          },
        });
      } else if (fc.loan && change.field === "originalMortgagee") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.LENDER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { originalLenderOrgId: org.id } });
      } else if (fc.loan && change.field === "currentMortgagee") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.LENDER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { currentMortgageeOrgId: org.id } });
      } else if (fc.loan && change.field === "mortgageServicer") {
        const org = await tx.organization.create({ data: { name: change.newValue as string, type: OrganizationType.SERVICER } });
        await tx.loan.update({ where: { id: fc.loan.id }, data: { mortgageServicerOrgId: org.id } });
      } else if (fc.loan && change.field === "deedOfTrustDate") {
        await tx.loan.update({ where: { id: fc.loan.id }, data: { deedOfTrustDate: new Date(change.newValue as string) } });
      } else if (fc.loan && change.field === "recordingDate") {
        await tx.loan.update({ where: { id: fc.loan.id }, data: { recordingDate: new Date(change.newValue as string) } });
      } else if (fc.loan && change.field === "instrumentNumber") {
        await tx.loan.update({ where: { id: fc.loan.id }, data: { instrumentNumber: change.newValue as string } });
      }

      await tx.auditLog.create({
        data: {
          action: `EXTRACTION_BACKFILL_${change.field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
          entityType: "ForeclosureCase",
          entityId: fc.id,
          beforeJson: { filingNumber: fc.countyFilingNumber, field: change.field, value: change.oldValue as object, source: change.oldSource } as never,
          afterJson: {
            filingNumber: fc.countyFilingNumber,
            field: change.field,
            value: change.newValue as object,
            source: change.newSource,
            confidence: change.newConfidence,
            reason: change.reason,
            runLabel: RUN_LABEL,
            codeVersion: CODE_VERSION,
          } as never,
        },
      });
    }

    // Keep the document's aggregate confidence/status honest with the corrected picture.
    await tx.sourceDocument.update({
      where: { id: sourceDocumentId },
      data: {
        extractionConfidence: overallConfidence,
        status: usedAiFallback ? DocumentProcessingStatus.AI_EXTRACTED : DocumentProcessingStatus.DETERMINISTIC_EXTRACTED,
      },
    });
  });
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
