import { describe, it, expect } from "vitest";
import { selectDisplayValuation } from "../src/address-resolution/appraisalAdapter";
import type { AppraisalValueYear } from "@foreclosuredata/types";

function year(taxYear: number, populated: boolean, marketValueCents: number | null = null): AppraisalValueYear {
  return {
    taxYear,
    landValueCents: null,
    improvementValueCents: null,
    appraisedValueCents: null,
    assessedValueCents: null,
    marketValueCents,
    certified: populated,
    populated,
    sourceUrl: "https://example.local",
    retrievedAt: new Date().toISOString(),
  };
}

describe("selectDisplayValuation", () => {
  it("picks the most recent populated year, skipping an unpopulated current year", () => {
    const result = selectDisplayValuation([year(2027, false), year(2026, true, 26_492_900)]);
    expect(result?.taxYear).toBe(2026);
    expect(result?.marketValueCents).toBe(26_492_900);
  });

  it("picks the most recent among several populated years rather than the first one found", () => {
    const result = selectDisplayValuation([year(2025, true, 100), year(2026, true, 200), year(2024, true, 300)]);
    expect(result?.taxYear).toBe(2026);
  });

  it("returns null (never a fabricated year) when nothing in the history is populated", () => {
    expect(selectDisplayValuation([year(2027, false), year(2026, false), year(2025, false)])).toBeNull();
  });

  it("returns null for an empty history", () => {
    expect(selectDisplayValuation([])).toBeNull();
  });
});
