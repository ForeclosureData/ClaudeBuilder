import type { DemoForeclosureCase, DemoPropertyType } from "./types";

export type SaleDateFilter = "ANY" | "THIS_WEEK" | "THIS_MONTH" | "NEXT_60_DAYS";
export type EquityFilter = "ANY" | "UNDER_25K" | "25K_75K" | "OVER_75K" | "UNAVAILABLE";

export interface DemoFilterState {
  query: string;
  city: string; // "" = any
  saleDate: SaleDateFilter;
  propertyType: DemoPropertyType | "ANY";
  equity: EquityFilter;
  hasCountyValue: boolean;
  newlyAdded: boolean;
}

export const DEFAULT_DEMO_FILTERS: DemoFilterState = {
  query: "",
  city: "",
  saleDate: "ANY",
  propertyType: "ANY",
  equity: "ANY",
  hasCountyValue: false,
  newlyAdded: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesQuery(c: DemoForeclosureCase, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return [c.address, c.city, c.borrowerName, c.subdivision, c.caseNumber].filter(Boolean).some((field) => (field as string).toLowerCase().includes(q));
}

function matchesSaleDate(c: DemoForeclosureCase, filter: SaleDateFilter, now: number): boolean {
  if (filter === "ANY") return true;
  const daysOut = (new Date(c.saleDateISO).getTime() - now) / DAY_MS;
  if (filter === "THIS_WEEK") return daysOut >= 0 && daysOut <= 7;
  if (filter === "THIS_MONTH") return daysOut >= 0 && daysOut <= 31;
  if (filter === "NEXT_60_DAYS") return daysOut >= 0 && daysOut <= 60;
  return true;
}

function matchesEquity(c: DemoForeclosureCase, filter: EquityFilter): boolean {
  if (filter === "ANY") return true;
  if (filter === "UNAVAILABLE") return c.estimatedEquityCents === null;
  if (c.estimatedEquityCents === null) return false;
  const dollars = c.estimatedEquityCents / 100;
  if (filter === "UNDER_25K") return dollars < 25_000;
  if (filter === "25K_75K") return dollars >= 25_000 && dollars <= 75_000;
  if (filter === "OVER_75K") return dollars > 75_000;
  return true;
}

export function filterDemoCases(cases: DemoForeclosureCase[], filters: DemoFilterState, now: number = Date.now()): DemoForeclosureCase[] {
  return cases
    .filter((c) => matchesQuery(c, filters.query))
    .filter((c) => (filters.city ? c.city === filters.city : true))
    .filter((c) => matchesSaleDate(c, filters.saleDate, now))
    .filter((c) => (filters.propertyType === "ANY" ? true : c.propertyType === filters.propertyType))
    .filter((c) => matchesEquity(c, filters.equity))
    .filter((c) => (filters.hasCountyValue ? c.countyMarketValueCents !== null : true))
    .filter((c) => (filters.newlyAdded ? now - new Date(c.createdAtISO).getTime() <= 7 * DAY_MS : true))
    .sort((a, b) => new Date(a.saleDateISO).getTime() - new Date(b.saleDateISO).getTime());
}

export function demoCityOptions(cases: DemoForeclosureCase[]): string[] {
  return [...new Set(cases.map((c) => c.city))].sort();
}

export function countActiveFilters(filters: DemoFilterState): number {
  let count = 0;
  if (filters.city) count++;
  if (filters.saleDate !== "ANY") count++;
  if (filters.propertyType !== "ANY") count++;
  if (filters.equity !== "ANY") count++;
  if (filters.hasCountyValue) count++;
  if (filters.newlyAdded) count++;
  return count;
}
