import type { ExtractedForeclosureNotice, ExtractedValue } from "@foreclosuredata/types";
import { parseCurrencyToCents, findAllCurrencyAmountsCents } from "./currency";
import { parseLabeledDate, parseLabeledTime } from "./dates";
import { detectStatedPropertyAddress } from "./addresses";
import { parseLegalDescription } from "./legalDescription";
import { extractLenderParties } from "./lenderExtraction";

/**
 * Layer 1 (deterministic) extraction for a standard Texas
 * "Notice of [Substitute] Trustee's Sale". Regex/template based — no AI
 * call. Anything this cannot confidently determine is left `value: null`
 * with `confidence: 0` so Layer 2 (AI) knows what still needs attention.
 */
export function extractDeterministic(noticeText: string): ExtractedForeclosureNotice {
  const text = normalize(noticeText);

  const { match: grantorMatch, names: grantorNames } = extractGrantorNames(text);

  const lenderParties = extractLenderParties(text);

  const principalLabelMatch = text.match(/Original Principal Amount:?\s*\$[\d,.]+/i) ?? text.match(/original principal amount of\s*\$[\d,.]+/i);
  const originalPrincipalCents = principalLabelMatch ? parseCurrencyToCents(principalLabelMatch[0]) : null;

  const unpaidBalanceMatch = text.match(/unpaid balance owing on the Note is\s*\$[\d,.]+/i) ?? text.match(/unpaid balance\s*(?:owing|is|of)?\s*\$[\d,.]+/i);
  const currentBalanceCents = unpaidBalanceMatch ? parseCurrencyToCents(unpaidBalanceMatch[0]) : null;

  const deedOfTrustDate = parseLabeledDate(text, /Deed of Trust Date:?/i) ?? parseLabeledDate(text, /on\s+(?:[A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+[A-Z][A-Za-z .'\-]+executed a Deed of Trust/i);
  const recordingDate = parseLabeledDate(text, /Record(?:ed|ing (?:Information|Date)):?/i);
  const instrumentMatch = text.match(/Instrument No\.?\s*([A-Za-z0-9\-]+)/i);

  // "Sale Information: August 4, 2026, at 10:00 AM..." is a real Hidalgo
  // template variant with no "Date of Sale:" label at all. Checked before
  // the generic `^Date:?` line-start fallback, which is risky against real
  // OCR text -- on one real notice it matched a line-wrapped "dated
  // November 30, 2017" (the Deed of Trust date, not the sale date) instead
  // because that word happened to fall at the start of an OCR'd line.
  const saleDate =
    parseLabeledDate(text, /Date of Sale:?/i) ?? parseLabeledDate(text, /Sale Information:?/i) ?? parseLabeledDate(text, /^Date:?/im);
  const saleTime = parseLabeledTime(text, /Time of Sale:?/i) ?? parseLabeledTime(text, /^Time:?/im);
  const saleLocationMatch = text.match(/Place of Sale:?\s*([^\n]+(?:\n[^\n]+)?)/i) ?? text.match(/^Place:?\s*([^\n]+(?:\n[^\n]+)?)/im);

  const detectedAddress = detectStatedPropertyAddress(text);
  const legal = parseLegalDescription(text);

  const propertyIdMatch = text.match(/Property ID:?\s*([A-Za-z0-9\-]+)/i) ?? text.match(/Geographic ID:?\s*([A-Za-z0-9\-]+)/i);

  const trusteeMatch = text.match(/Substitute Trustee\(?s?\)?:?\s*([^\n]+)/i);
  const trusteeNames = trusteeMatch && looksLikeNameList(trusteeMatch[1]!) ? splitNames(trusteeMatch[1]!) : [];

  const evidence = (pattern: RegExp): string | null => text.match(pattern)?.[0]?.trim() ?? null;

  return {
    borrowerNames: value(grantorNames.length ? grantorNames : null, {
      explicitlyStated: grantorNames.length > 0,
      confidence: grantorNames.length ? 0.9 : 0,
      supportingText: grantorMatch?.[0] ?? null,
    }),
    grantorNames: value(grantorNames.length ? grantorNames : null, {
      explicitlyStated: grantorNames.length > 0,
      confidence: grantorNames.length ? 0.9 : 0,
      supportingText: grantorMatch?.[0] ?? null,
    }),
    // Deprecated collapsed field -- prefers the current mortgagee (who's actually
    // foreclosing) since that's almost always the more useful single label, falling
    // back to the original mortgagee only when no current-holder party was found.
    lenderName: lenderParties.currentMortgagee.value !== null ? lenderParties.currentMortgagee : lenderParties.originalMortgagee,
    originalMortgagee: lenderParties.originalMortgagee,
    currentMortgagee: lenderParties.currentMortgagee,
    mortgageServicer: lenderParties.mortgageServicer,
    originalPrincipalAmount: value(originalPrincipalCents !== null ? originalPrincipalCents / 100 : null, {
      explicitlyStated: originalPrincipalCents !== null,
      confidence: originalPrincipalCents !== null ? 0.92 : 0,
      supportingText: principalLabelMatch?.[0] ?? null,
    }),
    currentPrincipalBalance: value(currentBalanceCents !== null ? currentBalanceCents / 100 : null, {
      explicitlyStated: currentBalanceCents !== null,
      confidence: currentBalanceCents !== null ? 0.85 : 0,
      supportingText: unpaidBalanceMatch?.[0] ?? null,
    }),
    deedOfTrustDate: value(deedOfTrustDate, {
      explicitlyStated: Boolean(deedOfTrustDate),
      confidence: deedOfTrustDate ? 0.9 : 0,
      supportingText: evidence(/Deed of Trust Date:?[^\n]+/i),
    }),
    instrumentNumber: value(instrumentMatch?.[1] ?? null, {
      explicitlyStated: Boolean(instrumentMatch),
      confidence: instrumentMatch ? 0.9 : 0,
      supportingText: instrumentMatch?.[0] ?? null,
    }),
    recordingDate: value(recordingDate, {
      explicitlyStated: Boolean(recordingDate),
      confidence: recordingDate ? 0.85 : 0,
      supportingText: evidence(/Record(?:ed|ing Information)[^\n]+/i),
    }),
    propertyAddress: value(detectedAddress?.text ?? null, {
      explicitlyStated: Boolean(detectedAddress),
      confidence: detectedAddress ? 0.95 : 0,
      supportingText: detectedAddress?.text ?? null,
    }),
    legalDescription: value(legal?.rawText ?? null, {
      explicitlyStated: Boolean(legal),
      confidence: legal ? 0.88 : 0,
      supportingText: legal?.rawText ?? null,
    }),
    propertyId: value(propertyIdMatch?.[1] ?? null, {
      explicitlyStated: Boolean(propertyIdMatch),
      confidence: propertyIdMatch ? 0.8 : 0,
      supportingText: propertyIdMatch?.[0] ?? null,
    }),
    saleDate: value(saleDate, {
      explicitlyStated: Boolean(saleDate),
      confidence: saleDate ? 0.95 : 0,
      supportingText: evidence(/Date of Sale:?[^\n]+/i) ?? evidence(/Sale Information:?[^\n]+/i),
    }),
    saleTime: value(saleTime, {
      explicitlyStated: Boolean(saleTime),
      confidence: saleTime ? 0.9 : 0,
      supportingText: evidence(/Time of Sale:?[^\n]+/i),
    }),
    saleLocation: value(saleLocationMatch ? saleLocationMatch[1]!.replace(/\s+/g, " ").trim() : null, {
      explicitlyStated: Boolean(saleLocationMatch),
      confidence: saleLocationMatch ? 0.85 : 0,
      supportingText: saleLocationMatch?.[0] ?? null,
    }),
    substituteTrustee: value(trusteeNames.length ? trusteeNames : null, {
      explicitlyStated: trusteeNames.length > 0,
      confidence: trusteeNames.length ? 0.85 : 0,
      supportingText: trusteeMatch?.[0] ?? null,
    }),
  };
}

/** True if two or more required fields are missing/low-confidence, signaling Layer 2 (AI) should be attempted. */
export function needsAiFallback(extracted: ExtractedForeclosureNotice): boolean {
  const criticalFields: Array<ExtractedValue<unknown>> = [
    extracted.borrowerNames,
    extracted.lenderName,
    extracted.saleDate,
    extracted.propertyAddress,
    extracted.legalDescription,
  ];
  const weak = criticalFields.filter((f) => f.value === null || f.confidence < 0.6);
  return weak.length >= 2;
}

function value<T>(v: T | null, opts: { explicitlyStated: boolean; confidence: number; supportingText: string | null }): ExtractedValue<T> {
  return { value: v, explicitlyStated: opts.explicitlyStated, confidence: opts.confidence, supportingText: opts.supportingText, pageNumber: v !== null ? 1 : null };
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
}

/**
 * Rejects a "label: rest of line" capture that plausibly matched a
 * generic sentence mentioning the label rather than the actual labeled
 * name -- e.g. against a real Hidalgo notice, `/Substitute Trustee.../`
 * matches the document's own title ("Notice of Substitute Trustee Sale",
 * capturing "Sale") and a later throwaway mention ("...or any substitute
 * trustee.", capturing text starting mid-sentence) before ever reaching
 * the real "Substitute Trustee: <Name>" line. A genuine name/company
 * capture reads as a short run of capitalized words; a false positive
 * from a generic sentence starts mid-clause in lowercase or with
 * unrelated punctuation.
 */
function looksLikeNameList(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 200) return false;
  return /^[A-Z][a-zA-Z.&'\-]*(?:\s+[A-Z][a-zA-Z.&'\-]*){1,}/.test(trimmed);
}

/**
 * Marital-status descriptors ("HUSBAND AND WIFE", "AN UNMARRIED MAN", ...)
 * sit in the same comma/AND-separated list as the actual grantor names in
 * real Hidalgo notices (e.g. "JUAN DOE, AN UNMARRIED MAN AND JANE ROE, AN
 * UNMARRIED WOMAN"), so a plain split on "AND"/"," turns them into two
 * fake extra "names". Filtered out post-split rather than stripped as a
 * prefix/suffix beforehand, since they can appear after each individual
 * name in a multi-grantor list, not just once at the end.
 */
const MARITAL_STATUS_DESCRIPTOR = /^(?:an?\s+)?(?:unmarried|married|single)\s+(?:man|woman|person)$|^husband$|^wife$|^husband and wife$/i;

function splitNames(raw: string): string[] {
  return cleanName(raw)
    .split(/\s+AND\s+|\s+and\/or\s+|,\s*/i)
    .map((n) => n.trim())
    .filter(Boolean)
    .filter((n) => !MARITAL_STATUS_DESCRIPTOR.test(n));
}

/**
 * Real Hidalgo notices use at least three different templates for the
 * borrower/grantor field, confirmed against the first 5 real production
 * notices (August 2026 postings):
 *  - "Grantor(s)/Mortgagor(s):" label, name on the same line
 *  - "Trustor(s):" label (legally synonymous with Grantor here, not
 *    previously recognized at all) -- and, in the specific sample seen,
 *    with the name landing on the *next* line after a garbled OCR date
 *    token (e.g. a mis-scanned "12/20/2018" reading as "121202018")
 *  - No label at all: narrative prose ("...the deed of trust executed by
 *    NAME..." / "The Deed of Trust executed by NAME secures...")
 * The label-based captures are unreliable on their own: these are table
 * layouts, and OCR reads side-by-side columns left-to-right per visual
 * row, so text from the *next* column (e.g. "Original Beneficiary:
 * MORTGAGE ELECTRONIC...") frequently bleeds onto the same line as the
 * name. The narrative "executed by" sentence is plain prose, untouched by
 * table-column bleed, and was present (often redundantly, alongside a
 * label) in every real sample checked -- so it's tried first.
 */
function extractGrantorNames(text: string): { match: RegExpMatchArray | null; names: string[] } {
  const executedByMatch = text.match(
    /deed of trust executed by\s+([\s\S]{1,180}?)(?:\s+secures the repayment|\.\s*[Tt]he [Rr]eal property)/i,
  );
  if (executedByMatch && looksLikeNameList(executedByMatch[1]!)) {
    return { match: executedByMatch, names: splitNames(executedByMatch[1]!) };
  }

  const sameLineMatch = text.match(/(?:Grant(?:o|0)r\(?s?\)?(?:\/Mortgagor\(?s?\)?)?|Trustor\(?s?\)?):?\s*([^\n]+)/i);
  if (sameLineMatch && looksLikeNameList(sameLineMatch[1]!)) {
    return { match: sameLineMatch, names: splitNames(sameLineMatch[1]!) };
  }

  const nextLineMatch = text.match(
    /(?:Grant(?:o|0)r\(?s?\)?(?:\/Mortgagor\(?s?\)?)?|Trustor\(?s?\)?):?\s*\n\s*(?:[\d/]{6,12}\s+)?([A-Z][A-Za-z .,'\-]+(?:AND\s+[A-Z][A-Za-z .,'\-]+)?)/i,
  );
  if (nextLineMatch && looksLikeNameList(nextLineMatch[1]!)) {
    return { match: nextLineMatch, names: splitNames(nextLineMatch[1]!) };
  }

  return { match: null, names: [] };
}
