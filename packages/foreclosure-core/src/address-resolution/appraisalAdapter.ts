import type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
} from "@foreclosuredata/types";
import { searchFullText, searchStructured, mapRowToCandidate, type RawPropertyRow } from "./hidalgoCadClient";

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
 * Live adapter against Hidalgo County's public ProdigyCAD property-search
 * API (hidalgo.prodigycad.com) — see hidalgoCadClient.ts for the endpoint
 * details, how the public access token is obtained, and why this is a
 * legitimate use of a public, unauthenticated flow (not an auth/CAPTCHA
 * bypass). The product owner manually verified ordinary property search
 * requires no login, CAPTCHA, or payment before this was implemented.
 *
 * The API has no combined-field query (e.g. "owner name AND subdivision"
 * in one request): for the two combined resolver strategies (owner+
 * subdivision, owner+acreage), the more selective field drives the one
 * live search call and the other field is applied as a client-side
 * filter on the results, so each resolver strategy still costs exactly
 * one request.
 */
export class HidalgoCountyAppraisalAdapter implements CountyAppraisalAdapter {
  countyCode = "hidalgo-tx";
  countyName = "Hidalgo";
  stateCode = "TX";
  sourceName = "Hidalgo County Appraisal District (ProdigyCAD public portal)";
  sourceUrl = "https://hidalgo.prodigycad.com/property-search";
  capabilities = {
    searchByOwnerName: true,
    searchByAddress: true,
    searchByParcelId: true,
    // No dedicated subdivision/legal-description field exists in this API
    // -- both go through the compound full-text search endpoint instead.
    searchByLegalDescription: true,
    searchBySubdivision: true,
    // No dedicated lot/block field either; supported only as a client-side
    // filter on a subdivision search's results, not as its own live query.
    searchByLotBlock: true,
    searchByMap: false,
    bulkDataAvailable: false,
    officialApiAvailable: true,
  };

  async searchProperties(query: AppraisalPropertySearchQuery): Promise<AppraisalPropertyCandidate[]> {
    if (query.parcelId) {
      return (await searchStructured("pid", query.parcelId, "=")).map(mapRowToCandidate);
    }
    if (query.geographicId) {
      return (await searchStructured("geoID", query.geographicId, "begins")).map(mapRowToCandidate);
    }

    if (query.ownerNames?.length && query.subdivision) {
      const rows = await searchFullText(subdivisionSearchTerm(query.subdivision));
      const surname = extractSurname(query.ownerNames[0]!);
      return rows.filter((r) => matchesOwnerSurname(r, surname)).map(mapRowToCandidate);
    }
    if (query.ownerNames?.length && query.acreage != null) {
      const surname = extractSurname(query.ownerNames[0]!);
      const rows = await searchStructured("name", surname, "begins");
      return rows.filter((r) => acreageCloseEnough(r, query.acreage!)).map(mapRowToCandidate);
    }

    if (query.subdivision) {
      return (await searchFullText(subdivisionSearchTerm(query.subdivision))).map(mapRowToCandidate);
    }
    if (query.legalDescription) {
      return (await searchFullText(query.legalDescription)).map(mapRowToCandidate);
    }
    if (query.ownerNames?.length) {
      const surname = extractSurname(query.ownerNames[0]!);
      return (await searchStructured("name", surname, "begins")).map(mapRowToCandidate);
    }
    if (query.streetAddress) {
      return (await searchStructured("streetPrimary", query.streetAddress, "mlike")).map(mapRowToCandidate);
    }

    return [];
  }

  async getPropertyDetails(sourcePropertyId: string): Promise<AppraisalPropertyRecord> {
    const rows = await searchStructured("pid", sourcePropertyId, "=");
    const match = rows.find((r) => String(r.pid) === sourcePropertyId) ?? rows[0];
    if (!match) throw new Error(`No Hidalgo CAD property found for pid "${sourcePropertyId}"`);
    return mapRowToCandidate(match);
  }

  async getAccessMetadata(): Promise<AppraisalSourceAccessMetadata> {
    return {
      officialApiAvailable: true,
      bulkDataAvailable: false,
      requiresManualAccess: false,
      notes:
        "Live public ProdigyCAD API (hidalgo.prodigycad.com), the same portal ordinary members of the " +
        "public use. Confirmed to require no login/CAPTCHA/payment for property search. Rate-limited: " +
        "single request in flight, HIDALGO_CAD_REQUEST_DELAY_MS between requests, and a per-notice " +
        "request budget enforced by the resolver — see resolver.ts's RequestBudget.",
    };
  }
}

/**
 * Strips a trailing generic classification word (SUBDIVISION, ADDITION,
 * ESTATES, etc.) from a subdivision name before it's used as a full-text
 * query term. Confirmed live: the full-text endpoint returns zero results
 * for "SOL BRILLA SUBDIVISION" but 20 for "SOL BRILLA" -- CAD's own legal-
 * description text apparently doesn't carry the boilerplate word, so
 * including it (as legalDescriptionParsing.ts's SUBDIVISION_RE does, by
 * design, so the raw subdivision name is never silently altered elsewhere)
 * makes the phrase match nothing. Only applied at the CAD-query boundary --
 * never changes what's stored/displayed as the subdivision name.
 */
const SUBDIVISION_SUFFIX_RE = /\s+(?:SUBDIVISION|ADDITION|ESTATES|TOWNSITE|PARK|PLACE|HEIGHTS|ACRES|MEADOWS|VILLAGE|VILLAS?|COVES?)$/i;
function subdivisionSearchTerm(subdivision: string): string {
  return subdivision.replace(SUBDIVISION_SUFFIX_RE, "").trim() || subdivision;
}

/** Last word of a name, uppercased -- ProdigyCAD's structured "name" field search uses a "begins" match, and its displayName format puts the surname first, so a surname-only query is the most reliable single term to search on. */
function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? fullName).toUpperCase();
}

function matchesOwnerSurname(row: RawPropertyRow, surnameUpper: string): boolean {
  return (row.displayName ?? "").toUpperCase().includes(surnameUpper);
}

function acreageCloseEnough(row: RawPropertyRow, targetAcreage: number): boolean {
  const rowAcreage = row.legalAcreage ?? row.effectiveSizeAcres;
  return rowAcreage != null && Math.abs(rowAcreage - targetAcreage) < 0.05;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function surname(fullNameLower: string): string {
  const parts = fullNameLower.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? fullNameLower;
}
