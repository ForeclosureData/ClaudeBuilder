/**
 * Shared by the deterministic parser (texasTemplates.ts's splitNames, which
 * splits a raw name list on commas) and the AI fallback's field validation
 * -- both can produce a dangling suffix-only entry from a real name like
 * "Ricardo Ruiz, Jr.": splitting on the comma reads "Jr." as if it were a
 * second person. Confirmed on a real notice (HID-117707, extraction repair
 * verification, 2026-08-09) where the deterministic layer produced
 * ["Ricardo Ruiz", "Jr."] with high enough confidence that the pipeline's
 * merge never let the AI's (separately-corrected) value override it --
 * fixing only the AI side left this case wrong. Reattaches the suffix to
 * the name immediately before it rather than keeping it as a phantom
 * co-borrower.
 */
const NAME_SUFFIX_ONLY = /^(Jr\.?|Sr\.?|I{1,3}|IV|V)$/i;

export function mergeDanglingNameSuffixes(names: string[]): string[] {
  const merged: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (NAME_SUFFIX_ONLY.test(trimmed) && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}, ${trimmed}`;
    } else {
      merged.push(name);
    }
  }
  return merged;
}
