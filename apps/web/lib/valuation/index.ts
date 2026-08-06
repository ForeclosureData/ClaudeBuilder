import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";
import { MockValuationProvider } from "./mock";
import { CountyAppraisalValueProvider } from "./countyAppraisal";
import { InternalComparableEstimateProvider } from "./internalEstimate";
import { LicensedThirdPartyAvmProvider } from "./thirdPartyAvm";
import { ZillowAuthorizedProvider } from "./zillow";

let cached: PropertyValuationProvider[] | null = null;

/**
 * Every valuation provider whose data is safe to query in the current
 * environment: county appraisal + internal estimate are always on
 * (public record / disclosed methodology); mock is added outside
 * production so dev/test always has something to render; third-party AVM
 * and Zillow are only included once their respective *_ENABLED flags are
 * true (both still return null internally until real credentials exist).
 * Never call a provider SDK/HTTP client outside this module.
 */
export function getValuationProviders(): PropertyValuationProvider[] {
  if (cached) return cached;

  const providers: PropertyValuationProvider[] = [new CountyAppraisalValueProvider(), new InternalComparableEstimateProvider()];

  if (process.env.NODE_ENV !== "production") {
    providers.push(new MockValuationProvider());
  }
  if ((process.env.THIRD_PARTY_AVM_ENABLED ?? "false").toLowerCase() === "true") {
    providers.push(new LicensedThirdPartyAvmProvider());
  }
  if ((process.env.ZILLOW_API_ENABLED ?? "false").toLowerCase() === "true") {
    providers.push(new ZillowAuthorizedProvider());
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
