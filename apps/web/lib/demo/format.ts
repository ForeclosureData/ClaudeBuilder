import type { DemoDataStatus, DemoPropertyType } from "./types";

export const PROPERTY_TYPE_LABELS: Record<DemoPropertyType, string> = {
  SINGLE_FAMILY: "Single Family",
  COMMERCIAL: "Commercial",
  LAND: "Land",
  MULTI_FAMILY: "Multi-Family",
};

export const DATA_STATUS_LABELS: Record<DemoDataStatus, string> = {
  COUNTY_VERIFIED: "County Verified",
  ADDRESS_RESOLVED: "Address Resolved",
  VALUE_AVAILABLE: "Value Available",
  NEEDS_REVIEW: "Needs Review",
};

/** Distinct from a generic currency formatter: equity is never "Unknown", always "Unavailable" when not responsibly calculable. */
export function formatEquity(cents: number | null): string {
  if (cents === null) return "Unavailable";
  return `~$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDaysUntil(iso: string, now: number = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000));
}
