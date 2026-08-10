import { getPublicationStatus, type PublicationFieldsSource } from "@/lib/publicationVisibility";
import { formatBorrowerName } from "@/lib/utils";
import type { InvestorDataState, InvestorListing, InvestorPropertyType } from "./types";

interface AdapterOrgRef {
  name: string;
}
interface AdapterPersonRef {
  fullName: string;
}

/**
 * Structural superset of PublicationFieldsSource (see lib/publicationVisibility.ts)
 * so toInvestorListing() can reuse the exact same publication decision this
 * app already makes everywhere else, rather than re-deriving it. Every
 * relation below is optional except the ones PublicationFieldsSource itself
 * requires -- a caller fetching the lighter foreclosureCaseListInclude()
 * shape (browse/card views) satisfies this with `mortgageServicer`, `trustee`,
 * `appraisalValueHistory`, and `legalDescriptions[].rawText` simply absent;
 * a caller fetching the richer detail-page include supplies them and gets a
 * fuller InvestorListing back. Never a fixture -- every field here traces to
 * a real Prisma column.
 */
export interface InvestorAdapterCase extends PublicationFieldsSource {
  id: string;
  caseNumber: string | null;
  createdAt: Date;
  county: { name: string; slug: string };
  property:
    | ({
        id: string;
        propertyStreetAddress: string | null;
        city: string | null;
        state: string;
        zipCode: string | null;
        latitude: number | null;
        longitude: number | null;
        propertyType: string;
        acreage: number | null;
        propertyIdNumber: string | null;
        geographicId: string | null;
        legalDescription: string | null;
        appraisedValueCents: number | null;
        estimatedMarketValueCents: number | null;
        addressResolutionMethod: string;
        addressResolutionConfidence: number | null;
        subdivision: string | null;
        lot: string | null;
        block: string | null;
        appraisalValueHistory?: Array<{
          landValueCents: number | null;
          improvementValueCents: number | null;
          taxYear: number;
          retrievedAt: Date;
        }>;
      } & PublicationFieldsSource["property"])
    | null;
  sales: Array<{
    saleDate: Date | null;
    trustee?: { person: AdapterPersonRef | null; organization: AdapterOrgRef | null } | null;
  }>;
  loan: {
    originalPrincipalAmountCents: number | null;
    currentPrincipalBalanceCents: number | null;
    estimatedRemainingBalanceCents: number | null;
    recordingDate: Date | null;
    instrumentNumber: string | null;
    currentMortgagee: AdapterOrgRef | null;
    originalLender: AdapterOrgRef | null;
    mortgageServicer?: AdapterOrgRef | null;
  } | null;
  borrower: AdapterPersonRef | null;
  legalDescriptions: Array<{ id: string; rawText?: string }>;
  documents: Array<{ id: string }>;
}

const KNOWN_INVESTOR_DATA_STATES = new Set<InvestorDataState>([
  "Verified property",
  "Source address",
  "Limited data",
  "Limited data — address pending",
  "Pending verification",
  "Unavailable",
]);

function toInvestorDataState(investorLabel: string): InvestorDataState {
  return KNOWN_INVESTOR_DATA_STATES.has(investorLabel as InvestorDataState) ? (investorLabel as InvestorDataState) : "Unavailable";
}

function toInvestorPropertyType(propertyType: string): InvestorPropertyType {
  const known: InvestorPropertyType[] = ["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOUSE", "MOBILE_HOME", "VACANT_LAND", "COMMERCIAL", "OTHER", "UNKNOWN"];
  return (known as string[]).includes(propertyType) ? (propertyType as InvestorPropertyType) : "UNKNOWN";
}

function trusteeNameFromSale(sale: InvestorAdapterCase["sales"][number] | null | undefined): string | null {
  const trustee = sale?.trustee;
  if (!trustee) return null;
  return trustee.organization?.name ?? trustee.person?.fullName ?? null;
}

/**
 * Maps one real, publication-gated ForeclosureCase to the flat investor UI
 * shape. `unlocked` mirrors hasFullAccessToCounty() -- lender/original-loan
 * are nulled out when locked, but `borrowerName` is always the real value:
 * display components decide whether to render it or a blurred placeholder
 * from `listing.unlocked` (see PropertyMetric's `locked` prop), never by
 * string-matching the value itself. Never invents an address, borrower, or
 * value -- every field is either a real column or null.
 */
