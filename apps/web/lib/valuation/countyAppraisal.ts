import { prisma } from "@foreclosuredata/database";
import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult, ValuationType } from "@foreclosuredata/types";

/**
 * Reads values already resolved onto Property / AppraisalValueHistory by
 * the address-resolution pipeline — this provider never makes a new
 * outbound request itself. County tax-roll appraisal figures are public
 * record, so display/storage are both allowed once we hold the data.
 *
 * Split into two providers (market vs. appraised) rather than one that
 * picks a single number: the MVP requirement is to show whichever fields
 * the county record actually names, under their own labels, side by side
 * when both exist — never blended or relabeled into a single "value".
 */
async function loadLatestAppraisal(propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { county: true, appraisalValueHistory: { orderBy: { taxYear: "desc" }, take: 1 } },
  });
  if (!property) return null;
  return { property, latest: property.appraisalValueHistory[0] ?? null };
}

function baseResult(
  providerKey: string,
  valuationType: ValuationType,
  valueCents: number,
  property: NonNullable<Awaited<ReturnType<typeof loadLatestAppraisal>>>["property"],
  latest: NonNullable<Awaited<ReturnType<typeof loadLatestAppraisal>>>["latest"],
): PropertyValuationResult {
  return {
    providerKey,
    providerPropertyId: property.propertyIdNumber ?? property.geographicId ?? undefined,
    valuationType,
    value: valueCents / 100,
    currency: "USD",
    confidence: 0.85,
    effectiveDate: latest ? `${latest.taxYear}-01-01` : undefined,
    retrievedAt: (latest?.retrievedAt ?? property.updatedAt).toISOString(),
    sourceUrl: latest?.sourceUrl ?? undefined,
    attributionText: `${property.county.name} County Appraisal District`,
    methodology: "county_tax_roll_record — the appraisal district's own record for property-tax purposes, not a market estimate.",
    licenseAllowsDisplay: true,
    licenseAllowsStorage: true,
  };
}

export class CountyMarketValueProvider implements PropertyValuationProvider {
  providerKey = "county_appraisal_market";
  displayName = "County market value";

  supportsAddressLookup = true;
  supportsParcelLookup = true;
  supportsCommercialUse = true;
  supportsRedistribution = true;

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    const loaded = await loadLatestAppraisal(input.propertyId);
    if (!loaded) return null;
    const marketValueCents = loaded.latest?.marketValueCents ?? loaded.property.estimatedMarketValueCents;
    if (marketValueCents === null || marketValueCents === undefined) return null;
    return baseResult(this.providerKey, "county_market_value", marketValueCents, loaded.property, loaded.latest);
  }
}

export class CountyAppraisedValueProvider implements PropertyValuationProvider {
  providerKey = "county_appraisal_appraised";
  displayName = "County appraised value";

  supportsAddressLookup = true;
  supportsParcelLookup = true;
  supportsCommercialUse = true;
  supportsRedistribution = true;

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    const loaded = await loadLatestAppraisal(input.propertyId);
    if (!loaded) return null;
    const appraisedValueCents = loaded.latest?.appraisedValueCents ?? loaded.property.appraisedValueCents;
    if (appraisedValueCents === null || appraisedValueCents === undefined) return null;
    return baseResult(this.providerKey, "county_appraised_value", appraisedValueCents, loaded.property, loaded.latest);
  }
}
