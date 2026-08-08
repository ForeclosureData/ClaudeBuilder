import { describe, it, expect } from "vitest";
import { resolveFromCandidates, scoreCandidates, explainMatch, type ScoringInput } from "../src/address-resolution/scoring";
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
  latitude: 26.1758,
  longitude: -98.2375,
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

  it("never auto-accepts on owner name alone, even if the auto-accept threshold is misconfigured low", () => {
    const ownerOnlyInput: ScoringInput = { ...baseInput, city: null, parcelId: null, geographicId: null, legalDescriptionRawText: null, subdivision: null, lot: null, block: null, acreage: null };
    const ownerOnlyCandidate: AppraisalPropertyCandidate = { ...record, city: null, subdivision: null, lot: null, block: null, legalDescription: null, acreage: null };
    const result = resolveFromCandidates(ownerOnlyInput, [ownerOnlyCandidate], { autoAcceptThreshold: 0.5, reviewThreshold: 0.3, minimumMargin: 0.1 });
    expect(result.requiresManualReview).toBe(true);
    expect(result.selectedCandidateId).toBeNull();
  });

  // Regression test for a real bug found investigating the 25-notice production run: a
  // parcel-ID (or subdivision+lot+block) match's confidence FLOOR (0.99/0.97) was being
  // applied even when the candidate's owner conflicted with the notice's borrower/grantor,
  // silently erasing the -0.3 conflictingOwner penalty and auto-accepting a property that
  // had (at minimum) changed hands since the notice was filed -- exactly the "an otherwise
  // high score overrides a genuine owner-name conflict" failure mode that must never happen.
  it("never auto-accepts an exact parcel-ID match when the owner genuinely conflicts", () => {
    const input: ScoringInput = { ...baseInput, ownerNames: ["Maria Garcia"], parcelId: "P-001" };
    const result = resolveFromCandidates(input, [record]);
    expect(result.requiresManualReview).toBe(true);
    expect(result.selectedCandidateId).toBeNull();
    expect(result.conflictingFields).toContain("ownerName");
  });

  it("never auto-accepts a subdivision+lot+block match when the owner genuinely conflicts", () => {
    const input: ScoringInput = { ...baseInput, ownerNames: ["Maria Garcia"] };
    const result = resolveFromCandidates(input, [record]);
    expect(result.requiresManualReview).toBe(true);
    expect(result.selectedCandidateId).toBeNull();
  });

  it("still auto-accepts a strong match when the owner name is merely an abbreviated/reordered form, not a conflict", () => {
    const input: ScoringInput = { ...baseInput, ownerNames: ["Smith, John"] };
    const result = resolveFromCandidates(input, [record]);
    expect(result.requiresManualReview).toBe(false);
    expect(result.selectedCandidateId).toBe("P-001");
  });
});

