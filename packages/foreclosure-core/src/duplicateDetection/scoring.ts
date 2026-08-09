/**
 * Detects when two DISTINCT ForeclosureCase records (different
 * countyId+countyFilingNumber, each its own legally meaningful county
 * filing) may describe the SAME underlying real-world foreclosure event.
 *
 * Built from a real confirmed case in the second fresh-25 Hidalgo batch
 * (2026-08-09): HID-117729 and HID-117731 share an identical trustee
 * tracking number ("T.S. #: 2025-20182-TX"), an OCR-noise-only-different
 * raw notice text, and every extractable field (borrower names, property
 * address, legal description, original principal, deed of trust date,
 * sale date, lender) -- overwhelming evidence of the same physical
 * document filed twice under two different county clerk document numbers.
 *
 * Deliberately conservative per the product requirement: a single matching
 * field (address, or lender, or borrower name alone) is NEVER sufficient.
 * This must require MULTIPLE independent fields to agree before flagging
 * anything above POSSIBLE_DUPLICATE, specifically so it does NOT collapse:
 *  - a first lien and a second lien on the same property (same address,
 *    but different lender/principal/deed-of-trust date)
 *  - an HOA lien foreclosure and a mortgage foreclosure on the same
 *    property (same address and often the same borrower, but a different
 *    lender, principal, and instrument)
 *  - two genuinely separate notices that just happen to share a common
 *    borrower or a common lender across different properties
 * A conflicting property address or legal description is treated as
 * decisive proof of a DISTINCT event and blocks any classification,
 * regardless of how many other fields match.
 */

export interface DuplicateComparisonCaseSnapshot {
  caseId: string;
  borrowerNames: string[];
  propertyAddress: string | null;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  originalPrincipalAmountCents: number | null;
  saleDate: string | null;
  deedOfTrustDate: string | null;
  lenderName: string | null;
  /** Full stored notice text (SourceDocument.rawText) -- used only for the trustee tracking number and raw-text-fingerprint signals, never for the field comparisons above. */
  rawText: string | null;
}

export type DuplicateConfidence = "CONFIRMED_SAME_EVENT" | "LIKELY_SAME_EVENT" | "POSSIBLE_DUPLICATE" | null;

export interface DuplicateEvidenceResult {
  score: number;
  matchedFields: string[];
  conflictingFields: string[];
  confidence: DuplicateConfidence;
  explanation: string;
}

/** A conflict on either of these is decisive evidence of a DISTINCT physical property/event -- never outweighed by other matching fields. */
const CRITICAL_CONFLICT_FIELDS = new Set(["propertyAddress", "legalDescription"]);

/** Fields that identify the LOAN itself, not just the property -- see the hasLoanIdentityEvidence gate below. */
const LOAN_IDENTITY_FIELDS = new Set(["originalPrincipalAmount", "deedOfTrustDate", "lenderName"]);

const WEIGHTS = {
  trusteeSaleTrackingNumber: 0.5,
  rawTextFingerprint: 0.45,
  propertyAddress: 0.25,
  legalDescription: 0.2,
  borrowerNames: 0.15,
  originalPrincipalAmount: 0.15,
  deedOfTrustDate: 0.1,
  saleDate: 0.08,
  lenderName: 0.08,
} as const;

const CONFLICT_WEIGHTS = {
  propertyAddress: -0.6,
  legalDescription: -0.6,
  saleDate: -0.1,
  originalPrincipalAmount: -0.15,
  lenderName: -0.1,
  borrowerNames: -0.2,
} as const;

/** Near-identical raw text (OCR noise aside) is treated as decisive -- see the module doc for why. */
const RAW_TEXT_FINGERPRINT_THRESHOLD = 0.9;
/** "Multiple independent fields" per the product requirement -- not counting the two decisive single-signal fields (tracking number, raw-text fingerprint), which already imply most of the others. */
const LIKELY_MIN_INDEPENDENT_FIELDS = 4;
const POSSIBLE_MIN_INDEPENDENT_FIELDS = 2;

