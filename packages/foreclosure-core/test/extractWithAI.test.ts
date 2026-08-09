import { describe, it, expect, beforeEach, vi } from "vitest";
import { AI_EXTRACTION_SYSTEM_PROMPT, AI_EXTRACTION_TOOL_INPUT_SCHEMA, AI_EXTRACTION_FIELD_NAMES } from "../src/extraction/ai/schema";

// extractWithAI dynamically `import()`s @anthropic-ai/sdk inside the
// function body (kept out of the always-loaded dependency graph since AI is
// optional infra) -- vi.mock still intercepts a dynamic import as long as
// it's declared at module scope, which is what this relies on.
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

const BLANK = { value: null, explicitlyStated: false, confidence: 0, supportingText: null, pageNumber: null };
const BLANK_ARRAY = { value: [] as string[], explicitlyStated: false, confidence: 0, supportingText: null, pageNumber: null };

/** A fully-populated, schema-valid response with every field blank -- tests override just the fields under test. */
function fullBlankResponse(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of AI_EXTRACTION_FIELD_NAMES) {
    result[field] = field === "borrowerNames" || field === "grantorNames" || field === "substituteTrustee" ? { ...BLANK_ARRAY } : { ...BLANK };
  }
  return result;
}

function mockToolResponse(input: Record<string, unknown>, opts?: { stopReason?: string; inputTokens?: number; outputTokens?: number }) {
  createMock.mockResolvedValueOnce({
    content: [{ type: "tool_use", id: "toolu_1", name: "extract_foreclosure_notice_fields", input }],
    stop_reason: opts?.stopReason ?? "tool_use",
    usage: { input_tokens: opts?.inputTokens ?? 1000, output_tokens: opts?.outputTokens ?? 500 },
  });
}

const budget = { hasHeadroom: vi.fn().mockResolvedValue(true), recordSpend: vi.fn().mockResolvedValue(undefined) };

