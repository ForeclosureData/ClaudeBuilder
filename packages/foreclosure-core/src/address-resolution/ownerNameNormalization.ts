/**
 * Owner-name normalization for matching a foreclosure notice's grantor
 * name(s) against appraisal-district owner-name fields. Produces search
 * *variants* of the original text — it never merges or discards
 * information, since two similarly-spelled names are not evidence they're
 * the same person without supporting evidence from another field (legal
 * description, parcel ID, etc. — see scoring.ts).
 */

export interface NormalizedOwnerName {
  original: string;
  /** One or more plausible individual names extracted from the original (splits "A and B", "A & B", "A ET UX"). */
  people: string[];
  /** Search-ready variants per person (surname-first, first-last, no punctuation, etc.). */
  normalizedVariants: string[];
  /** True if the original text looks like a business entity rather than an individual. */
  isEntity: boolean;
}

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const ENTITY_MARKERS = /\b(LLC|L\.L\.C\.|LP|L\.P\.|LTD|CORP|CORPORATION|INC|INCORPORATED|CO\b|COMPANY|TRUST|ESTATE\s+OF|DBA|D\/B\/A)\b/i;
const JOINT_MARKERS = /\bET\s+UX\b|\bET\s+VIR\b|\bET\s+AL\b/i;

/**
 * Common OCR confusions worth normalizing for fuzzy comparison (not
 * applied to the preserved original text) — e.g. "0" vs "O", "1" vs "l"/"I"
 * inside names, which occasionally appear from scanned-document extraction.
 */
const OCR_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/0/g, "O"],
  [/1/g, "I"],
  [/5/g, "S"],
];

export function normalizeOwnerName(rawInput: string): NormalizedOwnerName {
  const original = rawInput.trim();
  const isEntity = ENTITY_MARKERS.test(original);

  if (isEntity) {
    return {
      original,
      people: [stripDiacritics(original)],
      normalizedVariants: [normalizeVariant(original)],
      isEntity: true,
    };
  }

  const people = splitIntoPeople(original);
  const normalizedVariants = people.flatMap((p) => variantsForPerson(p));

  return { original, people, normalizedVariants, isEntity: false };
}

/**
 * Splits a raw grantor string into individual person names. Handles:
 * "SMITH, JOHN A & MARY L" (shared surname, "&"-joined first names),
 * "John A. Smith and Mary L. Smith" ("and"-joined full names),
 * "JOHN SMITH ET UX" (Latin legal shorthand for "and wife" — the second
 * person's name isn't stated, so only the named person is returned; the
 * ET UX marker is preserved as a hint, not expanded into a guessed name).
 */
