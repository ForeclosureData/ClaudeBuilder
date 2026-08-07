import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";

/**
 * Zillow integration — must only ever call an authorized API endpoint
 * (ZILLOW_API_BASE_URL, e.g. a partner/licensed data feed), never
 * zillow.com directly, and must never be enabled without real
 * credentials and a commercial display agreement. "Zestimate" wording is
 * only ever correct for a value that actually came from this provider
 * while enabled — see PropertyValuationProvider doc comment in
 * packages/types.
 *
 * While ZILLOW_API_ENABLED is unset or "false" (the default),
 * getValuation() returns null immediately — no HTTP call is reachable,
 * by construction, from this code path.
 *
 * Not part of the MVP: this class is not registered by
 * apps/web/lib/valuation/index.ts's getValuationProviders(). The MVP
 * valuation strategy uses county appraisal records only — Zillow stays
 * out of the active provider list (not just disabled by env flag) until a
 * product decision to re-add it, on top of real API access.
 */
export class ZillowAuthorizedProvider implements PropertyValuationProvider {
  providerKey = "zillow";
  displayName = "Zillow";

  supportsAddressLookup = true;
  supportsParcelLookup = false;
  supportsCommercialUse = false;
  supportsRedistribution = false;

  private isEnabled(): boolean {
    return (process.env.ZILLOW_API_ENABLED ?? "false").toLowerCase() === "true";
  }

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    if (!this.isEnabled()) return null;

    const baseUrl = process.env.ZILLOW_API_BASE_URL;
    const apiKey = process.env.ZILLOW_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("ZILLOW_API_ENABLED is true but ZILLOW_API_BASE_URL / ZILLOW_API_KEY are not configured.");
    }

    return this.fetchFromAuthorizedApi(baseUrl, apiKey, input);
  }

  // Only reachable once isEnabled() and the config check above have both
  // passed — kept as a separate method so the "never call zillow.com
  // directly" constraint is easy to audit at a glance.
  private async fetchFromAuthorizedApi(
    baseUrl: string,
    apiKey: string,
    input: PropertyValuationLookupInput,
  ): Promise<PropertyValuationResult | null> {
    const partnerId = process.env.ZILLOW_PARTNER_ID;
    const attributionText = process.env.ZILLOW_ATTRIBUTION_TEXT ?? "Zestimate® home valuation provided by Zillow.";
    const retentionDays = Number(process.env.ZILLOW_DATA_RETENTION_DAYS ?? "30");

    const response = await fetch(new URL("/valuations", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(partnerId ? { "X-Partner-Id": partnerId } : {}),
      },
      body: JSON.stringify({
        streetAddress: input.streetAddress,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
      }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      zestimate?: number;
      zestimateLow?: number;
      zestimateHigh?: number;
      zpid?: string;
      lastUpdated?: string;
      sourceUrl?: string;
    };
    if (data.zestimate === undefined) return null;

    return {
      providerKey: this.providerKey,
      providerPropertyId: data.zpid,
      valuationType: "zestimate",
      value: data.zestimate,
      currency: "USD",
      lowRange: data.zestimateLow,
      highRange: data.zestimateHigh,
      effectiveDate: data.lastUpdated,
      retrievedAt: new Date().toISOString(),
      sourceUrl: data.sourceUrl,
      attributionText,
      methodology: "zillow_zestimate — Zillow's proprietary automated valuation model.",
      licenseAllowsDisplay: true,
      licenseAllowsStorage: true,
      expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}
