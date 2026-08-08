/**
 * Detects an explicit street address stated in the notice — either after a
 * "Property Address:" label or a "commonly known as" phrase. Never returns
 * a mailing address; callers must pass only the notice body, not a section
 * already known to be the borrower's/trustee's mailing address.
 */
// `(?<![\d-])` stops the house-number group from starting mid-way through a
// longer digit/hyphen run -- a tracking-barcode or internal record-ID
// number sitting next to real address text in a badly-OCR'd document
// ("...25.000352.951-1 11 705 RAMSEY ST..."), or this project's own
// "Doc-117660" filename header immediately followed by the real address on
// the next line. Without it, a long digit run simply fails to match as a
// whole (spacing after 6 digits never lines up), so the engine happily
// retries starting from some digit/hyphen-adjacent position further into
// the same run instead of moving past it entirely.
const STREET_ADDRESS_PATTERN =
  /(?<![\d-])\d{1,6}\s+[A-Za-z0-9.'\- ]{2,60},?\s+[A-Za-z .'\-]{2,40},?\s+(?:Texas|TX)\s+\d{5}/;

/**
 * The Hidalgo County Administrative Building's address -- the standard
 * auction/"Place of Sale" location, boilerplate in nearly every real
 * Hidalgo notice, and NEVER the foreclosed property's address. Kept as an
 * explicit, always-checked denylist entry (in addition to the general
 * preceding-context check below, which alone might not catch every
 * phrasing) because this exact address was confirmed live to have been
 * published as the property's street address on 5 of 24 real records in
 * the 25-notice production run. Tolerant of the OCR noise actually seen
 * ("S."/"5."/"§." before "Business", missing periods, city/TX spacing).
 */
const KNOWN_NON_PROPERTY_ADDRESSES = [/2802\s+[S5§]\.?\s*Business\s+Hwy\s+281/i];

/**
 * General case: the bare (unlabeled) STREET_ADDRESS_PATTERN fallback has no
 * way to tell a property address from any *other* address-shaped string in
 * the document -- a trustee's, attorney's, servicer's, or mortgagee's
 * mailing address, all of which are common and real (confirmed live: a
 * substitute trustee's own mailing address, "...AVT Title Services, LLC,
 * located at 5177 Richmond Avenue Suite 1230, Houston, TX 77056...", was
 * caught by this exact failure mode once the sale-location boilerplate
 * above was excluded). Rather than denylisting every possible boilerplate
 * address individually, a match is rejected when the ~70 characters
 * immediately before it contain a phrase that marks it as somebody's
 * mailing/service address rather than a property reference.
 */
// The trailing `[\s:$]*$` (not just `\s*`) deliberately tolerates a stray
// OCR-mangled character sitting between the marker phrase and the address
// -- confirmed live: "AVT Title Services, LLC. located at $177 Richmond
// Avenue..." (OCR read "5177" as "$177"), which a whitespace-only gap
// would have missed entirely.
const NON_PROPERTY_CONTEXT_RE =
  /located\s+at|whose\s+address|c\/o|attorney\s+at\s+law|law\s+firm|\blender\b|sender\s+is|substitute\s+trustee|trustee'?s?\s+address|servicer'?s?\s+address|mortgagee'?s?\s+address|mailing\s+address|return\s+address|business\s+address|place\s+of\s+sale|location\s+of\s+sale|office\s+center|\bsuite\b/i;

function isKnownNonPropertyAddress(candidate: string): boolean {
  return KNOWN_NON_PROPERTY_ADDRESSES.some((pattern) => pattern.test(candidate));
}

/**
 * Every real Hidalgo County foreclosure notice concerns a property inside
 * Hidalgo County -- so a candidate address confidently in one of these
 * OTHER major Texas cities/metros is essentially never the collateral
 * property. Deliberately a list of well-known cities that are unambiguously
 * elsewhere (not a denylist targeted at any single address that happened to
 * appear in this session's sample) rather than an exhaustive Hidalgo-county
 * allowlist -- an unrecognized or ambiguous city name is left alone here
 * (see hasNonPropertyContext for that case), so this only fires on a
 * confident match, never a guess.
 */
const KNOWN_NON_HIDALGO_CITIES_RE =
  /\b(?:Coppell|Dallas|Fort\s+Worth|Houston|Austin|San\s+Antonio|El\s+Paso|Plano|Irving|Frisco|Arlington|Corpus\s+Christi|Lubbock|Laredo|Waco|Amarillo|Denton|Garland|Grand\s+Prairie|Sugar\s+Land|The\s+Woodlands|Katy|Spring)\b\s*,?\s*(?:Texas|TX)\b/i;

/**
 * A candidate address matching a well-known non-Hidalgo city, with a
 * ZIP that also confirms it (major Texas metros never share Hidalgo
 * County's 785xx ZIP block) -- both checked together so an OCR misread of
 * an actually-local city name never trips this on its own.
 */
function isConfidentlyOutsideHidalgoCounty(candidate: string): boolean {
  if (!KNOWN_NON_HIDALGO_CITIES_RE.test(candidate)) return false;
  const zip = candidate.match(/\b(\d{5})\b/)?.[1];
  return !zip || !zip.startsWith("785");
}

