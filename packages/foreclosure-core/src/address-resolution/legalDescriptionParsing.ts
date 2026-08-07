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
const SUBDIVISION_RE = /(?:,\s*)?([A-Z0-9 .'\-&]+?(?:SUBDIVISION|ADDITION|ESTATES|TOWNSITE|PARK|PLACE|HEIGHTS|ACRES|MEADOWS|VILLAGE|VILLA[SE]?|COVES?))\b/i;

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
    subdivision: matchGroup(text, SUBDIVISION_RE)?.trim() ?? null,
  };
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
