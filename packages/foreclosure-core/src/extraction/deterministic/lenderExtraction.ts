import type { ExtractedValue } from "@foreclosuredata/types";

/**
 * Deterministic extraction of the distinct lender-family parties named in a
 * real Hidalgo "Notice of [Substitute] Trustee's Sale" -- original
 * mortgagee (who made the loan, almost always named via a MERS
 * "as nominee for X" clause), current mortgagee/beneficiary (who currently
 * owns the note), and mortgage servicer (who administers it day to day).
 * Built from the actual OCR text of the 25-notice bounded production run
 * (2026-08-07) after the original single collapsed `lenderName` field
 * (Current Mortgagee: / Original Mortgagee: / "payable to the order of"
 * labels only) missed the majority of records -- most real Hidalgo notices
 * state these facts as narrative prose with no "Label: Value" line at all,
 * or via OCR-scrambled two-column tables.
 *
 * Priority model per concept (highest first), matching the borrower/
 * grantor extractor's approach in texasTemplates.ts:
 *  1. Strong narrative patterns (untouched by table-column OCR bleed)
 *  2. Same-line labeled value ("Current Mortgagee: X")
 *  3. Label followed by next-line value
 *  4. Structured/table best-effort (lower confidence -- these are
 *     genuinely harder to get right from OCR'd column-bled text)
 *  5. (Caller's responsibility) Claude fallback only when still null/weak.
 *
 * Never collapses original vs. current vs. servicer into one value -- see
 * the "Important lender distinction" requirement this was built against.
 */

export interface LenderExtractionResult {
  originalMortgagee: ExtractedValue<string>;
  currentMortgagee: ExtractedValue<string>;
  mortgageServicer: ExtractedValue<string>;
}

// These narrative regexes anchor a name capture with a literal `[A-Z]` --
// deliberately NOT combined with the `/i` flag, because case-insensitive
// matching folds `[A-Z]` into `[A-Za-z]` and silently defeats that anchor,
// letting the lazy capture start mid-sentence at a lowercase word (found
// the hard way: the anchor pattern matched starting at "rized..." from
// "...is\nauthorized to collect..." instead of "Shellpoint..."). Case
// variance in the surrounding literal words is instead spelled out
// explicitly per fragment below, since OCR rarely flips whole-word casing.
//
// Every pattern is compiled with the `g` flag and tried via `firstValidMatch`
// rather than a single `.match()` -- a lazily-bounded capture can complete
// the WHOLE regex successfully starting at the wrong (earlier) position in
// the document (e.g. swallowing a whole unrelated clause because nothing in
// it violated the permissive name character class), and a single `.match()`
// has no way to recover from that: it stops at the first syntactically
// successful match even when that match is semantically garbage. Iterating
// every match and validating each one lets a bad candidate fall through to
// the next real occurrence instead of returning garbage or giving up.

/** OCR commonly misreads "mortgagee" -- observed real variants across the corpus. */
const MORTGAGEE_FUZZY = "(?:[Mm]ortgagee|[Mm]origagee|[Mm]urigagee|[Mm]ortgagoe|[Mm]orgagee|[Mm]ortagee)";
/** OCR commonly drops/misreads a letter in "current" right before "mortgagee". */
const CURRENT_FUZZY = "(?:[Cc]urrent|[Cc]urren|[Cc]ument)";
const MORTGAGE_SERVICER_FUZZY = "(?:[Mm]ortgage\\s+[Ss]ervicer)";

const NAME_CHARS = "[A-Za-z0-9.,&'/\\-\\s]";
// Like NAME_CHARS, but a "." only counts as part of the name when it's NOT
// followed by whitespace + a capital letter -- i.e. it tolerates abbreviation
// periods ("L.L.C.", "P.C.") but refuses to let the lazy capture consume a
// genuine sentence-ending period. Without this, `matchAll`'s per-match retry
// doesn't help: when one bad match's span already extends past the real,
// later start position, there's no shorter match left to try inside it.
// A period immediately before a common entity-suffix word is still allowed
// even when followed by a capital -- OCR frequently misreads the comma in
// "X, LLC"/"X, INC." as a period ("X. LLC"), and that's a suffix, not a new
// sentence.
// No `/i` flag on the surrounding regex (see above), so case variants are spelled out explicitly.
const ENTITY_SUFFIX = "(?:LLC|L\\.L\\.C\\.|[Ii]nc|INC|[Cc]orp|CORP|[Cc]o|CO|[Ll]td|LTD|N\\.?A\\.?|PC|P\\.C\\.|LP|PLLC|[Bb]ank|BANK)";
const NAME_CHARS_SAFE = `(?:[A-Za-z0-9,&'/\\-\\s]|\\.(?!\\s+[A-Z])|\\.(?=\\s+${ENTITY_SUFFIX}\\b))`;