export function scoreDuplicateEvidence(
  a: DuplicateComparisonCaseSnapshot,
  b: DuplicateComparisonCaseSnapshot,
): DuplicateEvidenceResult {
  const matchedFields: string[] = [];
  const conflictingFields: string[] = [];
  let score = 0;

  const trackingA = extractTrusteeSaleTrackingNumber(a.rawText);
  const trackingB = extractTrusteeSaleTrackingNumber(b.rawText);
  const trackingNumberMatch = trackingA !== null && trackingA === trackingB;
  if (trackingNumberMatch) {
    matchedFields.push("trusteeSaleTrackingNumber");
    score += WEIGHTS.trusteeSaleTrackingNumber;
  }

  let fingerprintDice = 0;
  if (a.rawText && b.rawText) {
    fingerprintDice = rawTextFingerprintSimilarity(a.rawText, b.rawText);
    if (fingerprintDice >= RAW_TEXT_FINGERPRINT_THRESHOLD) {
      matchedFields.push("rawTextFingerprint");
      score += WEIGHTS.rawTextFingerprint;
    }
  }

  compareField(matchedFields, conflictingFields, "propertyAddress", normalizedTextsMatch(a.propertyAddress, b.propertyAddress), scoreConflictable(a.propertyAddress, b.propertyAddress));
  const legalMatch = legalDescriptionsMatch(a, b);
  const legalConflict = legalDescriptionsConflict(a, b);
  compareField(matchedFields, conflictingFields, "legalDescription", legalMatch, legalConflict);
  const nameOverlap = borrowerNamesOverlap(a.borrowerNames, b.borrowerNames);
  compareField(matchedFields, conflictingFields, "borrowerNames", nameOverlap === "match", nameOverlap === "conflict");
  const principalMatch = a.originalPrincipalAmountCents !== null && a.originalPrincipalAmountCents === b.originalPrincipalAmountCents;
  const principalConflict = a.originalPrincipalAmountCents !== null && b.originalPrincipalAmountCents !== null && a.originalPrincipalAmountCents !== b.originalPrincipalAmountCents;
  compareField(matchedFields, conflictingFields, "originalPrincipalAmount", principalMatch, principalConflict);
  const deedMatch = a.deedOfTrustDate !== null && a.deedOfTrustDate === b.deedOfTrustDate;
  compareField(matchedFields, conflictingFields, "deedOfTrustDate", deedMatch, false);
  const saleDateMatch = a.saleDate !== null && a.saleDate === b.saleDate;
  const saleDateConflict = a.saleDate !== null && b.saleDate !== null && a.saleDate !== b.saleDate;
  compareField(matchedFields, conflictingFields, "saleDate", saleDateMatch, saleDateConflict);
  compareField(matchedFields, conflictingFields, "lenderName", normalizedTextsMatch(a.lenderName, b.lenderName), scoreConflictable(a.lenderName, b.lenderName));

  for (const field of matchedFields) {
    if (field === "trusteeSaleTrackingNumber" || field === "rawTextFingerprint") continue;
    score += WEIGHTS[field as keyof typeof WEIGHTS] ?? 0;
  }
  for (const field of conflictingFields) {
    score += CONFLICT_WEIGHTS[field as keyof typeof CONFLICT_WEIGHTS] ?? 0;
  }
  score = Math.max(0, Math.min(1, score));

  const hasCriticalConflict = conflictingFields.some((f) => CRITICAL_CONFLICT_FIELDS.has(f));
  const independentFieldCount = matchedFields.filter((f) => f !== "trusteeSaleTrackingNumber" && f !== "rawTextFingerprint").length;
  // propertyAddress/legalDescription/borrowerNames/saleDate alone only ever
  // prove "same property, roughly the same time" -- exactly the shape of
  // evidence a first lien and a second lien (or an HOA lien and a mortgage
  // foreclosure) on the SAME property would ALSO share, despite being
  // genuinely distinct loans. At least one field that actually identifies
  // the LOAN itself (not just the property) must also match before
  // reaching LIKELY_SAME_EVENT -- confirmed necessary by a same-property-
  // different-lien regression case (see duplicateDetection.test.ts).
  const hasLoanIdentityEvidence = matchedFields.some((f) => LOAN_IDENTITY_FIELDS.has(f));

  let confidence: DuplicateConfidence = null;
  if (!hasCriticalConflict) {
    if (trackingNumberMatch || fingerprintDice >= RAW_TEXT_FINGERPRINT_THRESHOLD) {
      confidence = "CONFIRMED_SAME_EVENT";
    } else if (independentFieldCount >= LIKELY_MIN_INDEPENDENT_FIELDS && hasLoanIdentityEvidence) {
      confidence = "LIKELY_SAME_EVENT";
    } else if (independentFieldCount >= POSSIBLE_MIN_INDEPENDENT_FIELDS) {
      confidence = "POSSIBLE_DUPLICATE";
    }
  }

  return {
    score,
    matchedFields,
    conflictingFields,
    confidence,
    explanation: buildExplanation(confidence, matchedFields, conflictingFields, trackingNumberMatch, fingerprintDice),
  };
}

function compareField(matched: string[], conflicting: string[], field: string, isMatch: boolean, isConflict: boolean): void {
  if (isMatch) matched.push(field);
  else if (isConflict) conflicting.push(field);
}

/** True only when both values are present, normalized-equal, and neither is empty -- absence of a value is never treated as a match. */
function normalizedTextsMatch(x: string | null, y: string | null): boolean {
  if (!x || !y) return false;
  const nx = normalizeForComparison(x);
  const ny = normalizeForComparison(y);
  return nx.length > 0 && (nx === ny || nx.includes(ny) || ny.includes(nx));
}

