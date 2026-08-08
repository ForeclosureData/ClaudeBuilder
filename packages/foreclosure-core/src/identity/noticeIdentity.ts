/**
 * Stable notice identity for deduplication. A real-world foreclosure
 * notice is identified by (county, county filing number) -- never by the
 * bytes of whatever file happened to be rendered from it. Two different
 * renders of the exact same notice (a retry, a re-posted bundle with
 * different image compression, etc.) must resolve to the SAME identity;
 * two different notices that happen to produce identical bytes never do
 * in practice, but even if they did, that would be a coincidence, not an
 * identity signal.
 */

/**
 * Normalizes a raw county filing number for identity comparison. Trims
 * whitespace, strips internal whitespace and common OCR-introduced
 * punctuation, and uppercases -- conservative on purpose: it does NOT
 * strip leading zeros or reinterpret digits, since a real filing number's
 * exact digits are never insignificant. Returns null for anything that
 * normalizes to empty, so a genuinely missing/unparseable filing number is
 * never silently coerced into an empty-string "identity".
 */
export function normalizeCountyFilingNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[\s.\-_]/g, "");
  return normalized.length > 0 ? normalized : null;
}

export interface NoticeIdentityKey {
  countyId: string;
  countyFilingNumber: string;
}

/**
 * Builds the composite lookup key used to check whether a notice has
 * already been ingested -- pure and DB-agnostic so it's directly testable
 * without a live database. Deliberately derived ONLY from (county, filing
 * number), never from the notice's rendered bytes: two different renders
 * of the exact same real notice must produce the identical key, and this
 * function has no way to even see byte-level content, which is the point.
 *
 * Returns null when the filing number is missing or doesn't normalize to
 * anything -- callers must treat that as "identity unverifiable" (route to
 * manual review) rather than proceeding as if the notice were guaranteed
 * new.
 */
export function buildNoticeIdentityKey(countyId: string, rawFilingNumber: string | null | undefined): NoticeIdentityKey | null {
  const countyFilingNumber = normalizeCountyFilingNumber(rawFilingNumber);
  if (!countyFilingNumber) return null;
  return { countyId, countyFilingNumber };
}
