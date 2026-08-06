import { prisma } from "@foreclosuredata/database";
import type { PropertyValuationProvider, PropertyValuationLookupInput, PropertyValuationResult } from "@foreclosuredata/types";

/**
 * Reads values already resolved onto Property / AppraisalValueHistory by
 * the address-resolution pipeline — this provider never makes a new
 * outbound request itself. County tax-roll appraisal figures are public
 * record, so display/storage are both allowed once we hold the data.
 */
export class CountyAppraisalValueProvider implements PropertyValuationProvider {
  providerKey = "county_appraisal";
  displayName = "County appraisal district";

  supportsAddressLookup = true;
  supportsParcelLookup = true;
  supportsCommercialUse = true;
  supportsRedistribution = true;

  async getValuation(input: PropertyValuationLookupInput): Promise<PropertyValuationResult | null> {
    const property = await prisma.property.findUnique({
      where: { id: input.propertyId },
      include: { appraisalValueHistory: { orderBy: { taxYear: "desc" }, take: 1 } },
    });
    if (!property) return null;

    const latestHistory = property.appraisalValueHistory[0];
    const appraisedValueCents = latestHistory?.appraisedValueCents ?? property.appraisedValueCents;
    if (appraisedValueCents === null || appraisedValueCents === undefined) return null;

    return {
      providerKey: this.providerKey,
      providerPropertyId: property.propertyIdNumber ?? property.geographicId ?? undefined,
      valuationType: latestHistory ? "county_appraised_value" : "county_appraised_value",
      value: appraisedValueCents / 100,
      currency: "USD",
      confidence: 0.85,
      effectiveDate: latestHistory ? `${latestHistory.taxYear}-01-01` : undefined,
      retrievedAt: (latestHistory?.retrievedAt ?? property.updatedAt).toISOString(),
      sourceUrl: latestHistory?.sourceUrl ?? undefined,
      attributionText: "Source: county appraisal district public tax-roll record.",
      methodology: "county_tax_roll_record — the appraisal district's own assessed value, not a market estimate.",
      licenseAllowsDisplay: true,
      licenseAllowsStorage: true,
    };
  }
}
