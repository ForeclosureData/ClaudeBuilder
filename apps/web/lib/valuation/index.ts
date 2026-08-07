import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";
import { MockValuationProvider } from "./mock";
import { CountyMarketValueProvider, CountyAppraisedValueProvider } from "./countyAppraisal";

let cached: PropertyValuationProvider[] | null = null;

/**
 * MVP valuation strategy: the county appraisal district (public tax-roll
 * record) is the only active property-value source. Zillow (zillow.ts), a
 * licensed third-party AVM (thirdPartyAvm.ts), and ForeclosureData's own
 * internal comparable estimate (internalEstimate.ts) all have working
 * provider implementations but are deliberately NOT registered here —
 * none of them may block the Hidalgo pilot, and none may be fabricated to
 * fill a gap when the county has no value. Re-add them to this list only
 * once there's a real product decision plus (for Zillow/AVM) authorized
 * credentials and commercial display rights.
 */
export function getValuationProviders(): PropertyValuationProvider[] {
  if (cached) return cached;

  const providers: PropertyValuationProvider[] = [new CountyMarketValueProvider(), new CountyAppraisedValueProvider()];

  if (process.env.NODE_ENV !== "production") {
    providers.push(new MockValuationProvider());
  }

  cached = providers;
  return cached;
}

/** Queries every configured provider in parallel and returns only the results that actually resolved. */
export async function getAllValuations(input: PropertyValuationLookupInput): Promise<PropertyValuationResult[]> {
  const results = await Promise.all(
    getValuationProviders().map(async (provider) => {
      try {
        return await provider.getValuation(input);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is PropertyValuationResult => r !== null);
}
