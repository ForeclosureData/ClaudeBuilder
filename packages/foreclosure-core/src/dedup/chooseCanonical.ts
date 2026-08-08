/**
 * Picks which row in a group of duplicate ForeclosureCase rows (same real
 * notice, same countyId + normalized countyFilingNumber) should become the
 * canonical, surviving record when the others are archived as duplicates.
 *
 * Deliberately NOT "oldest wins" or "newest wins": per the dedup-repair
 * requirement, the canonical row is chosen by data completeness and
 * resolution quality -- the strongest verified parcel match, the most
 * complete extracted notice data, and valid downstream relationships.
 * createdAt is used ONLY to break an exact score tie.
 *
 * Pure and DB-agnostic so both the dry-run report and the real cleanup
 * script call the exact same logic -- the report is a true preview of what
 * the cleanup script will do, not a separate approximation of it.
 */

export interface CanonicalCandidateInput {
  caseId: string;
  createdAt: string;
  hasProperty: boolean;
  /** Property.addressResolutionMethod, or null if unresolved/no property. */
  addressResolutionMethod: string | null;
  /** Property.addressResolutionConfidence, 0-1, or null. */
  addressResolutionConfidence: number | null;
  /** Score (0-1) of the AppraisalPropertyCandidate with isSelected: true, or null if none selected. */
  selectedAppraisalCandidateScore: number | null;
  /**
   * Count of populated notable extracted fields on this case's downstream
   * records (Loan parties/amounts/dates, ForeclosureSale details, summary
   * text, legal description text) -- a proxy for "how complete is the
   * extracted notice data attached to this row."
   */
  extractedDataCompletenessCount: number;
  /** ManualReviewTask rows attached to this case with status RESOLVED. */
  resolvedManualReviewTaskCount: number;
}

export interface ScoredCanonicalCandidate {
  caseId: string;
  createdAt: string;
  score: number;
  scoreBreakdown: Record<string, number>;
}

export interface CanonicalSelectionResult {
  canonicalCaseId: string;
  scoredCandidates: ScoredCanonicalCandidate[];
  reasoning: string;
  tieBreakUsed: boolean;
}

// Higher rank = stronger, more directly verified evidence of the real
// property address. EXPLICIT_STATED (the notice itself states the address)
// outranks every CAD-derived match; CAD matches outrank owner-mailing-address
// and raw geocoding, which are weaker fallback signals; UNRESOLVED/unlisted
// methods score zero.
const RESOLUTION_METHOD_RANK: Record<string, number> = {
  EXPLICIT_STATED: 10,
  MULTI_FIELD_MATCH: 9,
  PROPERTY_ID_MATCH: 8,
  GEOGRAPHIC_ID_MATCH: 8,
  LEGAL_DESCRIPTION_MATCH: 7,
  CACHED_MATCH_REUSE: 6,
  COMMONLY_KNOWN_AS_PHRASE: 6,
  MANUAL: 5,
  OWNER_MAILING_ADDRESS_MATCH: 4,
  GEOCODING: 3,
  UNRESOLVED: 0,
};

const EXTRACTED_DATA_COMPLETENESS_CAP = 20;
const RESOLVED_MANUAL_REVIEW_CAP = 5;
const SCORE_TIE_EPSILON = 0.01;

export function scoreCanonicalCandidate(input: CanonicalCandidateInput): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    hasProperty: input.hasProperty ? 10 : 0,
    resolutionMethodRank: (RESOLUTION_METHOD_RANK[input.addressResolutionMethod ?? ""] ?? 0) * 2,
    resolutionConfidence: (input.addressResolutionConfidence ?? 0) * 20,
    selectedAppraisalCandidateScore: (input.selectedAppraisalCandidateScore ?? 0) * 15,
    extractedDataCompleteness: Math.min(input.extractedDataCompletenessCount, EXTRACTED_DATA_COMPLETENESS_CAP) * 0.5,
    resolvedManualReview: Math.min(input.resolvedManualReviewTaskCount, RESOLVED_MANUAL_REVIEW_CAP) * 1,
  };
  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score, breakdown };
}

export function chooseCanonicalCase(candidates: CanonicalCandidateInput[]): CanonicalSelectionResult {
  if (candidates.length === 0) {
    throw new Error("chooseCanonicalCase requires at least one candidate");
  }

  const scored: ScoredCanonicalCandidate[] = candidates.map((c) => {
    const { score, breakdown } = scoreCanonicalCandidate(c);
    return { caseId: c.caseId, createdAt: c.createdAt, score, scoreBreakdown: breakdown };
  });

  const maxScore = Math.max(...scored.map((s) => s.score));
  const topScored = scored.filter((s) => Math.abs(s.score - maxScore) < SCORE_TIE_EPSILON);
  // topScored is never empty: it's filtered from `scored`, which has the same
  // length as the caller-validated non-empty `candidates`, and maxScore is
  // itself one of the values being filtered against.
  const tieBreakUsed = topScored.length > 1;
  const winner = tieBreakUsed
    ? topScored.reduce((oldest, cur) => (new Date(cur.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? cur : oldest))
    : topScored[0]!;

  const reasoning = tieBreakUsed
    ? `${topScored.length} of ${scored.length} candidates tied at the top score (${maxScore.toFixed(2)}); chose case ${winner.caseId} as the earliest-created (createdAt tie-break only -- scores were equal on data completeness and resolution quality).`
    : `Case ${winner.caseId} scored highest (${winner.score.toFixed(2)} of ${scored.length} candidates) on data completeness and resolution quality; no tie-break needed.`;

  return { canonicalCaseId: winner.caseId, scoredCandidates: scored, reasoning, tieBreakUsed };
}