function splitIntoPeople(name: string): string[] {
  const withoutJointMarker = name.replace(JOINT_MARKERS, "").trim();

  // "SMITH, JOHN A & MARY L" — shared surname before the comma, multiple
  // first-name segments after it split on & / and.
  const lastFirstMatch = withoutJointMarker.match(/^([A-Za-zÀ-ÿ'\-]+),\s*(.+)$/);
  if (lastFirstMatch) {
    const surname = lastFirstMatch[1]!;
    const firstNamesPart = lastFirstMatch[2]!;
    const firstNameSegments = firstNamesPart.split(/\s*(?:&|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (firstNameSegments.length > 1) {
      return firstNameSegments.map((fn) => `${fn} ${surname}`.trim());
    }
    return [`${firstNamesPart} ${surname}`.trim()];
  }

  // "John A. Smith and Mary L. Smith" / "Rene Ramirez and wife Laura Ramirez"
  const joinedByAnd = withoutJointMarker.split(/\s*(?:,?\s*&\s*|\s+and\s+)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (joinedByAnd.length > 1) {
    return joinedByAnd.map((seg) => seg.replace(/^(wife|husband|spouse)\s+/i, "").trim()).filter(Boolean);
  }

  return [withoutJointMarker];
}

function variantsForPerson(personName: string): string[] {
  const cleaned = stripDiacritics(personName)
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const tokens = cleaned.split(" ").filter(Boolean);
  const withoutSuffix = tokens.filter((t) => !SUFFIXES.has(t.toUpperCase()));
  const suffix = tokens.find((t) => SUFFIXES.has(t.toUpperCase()));

  const variants = new Set<string>();
  variants.add(normalizeVariant(cleaned));

  if (withoutSuffix.length >= 2) {
    const first = withoutSuffix[0]!;
    const last = withoutSuffix[withoutSuffix.length - 1]!;
    // First Last
    variants.add(normalizeVariant([first, last, suffix].filter(Boolean).join(" ")));
    // Last First (appraisal-roll convention)
    variants.add(normalizeVariant([last, first, suffix].filter(Boolean).join(" ")));
    // Last, dropping middle initials
    variants.add(normalizeVariant([first, last].join(" ")));
  }

  // A bare (comma-less) name string is ambiguous between "First [Middle]
  // Last" and "Last First [Middle]" order -- appraisal-roll owner names are
  // routinely the latter. When there's a middle name/initial, the
  // First-Last/Last-First variants above silently drop it, so a real match
  // like notice "ERICA NELDA RODRIGUEZ" vs CAD roll "RODRIGUEZ ERICA NELDA"
  // never produces an equal variant on either side and was scoring as a
  // conflicting owner. These two rotations preserve every token (just
  // moving the presumed surname to the other end) so a middle name/initial
  // is never lost, whichever order the source actually used.
  if (withoutSuffix.length >= 2) {
    const rotateLastToFront = [withoutSuffix[withoutSuffix.length - 1]!, ...withoutSuffix.slice(0, -1)];
    const rotateFirstToBack = [...withoutSuffix.slice(1), withoutSuffix[0]!];
    variants.add(normalizeVariant([...rotateLastToFront, suffix].filter(Boolean).join(" ")));
    variants.add(normalizeVariant([...rotateFirstToBack, suffix].filter(Boolean).join(" ")));
  }

  return Array.from(variants);
}

function normalizeVariant(value: string): string {
  return stripDiacritics(value).toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Generic words in an entity name that carry no identifying information --
 * excluded when looking for a person's surname embedded in a trust/entity
 * name (e.g. "SMITH FAMILY TRUST" -- "SMITH" is the signal, "FAMILY" and
 * "TRUST" are not).
 */
const GENERIC_ENTITY_WORDS = new Set([
  "TRUST", "LIVING", "REVOCABLE", "IRREVOCABLE", "FAMILY", "ESTATE", "OF", "THE", "AND",
  "LLC", "L.L.C", "LP", "L.P", "LTD", "CORP", "CORPORATION", "INC", "INCORPORATED", "CO", "COMPANY", "DBA", "D/B/A",
]);

function significantEntityTokens(entityName: string): string[] {
  return stripDiacritics(entityName)
    .toUpperCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !GENERIC_ENTITY_WORDS.has(t));
}

function surnameTokensOf(people: string[]): string[] {
  return people
    .map((p) => stripDiacritics(p).toUpperCase().replace(/[.,]/g, "").trim().split(/\s+/).filter(Boolean).pop() ?? "")
    .filter(Boolean);
}

/**
 * True when both names share at least one surname in common — much
 * weaker than ownerNamesLikelyRelated (which requires a full-name
 * variant match). Used to avoid treating an abbreviated/partial name
 * ("J. Smith" vs "John A. Smith") as a *conflicting* owner — only a
 * genuinely different surname should count as negative evidence.
 *
 * When either side is a trust/entity (very common in Texas for a
 * homestead placed in a revocable living trust — "JOHN SMITH TRUST" or
 * "SMITH FAMILY TRUST" are both routinely the *same* person, not a
 * different owner), every significant word of the entity name is checked
 * against the other side's surname rather than only the entity string's
 * last word — an entity name's last word is very often a generic word
 * like "TRUST" or "LLC", which would otherwise never match a real
 * surname and wrongly read as a conflicting owner.
 */
export function surnamesMatch(a: string, b: string): boolean {
  const normA = normalizeOwnerName(a);
  const normB = normalizeOwnerName(b);
  const tokensOf = (norm: NormalizedOwnerName) =>
    norm.isEntity ? norm.people.flatMap((p) => significantEntityTokens(p)) : surnameTokensOf(norm.people);
  const tokensA = tokensOf(normA);
  const tokensB = tokensOf(normB);
  return tokensA.some((t) => tokensB.includes(t));
}

/** Loose fuzzy match tolerant of the OCR substitutions above — used only as a low-weight scoring signal, never alone. */
export function ownerNamesLikelyRelated(a: string, b: string): boolean {
  const normA = normalizeOwnerName(a);
  const normB = normalizeOwnerName(b);
  for (const va of normA.normalizedVariants) {
    for (const vb of normB.normalizedVariants) {
      if (va === vb) return true;
      if (applyOcrSubstitutions(va) === applyOcrSubstitutions(vb)) return true;
    }
  }
  return false;
}

function applyOcrSubstitutions(value: string): string {
  return OCR_SUBSTITUTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value);
}
