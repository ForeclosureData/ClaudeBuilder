/**
 * Generic, content-based defense against trustee/servicer/law-office
 * boilerplate addresses slipping through detectStatedPropertyAddress() as
 * if they were the foreclosed property's own address. Two real,
 * unaffiliated properties never share an exact street address -- so if a
 * freshly-detected "property address" candidate is byte-identical to one
 * already attributed to a DIFFERENT case, that's strong, self-contained
 * evidence it's actually a repeated office address, not a coincidence.
 *
 * Deliberately not a hardcoded list of specific known offices (e.g. "3111
 * W. Freddy Gonzalez Drive") -- a fixed list only ever covers addresses
 * already seen once and manually added, and the goal here is a check that
 * generalizes to any trustee's office, in any notice template, without
 * maintenance. Individual known addresses may still be useful as
 * *secondary* evidence elsewhere (a confidence bump when a hardcoded match
 * coincides with this check), but this function itself never hardcodes one.
 */

/** Normalizes an address for exact-match reuse comparison -- case/whitespace/punctuation only, never reinterprets the content. */
export function normalizeAddressForReuseCheck(address: string): string {
  return address
    .toUpperCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `candidateAddress` exactly matches an address already recorded
 * for a different case (`otherCaseAddresses`) -- the caller is responsible
 * for scoping `otherCaseAddresses` to "other cases in the same county"
 * (never a global cross-county comparison, since two different counties
 * could coincidentally share a common street name/number).
 */
export function isRepeatedAcrossCases(candidateAddress: string, otherCaseAddresses: Iterable<string>): boolean {
  const normalizedCandidate = normalizeAddressForReuseCheck(candidateAddress);
  if (!normalizedCandidate) return false;
  for (const other of otherCaseAddresses) {
    if (normalizeAddressForReuseCheck(other) === normalizedCandidate) return true;
  }
  return false;
}
