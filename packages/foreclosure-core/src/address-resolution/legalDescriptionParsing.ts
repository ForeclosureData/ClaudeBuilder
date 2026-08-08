/**
 * Extracts normalized tokens from a raw legal-description string (as
 * transcribed from a foreclosure notice) for matching against appraisal
 * district records. Always preserves the original text — normalized
 * tokens are additive, never a replacement for the source language.
 */
export interface ParsedLegalDescriptionTokens {
  rawText: string;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  section: string | null;
  phase: string | null;
  unit: string | null;
  tract: string | null;
  survey: string | null;
  abstractNumber: string | null;
  acreage: number | null;
  propertyIdNumber: string | null;
  geographicId: string | null;
}

const LOT_RE = /\bLOTS?\s+([A-Z0-9()&.,\-/'" ]+?)(?=,?\s*(?:BLOCK|BLK|OF\b|,|$))/i;
const BLOCK_RE = /\b(?:BLOCK|BLK)\.?\s+([0-9A-Z\-]+)/i;
const SECTION_RE = /\bSECTION\s+([0-9A-Z\-]+)/i;
const PHASE_RE = /\bPHASE\s+([0-9A-Z\-]+)/i;
const UNIT_RE = /\bUNIT\s+(?:NO\.?\s*)?([0-9A-Z\-]+)/i;
const TRACT_RE = /\bTRACT\s+([0-9A-Z\-]+)/i;
const SURVEY_RE = /\b(?:SURVEY|SVY)\s+([0-9A-Z\-]+)/i;
const ABSTRACT_RE = /\bABSTRACT\s+(?:NO\.?\s*)?([0-9A-Z\-]+)/i;
const ACREAGE_RE = /([0-9]+(?:\.[0-9]+)?)\s*ACRES?/i;
const PROPERTY_ID_RE = /\b(?:PROPERTY\s+ID|PARCEL\s+(?:ID|NO)\.?|APN)\s*[:#]?\s*([0-9A-Z\-]+)/i;
const GEOGRAPHIC_ID_RE = /\b(?:GEOGRAPHIC\s+ID|GEO\s+ID)\s*[:#]?\s*([0-9A-Z\-]+)/i;
// A "SUBDIVISION" (or plat-named addition) is everything up to the
// county/state boilerplate or the first comma-separated clause naming
// "AN ADDITION TO..." — captured loosely, kept as-is (not over-parsed).
// SUBDIV/SUBD (with or without a trailing period) are listed before the
// full "SUBDIVISION" spelling only for readability -- the trailing \b
// already prevents a false partial match against "SUBDIVISION" itself
// (no word boundary between the "D" and the "I" that follows).
const SUBDIVISION_RE =
  /(?:,\s*)?([A-Z0-9 .'\-&]+?(?:SUBDIVISION|SUBDIV\.?|SUBD\.?|ADDITION|ESTATES|TOWNSITE|PARK|PLACE|HEIGHTS|ACRES|MEADOWS|VILLAGE|VILLA[SE]?|COVES?))\b/i;
// Fallback for terse tax-roll style legal descriptions that never use any
// of the SUBDIVISION_RE classification words at all -- confirmed live,
// this is actually the common case for Hidalgo CAD's own legalDescription
// field (e.g. "SOL BRILLA PH 1 LOT 1", "INDIAN HARBOR LOT 39", "LAS PALMAS
// DEL VALLE UT 2 LOT 28 BLK 1"): everything before the first "LOT" is the
// subdivision name, with a trailing phase/unit/section+number qualifier
// (if any) stripped back off.
const BEFORE_LOT_RE = /^(.+?)\s+LOTS?\b/i;
const TRAILING_PHASE_UNIT_SECTION_RE = /\s+(?:PH|PHASE|UT|UNIT|SEC|SECTION)\.?\s*[0-9A-Z]+$/i;

export function parseLegalDescriptionTokens(rawText: string): ParsedLegalDescriptionTokens {
  const text = rawText.replace(/\s+/g, " ").trim();

  return {
    rawText,
    lot: matchGroup(text, LOT_RE)?.trim().replace(/\s+/g, " ") ?? null,
    block: matchGroup(text, BLOCK_RE),
    section: matchGroup(text, SECTION_RE),
    phase: matchGroup(text, PHASE_RE),
    unit: matchGroup(text, UNIT_RE),
    tract: matchGroup(text, TRACT_RE),
    survey: matchGroup(text, SURVEY_RE),
    abstractNumber: matchGroup(text, ABSTRACT_RE),
    acreage: (() => {
      const m = text.match(ACREAGE_RE);
      return m ? Number(m[1]) : null;
    })(),
    propertyIdNumber: matchGroup(text, PROPERTY_ID_RE),
    geographicId: matchGroup(text, GEOGRAPHIC_ID_RE),
    subdivision: matchGroup(text, SUBDIVISION_RE)?.trim() ?? subdivisionFromBeforeLot(text),
  };
}

function subdivisionFromBeforeLot(text: string): string | null {
  const beforeLot = text.match(BEFORE_LOT_RE)?.[1]?.trim();
  if (!beforeLot) return null;
  const withoutQualifier = beforeLot.replace(TRAILING_PHASE_UNIT_SECTION_RE, "").trim();
  return withoutQualifier || null;
}

function matchGroup(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m?.[1]?.trim() ?? null;
}

export function normalizeToken(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokensOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Builds a stable cache key for reusing a previously successful CAD match
 * against a later foreclosure case carrying the same legal description —
 * see ResolvedLegalDescriptionMatch. Prefers subdivision+lot+block (the
 * strongest, most stable identifier a notice typically states); falls
 * back to the normalized raw legal text when no subdivision was parsed.
 * Returns null when there's nothing stable enough to key on.
 */
export function buildLegalDescriptionCacheKey(input: {
  subdivision?: string | null;
  lot?: string | null;
  block?: string | null;
  rawText?: string | null;
}): string | null {
  const subdivision = normalizeToken(input.subdivision);
  if (subdivision) {
    const lot = normalizeToken(input.lot);
    const block = normalizeToken(input.block);
    return `SUBDIVISION:${subdivision}|LOT:${lot}|BLOCK:${block}`;
  }
  const rawText = normalizeToken(input.rawText);
  return rawText ? `RAWTEXT:${rawText}` : null;
}

// Meta-commentary about the transcription itself, not part of the legal
// description -- e.g. "(subdivision name obscured by handwriting on the
// source document)". Stripped entirely (parens and contents) rather than
// just de-parenthesized, since prose like this is never a useful search
// term and observed live to trigger an HTTP 400 from Hidalgo CAD's
// full-text endpoint (see HID-118198, docs/DEPLOYMENT.md's regeneration
// pilot report).
const META_COMMENTARY_PAREN_RE = /\([^()]*\b(?:obscured|illegible|unreadable|unclear|redacted|handwrit\w*|not\s+recoverable|not\s+legible|cannot\s+be\s+read)\b[^()]*\)/gi;

/**
 * Conservative, mechanical normalization of legal-description text for use
 * as CAD *search input only* -- never applied to the stored/displayed raw
 * text (that's preserved verbatim everywhere else). Purely removes/spaces
 * characters and phrases observed to break Hidalgo CAD's full-text search
 * endpoint; never rewrites legal meaning or guesses at intent. Returns
 * null when nothing search-worthy remains (avoids sending an empty or
 * near-empty query, which would return an over-broad, useless result set
 * rather than a real match).
 */
export function sanitizeCadSearchText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw;
  text = text.replace(META_COMMENTARY_PAREN_RE, " ");
  // Legitimate parenthetical qualifiers (e.g. "(N 5ac of N 9.59ac)",
  // "(East 5.0 acres)") carry real evidence -- de-parenthesize rather
  // than strip, keeping the inner words as loose search terms.
  text = text.replace(/[()]/g, " ");
  // Fraction/compound-lot slashes (e.g. "W1/2") -- space them out rather
  // than dropping the slash silently, so "W1/2" becomes "W1 2" instead of
  // an unspaced "W12" that would search as a different lot number.
  text = text.replace(/\//g, " ");
  // Punctuation not observed to appear in normal working legal
  // descriptions and not needed for a full-text match. Semicolons in
  // particular show up when a raw transcription strings multiple
  // sentences together (e.g. "...Texas; 4.99 acres, more or less;
  // Parcel ID ...") -- confirmed live (HID-118198) to still trigger an
  // HTTP 400 even after the meta-commentary/parens/slashes above are
  // handled.
  text = text.replace(/["'#;]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length < 3) return null;
  return text;
}
