import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrencyCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Unknown";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * The ingestion pipeline stores the literal string "Unknown owner" on
 * Person.fullName when no grantor/borrower name could be extracted from a
 * notice at all (see ingestForeclosureNotices.ts) -- a real, non-null
 * database value, not a missing one. Displaying that string as-is risks
 * reading like an actual (unusual) name rather than a missing-data
 * indicator. This normalizes both that placeholder and a genuinely null/
 * empty name to the same explicit missing-data phrasing used everywhere
 * else on investor-facing pages.
 */
export function formatBorrowerName(name: string | null | undefined): string {
  if (!name || name.trim().toLowerCase() === "unknown owner") return "Owner unavailable";
  return name;
}

/**
 * Many real trustee-notice templates simply never state an original
 * principal amount -- a genuine absence in the source document, not an
 * extraction error (see the pre-scale audit's principal-completeness
 * findings). Distinguishes that from formatCurrencyCents's generic
 * "Unknown" so investor-facing UI reads as an honest, expected data gap
 * rather than something that looks broken.
 */
export function formatOriginalPrincipal(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Original loan amount unavailable";
  return formatCurrencyCents(cents);
}

/** Investor-facing wording for a missing county market/appraised value — never a bare "Unknown" or "$0". */
export function formatCountyValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "County value unavailable";
  return formatCurrencyCents(cents);
}
