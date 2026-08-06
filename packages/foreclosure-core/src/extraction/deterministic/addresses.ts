/**
 * Detects an explicit street address stated in the notice — either after a
 * "Property Address:" label or a "commonly known as" phrase. Never returns
 * a mailing address; callers must pass only the notice body, not a section
 * already known to be the borrower's/trustee's mailing address.
 */
const STREET_ADDRESS_PATTERN =
  /\d{1,6}\s+[A-Za-z0-9.'\- ]{2,60},?\s+[A-Za-z .'\-]{2,40},?\s+(?:Texas|TX)\s+\d{5}/;

export interface DetectedAddress {
  text: string;
  method: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE";
}

export function detectStatedPropertyAddress(noticeText: string): DetectedAddress | null {
  const labeled = noticeText.match(/Property Address:\s*([^\n]+)/i);
  if (labeled) {
    const candidate = labeled[1]!.match(STREET_ADDRESS_PATTERN)?.[0] ?? labeled[1]!.trim();
    if (candidate) return { text: cleanAddress(candidate), method: "EXPLICIT_STATED" };
  }

  const commonlyKnownAs = noticeText.match(/commonly known as\s+([^\n(]+)/i);
  if (commonlyKnownAs) {
    const candidate = commonlyKnownAs[1]!.match(STREET_ADDRESS_PATTERN)?.[0] ?? commonlyKnownAs[1]!.trim();
    if (candidate) return { text: cleanAddress(candidate), method: "COMMONLY_KNOWN_AS_PHRASE" };
  }

  const bareMatch = noticeText.match(STREET_ADDRESS_PATTERN);
  if (bareMatch) return { text: cleanAddress(bareMatch[0]), method: "EXPLICIT_STATED" };

  return null;
}

function cleanAddress(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
}

/** Extracts a labeled mailing address (trustee/owner) — kept separate so callers never confuse it with a property address. */
export function extractLabeledMailingAddress(noticeText: string, labelPattern: RegExp): string | null {
  const match = noticeText.match(labelPattern);
  if (!match) return null;
  return cleanAddress(match[1] ?? "");
}
