/** Parses a dollar amount like "$185,000.00" into cents. Returns null if no plausible amount is found. */
export function parseCurrencyToCents(text: string): number | null {
  const match = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const numeric = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
}

/** Finds every dollar amount in a block of text, in reading order, as cents. */
export function findAllCurrencyAmountsCents(text: string): number[] {
  const matches = text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g);
  const amounts: number[] = [];
  for (const m of matches) {
    const numeric = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) amounts.push(Math.round(numeric * 100));
  }
  return amounts;
}
