import type { ExtractedForeclosureNotice, ExtractedValue } from "@foreclosuredata/types";
import {
  AI_EXTRACTION_FIELD_NAMES,
  AI_EXTRACTION_FIELD_SCHEMAS,
  AI_EXTRACTION_SYSTEM_PROMPT,
  AI_EXTRACTION_TOOL_INPUT_SCHEMA,
  AI_EXTRACTION_TOOL_NAME,
  type AiExtractionFieldName,
} from "./schema";
import { mergeDanglingNameSuffixes } from "../nameSuffixes";

export type AiFieldStatus = "accepted" | "rejected_invalid" | "omitted";

export interface AiFieldOutcome {
  field: AiExtractionFieldName;
  status: AiFieldStatus;
  /** Only set for rejected_invalid -- the zod validation error for this one field. */
  reason?: string;
  /** True when the accepted/rejected field carried a non-null value (i.e. would actually change anything if merged). */
  hadValue: boolean;
}

export interface AiExtractionOutcome {
  ranAiExtraction: boolean;
  /** Partial result: fields that failed validation or were omitted are left as blank (null-value) ExtractedValue entries, so the pipeline's merge naturally skips them rather than discarding the whole response. Null only when the call produced no usable tool input at all. */
  result: ExtractedForeclosureNotice | null;
  costCents: number;
  reason?: string;
  fieldOutcomes: AiFieldOutcome[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface BudgetGuard {
  /** Returns whether there is budget headroom for an AI call of roughly this many input characters. Kept as a callback so this package never touches the database directly. */
  hasHeadroom(estimatedInputChars: number): Promise<boolean>;
  /** Records actual spend after a call completes. */
  recordSpend(costCents: number): Promise<void>;
}

const BLANK_FIELD: ExtractedValue<never> = { value: null as never, explicitlyStated: false, confidence: 0, supportingText: null, pageNumber: null };

/**
 * Layer 2. Only called when Layer 1 (deterministic) extraction left
 * critical fields null/low-confidence — see `needsAiFallback` in
 * `texasTemplates.ts`. No-ops cleanly (never throws) when there is no API
 * key configured or no budget headroom, since AI is optional infrastructure
 * in this cost-conscious product.
 *
 * Uses Anthropic tool-use (not a plain-text completion) so the model is
 * given the actual JSON schema, including every required field name, and
 * validates each of the 18 returned fields independently: one invalid or
 * omitted field no longer discards four other valid ones (previously an
 * all-or-nothing `safeParse` on the whole object -- see git history for
 * the 9/9-failed run this replaced).
 */
export async function extractWithAI(
  noticeText: string,
  budget: BudgetGuard,
  options?: { apiKey?: string; model?: string },
): Promise<AiExtractionOutcome> {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ranAiExtraction: false, result: null, costCents: 0, reason: "ANTHROPIC_API_KEY not configured", fieldOutcomes: [] };
  }

