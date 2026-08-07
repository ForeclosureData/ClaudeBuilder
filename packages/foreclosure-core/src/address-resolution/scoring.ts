import type { AppraisalPropertyCandidate, PropertyResolutionMethod, PropertyResolutionResult } from "@foreclosuredata/types";
import { ownerNamesLikelyRelated, surnamesMatch } from "./ownerNameNormalization";
import { tokensOverlap } from "./legalDescriptionParsing";

export interface ScoringInput {
  ownerNames: string[];
  streetAddress: string | null;
  city: string | null;
  parcelId: string | null;
  geographicId: string | null;
  legalDescriptionRawText: string | null;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  ownerMailingAddress: string | null;
}

export interface ScoredCandidate {
  candidate: AppraisalPropertyCandidate;
  score: number;
  matchedFields: string[];
  conflictingFields: string[];
}

/**
 * Confidence floors for named, canonical matching strategies — the
 * additive WEIGHTS table below still drives fine-grained scoring across
 * messy real-world partial matches, but these floors guarantee the
 * headline strategies land at (or above) their product-specified
 * confidence: exact parcel ID 99%, exact geographic ID 97%, subdivision +
 * lot + block 97%, exact legal description 94%, owner name plus one more
 * corroborating field 88%, owner name alone 65%. A floor never applies
 * over a critical (lot/block) conflict — conflicting evidence always
 * wins over a floor.
 */
function applyConfidenceFloor(score: number, matchedFields: string[], conflictingFields: string[]): number {
  if (conflictingFields.some((f) => f === "lot" || f === "block")) return score;
  if (matchedFields.includes("parcelId")) return Math.max(score, 0.99);
  if (matchedFields.includes("geographicId")) return Math.max(score, 0.97);
  if (matchedFields.includes("subdivision") && matchedFields.includes("lot")) return Math.max(score, 0.97);
  if (matchedFields.includes("legalDescriptionTokens")) return Math.max(score, 0.94);
  if (matchedFields.includes("ownerName") && matchedFields.length >= 2) return Math.max(score, 0.88);
  if (matchedFields.length === 1 && matchedFields[0] === "ownerName") return Math.max(score, 0.65);
  return score;
}

/** Weighted-evidence table — see docs in the class-level comment on scoreCandidates(). */
const WEIGHTS = {
  parcelIdExact: 0.6,
  geographicIdExact: 0.55,
  subdivisionLotBlockExact: 0.5,
  subdivisionOnly: 0.2,
  legalDescriptionTokenOverlap: 0.2,
  ownerNameMatch: 0.15,
  acreageExact: 0.1,
  cityMatch: 0.05,
  mailingAddressMatch: 0.03,
  conflictingOwner: -0.3,
  conflictingLotOrBlock: -0.5,
  conflictingAcreage: -0.15,
} as const;

export interface MatchThresholds {
  autoAcceptThreshold: number;
  reviewThreshold: number;
  minimumMargin: number;
}

export function getMatchThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): MatchThresholds {
  return {
    autoAcceptThreshold: numberOr(env.PROPERTY_MATCH_AUTO_ACCEPT_THRESHOLD, 0.92),
    reviewThreshold: numberOr(env.PROPERTY_MATCH_REVIEW_THRESHOLD, 0.7),
    minimumMargin: numberOr(env.PROPERTY_MATCH_MINIMUM_MARGIN, 0.15),
  };
}

