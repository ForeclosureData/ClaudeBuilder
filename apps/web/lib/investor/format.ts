import { formatCurrencyCents } from "@/lib/utils";
import type { InvestorListing, InvestorPropertyType } from "./types";

export const PROPERTY_TYPE_LABELS: Record<InvestorPropertyType, string> = {
  SINGLE_FAMILY: "Single Family",
  MULTI_FAMILY: "Multi-Family",
  CONDO: "Condo",
  TOWNHOUSE: "Townhouse",
  MOBILE_HOME: "Mobile Home",
  VACANT_LAND: "Land",
  COMMERCIAL: "Commercial",
  OTHER: "Other",
  UNKNOWN: "Property type unavailable",
};

/** Distinct from a generic currency formatter: equity is never "Unknown" or "$0", always "Estimated equity unavailable" when not responsibly calculable. */
export function formatEquity(cents: number | null): string {
  if (cents === null) return "Estimated equity unavailable";
  return `~${formatCurrencyCents(cents)}`;
}

/** Generic money display for card metrics -- callers that need the specific "X unavailable" phrasing (loan amount, county value) should use formatOriginalPrincipal/formatCountyValue from lib/utils instead. */
export function formatMoney(cents: number | null): string {
  if (cents === null) return "Not available";
  return formatCurrencyCents(cents);
}

/**
 * Sale dates are stored as a calendar date (midnight UTC, no real time-of-
 * day meaning -- see ForeclosureSale.saleDate). Formatting with the
 * viewer's local timezone would silently roll the date back a day for
 * anyone west of UTC (a Sept 1 sale would read "Aug 31" in US Central) --
 * `timeZone: "UTC"` keeps the displayed date exactly what's stored,
 * regardless of the viewer's location.
 */
export function formatShortDate(iso: string | null): string {
  if (!iso) return "Sale date unavailable";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatDaysUntil(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
}

/**
 * The single place that turns `address`/`addressPending`/`unlocked` back
 * into investor-facing copy. `address` reads null for two different
 * reasons (see lib/investor/adapter.ts) -- this is what tells them apart:
 * a real street address exists but is paywalled vs. one was never
 * resolved at all. Never returns the raw address itself when locked (the
 * adapter already nulled it before this ever runs).
 */
export function addressDisplayText(listing: Pick<InvestorListing, "address" | "addressPending" | "unlocked">): string {
  if (listing.address) return listing.address;
  if (!listing.unlocked && !listing.addressPending) return "Address available with paid plan";
  return "Address not yet available";
}
