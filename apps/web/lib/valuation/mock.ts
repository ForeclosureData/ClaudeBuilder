import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";

/**
 * Deterministic, no-network provider used whenever no real valuation
 * source is configured (default in dev/test). Clearly labeled as an
 * internal estimate — never presented as county or Zillow data.
 */
export class MockValuationProvider implements PropertyValuationProvider {
  providerKey = "mock";
  displayName = "Sample estimate (mock provider)";

  supportsAddressLookup = true;
  supportsParcelLookup = true;
  supportsCommercialUse = true;
  supportsRedistribution = true;

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    if (!input.streetAddress && !input.parcelId) return null;
    const base = 150_000 + (hashSeed(input.propertyId) % 250_000);
    return {
      providerKey: this.providerKey,
      providerPropertyId: input.parcelId ?? input.propertyId,
      valuationType: "internal_estimate",
      value: base,
      currency: "USD",
      lowRange: Math.round(base * 0.9),
      highRange: Math.round(base * 1.1),
      confidence: 0.3,
      retrievedAt: new Date().toISOString(),
      methodology: "mock_fixture_v1 — placeholder value for local development, not derived from any real data source.",
      licenseAllowsDisplay: true,
      licenseAllowsStorage: true,
    };
  }
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