export function toInvestorListing(fc: InvestorAdapterCase, unlocked: boolean): InvestorListing {
  const publication = getPublicationStatus(fc);
  const property = fc.property;
  // Sales are fetched ordered ascending by saleDate (see foreclosureCaseListInclude()).
  // A case with postponements has MULTIPLE ForeclosureSale rows over time -- the last
  // one in ascending order is the current/most-recent sale date, never the first
  // (which for a postponed case would be the stale, superseded original date).
  const sale = fc.sales[fc.sales.length - 1] ?? null;
  const latestAppraisal = property?.appraisalValueHistory?.[0] ?? null;

  const countyMarketValueCents = property?.estimatedMarketValueCents ?? null;
  const countyAppraisedValueCents = property?.appraisedValueCents ?? null;
  const equityBaseCents = countyMarketValueCents ?? countyAppraisedValueCents;
  const equitySourceLabel = equityBaseCents === null ? null : countyMarketValueCents !== null ? "County Market Value" : "County Appraised Value";
  const loanBalanceCents = fc.loan?.currentPrincipalBalanceCents ?? fc.loan?.estimatedRemainingBalanceCents ?? null;
  const estimatedEquityCents = equityBaseCents !== null && loanBalanceCents !== null ? equityBaseCents - loanBalanceCents : null;

  return {
    id: property?.id ?? fc.id,
    caseNumber: fc.caseNumber,

    // Street address text is entitlement-gated like borrower/lender/
    // original-loan below -- null (not just visually hidden) when locked,
    // so the real address string never reaches a free/signed-out
    // visitor's browser. `addressPending` is computed independently above
    // from the publication status alone, so it still correctly
    // distinguishes "genuinely unresolved" from "resolved but paywalled"
    // even though `address` reads null in both cases here -- see
    // addressDisplayText() in lib/investor/format.ts, the single place
    // that turns those two flags back into investor-facing copy.
    //
    // lat/lng are NOT gated the same way -- a map with no pins for anyone
    // who hasn't paid isn't a usable map (see docs/PRODUCT_UX_ROADMAP.md's
    // map section: pins are core browsing, not a paywalled detail). The
    // popup that opens on a pin still goes through addressDisplayText(),
    // so a locked pin shows on the map but never reveals the street text.
    address: unlocked ? property?.propertyStreetAddress ?? null : null,
    addressPending: publication.addressPending,
    city: property?.city ?? null,
    state: property?.state ?? "TX",
    zip: property?.zipCode ?? null,
    lat: property?.latitude ?? null,
    lng: property?.longitude ?? null,

    saleDateISO: sale?.saleDate ? sale.saleDate.toISOString() : null,
    filedDateISO: fc.createdAt.toISOString(),

    propertyType: toInvestorPropertyType(property?.propertyType ?? "UNKNOWN"),
    subdivision: property?.subdivision ?? null,
    lot: property?.lot ?? null,
    block: property?.block ?? null,
    acreage: property?.acreage ?? null,
    parcelId: property?.propertyIdNumber ?? null,
    geoId: property?.geographicId ?? null,

    // Always the real value regardless of lock state -- `unlocked` on the
    // returned listing is what tells display components whether to render
    // it or a blurred placeholder (see components/investor/ui/property-metric.tsx),
    // so the data layer never bakes UI copy like "Upgrade to view" into a
    // field meant to hold a name.
    borrowerName: formatBorrowerName(fc.borrower?.fullName),
    lenderName: unlocked ? fc.loan?.currentMortgagee?.name ?? fc.loan?.originalLender?.name ?? null : null,
    mortgageServicer: fc.loan?.mortgageServicer?.name ?? null,
    trusteeName: trusteeNameFromSale(sale),

    originalLoanCents: unlocked ? fc.loan?.originalPrincipalAmountCents ?? null : null,
    recordingDate: fc.loan?.recordingDate ? fc.loan.recordingDate.toISOString() : null,
    instrumentNumber: fc.loan?.instrumentNumber ?? null,
    legalDescription: fc.legalDescriptions[0]?.rawText ?? property?.legalDescription ?? null,

    countyMarketValueCents,
    countyAppraisedValueCents,
    landValueCents: latestAppraisal?.landValueCents ?? null,
    improvementValueCents: latestAppraisal?.improvementValueCents ?? null,
    appraisalYear: latestAppraisal?.taxYear ?? null,
    appraisalLastRetrievedISO: latestAppraisal?.retrievedAt ? latestAppraisal.retrievedAt.toISOString() : null,

    estimatedEquityCents,
    equitySourceLabel,
    equityBaseCents,
    equityLoanBalanceCents: loanBalanceCents,

    dataState: toInvestorDataState(publication.investorLabel),

    unlocked,
    hasSourceDocument: fc.documents.length > 0,

    createdAtISO: fc.createdAt.toISOString(),
  };
}