describe("extractWithAI", () => {
  beforeEach(() => {
    createMock.mockReset();
    budget.hasHeadroom.mockClear();
    budget.recordSpend.mockClear();
  });

  it("accepts borrowerNames present with real values", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    response.borrowerNames = { value: ["JOHN DOE"], explicitlyStated: true, confidence: 0.9, supportingText: "executed by JOHN DOE", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.borrowerNames.value).toEqual(["JOHN DOE"]);
    expect(outcome.fieldOutcomes.find((f) => f.field === "borrowerNames")).toMatchObject({ status: "accepted", hadValue: true });
  });

  it("accepts borrowerNames as an empty array rather than treating it as invalid", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    mockToolResponse(fullBlankResponse());

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.borrowerNames.value).toEqual([]);
    expect(outcome.fieldOutcomes.find((f) => f.field === "borrowerNames")).toMatchObject({ status: "accepted", hadValue: false });
  });

  it("accepts grantorNames as an empty array", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    mockToolResponse(fullBlankResponse());

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.grantorNames.value).toEqual([]);
    expect(outcome.fieldOutcomes.find((f) => f.field === "grantorNames")).toMatchObject({ status: "accepted", hadValue: false });
  });

  it("accepts a null scalar field (e.g. lenderName not present in the notice)", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    mockToolResponse(fullBlankResponse());

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.lenderName.value).toBeNull();
    expect(outcome.fieldOutcomes.find((f) => f.field === "lenderName")).toMatchObject({ status: "accepted", hadValue: false });
  });

  it("accepts multiple borrowers listed together", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    response.borrowerNames = {
      value: ["JOHN DOE", "JANE DOE"],
      explicitlyStated: true,
      confidence: 0.9,
      supportingText: "JOHN DOE AND JANE DOE, HUSBAND AND WIFE",
      pageNumber: 1,
    };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.borrowerNames.value).toEqual(["JOHN DOE", "JANE DOE"]);
  });

  it("reattaches a dangling name-suffix entry (e.g. 'Jr.') to the preceding borrower instead of treating it as a second person (real HID-117707 defect)", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    response.borrowerNames = { value: ["Ricardo Ruiz", "Jr."], explicitlyStated: true, confidence: 0.9, supportingText: "Grantor: Ricardo Ruiz, Jr., a single person", pageNumber: 1 };
    response.grantorNames = { value: ["Ricardo Ruiz", "Jr."], explicitlyStated: true, confidence: 0.9, supportingText: "Grantor: Ricardo Ruiz, Jr., a single person", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.borrowerNames.value).toEqual(["Ricardo Ruiz, Jr."]);
    expect(outcome.result?.grantorNames.value).toEqual(["Ricardo Ruiz, Jr."]);
  });

  it("leaves multiple real borrowers alone when no suffix token is present", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    response.borrowerNames = { value: ["JOHN DOE", "JANE DOE"], explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result?.borrowerNames.value).toEqual(["JOHN DOE", "JANE DOE"]);
  });

  it("system prompt and tool schema explicitly disambiguate Trustor/Grantor/Mortgagor terminology from lender-side parties", () => {
    expect(AI_EXTRACTION_SYSTEM_PROMPT).toMatch(/Trustor/i);
    expect(AI_EXTRACTION_SYSTEM_PROMPT).toMatch(/Mortgagor/i);
    expect(AI_EXTRACTION_SYSTEM_PROMPT).toMatch(/substitute trustee/i);
    expect(JSON.stringify(AI_EXTRACTION_TOOL_INPUT_SCHEMA)).toMatch(/Trustor/i);
  });

  it("requires every field in the tool's input schema (no field can be silently omitted by the model without being flagged)", () => {
    expect(AI_EXTRACTION_TOOL_INPUT_SCHEMA.required).toEqual(AI_EXTRACTION_FIELD_NAMES);
    expect(AI_EXTRACTION_TOOL_INPUT_SCHEMA.required.length).toBe(18);
  });

  it("does not invalidate the whole response when one field is malformed -- accepts the rest", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    // Malformed: value is a string instead of the required array shape.
    response.borrowerNames = { value: "JOHN DOE", explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
    response.saleDate = { value: "2026-09-01", explicitlyStated: true, confidence: 0.95, supportingText: "Date of Sale: September 1, 2026", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.fieldOutcomes.find((f) => f.field === "borrowerNames")).toMatchObject({ status: "rejected_invalid" });
    expect(outcome.result?.borrowerNames.value).toBeNull();
    expect(outcome.fieldOutcomes.find((f) => f.field === "saleDate")).toMatchObject({ status: "accepted", hadValue: true });
    expect(outcome.result?.saleDate.value).toBe("2026-09-01");
  });

  it("treats a key omitted by the model as 'omitted', not as invalidating the rest of the response", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    delete response.grantorNames;
    response.saleDate = { value: "2026-09-01", explicitlyStated: true, confidence: 0.95, supportingText: "x", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.fieldOutcomes.find((f) => f.field === "grantorNames")).toMatchObject({ status: "omitted" });
    expect(outcome.result?.grantorNames.value).toBeNull();
    expect(outcome.result?.saleDate.value).toBe("2026-09-01");
  });

  it("accepts a response that's only partially valid -- some fields recovered, some not", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const response = fullBlankResponse();
    response.borrowerNames = { value: ["JOHN DOE"], explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
    response.originalPrincipalAmount = { value: "not-a-number", explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
    mockToolResponse(response);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    const accepted = outcome.fieldOutcomes.filter((f) => f.status === "accepted" && f.hadValue).map((f) => f.field);
    const rejected = outcome.fieldOutcomes.filter((f) => f.status === "rejected_invalid").map((f) => f.field);
    expect(accepted).toContain("borrowerNames");
    expect(rejected).toContain("originalPrincipalAmount");
  });

  it("never fabricates a value -- a fully unusable tool call returns a null result, not a guessed default (after exhausting the bounded retry)", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    const unusableResponse = {
      content: [{ type: "text", text: "I could not extract structured data." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    };
    createMock.mockResolvedValueOnce(unusableResponse).mockResolvedValueOnce(unusableResponse);

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.result).toBeNull();
    expect(outcome.reason).toBeTruthy();
    // Both attempts were real API calls -- confirmed by the mock having
    // been invoked twice, not by string-matching the reason text.
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not report usedAiFallback-worthy recovery when every field is blank (zero useful fields) -- and does NOT retry, since every field still passed validation", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    mockToolResponse(fullBlankResponse());

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    const anyUseful = outcome.fieldOutcomes.some((f) => f.status === "accepted" && f.hadValue);
    expect(anyUseful).toBe(false);
    // A fully-blank-but-VALID response (every field present and
    // schema-valid, just carrying a null value) is a normal low-signal
    // result, not the "acceptedCount === 0" total-failure case that
    // triggers a retry -- only a response where every field is
    // omitted/rejected_invalid counts as a total failure.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  // Root-caused against a real total-failure case (HID-117888, second
  // fresh-25 batch, 2026-08-09): re-running the exact same production call
  // against the same stored text, with no code changes, produced a
  // perfect response -- no reproducible schema/prompt bug was found, so a
  // bounded single retry is the evidence-backed fix rather than chasing a
  // schema bug that likely doesn't exist.
  describe("bounded retry on total extraction failure", () => {
    it("retries once and returns the successful second attempt when the first attempt has zero fields pass validation", async () => {
      const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
      mockToolResponse({}); // first attempt: total failure (every one of 18 fields omitted)
      const secondResponse = fullBlankResponse();
      secondResponse.borrowerNames = { value: ["JOHN DOE"], explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
      mockToolResponse(secondResponse); // second attempt: real recovery

      const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

      expect(createMock).toHaveBeenCalledTimes(2);
      expect(outcome.result?.borrowerNames.value).toEqual(["JOHN DOE"]);
      expect(outcome.reason).toBeUndefined();
    });

    it("retries once when the first attempt returns no usable tool call at all, and returns the successful second attempt", async () => {
      const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
      createMock.mockResolvedValueOnce({
        content: [{ type: "text", text: "I could not extract structured data." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20 },
      });
      const secondResponse = fullBlankResponse();
      secondResponse.saleDate = { value: "2026-09-01", explicitlyStated: true, confidence: 0.95, supportingText: "x", pageNumber: 1 };
      mockToolResponse(secondResponse);

      const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

      expect(createMock).toHaveBeenCalledTimes(2);
      expect(outcome.result?.saleDate.value).toBe("2026-09-01");
    });

    it("does NOT retry when at least one field passes validation on the first attempt (only a TOTAL failure triggers a retry)", async () => {
      const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
      const response = fullBlankResponse();
      response.saleDate = { value: "2026-09-01", explicitlyStated: true, confidence: 0.95, supportingText: "x", pageNumber: 1 };
      mockToolResponse(response);

      const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(outcome.result?.saleDate.value).toBe("2026-09-01");
    });

    it("sums cost and token usage across both attempts rather than reporting only the last one", async () => {
      const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
      mockToolResponse({}, { inputTokens: 1000, outputTokens: 500 }); // first attempt: total failure
      const secondResponse = fullBlankResponse();
      secondResponse.borrowerNames = { value: ["JOHN DOE"], explicitlyStated: true, confidence: 0.9, supportingText: "x", pageNumber: 1 };
      mockToolResponse(secondResponse, { inputTokens: 1200, outputTokens: 600 });

      const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

      expect(outcome.inputTokens).toBe(2200);
      expect(outcome.outputTokens).toBe(1100);
      expect(budget.recordSpend).toHaveBeenCalledTimes(2);
    });
  });

  it("records token usage and spend for instrumentation", async () => {
    const { extractWithAI } = await import("../src/extraction/ai/extractWithAI");
    mockToolResponse(fullBlankResponse(), { inputTokens: 2000, outputTokens: 800 });

    const outcome = await extractWithAI("notice text", budget, { apiKey: "test-key" });

    expect(outcome.inputTokens).toBe(2000);
    expect(outcome.outputTokens).toBe(800);
    expect(outcome.costCents).toBeGreaterThan(0);
    expect(budget.recordSpend).toHaveBeenCalledWith(outcome.costCents);
  });
});
