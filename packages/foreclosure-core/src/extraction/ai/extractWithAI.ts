import type { ExtractedForeclosureNotice } from "@foreclosuredata/types";
import { aiExtractionResponseSchema, AI_EXTRACTION_SYSTEM_PROMPT } from "./schema";

export interface AiExtractionOutcome {
  ranAiExtraction: boolean;
  result: ExtractedForeclosureNotice | null;
  costCents: number;
  reason?: string;
}

export interface BudgetGuard {
  /** Returns whether there is budget headroom for an AI call of roughly this many input characters. Kept as a callback so this package never touches the database directly. */
  hasHeadroom(estimatedInputChars: number): Promise<boolean>;
  /** Records actual spend after a call completes. */
  recordSpend(costCents: number): Promise<void>;
}

/**
 * Layer 2. Only called when Layer 1 (deterministic) extraction left
 * critical fields null/low-confidence — see `needsAiFallback` in
 * `texasTemplates.ts`. No-ops cleanly (never throws) when there is no API
 * key configured or no budget headroom, since AI is optional infrastructure
 * in this cost-conscious product.
 */
export async function extractWithAI(
  noticeText: string,
  budget: BudgetGuard,
  options?: { apiKey?: string; model?: string },
): Promise<AiExtractionOutcome> {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ranAiExtraction: false, result: null, costCents: 0, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const hasHeadroom = await budget.hasHeadroom(noticeText.length);
  if (!hasHeadroom) {
    return { ranAiExtraction: false, result: null, costCents: 0, reason: "Monthly AI budget exhausted" };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = options?.model ?? process.env.AI_EXTRACTION_MODEL ?? "claude-sonnet-5";

  const response = await client.messages.create({
    model,
    // The schema has ~20 fields, each with 5 sub-properties (value,
    // explicitlyStated, confidence, supportingText, pageNumber) -- a fully
    // populated response comfortably exceeds 2000 tokens and was silently
    // truncating mid-JSON on real notices (confirmed: every one of 15
    // fallback calls in the 25-notice production run spent budget but
    // failed to parse/validate, 0/15 merged). Raised with headroom.
    max_tokens: 4096,
    system: AI_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: noticeText }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";

  const costCents = estimateCostCents(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0, model);
  await budget.recordSpend(costCents);

  const truncated = response.stop_reason === "max_tokens";

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonBlock(raw));
  } catch {
    return {
      ranAiExtraction: true,
      result: null,
      costCents,
      reason: truncated ? "AI response was not valid JSON (truncated: hit max_tokens)" : "AI response was not valid JSON",
    };
  }

  const validated = aiExtractionResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ranAiExtraction: true,
      result: null,
      costCents,
      reason: `AI response failed schema validation${truncated ? " (truncated: hit max_tokens)" : ""}: ${validated.error.message}`,
    };
  }

  return { ranAiExtraction: true, result: validated.data, costCents };
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1]!.trim() : text.trim();
}

/** Rough published per-token pricing; update if the configured model's pricing changes. */
function estimateCostCents(inputTokens: number, outputTokens: number, _model: string): number {
  const inputCostPerMillionCents = 300;
  const outputCostPerMillionCents = 1500;
  const cost = (inputTokens / 1_000_000) * inputCostPerMillionCents + (outputTokens / 1_000_000) * outputCostPerMillionCents;
  return Math.round(cost);
}
