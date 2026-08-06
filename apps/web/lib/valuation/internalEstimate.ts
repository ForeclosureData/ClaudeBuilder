import { prisma } from "@foreclosuredata/database";
import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";

export const INTERNAL_ESTIMATE_DISCLAIMER =
  "This is a rough internal estimate derived from the county appraisal record, not a market " +
  "valuation, comparable-sales analysis, or Zillow Zestimate. It should not be relied on for " +
  "pricing or lending decisions.";

// Texas county appraisal districts generally target market value, but
// assessed/appraised figures used for tax purposes commonly lag actual
// market price. This is a single, disclosed, conservative adjustment
// factor — not a comparable-sales model — kept intentionally simple so
// its limitations are obvious rather than hidden behind false precision.
const MARKET_ADJUSTMENT_FACTOR = 1.08;

/**
 * ForeclosureData's own transparent, disclosed estimate — reuses the
 * same "estimate, not a fact, always disclosed" pattern as
 * estimateRemainingBalance(). Must never be labeled a Zestimate or any
 * third-party AVM name.
 */
export class InternalComparableEstimateProvider implements PropertyValuationProvider {
  providerKey = "internal_estimate";
  displayName = "ForeclosureData estimate";

  supportsAddressLookup = true;
  supportsParcelLookup = true;
  supportsCommercialUse = true;
  supportsRedistribution = true;

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    const property = await prisma.property.findUnique({ where: { id: input.propertyId } });
    const appraisedValueCents = property?.appraisedValueCents;
    if (!appraisedValueCents) return null;

    const estimatedCents = Math.round(appraisedValueCents * MARKET_ADJUSTMENT_FACTOR);

    return {
      providerKey: this.providerKey,
      valuationType: "internal_estimate",
      value: estimatedCents / 100,
      currency: "USD",
      lowRange: Math.round((estimatedCents * 0.92) / 100),
      highRange: Math.round((estimatedCents * 1.15) / 100),
      confidence: 0.35,
      retrievedAt: new Date().toISOString(),
      methodology: `internal_estimate_v1 — county appraised value × ${MARKET_ADJUSTMENT_FACTOR}. ${INTERNAL_ESTIMATE_DISCLAIMER}`,
      licenseAllowsDisplay: true,
      licenseAllowsStorage: true,
    };
  }
}
