import type { InvestorListing, InvestorPropertyType } from "./types";

export type SaleDateFilter = "ANY" | "THIS_WEEK" | "THIS_MONTH" | "NEXT_60_DAYS";
export type EquityFilter = "ANY" | "UNDER_25K" | "25K_75K" | "OVER_75K" | "UNAVAILABLE";

export interface InvestorFilterState {
  query: string;
  city: string; // "" = any
  saleDate: SaleDateFilter;
  propertyType: InvestorPropertyType | "ANY";
  equity: EquityFilter;
  hasCountyValue: boolean;
  hasStreetAddress: boolean;
  newlyAdded: boolean;
}

export const DEFAULT_INVESTOR_FILTERS: InvestorFilterState = {
  query: "",
  city: "",
  saleDate: "ANY",
  propertyType: "ANY",
  equity: "ANY",
  hasCountyValue: false,
  hasStreetAddress: false,
  newlyAdded: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesQuery(l: InvestorListing, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [l.address, l.city, l.borrowerName, l.subdivision, l.caseNumber].filter(Boolean).some((field) => (field as string).toLowerCase().includes(q));
}

function matchesSaleDate(l: InvestorListing, filter: SaleDateFilter, now: number): boolean {
  if (filter === "ANY") return true;
  if (!l.saleDateISO) return false;
  const daysOut = (new Date(l.saleDateISO).getTime() - now) / DAY_MS;
  if (filter === "THIS_WEEK") return daysOut >= 0 && daysOut <= 7;
  if (filter === "THIS_MONTH") return daysOut >= 0 && daysOut <= 31;
  if (filter === "NEXT_60_DAYS") return daysOut >= 0 && daysOut <= 60;
  return true;
}

function matchesEquity(l: InvestorListing, filter: EquityFilter): boolean {
  if (filter === "ANY") return true;
  if (filter === "UNAVAILABLE") return l.estimatedEquityCents === null;
  if (l.estimatedEquityCents === null) return false;
  const dollars = l.estimatedEquityCents / 100;
  if (filter === "UNDER_25K") return dollars < 25_000;
  if (filter === "25K_75K") return dollars >= 25_000 && dollars <= 75_000;
  if (filter === "OVER_75K") return dollars > 75_000;
  return true;
}

/** Pure client-side filtering over an already publication-safe listing array -- mirrors filterDemoCases() so no new UX behavior needs inventing, but every input listing here already passed the server-side publication gate. */
export function filterInvestorListings(listings: InvestorListing[], filters: InvestorFilterState, now: number = Date.now()): InvestorListing[] {
  return listings
    .filter((l) => matchesQuery(l, filters.query))
    .filter((l) => (filters.city ? l.city === filters.city : true))
    .filter((l) => matchesSaleDate(l, filters.saleDate, now))
    .filter((l) => (filters.propertyType === "ANY" ? true : l.propertyType === filters.propertyType))
    .filter((l) => matchesEquity(l, filters.equity))
    .filter((l) => (filters.hasCountyValue ? l.countyMarketValueCents !== null || l.countyAppraisedValueCents !== null : true))
    .filter((l) => (filters.hasStreetAddress ? l.address !== null : true))
    .filter((l) => (filters.newlyAdded ? now - new Date(l.createdAtISO).getTime() <= 7 * DAY_MS : true))
    .sort((a, b) => {
      if (a.saleDateISO && b.saleDateISO) return new Date(a.saleDateISO).getTime() - new Date(b.saleDateISO).getTime();
      if (a.saleDateISO) return -1;
      if (b.saleDateISO) return 1;
      return 0;
    });
}

export function investorCityOptions(listings: InvestorListing[]): string[] {
  return [...new Set(listings.map((l) => l.city).filter((c): c is string => Boolean(c)))].sort();
}

export function countActiveInvestorFilters(filters: InvestorFilterState): number {
  let count = 0;
  if (filters.city) count++;
  if (filters.saleDate !== "ANY") count++;
  if (filters.propertyType !== "ANY") count++;
  if (filters.equity !== "ANY") count++;
  if (filters.hasCountyValue) count++;
  if (filters.hasStreetAddress) count++;
  if (filters.newlyAdded) count++;
  return count;
}
