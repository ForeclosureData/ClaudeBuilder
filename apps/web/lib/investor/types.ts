/**
 * Flat, display-ready shape for the investor-facing UI (browse cards, map,
 * detail page). Adapted from the fixture-only demo's DemoForeclosureCase
 * shape (apps/web/lib/demo/types.ts) so the ported demo components need
 * minimal changes -- but every value here is computed from real,
 * publication-gated production data (see lib/investor/adapter.ts), never a
 * fixture. Locked fields (gated by county entitlement) are represented as
 * `null` with `locked: true` rather than omitted, so a card can render a
 * consistent "Upgrade to view" treatment without a separate prop.
 */

export type InvestorPropertyType = "SINGLE_FAMILY" | "MULTI_FAMILY" | "CONDO" | "TOWNHOUSE" | "MOBILE_HOME" | "VACANT_LAND" | "COMMERCIAL" | "OTHER" | "UNKNOWN";

/** The simple, non-technical publication state shown to investors -- sourced directly from computePublicationStatus()'s own investorLabel, never a raw confidence number or internal review-reason code. */
export type InvestorDataState = "Verified property" | "Source address" | "Limited data" | "Limited data — address pending" | "Pending verification" | "Unavailable";

export interface InvestorListing {
  /** Property.id -- the route param for /properties/[id]. */
  id: string;
  caseNumber: string | null;

  address: string | null;
  addressPending: boolean;
  city: string | null;
  state: string;
  zip: string | null;
  lat: number | null;
  lng: number | null;

  saleDateISO: string | null;
  filedDateISO: string;

  propertyType: InvestorPropertyType;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  parcelId: string | null;
  geoId: string | null;

  /** Never the raw "Unknown owner" placeholder -- already passed through formatBorrowerName(). */
  borrowerName: string;
  /** null when the county entitlement locks this field for the current viewer. */
  lenderName: string | null;
  mortgageServicer: string | null;
  trusteeName: string | null;

  /** null when the county entitlement locks this field, or the notice never stated a principal. */
  originalLoanCents: number | null;
  recordingDate: string | null;
  instrumentNumber: string | null;
  legalDescription: string | null;

  countyMarketValueCents: number | null;
  countyAppraisedValueCents: number | null;
  landValueCents: number | null;
  improvementValueCents: number | null;
  appraisalYear: number | null;
  appraisalLastRetrievedISO: string | null;

  estimatedEquityCents: number | null;
  equitySourceLabel: string | null;
  equityBaseCents: number | null;
  equityLoanBalanceCents: number | null;

  dataState: InvestorDataState;

  /** True only when the viewer's entitlement grants full access to this county -- drives "Upgrade to view" treatment for locked fields. */
  unlocked: boolean;
  /** True once a document (source notice) exists for this case, regardless of unlock status -- used to decide whether to show a "View original notice" link at all. */
  hasSourceDocument: boolean;

  createdAtISO: string;
}

export interface InvestorCountySummary {
  countyName: string;
  countySlug: string;
  stateAbbr: string;
  nextAuctionISO: string | null;
  /** The number of investor-visible listings -- never the raw source-notice count. See docs/DEPLOYMENT.md's metrics glossary. */
  visibleOpportunities: number;
  withPropertyAddress: number;
  withCountyValue: number;
  newThisWeek: number;
  /** Internal-only context for the final report / admin views -- never rendered as the primary public count. */
  sourceNoticesProcessed: number;
}
