/**
 * Investor-facing publication readiness. A single, centralized predicate for
 * "is this ForeclosureCase safe and useful enough to show a member of the
 * public, and how should it be labeled" -- computed on read from the case's
 * actual data, never a hand-maintained/stale stored flag, so it can never
 * drift from what the record actually contains.
 *
 * Deliberately NOT "has no open manual review tasks" -- most review reasons
 * (NO_ADDRESS_RESOLVED, MULTIPLE_APPRAISAL_MATCHES, LOW_CONFIDENCE, etc.) are
 * optional-enrichment gaps that a real investor can work around; only a
 * small set of reasons mean "we might be showing the wrong property or the
 * wrong sale" and those are the only ones that block publication.
 */

export type PublicationStatus = "PUBLISHED" | "PUBLISHED_WITH_LIMITED_DATA" | "PENDING_REVIEW" | "WITHHELD" | "ARCHIVED";

/**
 * ManualReviewReason values that mean "this case might be misrepresenting
 * the real-world property, owner, or sale" -- publication blockers. Every
 * other reason is an optional-enrichment gap and never blocks publication
 * on its own.
 */
export const CRITICAL_BLOCKER_REVIEW_REASONS = new Set([
  "CAD_OWNER_CONFLICT",
  "BORROWER_NAME_CONFLICT",
  "SALE_DATE_CONFLICT",
  "MISSING_FILING_NUMBER",
  "POSSIBLE_CONTENT_DUPLICATE",
  "POOR_TEXT_QUALITY",
]);

export const NON_BLOCKING_REVIEW_REASONS = new Set(["NO_ADDRESS_RESOLVED", "MULTIPLE_APPRAISAL_MATCHES", "PROPERTY_CLASSIFICATION_UNCERTAIN", "LOW_CONFIDENCE", "USER_REPORTED"]);

const PLACEHOLDER_BORROWER_NAMES = new Set(["unknown owner"]);

export interface PublicationInput {
  archivedAt: Date | null;
  hasSourceDocument: boolean;
  saleDate: Date | null;
  borrowerName: string | null;
  propertyStreetAddress: string | null;
  addressResolutionMethod: string | null; // AddressResolutionMethod enum value, or null if no Property row
  addressResolutionConfidence: number | null;
  hasLegalDescription: boolean;
  hasCadConfirmedProperty: boolean;
  openManualReviewReasons: string[];
  hasActiveDuplicateLink: boolean; // OPEN PossibleDuplicateNoticeLink at LIKELY_SAME_EVENT or CONFIRMED_SAME_EVENT
}

export interface PublicationResult {
  status: PublicationStatus;
  /** True when the case is otherwise safe to publish but has no trustworthy street address -- route to the separated "Address pending" UX, never intermixed with address-resolved listings (see module doc + docs on addressless-case handling). */
  addressPending: boolean;
  /** Which specific things are keeping this out of PUBLISHED (or out of the public feed at all). Always populated, even for PUBLISHED (empty array). */
  blockingReasons: string[];
  /** Investor-safe, non-technical label. Never exposes raw confidence scores. */
  investorLabel: string;
}

const ADDRESS_TRUST_FLOOR = 0.7;

function hasTrustworthyAddress(input: PublicationInput): boolean {
  if (!input.propertyStreetAddress) return false;
  if (input.addressResolutionMethod === "UNRESOLVED" || input.addressResolutionMethod === null) return false;
  // A method the notice itself explicitly stated is trustworthy regardless of
  // whether county-appraisal enrichment ever confirmed it -- it's exactly
  // what the recorded document says, not a fuzzy match.
  if (input.addressResolutionMethod === "EXPLICIT_STATED" || input.addressResolutionMethod === "COMMONLY_KNOWN_AS_PHRASE") return true;
  return (input.addressResolutionConfidence ?? 0) >= ADDRESS_TRUST_FLOOR;
}

function hasRealBorrowerName(input: PublicationInput): boolean {
  if (!input.borrowerName) return false;
  return !PLACEHOLDER_BORROWER_NAMES.has(input.borrowerName.trim().toLowerCase());
}

/**
 * Computes publication status + investor-facing label for one case. Pure
 * function -- the caller is responsible for fetching the fields in
 * PublicationInput (see PUBLICATION_STATUS_INCLUDE in
 * apps/web/lib/publicationVisibility.ts for the canonical Prisma shape).
 */
export function computePublicationStatus(input: PublicationInput): PublicationResult {
  if (input.archivedAt !== null) {
    return { status: "ARCHIVED", addressPending: false, blockingReasons: ["archived"], investorLabel: "No longer active" };
  }

  const hasValidSourceNotice = input.hasSourceDocument && input.saleDate !== null;
  if (!hasValidSourceNotice) {
    return { status: "WITHHELD", addressPending: false, blockingReasons: ["missing_or_invalid_source_notice"], investorLabel: "Unavailable" };
  }

  const criticalReasons = input.openManualReviewReasons.filter((r) => CRITICAL_BLOCKER_REVIEW_REASONS.has(r));
  const hasCriticalBlocker = criticalReasons.length > 0 || input.hasActiveDuplicateLink;
  if (hasCriticalBlocker) {
    const reasons = [...criticalReasons];
    if (input.hasActiveDuplicateLink) reasons.push("active_duplicate_link");
    return { status: "PENDING_REVIEW", addressPending: false, blockingReasons: reasons, investorLabel: "Pending verification" };
  }

  const hasAddress = hasTrustworthyAddress(input);
  const hasCoreIdentifier = hasAddress || input.hasLegalDescription;
  if (!hasCoreIdentifier) {
    // No sale-date-and-source-notice-only case is safe to show -- we can't
    // even tell an investor which property this is.
    return { status: "PENDING_REVIEW", addressPending: false, blockingReasons: ["no_property_identifier"], investorLabel: "Pending verification" };
  }

  const addressPending = !hasAddress;
  const hasRealBorrower = hasRealBorrowerName(input);
  const nonBlockingGaps: string[] = [];
  if (addressPending) nonBlockingGaps.push("address_pending");
  if (!hasRealBorrower) nonBlockingGaps.push("borrower_unavailable");
  if (!input.hasCadConfirmedProperty) nonBlockingGaps.push("cad_unconfirmed");

  if (addressPending || !hasRealBorrower) {
    return {
      status: "PUBLISHED_WITH_LIMITED_DATA",
      addressPending,
      blockingReasons: nonBlockingGaps,
      investorLabel: addressPending ? "Limited data — address pending" : "Limited data",
    };
  }

  if (!input.hasCadConfirmedProperty) {
    return {
      status: "PUBLISHED_WITH_LIMITED_DATA",
      addressPending: false,
      blockingReasons: nonBlockingGaps,
      investorLabel: "Source address",
    };
  }

  return { status: "PUBLISHED", addressPending: false, blockingReasons: [], investorLabel: "Verified property" };
}

/** True for any status a member of the public should ever see. */
export function isPubliclyVisibleStatus(status: PublicationStatus): boolean {
  return status === "PUBLISHED" || status === "PUBLISHED_WITH_LIMITED_DATA";
}
