/**
 * Shared by every deterministic borrower/grantor label pattern in
 * texasTemplates.ts that captures a name from the REST OF THE SAME LINE
 * only (`[^\n]+`-shaped capture groups). Real Hidalgo notices sometimes
 * PDF-wrap the name value at exactly a middle initial ("Original
 * Mortgagor/Grantor: CHRISTOPHER D.\nMUNIZ AND MAYRA C. MARTINEZ"), and a
 * same-line-only capture reports the complete name as "CHRISTOPHER D." --
 * silently dropping the surname and a second co-borrower that continues on
 * the next line (real HID-117914 defect: confirmed stored as borrower
 * "CHRISTOPHER D" with no surname at all).
 *
 * Deliberately narrow rather than "always merge the next line": a captured
 * name legitimately ending in a multi-letter suffix ("...RUIZ, JR.") or
 * simply ending mid-sentence with no trailing initial at all must NOT pull
 * in unrelated next-line content (a new field's label, an address, a
 * heading). Only merges when there's real evidence the line break falls
 * mid-name:
 *  1. The captured text must end with a BARE, standalone middle initial --
 *     one capital letter immediately followed by a period, itself preceded
 *     by whitespace/start of string (so "D." qualifies; "JR." or "INC."
 *     don't, since those are two-letter tokens, not a single initial).
 *  2. The next line must not itself look like a new label/field -- no
 *     colon in its first ~40 characters (a real "Label:" line always puts
 *     the colon near the start, e.g. "Original Beneficiary:").
 *  3. The next line must not look like an address (doesn't start with a
 *     house number).
 *  4. The next line must start with a capitalized word -- a plausible name
 *     continuation, not lowercase running prose.
 * Only the immediately-following line is ever considered (bounded to the
 * one real line-wrap case this was built from, not an open-ended scan).
 */
export function mergeLineWrappedNameContinuation(capturedText: string, textAfterCapture: string): string {
  const trimmed = capturedText.trim();
  if (!/(?:^|\s)[A-Z]\.$/.test(trimmed)) return trimmed;

  const nextLineMatch = textAfterCapture.match(/^[ \t]*\n[ \t]*([^\n]+)/);
  if (!nextLineMatch) return trimmed;
  const nextLine = nextLineMatch[1]!.trim();

  if (nextLine.slice(0, 40).includes(":")) return trimmed;
  if (/^\d/.test(nextLine)) return trimmed;
  if (!/^[A-Z]/.test(nextLine)) return trimmed;

  return `${trimmed} ${nextLine}`;
}
