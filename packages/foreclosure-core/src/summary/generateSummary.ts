import type { AddressResolutionMethod } from "@foreclosuredata/types";

export interface SummaryInput {
  classification: "RESIDENTIAL" | "COMMERCIAL" | "UNKNOWN";
  propertyAddress: string | null;
  city: string | null;
  subdivision: string | null;
  saleDateIso: string | null;
  borrowerName: string | null;
  lenderName: string | null;
  originalLoanDateIso: string | null;
  originalPrincipalCents: number | null;
  currentBalanceStatedCents: number | null;
  addressResolutionMethod: AddressResolutionMethod;
}

/**
 * Deterministic, template-based plain-English summary — no AI call. Run
 * once per case at ingestion time and cached (`ForeclosureCase.summaryText`);
 * never regenerated on page render, per the cost-control rules.
 */
export function generateForeclosureSummary(input: SummaryInput): string {
  const kind = input.classification === "COMMERCIAL" ? "commercial" : input.classification === "RESIDENTIAL" ? "residential" : "";
  const propertyPhrase = input.propertyAddress
    ? `This ${kind ? kind + " " : ""}property is located at ${input.propertyAddress}${input.city ? `, ${input.city}, TX` : ""}`
    : input.subdivision
      ? `This ${kind ? kind + " " : ""}property is in the ${input.subdivision} area${input.city ? ` of ${input.city}, TX` : ""} (exact address not yet confirmed)`
      : `This ${kind ? kind + " " : ""}property's location has not yet been confirmed`;

  const salePhrase = input.saleDateIso
    ? `is scheduled for foreclosure sale on ${formatDate(input.saleDateIso)}`
    : "does not yet have a confirmed foreclosure sale date";

  const partiesPhrase =
    input.borrowerName && input.lenderName
      ? `The notice identifies ${input.borrowerName} as the borrower and ${input.lenderName} as the mortgagee.`
      : input.lenderName
        ? `The notice identifies ${input.lenderName} as the mortgagee.`
        : "";

  const loanPhrase =
    input.originalLoanDateIso && input.originalPrincipalCents
      ? `The original deed of trust was recorded around ${formatDate(input.originalLoanDateIso)} with an original principal amount of ${formatCurrency(input.originalPrincipalCents)}.`
      : "";

  const balancePhrase =
    input.currentBalanceStatedCents !== null
      ? `The notice states an unpaid balance of ${formatCurrency(input.currentBalanceStatedCents)}.`
      : "The notice does not state the current payoff balance.";

  const resolutionPhrase = resolutionSentence(input.addressResolutionMethod);

  return [`${propertyPhrase} ${salePhrase}.`, partiesPhrase, loanPhrase, balancePhrase, resolutionPhrase]
    .filter(Boolean)
    .join(" ");
}

function resolutionSentence(method: AddressResolutionMethod): string {
  switch (method) {
    case "EXPLICIT_STATED":
      return "The property address was explicitly stated in the foreclosure notice.";
    case "COMMONLY_KNOWN_AS_PHRASE":
      return "The property address was identified from a \"commonly known as\" phrase in the notice.";
    case "LEGAL_DESCRIPTION_MATCH":
      return "The property address was matched to the county appraisal record using the legal description.";
    case "PROPERTY_ID_MATCH":
      return "The property address was matched using the property ID referenced in the notice.";
    case "OWNER_MAILING_ADDRESS_MATCH":
      return "The property address was matched using the owner's name against appraisal district records.";
    case "GEOCODING":
      return "The property address was resolved with the assistance of a geocoding service.";
    case "MANUAL":
      return "The property address was confirmed by an administrator.";
    case "UNRESOLVED":
    default:
      return "The property address could not be confidently resolved and this record is pending manual review.";
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
