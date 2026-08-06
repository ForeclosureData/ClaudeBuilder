import type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
} from "@foreclosuredata/types";

export type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
};

/**
 * Fixture-backed mock adapter for local dev/tests. All capabilities on —
 * this is what exercises the full resolver/scoring pipeline without any
 * real network access or access-terms question to answer.
 */
export class MockCountyAppraisalAdapter implements CountyAppraisalAdapter {
  countyCode = "mock-tx";
  countyName = "Mock County";
  stateCode = "TX";
  sourceName = "Fixture data (local dev/tests only)";
  sourceUrl = "https://example-fixture.local/appraisal-district";
  capabilities = {
    searchByOwnerName: true,
    searchByAddress: true,
    searchByParcelId: true,
    searchByLegalDescription: true,
    searchBySubdivision: true,
    searchByLotBlock: true,
    searchByMap: false,
    bulkDataAvailable: false,
    officialApiAvailable: false,
  };

  constructor(private readonly records: AppraisalPropertyCandidate[]) {}

  async searchProperties(query: AppraisalPropertySearchQuery): Promise<AppraisalPropertyCandidate[]> {
    return this.records.filter((r) => {
      if (query.parcelId && r.parcelId !== query.parcelId) return false;
      if (query.geographicId && r.geographicId !== query.geographicId) return false;
      if (query.subdivision && normalize(r.subdivision) !== normalize(query.subdivision)) return false;
      if (query.lot && normalize(r.lot) !== normalize(query.lot)) return false;
      if (query.block && normalize(r.block) !== normalize(query.block)) return false;
      if (query.streetAddress && !normalize(r.situsAddress).includes(normalize(query.streetAddress))) return false;
      if (query.ownerNames?.length) {
        const target = normalize(r.ownerName);
        const anyMatch = query.ownerNames.some((n) => target.includes(surname(normalize(n))));
        if (!anyMatch) return false;
      }
      return true;
    });
  }

  async getPropertyDetails(sourcePropertyId: string): Promise<AppraisalPropertyRecord> {
    const found = this.records.find((r) => r.sourcePropertyId === sourcePropertyId);
    if (!found) throw new Error(`No fixture record for sourcePropertyId "${sourcePropertyId}"`);
    return found;
  }

  async getAccessMetadata(): Promise<AppraisalSourceAccessMetadata> {
    return {
      officialApiAvailable: false,
      bulkDataAvailable: false,
      requiresManualAccess: false,
      notes: "Fixture data for local development and automated tests — not a real data source.",
    };
  }
}

/**
 * Intentional stub. Hidalgo County Appraisal District's actual access
 * method (official API, approved bulk-data export, licensed vendor feed,
 * or something requiring a public-information request) has not been
 * documented yet — see docs/ARCHITECTURE.md §14. Earlier in this
 * project's history, an ad-hoc script queried a private third-party
 * aggregator site (hidalgocad.org / TaxNetUSA) without reviewing its
 * terms of use; that output was discarded and nothing from it is used
 * here. Until a compliant method is documented and implemented, every
 * method on this adapter refuses to run rather than silently returning
 * nothing or guessing — resolution for Hidalgo falls through to manual
 * review (see the admin property-resolution screen).
 */
export class HidalgoCountyAppraisalAdapter implements CountyAppraisalAdapter {
  countyCode = "hidalgo-tx";
  countyName = "Hidalgo";
  stateCode = "TX";
  sourceName = "Hidalgo County Appraisal District (access method not yet documented)";
  sourceUrl = "https://www.hidalgoad.org/";
  capabilities = {
    searchByOwnerName: false,
    searchByAddress: false,
    searchByParcelId: false,
    searchByLegalDescription: false,
    searchBySubdivision: false,
    searchByLotBlock: false,
    searchByMap: false,
    bulkDataAvailable: false,
    officialApiAvailable: false,
  };

  async searchProperties(_query: AppraisalPropertySearchQuery): Promise<AppraisalPropertyCandidate[]> {
    throw new Error(
      "HidalgoCountyAppraisalAdapter is not yet authorized to search live data. " +
        "See docs/ARCHITECTURE.md §14 — Hidalgo's compliant appraisal-district access method " +
        "(official API / approved bulk-data feed / licensed vendor feed / public-information-request " +
        "import) has not been documented. Route this case to manual review instead.",
    );
  }

  async getPropertyDetails(_sourcePropertyId: string): Promise<AppraisalPropertyRecord> {
    throw new Error("HidalgoCountyAppraisalAdapter is not yet authorized to fetch live property details — see searchProperties().");
  }

  async getAccessMetadata(): Promise<AppraisalSourceAccessMetadata> {
    return {
      officialApiAvailable: false,
      bulkDataAvailable: false,
      requiresManualAccess: true,
      notes:
        "Access method undocumented as of this writing. Do not scrape hidalgoad.org or any private " +
        "aggregator (e.g. hidalgocad.org) automatically. Resolve addresses for Hidalgo cases via the " +
        "admin property-resolution manual-review screen until an official API, approved bulk-data file, " +
        "licensed vendor feed, or public-information-request import is set up.",
    };
  }
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function surname(fullNameLower: string): string {
  const parts = fullNameLower.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? fullNameLower;
}
