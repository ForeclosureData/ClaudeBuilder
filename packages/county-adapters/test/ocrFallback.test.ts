import { describe, it, expect } from "vitest";
import { shouldFallbackToClaude } from "../src/hidalgo/splitBundle";

describe("shouldFallbackToClaude", () => {
  it("trusts OCR when confidence is high and text is substantial", () => {
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 94 })).toBe(false);
  });

  it("falls back when confidence is below the threshold", () => {
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 65 }, 70)).toBe(true);
  });

  it("falls back when text is implausibly short even if confidence is reported high (e.g. a near-blank page misread)", () => {
    expect(shouldFallbackToClaude({ text: "a", confidence: 99 })).toBe(true);
  });

  it("trusts OCR right at the threshold boundary but not just below it", () => {
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 70 }, 70)).toBe(false);
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 69.9 }, 70)).toBe(true);
  });

  it("uses the default threshold (70) when none is given", () => {
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 71 })).toBe(false);
    expect(shouldFallbackToClaude({ text: "A".repeat(500), confidence: 50 })).toBe(true);
  });
});