describe("confidence floors (product-specified anchors)", () => {
  it("floors an exact-parcel-ID-only match at 0.99", () => {
    const input: ScoringInput = { ownerNames: [], streetAddress: null, city: null, parcelId: "P-001", geographicId: null, legalDescriptionRawText: null, subdivision: null, lot: null, block: null, acreage: null, ownerMailingAddress: null };
    const candidate: AppraisalPropertyCandidate = { ...record, ownerName: null, subdivision: null, lot: null, block: null, legalDescription: null, acreage: null };
    const [scored] = scoreCandidates(input, [candidate]);
    expect(scored!.score).toBeGreaterThanOrEqual(0.99);
  });

  it("floors an exact-geographic-ID-only match at 0.97", () => {
    const input: ScoringInput = { ownerNames: [], streetAddress: null, city: null, parcelId: null, geographicId: "G-001", legalDescriptionRawText: null, subdivision: null, lot: null, block: null, acreage: null, ownerMailingAddress: null };
    const candidate: AppraisalPropertyCandidate = { ...record, parcelId: null, ownerName: null, subdivision: null, lot: null, block: null, legalDescription: null, acreage: null };
    const [scored] = scoreCandidates(input, [candidate]);
    expect(scored!.score).toBeGreaterThanOrEqual(0.97);
  });

  it("floors a subdivision+lot+block-only match at 0.97", () => {
    const input: ScoringInput = { ownerNames: [], streetAddress: null, city: null, parcelId: null, geographicId: null, legalDescriptionRawText: null, subdivision: "Sunrise Terrace Subdivision", lot: "14", block: "3", acreage: null, ownerMailingAddress: null };
    const candidate: AppraisalPropertyCandidate = { ...record, parcelId: null, geographicId: null, ownerName: null, legalDescription: null, acreage: null };
    const [scored] = scoreCandidates(input, [candidate]);
    expect(scored!.score).toBeGreaterThanOrEqual(0.97);
  });

  it("floors owner name + one corroborating field (subdivision) at 0.88", () => {
    const input: ScoringInput = { ownerNames: ["John A. Smith"], streetAddress: null, city: null, parcelId: null, geographicId: null, legalDescriptionRawText: null, subdivision: "Sunrise Terrace Subdivision", lot: null, block: null, acreage: null, ownerMailingAddress: null };
    const candidate: AppraisalPropertyCandidate = { ...record, parcelId: null, geographicId: null, lot: null, block: null, legalDescription: null, acreage: null };
    const [scored] = scoreCandidates(input, [candidate]);
    expect(scored!.score).toBeGreaterThanOrEqual(0.88);
    expect(scored!.score).toBeLessThan(0.97);
  });

  it("floors an owner-name-only match at 0.65 — a weak signal, not near auto-accept", () => {
    const input: ScoringInput = { ownerNames: ["John A. Smith"], streetAddress: null, city: null, parcelId: null, geographicId: null, legalDescriptionRawText: null, subdivision: null, lot: null, block: null, acreage: null, ownerMailingAddress: null };
    const candidate: AppraisalPropertyCandidate = { ...record, parcelId: null, geographicId: null, subdivision: null, lot: null, block: null, legalDescription: null, acreage: null };
    const [scored] = scoreCandidates(input, [candidate]);
    expect(scored!.score).toBeGreaterThanOrEqual(0.65);
    expect(scored!.score).toBeLessThan(0.88);
  });

  it("never applies a floor over a critical lot/block conflict", () => {
    const conflictingLot: AppraisalPropertyCandidate = { ...record, lot: "99" };
    const [scored] = scoreCandidates(baseInput, [conflictingLot]);
    expect(scored!.conflictingFields).toContain("lot");
    expect(scored!.score).toBeLessThan(0.97);
  });

  it("never applies the parcel-ID floor over a genuine owner-name conflict", () => {
    const input: ScoringInput = { ownerNames: ["Maria Garcia"], streetAddress: null, city: null, parcelId: "P-001", geographicId: null, legalDescriptionRawText: null, subdivision: null, lot: null, block: null, acreage: null, ownerMailingAddress: null };
    const [scored] = scoreCandidates(input, [{ ...record, subdivision: null, lot: null, block: null, legalDescription: null, acreage: null }]);
    expect(scored!.conflictingFields).toContain("ownerName");
    expect(scored!.score).toBeLessThan(0.99);
  });

  it("never applies the subdivision+lot+block floor over a genuine owner-name conflict", () => {
    const input: ScoringInput = { ...baseInput, ownerNames: ["Maria Garcia"], parcelId: null, geographicId: null };
    const [scored] = scoreCandidates(input, [{ ...record, parcelId: null, geographicId: null, legalDescription: null, acreage: null }]);
    expect(scored!.conflictingFields).toContain("ownerName");
    expect(scored!.score).toBeLessThan(0.97);
  });
});

describe("explainMatch", () => {
  it("describes an owner-name-only match as a weak signal", () => {
    expect(explainMatch(["ownerName"], [])).toMatch(/weak signal/i);
  });

  it("describes a parcel ID match plainly", () => {
    expect(explainMatch(["parcelId"], [])).toMatch(/parcel id/i);
  });

  it("surfaces conflicting fields alongside matched ones", () => {
    expect(explainMatch(["subdivision", "lot", "block"], ["ownerName"])).toMatch(/conflicting: ownerName/);
  });
});
