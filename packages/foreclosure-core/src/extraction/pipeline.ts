import type { ExtractedForeclosureNotice, ExtractedValue } from "@foreclosuredata/types";
import { extractDeterministic, needsAiFallback } from "./deterministic/texasTemplates";
import { extractWithAI, type BudgetGuard } from "./ai/extractWithAI";

export interface ExtractionPipelineResult {
  extracted: ExtractedForeclosureNotice;
  usedAiFallback: boolean;
  aiCostCents: number;
  overallConfidence: number;
  needsManualReview: boolean;
  manualReviewReasons: string[];
  /** Set when Layer 2 was attempted (spent budget) but its result couldn't be merged -- visible in the run summary rather than silently discarded, since budget was still spent. */
  aiFailureReason?: string;
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

  if (needsAiFallback(deterministic)) {
    const aiOutcome = await extractWithAI(noticeText, budget, aiOptions);
    aiCostCents = aiOutcome.costCents;
    if (aiOutcome.ranAiExtraction && aiOutcome.result) {
      usedAiFallback = true;
      merged = mergePreferringNonNull(deterministic, aiOutcome.result);
    } else if (aiOutcome.ranAiExtraction) {
      aiFailureReason = aiOutcome.reason;
    }
  }

  const overallConfidence = averageConfidence(merged);
  const manualReviewReasons = determineManualReviewReasons(merged, noticeText);

  return {
    extracted: merged,
    usedAiFallback,
    aiCostCents,
    overallConfidence,
    needsManualReview: manualReviewReasons.length > 0,
    manualReviewReasons,
    aiFailureReason,
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

function determineManualReviewReasons(extracted: ExtractedForeclosureNotice, noticeText: string): string[] {
  const reasons: string[] = [];
  if (extracted.propertyAddress.value === null && extracted.legalDescription.value === null) {
    reasons.push("NO_ADDRESS_RESOLVED");
  }
  if (extracted.borrowerNames.value === null) {
    reasons.push("BORROWER_NAME_CONFLICT");
  }
  if (extracted.saleDate.value === null) {
    reasons.push("SALE_DATE_CONFLICT");
  }
  const ocrNoiseMarkers = (noticeText.match(/[0O]{1}[a-z]{2,}\d|illegible|approx, low OCR/gi) ?? []).length;
  if (ocrNoiseMarkers >= 2) {
    reasons.push("POOR_TEXT_QUALITY");
  }
  if (averageConfidence(extracted) < 0.55) {
    reasons.push("LOW_CONFIDENCE");
  }
  return reasons;
}