/** A conflict requires both values present, normalized, and clearly NOT overlapping -- absence is never a conflict. */
function scoreConflictable(x: string | null, y: string | null): boolean {
  if (!x || !y) return false;
  const nx = normalizeForComparison(x);
  const ny = normalizeForComparison(y);
  return nx.length > 0 && ny.length > 0 && nx !== ny && !nx.includes(ny) && !ny.includes(nx);
}

function normalizeForComparison(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function legalDescriptionsMatch(a: DuplicateComparisonCaseSnapshot, b: DuplicateComparisonCaseSnapshot): boolean {
  if (!a.subdivision || !b.subdivision) return false;
  const subdivisionMatch = normalizedTextsMatch(a.subdivision, b.subdivision);
  if (!subdivisionMatch) return false;
  if (a.lot && b.lot) return normalizeForComparison(a.lot) === normalizeForComparison(b.lot);
  return true;
}

function legalDescriptionsConflict(a: DuplicateComparisonCaseSnapshot, b: DuplicateComparisonCaseSnapshot): boolean {
  if (a.subdivision && b.subdivision && scoreConflictable(a.subdivision, b.subdivision)) return true;
  if (a.subdivision && b.subdivision && normalizedTextsMatch(a.subdivision, b.subdivision) && a.lot && b.lot) {
    return normalizeForComparison(a.lot) !== normalizeForComparison(b.lot);
  }
  return false;
}

function borrowerNamesOverlap(a: string[], b: string[]): "match" | "conflict" | "none" {
  if (a.length === 0 || b.length === 0) return "none";
  const normA = a.map(normalizeForComparison).filter(Boolean);
  const normB = b.map(normalizeForComparison).filter(Boolean);
  const anyOverlap = normA.some((na) => normB.some((nb) => na === nb || na.includes(nb) || nb.includes(na)));
  if (anyOverlap) return "match";
  return "conflict";
}

/**
 * Real trustee/servicer notices commonly carry their own internal file
 * tracking number ("T.S. #: 2025-20182-TX") near the top of the document,
 * independent of the county clerk's own filing number -- when two
 * separately-filed notices share this number, they are the same physical
 * source document. Tolerant of the OCR noise confirmed on the real
 * HID-117729/117731 pair ("TS. £2025-20182-TX" vs "1.5. #:2025-20182-TX")
 * by matching only the stable digit-dash-letters shape, not the
 * surrounding label text.
 */
function extractTrusteeSaleTrackingNumber(rawText: string | null): string | null {
  if (!rawText) return null;
  const match = rawText.slice(0, 300).match(/\b(\d{4}-\d{4,6}-[A-Z]{1,4})\b/);
  return match ? match[1]! : null;
}

/** Word-bigram Dice coefficient over normalized text -- a lightweight, OCR-noise-tolerant near-duplicate signal that doesn't require full edit-distance computation. Strips each document's own case-specific "Doc-XXXXXX" header first, since that alone would otherwise guarantee zero bigram overlap between any two documents. */
export function rawTextFingerprintSimilarity(a: string, b: string): number {
  const tokensA = normalizeForFingerprint(a);
  const tokensB = normalizeForFingerprint(b);
  const bigramsA = bigramSet(tokensA);
  const bigramsB = bigramSet(tokensB);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function normalizeForFingerprint(text: string): string[] {
  return text
    .replace(/^Doc-\d+\s*/i, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function bigramSet(tokens: string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) set.add(`${tokens[i]}_${tokens[i + 1]}`);
  return set;
}

function buildExplanation(
  confidence: DuplicateConfidence,
  matchedFields: string[],
  conflictingFields: string[],
  trackingNumberMatch: boolean,
  fingerprintDice: number,
): string {
  if (confidence === null) {
    if (conflictingFields.length > 0) return `Not flagged: conflicting evidence on ${conflictingFields.join(", ")}.`;
    return `Not flagged: insufficient matching evidence (${matchedFields.length} field(s) matched).`;
  }
  const decisive: string[] = [];
  if (trackingNumberMatch) decisive.push("identical trustee/servicer tracking number");
  if (fingerprintDice >= RAW_TEXT_FINGERPRINT_THRESHOLD) decisive.push(`${Math.round(fingerprintDice * 100)}% near-identical raw notice text`);
  const decisivePart = decisive.length > 0 ? `Decisive signal(s): ${decisive.join(", ")}. ` : "";
  const conflictPart = conflictingFields.length > 0 ? ` Conflicting: ${conflictingFields.join(", ")}.` : "";
  return `${decisivePart}Matched fields: ${matchedFields.join(", ")}.${conflictPart}`;
}
