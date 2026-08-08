import { describe, it, expect } from "vitest";
import { chooseCanonicalCase, scoreCanonicalCandidate, type CanonicalCandidateInput } from "../src/dedup/chooseCanonical";

function candidate(overrides: Partial<CanonicalCandidateInput> & { caseId: string }): CanonicalCandidateInput {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    hasProperty: false,
    addressResolutionMethod: null,
    addressResolutionConfidence: null,
    selectedAppraisalCandidateScore: null,
    extractedDataCompletenessCount: 0,
    resolvedManualReviewTaskCount: 0,
    ...overrides,
  };
}

describe("chooseCanonicalCase", () => {
  it("returns the single candidate when there is only one", () => {
    const result = chooseCanonicalCase([candidate({ caseId: "a" })]);
    expect(result.canonicalCaseId).toBe("a");
    expect(result.tieBreakUsed).toBe(false);
  });

  it("prefers a row with EXPLICIT_STATED resolution over an UNRESOLVED row, regardless of age", () => {
    const older = candidate({ caseId: "old-unresolved", createdAt: "2026-01-01T00:00:00.000Z", hasProperty: true, addressResolutionMethod: "UNRESOLVED" });
    const newer = candidate({
      caseId: "new-explicit",
      createdAt: "2026-08-01T00:00:00.000Z",
      hasProperty: true,
      addressResolutionMethod: "EXPLICIT_STATED",
      addressResolutionConfidence: 0.95,
    });
    const result = chooseCanonicalCase([older, newer]);
    expect(result.canonicalCaseId).toBe("new-explicit");
    expect(result.tieBreakUsed).toBe(false);
  });

  it("prefers a row with a strong selected CAD candidate match over one with none", () => {
    const noMatch = candidate({ caseId: "no-match", hasProperty: true, addressResolutionMethod: "MANUAL", addressResolutionConfidence: 0.5 });
    const cadMatch = candidate({
      caseId: "cad-match",
      hasProperty: true,
      addressResolutionMethod: "MULTI_FIELD_MATCH",
      addressResolutionConfidence: 0.9,
      selectedAppraisalCandidateScore: 0.97,
    });
    const result = chooseCanonicalCase([noMatch, cadMatch]);
    expect(result.canonicalCaseId).toBe("cad-match");
  });

  it("prefers more complete extracted notice data when resolution quality is otherwise equal", () => {
    const sparse = candidate({
      caseId: "sparse",
      hasProperty: true,
      addressResolutionMethod: "EXPLICIT_STATED",
      addressResolutionConfidence: 0.9,
      extractedDataCompletenessCount: 1,
    });
    const rich = candidate({
      caseId: "rich",
      hasProperty: true,
      addressResolutionMethod: "EXPLICIT_STATED",
      addressResolutionConfidence: 0.9,
      extractedDataCompletenessCount: 12,
    });
    const result = chooseCanonicalCase([sparse, rich]);
    expect(result.canonicalCaseId).toBe("rich");
    expect(result.tieBreakUsed).toBe(false);
  });

  it("uses createdAt only as a tie-break when scores are exactly equal", () => {
    const shared = { hasProperty: true, addressResolutionMethod: "EXPLICIT_STATED", addressResolutionConfidence: 0.9 } as const;
    const older = candidate({ caseId: "older", createdAt: "2026-01-01T00:00:00.000Z", ...shared });
    const newer = candidate({ caseId: "newer", createdAt: "2026-08-01T00:00:00.000Z", ...shared });
    const result = chooseCanonicalCase([newer, older]);
    expect(result.canonicalCaseId).toBe("older");
    expect(result.tieBreakUsed).toBe(true);
  });

  it("never lets recency alone override a materially better-resolved row (not a disguised newest-wins rule)", () => {
    const newerButWorse = candidate({ caseId: "newer-worse", createdAt: "2026-08-01T00:00:00.000Z", hasProperty: false });
    const olderButBetter = candidate({
      caseId: "older-better",
      createdAt: "2026-01-01T00:00:00.000Z",
      hasProperty: true,
      addressResolutionMethod: "EXPLICIT_STATED",
      addressResolutionConfidence: 0.95,
      selectedAppraisalCandidateScore: 0.9,
      extractedDataCompletenessCount: 10,
    });
    const result = chooseCanonicalCase([newerButWorse, olderButBetter]);
    expect(result.canonicalCaseId).toBe("older-better");
  });
});

describe("scoreCanonicalCandidate", () => {
  it("gives a fully unresolved, empty candidate a score of zero", () => {
    const { score } = scoreCanonicalCandidate(candidate({ caseId: "empty" }));
    expect(score).toBe(0);
  });

  it("caps the extracted-data-completeness contribution so a single field doesn't dominate the score", () => {
    const { breakdown: cappedBreakdown } = scoreCanonicalCandidate(candidate({ caseId: "huge", extractedDataCompletenessCount: 1000 }));
    const { breakdown: normalBreakdown } = scoreCanonicalCandidate(candidate({ caseId: "normal", extractedDataCompletenessCount: 20 }));
    expect(cappedBreakdown.extractedDataCompleteness).toBe(normalBreakdown.extractedDataCompleteness);
  });
});
