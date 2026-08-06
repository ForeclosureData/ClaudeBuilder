import { describe, it, expect } from "vitest";
import { resolveFromCandidates, scoreCandidates, type ScoringInput } from "../src/address-resolution/scoring";
import type { AppraisalPropertyCandidate } from "@foreclosuredata/types";

const record: AppraisalPropertyCandidate = {
  sourcePropertyId: "P-001",
  sourceUrl: null as unknown as string,
  ownerName: "John A. Smith",
  situsAddress: "1417 N Cage Blvd, Pharr, TX 78577",
  city: "Pharr",
  zipCode: "78577",
  parcelId: "P-001",
  geographicId: "G-001",
  legalDescription: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
  subdivision: "Sunrise Terrace Subdivision",
  lot: "14",
  block: "3",
  acreage: 0.21,
  classification: "RESIDENTIAL",
  landValueCents: null,
  improvementValueCents: null,
  appraisedValueCents: 18_500_00,
  assessedValueCents: null,
  marketValueCents: null,
  homestead: true,
  taxYear: 2026,
};

const baseInput: ScoringInput = {
  ownerNames: ["John A. Smith"],
  streetAddress: null,
  city: "Pharr",
  parcelId: null,
  geographicId: null,
  legalDescriptionRawText: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
  subdivision: "Sunrise Terrace Subdivision",
  lot: "14",
  block: "3",
  acreage: 0.21,
  ownerMailingAddress: null,
};

describe("scoreCandidates", () => {
  it("scores a fully-matching candidate near the top of the range", () => {
    const [scored] = scoreCandidates(baseInput, [record]);
    expect(scored!.score).toBeGreaterThan(0.9);
    expect(scored!.matchedFields).toEqual(expect.arrayContaining(["subdivision", "lot", "block", "ownerName"]));
    expect(scored!.conflictingFields).toEqual([]);
  });

  it("penalizes a conflicting lot number even when the subdivision matches", () => {
    const conflicting: AppraisalPropertyCandidate = { ...record, lot: "99" };
    const [scored] = scoreCandidates(baseInput, [conflicting]);
    expect(scored!.conflictingFields).toContain("lot");
  });

  it("does not penalize an abbreviated owner name as conflicting", () => {
    const [scored] = scoreCandidates({ ...baseInput, ownerNames: ["J. Smith"] }, [record]);
    expect(scored!.conflictingFields).not.toContain("ownerName");
  });

  it("penalizes a genuinely different owner name", () => {
    const [scored] = scoreCandidates({ ...baseInput, ownerNames: ["Maria Garcia"] }, [record]);
    expect(scored!.conflictingFields).toContain("ownerName");
  });
});

describe("resolveFromCandidates", () => {
  it("auto-accepts a single strong candidate above the default threshold", () => {
    const result = resolveFromCandidates(baseInput, [record]);
    expect(result.requiresManualReview).toBe(false);
    expect(result.selectedCandidateId).toBe("P-001");
    expect(result.confidence).toBeGreaterThanOrEqual(0.92);
  });

  it("requires manual review when the top two candidates are too close together", () => {
    const rival: AppraisalPropertyCandidate = { ...record, sourcePropertyId: "P-002", parcelId: "P-002", geographicId: "G-002", ownerName: "J Smith" };
    const result = resolveFromCandidates(baseInput, [record, rival], { autoAcceptThreshold: 0.5, reviewThreshold: 0.3, minimumMargin: 0.3 });
    expect(result.requiresManualReview).toBe(true);
    expect(result.candidateCount).toBe(2);
  });

  it("never auto-accepts when a critical field (lot/block) conflicts, regardless of overall score", () => {
    const conflicting: AppraisalPropertyCandidate = { ...record, lot: "99" };
    const result = resolveFromCandidates(baseInput, [conflicting]);
    expect(result.requiresManualReview).toBe(true);
  });

  it("returns unresolved with zero candidates when nothing is found", () => {
    const result = resolveFromCandidates(baseInput, []);
    expect(result.resolutionMethod).toBe("unresolved");
    expect(result.requiresManualReview).toBe(true);
    expect(result.candidateCount).toBe(0);
  });

  it("respects custom thresholds from getMatchThresholdsFromEnv-style overrides", () => {
    const result = resolveFromCandidates(baseInput, [record], { autoAcceptThreshold: 1.5, reviewThreshold: 0.1, minimumMargin: 0.15 });
    // Score can never reach 1.5 (clamped at 1), so this must fall to manual review even though the candidate is a great match.
    expect(result.requiresManualReview).toBe(true);
  });
});
