import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";

/**
 * Placeholder for a licensed third-party AVM vendor (not Zillow — see
 * zillow.ts for that integration specifically). No vendor is contracted
 * yet, so this always returns null. Wire a real client into
 * getValuation() only after a commercial agreement and display/storage
 * license terms exist; gate it behind THIRD_PARTY_AVM_ENABLED the same
 * way zillow.ts gates ZILLOW_API_ENABLED.
 */
export class LicensedThirdPartyAvmProvider implements PropertyValuationProvider {
  providerKey = "third_party_avm";
  displayName = "Licensed AVM (not yet configured)";

  supportsAddressLookup = true;
  supportsParcelLookup = false;
  supportsCommercialUse = false;
  supportsRedistribution = false;

  async getValuation(_input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    if ((process.env.THIRD_PARTY_AVM_ENABLED ?? "false").toLowerCase() !== "true") return null;
    // No vendor integration exists yet — enabling the flag alone does not
    // activate a data source. Left unimplemented intentionally.
    return null;
  }
}
