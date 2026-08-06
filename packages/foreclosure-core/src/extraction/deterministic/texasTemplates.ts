import type { ExtractedForeclosureNotice, ExtractedValue } from "@foreclosuredata/types";
import { parseCurrencyToCents, findAllCurrencyAmountsCents } from "./currency";
import { parseLabeledDate, parseLabeledTime } from "./dates";
import { detectStatedPropertyAddress } from "./addresses";
import { parseLegalDescription } from "./legalDescription";

/**
 * Layer 1 (deterministic) extraction for a standard Texas
 * "Notice of [Substitute] Trustee's Sale". Regex/template based — no AI
 * call. Anything this cannot confidently determine is left `value: null`
 * with `confidence: 0` so Layer 2 (AI) knows what still needs attention.
 */
export function extractDeterministic(noticeText: string): ExtractedForeclosureNotice {
  const text = normalize(noticeText);

  const grantorMatch = text.match(/Grant(?:o|0)r:?\s*([^\n]+)/i);
  const grantorNames = grantorMatch ? splitNames(grantorMatch[1]!) : [];

  const currentMortgageeMatch = text.match(/Current Mortgagee:?\s*([^\n]+)/i);
  const lenderMatch = currentMortgageeMatch ?? text.match(/Original Mortgagee:?\s*([^\n]+)/i) ?? text.match(/payable to the order of\s+([^\n,]+)/i);

  const servicerMatch = text.match(/Mortgage Servicer:?\s*([^\n]+)/i);

  const principalLabelMatch = text.match(/Original Principal Amount:?\s*\$[\d,.]+/i) ?? text.match(/original principal amount of\s*\$[\d,.]+/i);
  const originalPrincipalCents = principalLabelMatch ? parseCurrencyToCents(principalLabelMatch[0]) : null;

  const unpaidBalanceMatch = text.match(/unpaid balance owing on the Note is\s*\$[\d,.]+/i) ?? text.match(/unpaid balance\s*(?:owing|is|of)?\s*\$[\d,.]+/i);
  const currentBalanceCents = unpaidBalanceMatch ? parseCurrencyToCents(unpaidBalanceMatch[0]) : null;

  const deedOfTrustDate = parseLabeledDate(text, /Deed of Trust Date:?/i) ?? parseLabeledDate(text, /on\s+(?:[A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+[A-Z][A-Za-z .'\-]+executed a Deed of Trust/i);
  const recordingDate = parseLabeledDate(text, /Record(?:ed|ing (?:Information|Date)):?/i);
  const instrumentMatch = text.match(/Instrument No\.?\s*([A-Za-z0-9\-]+)/i);

  const saleDate = parseLabeledDate(text, /Date of Sale:?/i) ?? parseLabeledDate(text, /^Date:?/im);
  const saleTime = parseLabeledTime(text, /Time of Sale:?/i) ?? parseLabeledTime(text, /^Time:?/im);
  const saleLocationMatch = text.match(/Place of Sale:?\s*([^\n]+(?:\n[^\n]+)?)/i) ?? text.match(/^Place:?\s*([^\n]+(?:\n[^\n]+)?)/im);

  const detectedAddress = detectStatedPropertyAddress(text);
  const legal = parseLegalDescription(text);

  const propertyIdMatch = text.match(/Property ID:?\s*([A-Za-z0-9\-]+)/i) ?? text.match(/Geographic ID:?\s*([A-Za-z0-9\-]+)/i);

  const trusteeMatch = text.match(/Substitute Trustee\(?s?\)?:?\s*([^\n]+)/i);
  const trusteeNames = trusteeMatch ? splitNames(trusteeMatch[1]!) : [];

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
    lenderName: value(lenderMatch ? cleanName(lenderMatch[1]!) : null, {
      explicitlyStated: Boolean(lenderMatch),
      confidence: lenderMatch ? 0.88 : 0,
      supportingText: lenderMatch?.[0] ?? null,
    }),
    mortgageServicer: value(servicerMatch ? cleanName(servicerMatch[1]!) : null, {
      explicitlyStated: Boolean(servicerMatch),
      confidence: servicerMatch ? 0.85 : 0,
      supportingText: servicerMatch?.[0] ?? null,
    }),
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
      supportingText: evidence(/Date of Sale:?[^\n]+/i),
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

function splitNames(raw: string): string[] {
  return cleanName(raw)
    .split(/\s+AND\s+|\s+and\/or\s+|,\s*/i)
    .map((n) => n.trim())
    .filter(Boolean);
}