  const hasHeadroom = await budget.hasHeadroom(noticeText.length);
  if (!hasHeadroom) {
    return { ranAiExtraction: false, result: null, costCents: 0, reason: "Monthly AI budget exhausted", fieldOutcomes: [] };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = options?.model ?? process.env.AI_EXTRACTION_MODEL ?? "claude-sonnet-5";

  // A total failure (every one of 18 fields omitted/rejected, or no usable
  // tool call at all) gets ONE retry rather than being reported as a
  // permanent extraction failure. Root-caused against a real total-failure
  // case (HID-117888, second fresh-25 batch): a direct re-run of this exact
  // call against the same stored text, with no code changes, produced a
  // perfect 18/18 response -- no reproducible schema/prompt bug was found,
  // so the original failure was very likely a one-off malformed sampling on
  // that specific call. Bounded to a single retry (2 attempts total) so a
  // genuinely unrecoverable document (e.g. a scanned page too garbled for
  // the model on any attempt) still fails fast rather than looping.
  const maxAttempts = 2;
  let totalCostCents = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastOutcome: Omit<AiExtractionOutcome, "costCents" | "inputTokens" | "outputTokens"> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.messages.create({
      // The schema has 18 fields, each with 5 sub-properties (value,
      // explicitlyStated, confidence, supportingText, pageNumber) -- a fully
      // populated response comfortably exceeds 2000 tokens and was silently
      // truncating mid-JSON on real notices in an earlier incident. Raised
      // with headroom; unrelated to the missing-required-keys bug this
      // tool-use rewrite fixes.
      max_tokens: 4096,
      model,
      system: AI_EXTRACTION_SYSTEM_PROMPT,
      tools: [
        {
          name: AI_EXTRACTION_TOOL_NAME,
          description: "Records the structured fields extracted from the foreclosure notice.",
          input_schema: AI_EXTRACTION_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: AI_EXTRACTION_TOOL_NAME },
      messages: [{ role: "user", content: noticeText }],
    });

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costCents = estimateCostCents(inputTokens, outputTokens);
    await budget.recordSpend(costCents);
    totalCostCents += costCents;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    const toolUseBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolUseBlock || !("input" in toolUseBlock) || typeof toolUseBlock.input !== "object" || toolUseBlock.input === null) {
      const truncated = response.stop_reason === "max_tokens";
      lastOutcome = {
        ranAiExtraction: true,
        result: null,
        reason: `AI did not return a usable tool call${truncated ? " (truncated: hit max_tokens)" : ""}${attempt < maxAttempts ? " -- retrying" : ""}`,
        fieldOutcomes: [],
      };
      continue;
    }

    const rawInput = toolUseBlock.input as Record<string, unknown>;
    const { result, fieldOutcomes } = validateFieldsIndependently(rawInput);
    const acceptedCount = fieldOutcomes.filter((f) => f.status === "accepted").length;

    if (acceptedCount === 0 && attempt < maxAttempts) {
      lastOutcome = { ranAiExtraction: true, result, reason: "No fields passed validation -- retrying", fieldOutcomes };
      continue;
    }

    return {
      ranAiExtraction: true,
      result, // partial: caller merges only fields with non-null values, so rejected/omitted fields are inert
      costCents: totalCostCents,
      reason: acceptedCount === 0 ? "No fields passed validation" : undefined,
      fieldOutcomes,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }

  // Every attempt was a total failure -- return the last one, with the
  // combined cost of every attempt actually made.
  return {
    ...(lastOutcome as Omit<AiExtractionOutcome, "costCents" | "inputTokens" | "outputTokens">),
    costCents: totalCostCents,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

/**
 * Validates each of the 18 top-level fields independently against its own
 * zod schema. A field that's missing entirely, or present but malformed,
 * is recorded as omitted/rejected and left blank (never merged) -- it does
 * NOT invalidate the other fields the model got right. Nothing here ever
 * fabricates a value: rejected/omitted fields become the same blank,
 * null-value placeholder the deterministic layer already uses to mean
 * "unknown".
 */
function validateFieldsIndependently(rawInput: Record<string, unknown>): {
  result: ExtractedForeclosureNotice;
  fieldOutcomes: AiFieldOutcome[];
} {
  const fieldOutcomes: AiFieldOutcome[] = [];
  const result = {} as ExtractedForeclosureNotice;

  for (const field of AI_EXTRACTION_FIELD_NAMES) {
    if (!(field in rawInput)) {
      fieldOutcomes.push({ field, status: "omitted", hadValue: false });
      (result[field] as ExtractedValue<unknown>) = BLANK_FIELD;
      continue;
    }

    const fieldSchema = AI_EXTRACTION_FIELD_SCHEMAS[field];
    const validated = fieldSchema.safeParse(rawInput[field]);
    if (!validated.success) {
      fieldOutcomes.push({ field, status: "rejected_invalid", reason: validated.error.message, hadValue: false });
      (result[field] as ExtractedValue<unknown>) = BLANK_FIELD;
      continue;
    }

    const value = validated.data as ExtractedValue<unknown>;
    if (Array.isArray(value.value) && (field === "borrowerNames" || field === "grantorNames" || field === "substituteTrustee")) {
      value.value = mergeDanglingNameSuffixes(value.value as string[]);
    }
    const hadValue = value.value !== null && !(Array.isArray(value.value) && value.value.length === 0);
    fieldOutcomes.push({ field, status: "accepted", hadValue });
    (result[field] as ExtractedValue<unknown>) = value;
  }

  return { result, fieldOutcomes };
}

/** Rough published per-token pricing; update if the configured model's pricing changes. */
function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCostPerMillionCents = 300;
  const outputCostPerMillionCents = 1500;
  const cost = (inputTokens / 1_000_000) * inputCostPerMillionCents + (outputTokens / 1_000_000) * outputCostPerMillionCents;
  return Math.round(cost);
}