/** Rejects a capture that is garbage rather than a real party name -- a document title, an address, a trustee/auction company, a bare label, or an OCR fragment. */
function looksLikeOrgName(raw: string): boolean {
  const trimmed = raw.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
  if (trimmed.length < 3 || trimmed.length > 200) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  // Just another column-header label ("Current Beneficiary/Mortgagee:"), not a value.
  if (/^(?:Original|Current)\s+(?:Mortgagee|Beneficiary)/i.test(trimmed)) return false;
  // A single generic word with no second token -- "Mortgagee", "Beneficiary", "Lender" alone.
  if (/^(?:Mortgagee|Beneficiary|Lender|Servicer|Trustee)s?$/i.test(trimmed)) return false;
  if (/^(?:MORTGAGE SERVICING INFORMATION|TERMS OF SALE|SALE INFORMATION|NOTICE OF (?:SUBSTITUTE )?TRUSTEE'?S SALE|INSTRUMENT BEING FORECLOSED)$/i.test(trimmed)) {
    return false;
  }
  // A "Label\nInformation." / "Label Information." heading continuation, not a name --
  // e.g. "...AND MORTGAGE SERVICER INFORMATION" matching a bare "Mortgage Servicer" label regex.
  if (/^Information\b/i.test(trimmed)) return false;
  // Trustee/auction/posting companies sometimes sit right after a lender-ish label in the same sentence.
  if (/substitute trustee|auction\.com|title services|posting and publishing/i.test(trimmed)) return false;
  // Looks like a street address, not a party name.
  if (/^\d{1,6}\s/.test(trimmed)) return false;
  // A real entity name never contains the standalone word "to" -- this is the
  // signature of a lazy capture bleeding across a whole grantor-conveyance clause
  // ("...WIFE to JOSE ALBERTO CISNEROS...WIFE. MOVEMENT MORTGAGE, LLC") because
  // every character in that span (letters/commas/periods/spaces) is otherwise a
  // legal name character with nothing to stop the match at the real boundary.
  if (/\bto\b/i.test(trimmed)) return false;
  // A real entity name never contains "is the" as running English words -- rejects a
  // capture that swallowed a second "X is the current mortgagee/servicer" sentence
  // whole because nothing in an address/second-name span violated the character class.
  if (/\bis\s+the\b/i.test(trimmed)) return false;
  // A real entity name doesn't cross a genuine sentence-ending period (a lowercase
  // word of 3+ letters immediately followed by ". Capitalized") -- abbreviations like
  // "L.L.C." or "P.C." don't have a 3+ letter lowercase run before their periods, so
  // this doesn't reject those. A period immediately before a known entity suffix is
  // exempt too -- OCR often misreads "X, LLC" as "X. LLC".
  if (new RegExp(`[a-z]{3,}\\.\\s+(?!${ENTITY_SUFFIX}\\b)[A-Z]`).test(trimmed)) return false;
  // A real party name doesn't itself contain the role phrase "Mortgage Servicer" --
  // rejects a capture that swallowed a role label as if it were part of the name
  // (e.g. "...BANK, as Mortgage Servicer" from a lazily-bounded "is representing" match).
  if (/\bMortgage\s+Servicer\b/i.test(trimmed)) return false;
  return true;
}

function clean(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
}

interface Match {
  value: string;
  supportingText: string;
}

/** Tries every occurrence of `pattern` (must carry the `g` flag) in document order until group 1 survives validation, instead of trusting the textually-first match. */
function firstValidMatch(text: string, pattern: RegExp): Match | null {
  for (const m of text.matchAll(pattern)) {
    const captured = m[1];
    if (captured && looksLikeOrgName(captured)) {
      return { value: clean(captured), supportingText: m[0].replace(/\s+/g, " ").trim() };
    }
  }
  return null;
}

function value(v: string | null, opts: { confidence: number; supportingText: string | null }): ExtractedValue<string> {
  return { value: v, explicitlyStated: v !== null, confidence: v !== null ? opts.confidence : 0, supportingText: opts.supportingText, pageNumber: v !== null ? 1 : null };
}

/** The party MERS acted as nominee for is the real original lender/mortgagee -- MERS itself is never the answer. Works against both clean narrative sentences and OCR-scrambled tables, since the phrase itself (not surrounding layout) is the anchor. */
function extractOriginalMortgagee(text: string): Match | null {
  const nomineeFor = firstValidMatch(text, new RegExp(`nominee\\s+for\\s+(${NAME_CHARS}{1,150}?)\\s*,?\\s*its\\s+successors\\s+and\\s+assigns`, "gi"));
  if (nomineeFor) return nomineeFor;

  // "...for the benefit of NAME ("Mortgagee")" -- a real Hidalgo narrative
  // template (HID-117888) with no MERS nominee clause and no "Original
  // Mortgagee:" label at all. On OCR-garbled input this candidate is
  // expected to be rejected by looksLikeOrgName's leading-capital-letter
  // guard (e.g. a misread "21st" reading as "215\"") rather than fabricate
  // a wrong value -- AI fallback fills it in that case.
  const benefitOf = firstValidMatch(text, new RegExp(`for\\s+the\\s+benefit\\s+of\\s+(${NAME_CHARS}{1,150}?)\\s*\\(["“]?${MORTGAGEE_FUZZY}["”]?\\)`, "gi"));
  if (benefitOf) return benefitOf;

  const labeled = firstValidMatch(text, /Original\s+(?:Mortgagee\/Beneficiary|Beneficiary\/Mortgagee|Mortgagee|Beneficiary):?\s*([^\n]+)/gi);
  if (labeled) {
    // The label's own value often still contains the raw MERS clause ("Mortgage Electronic Registration
    // Systems, Inc., as beneficiary, as nominee for X, its successors and assigns") -- prefer the real
    // nominee target over the MERS boilerplate when both are present in the captured line.
    const nested = labeled.value.match(new RegExp(`nominee\\s+for\\s+(${NAME_CHARS}{1,150}?)(?:,?\\s*its\\s+successors\\s+and\\s+assigns)?$`, "i"));
    if (nested && looksLikeOrgName(nested[1]!)) return { value: clean(nested[1]!), supportingText: labeled.supportingText };
    return labeled;
  }

  return null;
}

function extractCurrentMortgagee(text: string): (Match & { confidence: number }) | null {
  const narrative = firstValidMatch(
    text,
    new RegExp(`(\\b[A-Z]${NAME_CHARS_SAFE}{1,200}?)(?:,\\s*whose address is[\\s\\S]{1,150}?)?\\s+is\\s+the\\s+${CURRENT_FUZZY}\\s+${MORTGAGEE_FUZZY}`, "g"),
  );
  if (narrative) return { ...narrative, confidence: 0.85 };

  const ownerHolder = firstValidMatch(
    text,
    new RegExp(`(\\b[A-Z]${NAME_CHARS_SAFE}{1,150}?)\\s+is\\s+the\\s+${CURRENT_FUZZY}\\s+owner\\s+and\\s+holder\\s+of\\s+the\\s+Obligations`, "g"),
  );
  if (ownerHolder) return { ...ownerHolder, confidence: 0.85 };

  const labeled = firstValidMatch(
    text,
    /Current\s+(?:Mortgagee\/Beneficiary|Beneficiary\/Mortgagee|Mortgagee|Beneficiary|Mortgagoe):?\s*([^\n]+)/gi,
  );
  if (labeled) return { ...labeled, confidence: 0.85 };

  // A bare "Lender:"/"Payee:" label (colon required, anchored to a line start
  // -- NOT a bare match, since "lender" also appears as an ordinary word
  // mid-sentence, e.g. "...successor to original lender") is ambiguous in
  // principle, but in every real occurrence found it named the party
  // currently exercising foreclosure rights (sometimes explicitly described
  // as "successor to original lender"), never the original lender.
  const bareLenderLabel = firstValidMatch(text, /^\s*(?:Lender|Payee):\s*([^\n]+)/gim);
  if (bareLenderLabel) return { ...bareLenderLabel, confidence: 0.75 };

  // Best-effort: some notices bleed the current mortgagee's name onto the end of the MERS boilerplate
  // line ("...MORTGAGE ELECTRONIC REGISTRATION SYSTEMS, INC. Planet Home Lending, LLC") when OCR reads
  // a two-column table left-to-right per visual row. Lower confidence -- genuinely less certain.
  const mersBleed = firstValidMatch(text, new RegExp(`MORTGAGE ELECTRONIC REGISTRATION SYSTEMS,?\\s*INC\\.?\\s+(\\b[A-Z]${NAME_CHARS}{2,80})$`, "gm"));
  if (mersBleed) return { ...mersBleed, confidence: 0.55 };

  // Best-effort: "Current <NAME> Loan Servicer: <NAME2>" is a table row where the current-beneficiary
  // column bled onto the servicer row's line.
  const currentLoanServicerLine = firstValidMatch(text, new RegExp(`Current\\s+(\\b[A-Z]${NAME_CHARS}{1,80}?)\\s+Loan\\s+Servicer:?`, "g"));
  if (currentLoanServicerLine) return { ...currentLoanServicerLine, confidence: 0.55 };

  return null;
}

function extractMortgageServicer(text: string): (Match & { confidence: number }) | null {
  const narrative = firstValidMatch(
    text,
    new RegExp(
      `(\\b[A-Z]${NAME_CHARS_SAFE}{1,150}?)\\s+is\\s+(?:acting\\s+as\\s+the\\s+${MORTGAGE_SERVICER_FUZZY}|the\\s+${CURRENT_FUZZY}\\s+mortgage\\s+servicer|mortgage\\s+servicer)\\b`,
      "g",
    ),
  );
  if (narrative) return { ...narrative, confidence: 0.85 };

  // "X, as Mortgage Servicer, is representing the current mortgagee" -- the servicer name precedes
  // the label here rather than following it.
  const asServicerRepresenting = firstValidMatch(
    text,
    new RegExp(`(\\b[A-Z]${NAME_CHARS_SAFE}{1,150}?),?\\s+as\\s+${MORTGAGE_SERVICER_FUZZY},?\\s+is\\s+representing`, "g"),
  );
  if (asServicerRepresenting) return { ...asServicerRepresenting, confidence: 0.85 };

  const representing = firstValidMatch(text, new RegExp(`(\\b[A-Z]${NAME_CHARS_SAFE}{1,80}?)\\s+is\\s+representing\\s+the\\s+${CURRENT_FUZZY}`, "g"));
  if (representing) return { ...representing, confidence: 0.8 };

  const labeled = firstValidMatch(text, /Mortgage Servicer:?\s*([^\n]+)/gi);
  if (labeled) return { ...labeled, confidence: 0.85 };

  const currentLoanServicerLine = firstValidMatch(
    text,
    new RegExp(`Current\\s+\\b[A-Z]${NAME_CHARS}{1,80}?\\s+Loan\\s+Servicer:?\\s*~*\\s*([^\\n]+)`, "g"),
  );
  if (currentLoanServicerLine) return { ...currentLoanServicerLine, confidence: 0.55 };

  return null;
}

export function extractLenderParties(noticeText: string): LenderExtractionResult {
  const text = noticeText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  const original = extractOriginalMortgagee(text);
  const current = extractCurrentMortgagee(text);
  const servicer = extractMortgageServicer(text);

  return {
    originalMortgagee: value(original?.value ?? null, { confidence: 0.85, supportingText: original?.supportingText ?? null }),
    currentMortgagee: value(current?.value ?? null, { confidence: current?.confidence ?? 0, supportingText: current?.supportingText ?? null }),
    mortgageServicer: value(servicer?.value ?? null, { confidence: servicer?.confidence ?? 0, supportingText: servicer?.supportingText ?? null }),
  };
}
