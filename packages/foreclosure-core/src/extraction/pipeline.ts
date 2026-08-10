import type { ExtractedForeclosureNotice, ExtractedValue, ManualReviewTaskEvidence } from "@foreclosuredata/types";
import { extractDeterministic, needsAiFallback } from "./deterministic/texasTemplates";
import { extractWithAI, type AiFieldOutcome, type BudgetGuard } from "./ai/extractWithAI";

export interface ExtractionPipelineResult {
  extracted: ExtractedForeclosureNotice;
  usedAiFallback: boolean;
  aiCostCents: number;
  overallConfidence: number;
  needsManualReview: boolean;
  manualReviewReasons: string[];
  /** Structured evidence for each reason in manualReviewReasons, keyed by reason -- see ManualReviewTaskEvidence for what's captured. Only reasons this pipeline itself determines (not ones added later by the caller, e.g. CAD_OWNER_CONFLICT) have an entry here. */
  manualReviewEvidence: Record<string, ManualReviewTaskEvidence>;
  /** Set when Layer 2 was attempted (spent budget) but produced zero usable fields -- visible in the run summary rather than silently discarded, since budget was still spent. */
  aiFailureReason?: string;
  /** Per-field validation outcome of the AI call, for cost/yield instrumentation. Empty when AI wasn't invoked. */
  aiFieldOutcomes: AiFieldOutcome[];
  aiInputTokens?: number;
  aiOutputTokens?: number;
}

/**
 * Runs Layer 1 (deterministic) then, only if needed and budget allows,
 * Layer 2 (AI) — merging AI values in only for fields Layer 1 left
 * null/low-confidence. Layer 1's explicit finds are never overwritten by
 * the AI pass, per the "AI is the last resort" cost rule.
 */
export async function runExtractionPipeline(
  noticeText: string,
  budget: BudgetGuard,
  aiOptions?: { apiKey?: string; model?: string },
): Promise<ExtractionPipelineResult> {
  const deterministic = extractDeterministic(noticeText);
  let merged = deterministic;
  let usedAiFallback = false;
  let aiCostCents = 0;
  let aiFailureReason: string | undefined;
  let aiFieldOutcomes: AiFieldOutcome[] = [];
  let aiInputTokens: number | undefined;
  let aiOutputTokens: number | undefined;

  if (needsAiFallback(deterministic)) {
    const aiOutcome = await extractWithAI(noticeText, budget, aiOptions);
    aiCostCents = aiOutcome.costCents;
    aiFieldOutcomes = aiOutcome.fieldOutcomes;
    aiInputTokens = aiOutcome.inputTokens;
    aiOutputTokens = aiOutcome.outputTokens;
    if (aiOutcome.ranAiExtraction && aiOutcome.result) {
      const recoveredAtLeastOneField = aiOutcome.fieldOutcomes.some((f) => f.status === "accepted" && f.hadValue);
      if (recoveredAtLeastOneField) {
        usedAiFallback = true;
        merged = mergePreferringNonNull(deterministic, aiOutcome.result);
      } else {
        aiFailureReason = aiOutcome.reason ?? "AI call succeeded but recovered no usable fields";
      }
    } else if (aiOutcome.ranAiExtraction) {
      aiFailureReason = aiOutcome.reason;
    }
  }

  const overallConfidence = averageConfidence(merged);
  const { reasons: manualReviewReasons, evidence: manualReviewEvidence } = determineManualReviewReasons(merged, noticeText, overallConfidence);

  return {
    extracted: merged,
    usedAiFallback,
    aiCostCents,
    overallConfidence,
    needsManualReview: manualReviewReasons.length > 0,
    manualReviewReasons,
    manualReviewEvidence,
    aiFailureReason,
    aiFieldOutcomes,
    aiInputTokens,
    aiOutputTokens,
  };
}

function mergePreferringNonNull(
  base: ExtractedForeclosureNotice,
  fallback: ExtractedForeclosureNotice,
): ExtractedForeclosureNotice {
  const result = { ...base } as ExtractedForeclosureNotice;
  for (const key of Object.keys(base) as Array<keyof ExtractedForeclosureNotice>) {
    const baseField = base[key] as ExtractedValue<unknown>;
    const fallbackField = fallback[key] as ExtractedValue<unknown>;
    if ((baseField.value === null || baseField.confidence < 0.6) && fallbackField.value !== null) {
      (result[key] as ExtractedValue<unknown>) = fallbackField;
    }
  }
  return result;
}

function averageConfidence(extracted: ExtractedForeclosureNotice): number {
  const fields = Object.values(extracted) as Array<ExtractedValue<unknown>>;
  const withValue = fields.filter((f) => f.value !== null);
  if (withValue.length === 0) return 0;
  return withValue.reduce((sum, f) => sum + f.confidence, 0) / withValue.length;
}

function determineManualReviewReasons(
  extracted: ExtractedForeclosureNotice,
  noticeText: string,
  overallConfidence: number,
): { reasons: string[]; evidence: Record<string, ManualReviewTaskEvidence> } {
  const reasons: string[] = [];
  const evidence: Record<string, ManualReviewTaskEvidence> = {};

  if (extracted.propertyAddress.value === null && extracted.legalDescription.value === null) {
    reasons.push("NO_ADDRESS_RESOLVED");
    evidence.NO_ADDRESS_RESOLVED = { reason: "NO_ADDRESS_RESOLVED", conflictingField: "propertyAddress", noticeValue: null };
  }
  if (extracted.borrowerNames.value === null) {
    reasons.push("BORROWER_NAME_CONFLICT");
    evidence.BORROWER_NAME_CONFLICT = { reason: "BORROWER_NAME_CONFLICT", conflictingField: "borrowerNames", noticeValue: null };
  }
  if (extracted.saleDate.value === null) {
    reasons.push("SALE_DATE_CONFLICT");
    evidence.SALE_DATE_CONFLICT = { reason: "SALE_DATE_CONFLICT", conflictingField: "saleDate", noticeValue: null };
  }
  const ocrNoiseMatches = noticeText.match(/[0O]{1}[a-z]{2,}\d|illegible|approx, low OCR/gi) ?? [];
  if (ocrNoiseMatches.length >= 2) {
    reasons.push("POOR_TEXT_QUALITY");
    evidence.POOR_TEXT_QUALITY = { reason: "POOR_TEXT_QUALITY", sourceSnippet: ocrNoiseMatches.slice(0, 3).join(" … ") };
  }
  if (overallConfidence < 0.55) {
    reasons.push("LOW_CONFIDENCE");
    evidence.LOW_CONFIDENCE = { reason: "LOW_CONFIDENCE", score: overallConfidence };
  }
  return { reasons, evidence };
}