/**
 * Checked over a wide preceding window (not anchored right up against the
 * match) since real notices routinely put company-name/role text between
 * the marker phrase and the actual address digits ("...appoint AVT Title
 * Services, LLC, located at 5177 Richmond Avenue...", or worse, with OCR
 * noise stretching that gap even further). A false negative here (missing
 * a genuinely non-property address) is far cheaper than a false positive
 * (a real property address getting excluded) would be safe either way --
 * excluding too aggressively only pushes a case to legal-description-based
 * CAD resolution or manual review, never publishes a wrong address.
 */
function hasNonPropertyContext(noticeText: string, matchIndex: number): boolean {
  const precedingWindow = noticeText.slice(Math.max(0, matchIndex - 150), matchIndex);
  return NON_PROPERTY_CONTEXT_RE.test(precedingWindow);
}

// A Certificate of Posting footer/tracking code sitting on the SAME LINE as
// a real address ("25.000352.951-1 11 705 RAMSEY ST...") defeats the
// digit-run lookbehind above because a plain space separates the barcode
// from a short stray number that then reads as a plausible house number
// ("11") -- confirmed live, the real street number ("705") sits just past
// it. Deliberately scoped to the CURRENT LINE only (text since the last
// newline) -- a case/filing number on its OWN line immediately followed by
// the real address on the NEXT line is a completely normal, common notice
// header (confirmed live: "26-01543\n1715 Texas Ave...") and must never be
// rejected by this: there, the match starts right after a newline with
// nothing else on its own line before it, so the current-line prefix is
// empty and this simply doesn't match.
const PRECEDING_BARCODE_NOISE_RE = /\d[\d.\-]{5,}\d[ \t]+$/;

function hasPrecedingBarcodeNoise(noticeText: string, matchIndex: number): boolean {
  const lastNewline = noticeText.lastIndexOf("\n", matchIndex - 1);
  const currentLinePrefix = noticeText.slice(lastNewline + 1, matchIndex);
  return PRECEDING_BARCODE_NOISE_RE.test(currentLinePrefix);
}

export interface DetectedAddress {
  text: string;
  method: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE";
}

export function detectStatedPropertyAddress(noticeText: string): DetectedAddress | null {
  // A "Property Address:" label or "commonly known as" phrase is normally
  // strong enough evidence on its own -- but a confidently-elsewhere city
  // still overrides it, since every real Hidalgo notice's property is
  // inside Hidalgo County; a label pointing outside it is a red flag (a
  // mislabeled mailing address, or the label having attached to the wrong
  // line), not "the notice clearly identifies it as the foreclosed
  // property" in the sense that matters here.
  const labeled = noticeText.match(/Property Address:\s*([^\n]+)/i);
  if (labeled) {
    const candidate = labeled[1]!.match(STREET_ADDRESS_PATTERN)?.[0] ?? labeled[1]!.trim();
    if (candidate && !isKnownNonPropertyAddress(candidate) && !isConfidentlyOutsideHidalgoCounty(candidate)) {
      return { text: cleanAddress(candidate), method: "EXPLICIT_STATED" };
    }
  }

  const commonlyKnownAs = noticeText.match(/commonly known as\s+([^\n(]+)/i);
  if (commonlyKnownAs) {
    const candidate = commonlyKnownAs[1]!.match(STREET_ADDRESS_PATTERN)?.[0] ?? commonlyKnownAs[1]!.trim();
    if (candidate && !isKnownNonPropertyAddress(candidate) && !isConfidentlyOutsideHidalgoCounty(candidate)) {
      return { text: cleanAddress(candidate), method: "COMMONLY_KNOWN_AS_PHRASE" };
    }
  }

  // Try every bare address-shaped match in document order, not just the
  // first -- the first one is frequently sale-location or trustee/attorney
  // boilerplate, which appears earlier in these templates than any real
  // property address (when one is stated in a matchable form at all).
  for (const match of noticeText.matchAll(new RegExp(STREET_ADDRESS_PATTERN, "g"))) {
    if (isKnownNonPropertyAddress(match[0])) continue;
    if (isConfidentlyOutsideHidalgoCounty(match[0])) continue;
    if (match.index !== undefined && hasNonPropertyContext(noticeText, match.index)) continue;
    if (match.index !== undefined && hasPrecedingBarcodeNoise(noticeText, match.index)) continue;
    return { text: cleanAddress(match[0]), method: "EXPLICIT_STATED" };
  }

  return null;
}

// A house number immediately followed by a directional prefix with no
// space ("508E HAWK ST") is a common OCR/transcription artifact -- real
// example confirmed live. Only applied at the very start of the address
// (the house-number position, anchored with `^`) and only when the
// captured letters are immediately followed by more street text, so a
// number that's simply part of a longer word ("508EXPRESS BLVD") is never
// split. Purely inserts a missing space -- never removes or reorders any
// character, so the address's actual content (and the original raw match
// text callers already have before this function runs) is unchanged.
const MISSING_DIRECTIONAL_SPACE_RE = /^(\d+)(NE|NW|SE|SW|N|S|E|W)(\s+[A-Za-z])/i;

function cleanAddress(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim()
    .replace(MISSING_DIRECTIONAL_SPACE_RE, "$1 $2$3");
}

/** Extracts a labeled mailing address (trustee/owner) — kept separate so callers never confuse it with a property address. */
export function extractLabeledMailingAddress(noticeText: string, labelPattern: RegExp): string | null {
  const match = noticeText.match(labelPattern);
  if (!match) return null;
  return cleanAddress(match[1] ?? "");
}
