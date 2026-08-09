/**
 * Extraction/AI-fallback repair verification (2026-08-09). Re-runs
 * deterministic + corrected AI-fallback extraction against ONLY the 25
 * notices from the fresh 25-notice production ingestion test, using their
 * already-persisted SourceDocument.rawText -- no re-discovery, no
 * re-download, no re-OCR, no new SourceDocument rows. Read-only against
 * the database: computes and prints a before/after report but does not
 * write corrected values back onto the existing ForeclosureCase/Loan/
 * Person/Organization rows (that backfill, if wanted, is a distinct,
 * separately-approved follow-up -- this run is the fix's verification
 * gate, not a data migration).
 *
 * The AI-fallback call count is bounded to the same 9 notices the
 * original run needed (confirmed identical here since the fix only
 * changed principal-amount patterns and the AI schema/prompt, not the
 * borrower/lender/saleDate/address/legalDescription logic that
 * needsAiFallback gates on).
 */
import { prisma } from "@foreclosuredata/database";
import { extractDeterministic, needsAiFallback, runExtractionPipeline } from "@foreclosuredata/foreclosure-core";

const FRESH_25_FILING_NUMBERS = [
  "117630", "117631", "117632", "117633", "117634", "117635", "117642", "117643",
  "117648", "117651", "117652", "117658", "117659", "117660", "117661", "117675",
  "117695", "117697", "117698", "117700", "117701", "117702", "117707", "117708", "117710",
];

// Empirically observed BEFORE state of the same 25 notices, computed
// against the pre-fix code (git history) against the same stored rawText.
// AI-side numbers are the values the user reported from the original run:
// 9 calls attempted, 0 schema-valid/merged, $0.45 spent.
const BEFORE = {
  total: 25,
  borrowerCount: 16,
  principalCount: 8,
  saleDateCount: 20,
  legalCount: 20,
  aiFallbackNeeded: 9,
  aiCallsAttempted: 9,
  aiCallsSchemaValid: 0,
  aiCallsWithUsefulField: 0,
  aiTotalFieldsRecovered: 0,
  aiSpendCents: 45,
};

const MAX_AI_CALLS = 9;

async function main() {
  const docs = await prisma.sourceDocument.findMany({
    where: { countyFilingNumber: { in: FRESH_25_FILING_NUMBERS } },
    select: { countyFilingNumber: true, rawText: true },
  });
  if (docs.length !== 25) {
    throw new Error(`Expected 25 stored notices, found ${docs.length}. Aborting -- refusing to run a partial/mismatched repair pass.`);
  }

  let aiCallCount = 0;
  let aiSpendCents = 0;
  const budget = {
    async hasHeadroom(): Promise<boolean> {
      return aiCallCount < MAX_AI_CALLS;
    },
    async recordSpend(costCents: number): Promise<void> {
      aiCallCount++;
      aiSpendCents += costCents;
    },
  };

  let borrowerCount = 0;
  let principalCount = 0;
  let saleDateCount = 0;
  let legalCount = 0;
  let aiFallbackNeededCount = 0;
  let aiCallsSchemaValid = 0;
  let aiCallsWithUsefulField = 0;
  let aiTotalFieldsRecovered = 0;

  const perNotice: Array<Record<string, unknown>> = [];

  for (const doc of docs) {
    const deterministic = extractDeterministic(doc.rawText ?? "");
    const needsFallback = needsAiFallback(deterministic);
    if (needsFallback) aiFallbackNeededCount++;

    const pipelineResult = await runExtractionPipeline(doc.rawText ?? "", budget, { model: process.env.AI_EXTRACTION_MODEL });

    const extracted = pipelineResult.extracted;
    if (extracted.borrowerNames.value) borrowerCount++;
    if (extracted.originalPrincipalAmount.value !== null) principalCount++;
    if (extracted.saleDate.value) saleDateCount++;
    if (extracted.legalDescription.value) legalCount++;

    let aiSchemaValid = false;
    let usefulFieldCount = 0;
    if (pipelineResult.aiFieldOutcomes.length > 0) {
      aiSchemaValid = pipelineResult.aiFieldOutcomes.some((f) => f.status === "accepted");
      usefulFieldCount = pipelineResult.aiFieldOutcomes.filter((f) => f.status === "accepted" && f.hadValue).length;
      if (aiSchemaValid) aiCallsSchemaValid++;
      if (usefulFieldCount > 0) aiCallsWithUsefulField++;
      aiTotalFieldsRecovered += usefulFieldCount;
    }

    perNotice.push({
      filingNumber: doc.countyFilingNumber,
      neededAiFallback: needsFallback,
      usedAiFallback: pipelineResult.usedAiFallback,
      aiFailureReason: pipelineResult.aiFailureReason ?? null,
      aiFieldOutcomes: pipelineResult.aiFieldOutcomes,
      aiInputTokens: pipelineResult.aiInputTokens ?? null,
      aiOutputTokens: pipelineResult.aiOutputTokens ?? null,
      borrowerNames: extracted.borrowerNames.value,
      grantorNames: extracted.grantorNames.value,
      originalPrincipalAmount: extracted.originalPrincipalAmount.value,
      originalPrincipalExplicitlyStated: extracted.originalPrincipalAmount.explicitlyStated,
      originalPrincipalSupportingText: extracted.originalPrincipalAmount.supportingText,
      saleDate: extracted.saleDate.value,
      legalDescription: extracted.legalDescription.value,
      overallConfidence: pipelineResult.overallConfidence,
      manualReviewReasons: pipelineResult.manualReviewReasons,
    });
  }

  const AFTER = {
    total: docs.length,
    borrowerCount,
    principalCount,
    saleDateCount,
    legalCount,
    aiFallbackNeeded: aiFallbackNeededCount,
    aiCallsAttempted: aiCallCount,
    aiCallsSchemaValid,
    aiCallsWithUsefulField,
    aiTotalFieldsRecovered,
    aiSpendCents,
  };

  console.log(JSON.stringify({ before: BEFORE, after: AFTER, perNotice }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exitCode = 1;
});
