import { describe, it, expect } from "vitest";
import { runExtractionPipeline } from "../src/extraction/pipeline";
import type { BudgetGuard } from "../src/extraction/ai/extractWithAI";

/** Never has headroom -- keeps every test purely deterministic (no AI fallback call, no network). */
const NO_AI_BUDGET: BudgetGuard = {
  hasHeadroom: async () => false,
  recordSpend: async () => {},
};

describe("runExtractionPipeline manual review evidence", () => {
  it("attaches structured evidence for every reason it raises on a nearly-empty notice", async () => {
    const result = await runExtractionPipeline("", NO_AI_BUDGET);

    expect(result.manualReviewReasons).toEqual(
      expect.arrayContaining(["NO_ADDRESS_RESOLVED", "BORROWER_NAME_CONFLICT", "SALE_DATE_CONFLICT", "LOW_CONFIDENCE"]),
    );

    for (const reason of result.manualReviewReasons) {
      const evidence = result.manualReviewEvidence[reason];
      expect(evidence, `expected evidence for reason ${reason}`).toBeDefined();
      expect(evidence!.reason).toBe(reason);
    }

    expect(result.manualReviewEvidence.NO_ADDRESS_RESOLVED?.conflictingField).toBe("propertyAddress");
    expect(result.manualReviewEvidence.BORROWER_NAME_CONFLICT?.conflictingField).toBe("borrowerNames");
    expect(result.manualReviewEvidence.SALE_DATE_CONFLICT?.conflictingField).toBe("saleDate");
    expect(result.manualReviewEvidence.LOW_CONFIDENCE?.score).toBe(0);
  });

  it("records a source snippet for POOR_TEXT_QUALITY evidence", async () => {
    const noisyText = "0abcd1 property notice illegible portion illegible again";
    const result = await runExtractionPipeline(noisyText, NO_AI_BUDGET);

    expect(result.manualReviewReasons).toContain("POOR_TEXT_QUALITY");
    const evidence = result.manualReviewEvidence.POOR_TEXT_QUALITY;
    expect(evidence?.reason).toBe("POOR_TEXT_QUALITY");
    expect(typeof evidence?.sourceSnippet).toBe("string");
    expect(evidence?.sourceSnippet?.length).toBeGreaterThan(0);
  });

  it("does not raise BORROWER_NAME_CONFLICT/SALE_DATE_CONFLICT/NO_ADDRESS_RESOLVED evidence when those fields resolved cleanly", async () => {
    const cleanNotice = [
      "Property Address: 3312 W Trenton Rd, Edinburg, Texas 78539",
      "Date of Sale: September 1, 2026",
      "Time of Sale: 10:00 AM",
      "Grantor: Jane A. Doe",
      "Original Principal Amount: $185,000.00",
    ].join("\n");
    const result = await runExtractionPipeline(cleanNotice, NO_AI_BUDGET);

    expect(result.manualReviewReasons).not.toContain("NO_ADDRESS_RESOLVED");
    expect(result.manualReviewReasons).not.toContain("SALE_DATE_CONFLICT");
    expect(result.manualReviewEvidence.NO_ADDRESS_RESOLVED).toBeUndefined();
    expect(result.manualReviewEvidence.SALE_DATE_CONFLICT).toBeUndefined();
  });
});
