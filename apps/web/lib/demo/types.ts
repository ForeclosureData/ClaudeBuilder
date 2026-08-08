/**
 * Types for the investor demo (apps/web/app/demo/**). Deliberately NOT
 * imported from @foreclosuredata/database or @foreclosuredata/types --
 * this is a self-contained, purpose-built shape for fixture data so the
 * demo never depends on (or risks drifting into) real backend contracts.
 * See apps/web/lib/demo/README.md for how this fits together.
 */

export type DemoPropertyType = "SINGLE_FAMILY" | "COMMERCIAL" | "LAND" | "MULTI_FAMILY";

export type DemoDataStatus = "COUNTY_VERIFIED" | "ADDRESS_RESOLVED" | "VALUE_AVAILABLE" | "NEEDS_REVIEW";

export interface DemoForeclosureCase {
  id: string;
  /** Purely cosmetic display id, e.g. "HID-117634" -- never surfaced as the primary UI element. */
  caseNumber: string;

  /** null when the property address could not be resolved -- a genuine, shown state, not an error. */
  address: string | null;
  city: string;
  state: "TX";
  zip: string;
  /** Mock coordinates for the demo map -- not real geocoding. */
  lat: number;
  lng: number;

  saleDateISO: string;
  filedDateISO: string;

  propertyType: DemoPropertyType;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
  acreage: number | null;
  parcelId: string | null;
  geoId: string | null;

  borrowerName: string;
  ownerIsSameAsBorrower: boolean;
  lenderName: string;
  mortgageServicer: string | null;
  trusteeName: string;
  trusteePhone: string | null;

  originalLoanCents: number;
  originalLoanDateISO: string;
  recordingDate: string | null;
  instrumentNumber: string | null;
  legalDescription: string;

  /** null = "no county value on file for this case" (a real, shown scenario). */
  countyMarketValueCents: number | null;
  countyAppraisedValueCents: number | null;
  landValueCents: number | null;
  improvementValueCents: number | null;
  appraisalYear: number | null;
  appraisalLastRetrievedISO: string | null;

  /**
   * null = "cannot responsibly estimate" -- always shown as "Unavailable" in
   * the UI, never computed client-side from other fields as a fallback.
   */
  estimatedEquityCents: number | null;

  dataStatuses: DemoDataStatus[];

  /** Local path under /public/demo -- a placeholder source document, not a real notice. */
  sourceNoticeUrl: string;

  createdAtISO: string;
}

export interface DemoCountySummary {
  countyName: string;
  stateAbbr: string;
  nextAuctionISO: string;
  activeForeclosures: number;
  withPropertyAddress: number;
  withCountyValue: number;
  newThisWeek: number;
}