function numberOr(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Scores every candidate against the notice's known fields using the
 * weighted-evidence table from the product spec. A candidate never scores
 * above 1 (clamped) and never below 0 (clamped) — negative evidence only
 * pulls a candidate down relative to others, it doesn't produce a
 * meaningfully negative absolute score.
 */
export function scoreCandidates(input: ScoringInput, candidates: AppraisalPropertyCandidate[]): ScoredCandidate[] {
  return candidates.map((candidate) => {
    let score = 0;
    const matchedFields: string[] = [];
    const conflictingFields: string[] = [];

    if (input.parcelId && candidate.parcelId && input.parcelId === candidate.parcelId) {
      score += WEIGHTS.parcelIdExact;
      matchedFields.push("parcelId");
    }
    if (input.geographicId && candidate.geographicId && input.geographicId === candidate.geographicId) {
      score += WEIGHTS.geographicIdExact;
      matchedFields.push("geographicId");
    }

    const subdivisionMatches = tokensOverlap(input.subdivision, candidate.subdivision);
    const lotMatches = tokensOverlap(input.lot, candidate.lot);
    const blockMatches = input.block || candidate.block ? tokensOverlap(input.block, candidate.block) : true;
    if (input.subdivision && input.lot) {
      if (subdivisionMatches && lotMatches && blockMatches) {
        score += WEIGHTS.subdivisionLotBlockExact;
        matchedFields.push("subdivision", "lot");
        if (input.block) matchedFields.push("block");
      } else if (subdivisionMatches && input.lot && candidate.lot && !lotMatches) {
        score += WEIGHTS.conflictingLotOrBlock;
        conflictingFields.push("lot");
      } else if (input.block && candidate.block && !blockMatches && subdivisionMatches && lotMatches) {
        score += WEIGHTS.conflictingLotOrBlock;
        conflictingFields.push("block");
      }
    } else if (input.subdivision && subdivisionMatches) {
      // Subdivision is known but lot wasn't stated/parsed from the notice
      // (search strategy F: owner name + subdivision) — a weaker standalone
      // signal than a full subdivision+lot+block match, but still real
      // corroborating evidence, not nothing.
      score += WEIGHTS.subdivisionOnly;
      matchedFields.push("subdivision");
    }

    if (input.legalDescriptionRawText && candidate.legalDescription) {
      if (tokensOverlap(input.legalDescriptionRawText, candidate.legalDescription)) {
        score += WEIGHTS.legalDescriptionTokenOverlap;
        matchedFields.push("legalDescriptionTokens");
      }
    }

    if (input.ownerNames.length && candidate.ownerName) {
      const fullMatch = input.ownerNames.some((n) => ownerNamesLikelyRelated(n, candidate.ownerName as string));
      const sameSurname = input.ownerNames.some((n) => surnamesMatch(n, candidate.ownerName as string));
      if (fullMatch) {
        score += WEIGHTS.ownerNameMatch;
        matchedFields.push("ownerName");
      } else if (!sameSurname) {
        // A genuinely different surname is negative evidence. A partial/
        // abbreviated match ("J. Smith" vs "John A. Smith") shares a
        // surname and is left neutral rather than penalized.
        score += WEIGHTS.conflictingOwner;
        conflictingFields.push("ownerName");
      }
    }

    if (input.acreage !== null && candidate.acreage !== null) {
      if (Math.abs(input.acreage - candidate.acreage) < 0.05) {
        score += WEIGHTS.acreageExact;
        matchedFields.push("acreage");
      } else if (Math.abs(input.acreage - candidate.acreage) > 0.5) {
        score += WEIGHTS.conflictingAcreage;
        conflictingFields.push("acreage");
      }
    }

    if (input.city && candidate.city && normalizeCity(input.city) === normalizeCity(candidate.city)) {
      score += WEIGHTS.cityMatch;
      matchedFields.push("city");
    }

    if (input.ownerMailingAddress && candidate.situsAddress) {
      if (normalizeAddress(input.ownerMailingAddress) === normalizeAddress(candidate.situsAddress)) {
        score += WEIGHTS.mailingAddressMatch;
        matchedFields.push("mailingAddressMatchesSitus");
      }
    }

    const dedupedMatched = dedupe(matchedFields);
    const dedupedConflicting = dedupe(conflictingFields);
    const floored = applyConfidenceFloor(score, dedupedMatched, dedupedConflicting);
    return { candidate, score: clamp(floored, 0, 1), matchedFields: dedupedMatched, conflictingFields: dedupedConflicting };
  });
}

/** One-line human explanation of why a specific candidate scored the way it did — used per-candidate in the admin review screen, distinct from resolveFromCandidates()'s top-pick explanation. */
export function explainMatch(matchedFields: string[], conflictingFields: string[]): string {
  if (matchedFields.length === 0 && conflictingFields.length === 0) return "No matching fields found.";
  const parts: string[] = [];
  if (matchedFields.includes("parcelId")) parts.push("exact parcel ID match");
  else if (matchedFields.includes("geographicId")) parts.push("exact geographic ID match");
  else if (matchedFields.includes("subdivision") && matchedFields.includes("lot")) parts.push("subdivision, lot, and block matched");
  else if (matchedFields.includes("legalDescriptionTokens")) parts.push("legal description text matched");
  else if (matchedFields.includes("ownerName") && matchedFields.includes("subdivision")) parts.push("owner name plus subdivision matched (no lot stated)");
  else if (matchedFields.includes("subdivision")) parts.push("subdivision matched (no lot stated)");
  else if (matchedFields.includes("ownerName") && matchedFields.length > 1) parts.push(`owner name plus ${matchedFields.filter((f) => f !== "ownerName").join(", ")}`);
  else if (matchedFields.includes("ownerName")) parts.push("owner name only — weak signal, cannot auto-publish alone");
  else if (matchedFields.length > 0) parts.push(`matched: ${matchedFields.join(", ")}`);

  if (conflictingFields.length > 0) parts.push(`conflicting: ${conflictingFields.join(", ")}`);
  return parts.join("; ") || "No matching fields found.";
}

/**
 * Runs the full 10-step resolution sequence (explicit address is handled
 * upstream by the caller before this is invoked — steps 1/2 in the spec).
 * Publishes an address only when the top candidate clears
 * `autoAcceptThreshold`, has no conflicting critical fields, and beats the
 * second-best candidate by at least `minimumMargin`. Otherwise the result
 * is routed to manual review rather than guessed.
 */
export function resolveFromCandidates(
  input: ScoringInput,
  candidates: AppraisalPropertyCandidate[],
  thresholds: MatchThresholds = getMatchThresholdsFromEnv(),
): PropertyResolutionResult {
  if (candidates.length === 0) {
    return {
      selectedCandidateId: null,
      confidence: 0,
      resolutionMethod: "unresolved",
      explanation: "No appraisal-district candidates were found for the available fields (legal description / owner name / parcel / geographic ID).",
      matchedFields: [],
      conflictingFields: [],
      candidateCount: 0,
      requiresManualReview: true,
    };
  }

  const scored = scoreCandidates(input, candidates).sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;

  const hasCriticalConflict = top.conflictingFields.some((f) => f === "lot" || f === "block");
  // Owner name alone is never sufficient to auto-publish, regardless of
  // how PROPERTY_MATCH_AUTO_ACCEPT_THRESHOLD is configured — this is a
  // hard rule, not a threshold-tuning outcome.
  const isOwnerNameAlone = top.matchedFields.length === 1 && top.matchedFields[0] === "ownerName";
  const method = methodFor(top, input);

  if (
    !hasCriticalConflict &&
    !isOwnerNameAlone &&
    top.score >= thresholds.autoAcceptThreshold &&
    (candidates.length === 1 || margin >= thresholds.minimumMargin)
  ) {
    return {
      selectedCandidateId: top.candidate.sourcePropertyId,
      confidence: top.score,
      resolutionMethod: method,
      explanation: explanationFor(method, top, candidates.length),
      matchedFields: top.matchedFields,
      conflictingFields: top.conflictingFields,
      candidateCount: candidates.length,
      requiresManualReview: false,
    };
  }

  if (top.score >= thresholds.reviewThreshold) {
    return {
      selectedCandidateId: null,
      confidence: top.score,
      resolutionMethod: method,
      explanation: hasCriticalConflict
        ? `The top candidate scored ${top.score.toFixed(2)} but has a conflicting ${top.conflictingFields.join("/")} — sent to manual review rather than auto-accepted.`
        : isOwnerNameAlone
          ? `The top candidate matched on owner name only (score ${top.score.toFixed(2)}) — owner name alone is never sufficient to auto-publish, sent to manual review.`
          : `The top candidate scored ${top.score.toFixed(2)}, ${second ? `only ${margin.toFixed(2)} ahead of the next candidate (${second.score.toFixed(2)})` : "below the auto-accept threshold"} — sent to manual review.`,
      matchedFields: top.matchedFields,
      conflictingFields: top.conflictingFields,
      candidateCount: candidates.length,
      requiresManualReview: true,
    };
  }

  return {
    selectedCandidateId: null,
    confidence: top.score,
    resolutionMethod: "unresolved",
    explanation: `No candidate scored above the manual-review threshold (best was ${top.score.toFixed(2)}).`,
    matchedFields: [],
    conflictingFields: top.conflictingFields,
    candidateCount: candidates.length,
    requiresManualReview: true,
  };
}

function methodFor(top: ScoredCandidate, input: ScoringInput): PropertyResolutionMethod {
  if (top.matchedFields.includes("parcelId")) return "parcel_id_match";
  if (top.matchedFields.includes("geographicId")) return "geographic_id_match";
  if (top.matchedFields.includes("subdivision") && top.matchedFields.includes("lot")) {
    return input.legalDescriptionRawText ? "subdivision_lot_block" : "subdivision_lot_block";
  }
  if (top.matchedFields.includes("legalDescriptionTokens")) return "exact_legal_description";
  if (top.matchedFields.length >= 2) return "multi_field_match";
  return "manual";
}

function explanationFor(method: PropertyResolutionMethod, top: ScoredCandidate, candidateCount: number): string {
  const fieldList = top.matchedFields.join(", ");
  const uniqueness = candidateCount > 1 ? ` (best of ${candidateCount} candidates considered)` : "";
  switch (method) {
    case "parcel_id_match":
      return `Exact parcel ID match to the county appraisal record${uniqueness}.`;
    case "geographic_id_match":
      return `Exact geographic ID match to the county appraisal record${uniqueness}.`;
    case "subdivision_lot_block":
      return `Subdivision, lot, and block matched the county appraisal record (matched fields: ${fieldList})${uniqueness}.`;
    case "exact_legal_description":
      return `Legal description text matched the county appraisal record's legal description${uniqueness}.`;
    case "multi_field_match":
      return `Multiple corroborating fields matched the county appraisal record (${fieldList})${uniqueness}.`;
    default:
      return `Matched on: ${fieldList || "no fields"}${uniqueness}.`;
  }
}

function normalizeCity(value: string): string {
  return value.toUpperCase().trim();
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
