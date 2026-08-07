import { MockCountyAppraisalAdapter, HidalgoCountyAppraisalAdapter } from "@foreclosuredata/foreclosure-core";
import type { CountyAppraisalAdapter } from "@foreclosuredata/types";

const cache = new Map<string, CountyAppraisalAdapter>();

/**
 * One adapter per county, gated the same way BILLING_PROVIDER gates
 * billing: real counties only get a live adapter once one is documented
 * and implemented. Every county without one falls back to an
 * empty-fixture mock (zero candidates, never fabricated data) so
 * resolution honestly falls through to manual review instead of crashing
 * or guessing.
 */
export function getCountyAppraisalAdapter(countySlug: string): CountyAppraisalAdapter {
  const key = countySlug.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  // County.slug in the database is "hidalgo-tx" (see seed.ts), not "hidalgo".
  const adapter: CountyAppraisalAdapter = key === "hidalgo-tx" ? new HidalgoCountyAppraisalAdapter() : new MockCountyAppraisalAdapter([]);
  cache.set(key, adapter);
  return adapter;
}
