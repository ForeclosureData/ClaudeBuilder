import type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
  AppraisalRequestBudget,
  AppraisalValueYear,
} from "@foreclosuredata/types";
import { searchFullText, searchStructured, mapRowToCandidate, getValuationHistory, type RawPropertyRow } from "./hidalgoCadClient";
import { parseLegalDescriptionTokens, normalizeToken, sanitizeCadSearchText } from "./legalDescriptionParsing";

export type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
  AppraisalValueYear,
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
 * in one request): for the combined resolver strategies (owner+
 * subdivision, owner+acreage), the more selective field drives the live
 * search call(s) and the other field is applied as a client-side filter
 * on the results.
 *
 * Search priority within one query object (confirmed live, see the
 * "Priority 1-3" doc comments below for what changed and why):
 *   1. Parcel ID / GEO ID -- literal identifiers, strongest when present.
 *   2. Street address -- confirmed live to be highly selective (usually
 *      0 or 1 result), so an already-resolved case's enrichment lookup
 *      tries this before any broader subdivision/owner sweep.
 *   3. Subdivision (+ lot/block when known) -- paginated, stops early
 *      once the exact lot appears (see hidalgoCadClient's isGoodEnough).
 *   4. Legal description full text.
 *   5. Owner name -- tries the complete stated name as one full-text
 *      query first (confirmed live: an AND-of-tokens match, so a full
 *      "First Surname1 Surname2" query is dramatically more selective
 *      than a single-surname structured search -- e.g. a bare surname
 *      structured search returned 40 unrelated results where the full
 *      name returned exactly 1). Only falls back to the broad single-
 *      surname structured search, capped to one page, if that precise
 *      attempt finds nothing -- this is the deliberate "last resort."
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

  async searchProperties(query: AppraisalPropertySearchQuery, budget?: AppraisalRequestBudget): Promise<AppraisalPropertyCandidate[]> {
    if (query.parcelId) {
      return (await searchStructured("pid", query.parcelId, "=", { budget, maxPages: 1 })).map(mapRowToCandidate);
    }
    if (query.geographicId) {
      return (await searchStructured("geoID", query.geographicId, "begins", { budget })).map(mapRowToCandidate);
    }

    // Priority 3: verify/enrich an already-resolved case against its exact
    // notice-stated address before trying anything broader.
    if (query.streetAddress) {
      const term = extractStreetSearchTerm(query.streetAddress);
      return (await searchStructured("streetPrimary", term, "mlike", { budget })).map(mapRowToCandidate);
    }

    if (query.ownerNames?.length && query.subdivision) {
      const term = subdivisionSearchTerm(query.subdivision);
      const isGoodEnough = query.lot ? goodEnoughOnLot(query.lot, query.block) : undefined;
      const rows = await searchFullText(term, { budget, isGoodEnough });
      const surname = extractSurname(query.ownerNames[0]!);
      return rows.filter((r) => matchesOwnerSurname(r, surname)).map(mapRowToCandidate);
    }
    if (query.ownerNames?.length && query.acreage != null) {
      const surname = extractSurname(query.ownerNames[0]!);
      const rows = await searchStructured("name", surname, "begins", { budget, maxPages: 1 });
      return rows.filter((r) => acreageCloseEnough(r, query.acreage!)).map(mapRowToCandidate);
    }

    // Priority 1 + Priority 4: paginated subdivision search, narrowed to
    // the exact lot (+block) when the notice gives one and the CAD
    // returns it -- otherwise the full subdivision set is returned
    // unfiltered so scoring.ts can still see (and flag) a conflicting lot.
    if (query.subdivision) {
      const term = subdivisionSearchTerm(query.subdivision);
      const isGoodEnough = query.lot ? goodEnoughOnLot(query.lot, query.block) : undefined;
      const rows = await searchFullText(term, { budget, isGoodEnough });
      if (query.lot) {
        const narrowed = rows.filter((r) => rowMatchesLotBlock(r, query.lot!, query.block));
        if (narrowed.length > 0) return narrowed.map(mapRowToCandidate);
      }
      return rows.map(mapRowToCandidate);
    }
    if (query.legalDescription) {
      // The raw legal-description text as transcribed can carry
      // meta-commentary ("(subdivision name obscured by handwriting...)")
      // and punctuation (parens, slashes) the full-text endpoint rejects
      // with an HTTP 400 -- sanitize for search purposes only, never for
      // storage/display (see sanitizeCadSearchText's doc comment). A case
      // with nothing search-worthy left after sanitizing is correctly
      // treated as having no legal-description evidence to search on.
      const sanitized = sanitizeCadSearchText(query.legalDescription);
      if (!sanitized) return [];
      return (await searchFullText(sanitized, { budget })).map(mapRowToCandidate);
    }
    if (query.ownerNames?.length) {
      // Precise attempt first: the complete stated name as one full-text
      // query (see the class doc comment -- an AND-of-tokens match, far
      // more selective than a bare surname). Only if that finds nothing
      // does this fall back to the broad, single-page surname sweep.
      const fullNameTerm = query.ownerNames[0]!.trim();
      const preciseRows = fullNameTerm ? await searchFullText(fullNameTerm, { budget, maxPages: 1 }) : [];
      if (preciseRows.length > 0) {
        return preciseRows.map(mapRowToCandidate);
      }
      const surname = extractSurname(query.ownerNames[0]!);
      return (await searchStructured("name", surname, "begins", { budget, maxPages: 1 })).map(mapRowToCandidate);
    }

    return [];
  }

  async getPropertyDetails(sourcePropertyId: string): Promise<AppraisalPropertyRecord> {
    const rows = await searchStructured("pid", sourcePropertyId, "=", { maxPages: 1 });
    const match = rows.find((r) => String(r.pid) === sourcePropertyId) ?? rows[0];
    if (!match) throw new Error(`No Hidalgo CAD property found for pid "${sourcePropertyId}"`);
    return mapRowToCandidate(match);
  }

  /**
   * Valuation-only lookup for an already-identified property -- never
   * re-resolves or re-selects the property itself. Confirmed live: the
   * CAD's "current" appraisal year (per /public/config/currentyear) is
   * often the *working* year for the next appraisal cycle, not yet
   * certified -- every value field comes back "N/A" and the row's own
   * `valueReady` flag is 0 (this is exactly the signal the public
   * portal's own client code checks: `marketValue: e.valueReady ?
   * e.marketValue : "N/A"`). The prior year(s) are typically certified
   * (`valueReady: 1`) with real populated values. See
   * hidalgoCadClient.ts's getValuationHistory for the year-walkback.
   */
  async getValuationHistory(sourcePropertyId: string, options?: { maxYearsBack?: number; budget?: AppraisalRequestBudget }): Promise<AppraisalValueYear[]> {
    return getValuationHistory(sourcePropertyId, options);
  }

  async getAccessMetadata(): Promise<AppraisalSourceAccessMetadata> {
    return {
      officialApiAvailable: true,
      bulkDataAvailable: false,
      requiresManualAccess: false,
      notes:
        "Live public ProdigyCAD API (hidalgo.prodigycad.com), the same portal ordinary members of the " +
        "public use. Confirmed to require no login/CAPTCHA/payment for property search. Rate-limited: " +
        "single request in flight, HIDALGO_CAD_REQUEST_DELAY_MS between requests, controlled pagination " +
        "(HIDALGO_CAD_MAX_PAGES_PER_SEARCH/HIDALGO_CAD_PAGE_SIZE), and a per-notice request budget " +
        "(HIDALGO_CAD_MAX_REQUESTS_PER_NOTICE) enforced by the resolver — see resolver.ts's RequestBudget.",
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

/**
 * Cuts a full notice-stated address down to just its street portion (house
 * number + street name) before using it as a streetPrimary query, and
 * strips a leading directional prefix off the house number.
 *
 * Cuts right after the *last* recognized street-suffix word (AVE, DR, ST,
 * etc.) rather than trying to strip a "city, state zip" tail -- a first
 * attempt at the latter (matching city/state/zip directly) was confirmed
 * live to badly over-strip: with only one comma before the state (a
 * common real format, e.g. "700 W La Quinta Dr Pharr, Texas 78577") or no
 * comma at all ("1416 W McKinley Ave Alton. Texas 78573"), a plain
 * "[A-Za-z ]* Texas zip" pattern happily consumes the *entire* street
 * name too (nothing in the regex stops it at the city boundary), leaving
 * just the house number and turning a precise 1-result query into a
 * near-useless 100+-result one. Cutting after the last street-suffix word
 * doesn't have that failure mode, since a suffix word essentially never
 * appears elsewhere in a Texas street address.
 *
 * The directional-prefix strip is separate: CAD's streetPrimary field is
 * inconsistent about carrying it (e.g. "1416 MCKINLEY AVE" with no "W",
 * even though the notice and even other records in the same subdivision
 * do include it) -- keeping "W" in the query returned zero results where
 * dropping it returned the exact single match every time it was tried.
 */
const STREET_SUFFIX_RE = /\b(?:ST|AVE|AV|DR|RD|LN|BLVD|CIR|CT|WAY|PL|TRL|LOOP|PKWY|HWY|EXPY|FWY)\b\.?/gi;
const CITY_STATE_ZIP_SUFFIX_RE = /,?\s*[A-Za-z][A-Za-z .'\-]*[.,]?\s+(?:Texas|TX)\s+\d{5}\s*$/i;
const DIRECTIONAL_PREFIX_RE = /^(\d+)\s+(?:N|S|E|W|NE|NW|SE|SW)\.?\s+(.+)$/i;
export function extractStreetSearchTerm(fullAddress: string): string {
  const suffixMatches = [...fullAddress.matchAll(STREET_SUFFIX_RE)];
  const lastSuffix = suffixMatches[suffixMatches.length - 1];
  const streetOnly =
    lastSuffix && lastSuffix.index !== undefined
      ? fullAddress.slice(0, lastSuffix.index + lastSuffix[0].length).trim()
      : fullAddress.replace(CITY_STATE_ZIP_SUFFIX_RE, "").trim().replace(/,$/, "");
  const directional = streetOnly.match(DIRECTIONAL_PREFIX_RE);
  return directional ? `${directional[1]} ${directional[2]}` : streetOnly;
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
  const rowAcreage = Number(row.legalAcreage ?? row.effectiveSizeAcres);
  return Number.isFinite(rowAcreage) && Math.abs(rowAcreage - targetAcreage) < 0.05;
}

/** A row's lot/block, falling back to parsing them out of its legalDescription text when the API's own dedicated lot/block fields are null (observed live: sometimes populated, sometimes not, for the same subdivision). */
function rowLotBlock(row: RawPropertyRow): { lot: string | null; block: string | null } {
  if (row.lot || row.block) return { lot: row.lot, block: row.block };
  const tokens = row.legalDescription ? parseLegalDescriptionTokens(row.legalDescription) : null;
  return { lot: tokens?.lot ?? null, block: tokens?.block ?? null };
}

function rowMatchesLotBlock(row: RawPropertyRow, lot: string, block?: string): boolean {
  const { lot: rowLot, block: rowBlock } = rowLotBlock(row);
  if (!rowLot || normalizeToken(rowLot) !== normalizeToken(lot)) return false;
  if (block && rowBlock && normalizeToken(rowBlock) !== normalizeToken(block)) return false;
  return true;
}

/** Pagination early-stop: once the accumulated rows already contain the exact lot (+block, if known), fetching further pages of the same subdivision search buys nothing -- pure recall/cost optimization, never changes which candidates are returned. */
function goodEnoughOnLot(lot: string, block?: string) {
  return (rows: RawPropertyRow[]) => rows.some((r) => rowMatchesLotBlock(r, lot, block));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function surname(fullNameLower: string): string {
  const parts = fullNameLower.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? fullNameLower;
}

/**
 * Picks which year's values a property page should display: the most
 * recent year with `populated: true`, regardless of how many unpopulated
 * (e.g. not-yet-certified current-year) entries getValuationHistory also
 * returned. Returns null if nothing in the history is populated -- the
 * caller should show "not yet available" rather than a zeroed-out or
 * missing year, never invent a number.
 */
export function selectDisplayValuation(years: AppraisalValueYear[]): AppraisalValueYear | null {
  const populated = years.filter((y) => y.populated);
  if (populated.length === 0) return null;
  return populated.reduce((latest, y) => (y.taxYear > latest.taxYear ? y : latest));
}
