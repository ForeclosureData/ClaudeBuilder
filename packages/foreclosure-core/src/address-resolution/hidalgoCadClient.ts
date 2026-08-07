/**
 * Low-level client for Hidalgo County's public ProdigyCAD property-search
 * API. The endpoint, request/response shapes, and token-bootstrap
 * mechanism were reverse-engineered entirely from the portal's own
 * public, unauthenticated client-side JavaScript (shipped to every
 * visitor of https://hidalgo.prodigycad.com/property-search), confirmed
 * against real test requests. The product owner manually verified the
 * ordinary public search flow requires no login, no CAPTCHA, and no
 * payment.
 *
 * Token flow: POST {API_BASE}/trueprodigy/cadpublic/auth/token with
 * {"office": "Hidalgo"} returns a short-lived (5-minute, confirmed via
 * the JWT's iat/exp claims) token at response.user.token -- decoded, its
 * claims read {email: "cadpublic@trueprodigy.tech", modules: ["Prodigy
 * Public Portal"], office: "Hidalgo", userType: "private"}, i.e. a
 * generic anonymous-portal identity, not a real account. This is the
 * exact bootstrap call the public SPA itself makes for anonymous
 * visitors -- nothing here reuses, stores, or depends on a token
 * captured from any real user session; every token used is freshly
 * requested through this same public, unauthenticated flow. Applied to
 * subsequent requests as a raw `Authorization: <token>` header (no
 * "Bearer " prefix -- that prefix is used by a *different*,
 * non-public endpoint in the same bundle; confirmed by testing).
 *
 * Deliberately conservative for the pilot: a single request in flight at
 * a time, a configurable minimum delay between requests, every page of
 * every query cached in-memory so a repeated resolution attempt never
 * re-fetches, and controlled pagination (see `paginate` below) rather
 * than an unbounded "fetch everything" loop. The per-notice request cap
 * is enforced by the caller threading an AppraisalRequestBudget through
 * (see resolver.ts's RequestBudget) -- every real HTTP call this client
 * makes, across every page of every search strategy, spends from that
 * same shared budget.
 */
import type { AppraisalPropertyCandidate, AppraisalRequestBudget, AppraisalValueYear } from "@foreclosuredata/types";
import { parseLegalDescriptionTokens } from "./legalDescriptionParsing";

const API_BASE = "https://prod-container.trueprodigyapi.com";
const OFFICE = "Hidalgo";
const PORTAL_URL = "https://hidalgo.prodigycad.com/property-search";

const REQUEST_DELAY_MS = Number(process.env.HIDALGO_CAD_REQUEST_DELAY_MS ?? 2000);
const CONCURRENCY = Number(process.env.HIDALGO_CAD_CONCURRENCY ?? 1);
const PAGE_SIZE = Number(process.env.HIDALGO_CAD_PAGE_SIZE ?? 20);
const MAX_PAGES_PER_SEARCH = Number(process.env.HIDALGO_CAD_MAX_PAGES_PER_SEARCH ?? 5);
const VALUATION_YEAR_LOOKBACK = Number(process.env.HIDALGO_CAD_VALUATION_YEAR_LOOKBACK ?? 2);

if (CONCURRENCY !== 1) {
  // Only concurrency=1 has been validated against the real API during the
  // pilot -- refuse to silently run more aggressively than that.
  throw new Error(`HIDALGO_CAD_CONCURRENCY must be 1 during the pilot (got ${CONCURRENCY}).`);
}

export class HidalgoCaptchaDetectedError extends Error {
  constructor(context: string) {
    super(`CAPTCHA or bot-challenge detected during Hidalgo CAD access (${context}). Automated access has been stopped -- do not retry.`);
    this.name = "HidalgoCaptchaDetectedError";
  }
}

let cachedToken: { token: string; expiresAtMs: number } | null = null;
let cachedYear: { year: number; fetchedAtMs: number } | null = null;
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAtMs = 0;

/** Serializes every call through this client to one in-flight request at a time, spaced at least REQUEST_DELAY_MS apart, regardless of how many callers are waiting. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const waitMs = Math.max(0, REQUEST_DELAY_MS - (Date.now() - lastRequestAtMs));
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAtMs = Date.now();
    return fn();
  });
  requestQueue = run.catch(() => undefined);
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const bodyText = await response.text();
    if (/captcha/i.test(bodyText) || /recaptcha/i.test(bodyText)) {
      throw new HidalgoCaptchaDetectedError(path);
    }
    throw new Error(`Hidalgo CAD API returned a non-JSON response (HTTP ${response.status}) for ${path}: ${bodyText.slice(0, 200)}`);
  }
  return response;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs - Date.now() > 30_000) {
    return cachedToken.token;
  }
  return enqueue(async () => {
    if (cachedToken && cachedToken.expiresAtMs - Date.now() > 30_000) return cachedToken.token;
    const response = await rawFetch("/trueprodigy/cadpublic/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ office: OFFICE }),
    });
    if (!response.ok) throw new Error(`Hidalgo CAD public-token request failed: HTTP ${response.status}`);
    const body = (await response.json()) as { user?: { token?: string } };
    const token = body.user?.token;
    if (!token) throw new Error("Hidalgo CAD public-token response did not contain a token.");
    const expClaimMs = decodeJwtExpiryMs(token);
    cachedToken = { token, expiresAtMs: expClaimMs ?? Date.now() + 4 * 60 * 1000 };
    return token;
  });
}

function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getCurrentYear(): Promise<number> {
  if (cachedYear && Date.now() - cachedYear.fetchedAtMs < 60 * 60 * 1000) {
    return cachedYear.year;
  }
  const token = await getToken();
  return enqueue(async () => {
    if (cachedYear && Date.now() - cachedYear.fetchedAtMs < 60 * 60 * 1000) return cachedYear.year;
    const response = await rawFetch("/public/config/currentyear", { headers: { Authorization: token } });
    if (!response.ok) throw new Error(`Hidalgo CAD current-year request failed: HTTP ${response.status}`);
    const body = (await response.json()) as { results?: { year?: number } };
    const year = body.results?.year;
    if (!year) throw new Error("Hidalgo CAD current-year response did not contain a year.");
    cachedYear = { year, fetchedAtMs: Date.now() };
    return year;
  });
}

/** Shape of a raw property row as returned by both /public/property/search and /public/property/searchfulltext -- confirmed by inspection of a live response. Only the fields this adapter actually uses are typed; the real response has more. Value fields are sometimes the literal string "N/A" rather than a number or null (confirmed live) -- toCents() below only accepts an actual number, so that case is treated the same as missing. */
export interface RawPropertyRow {
  pid: number | string;
  pYear: number;
  geoID: string | null;
  displayName: string | null;
  streetPrimary: string | null;
  fullSitus: string | null;
  city: string | null;
  zip: string | null;
  legalDescription: string | null;
  lot: string | null;
  block: string | null;
  legalAcreage: number | null;
  effectiveSizeAcres: number | null;
  marketValue: number | string | null;
  appraisedValue: number | string | null;
  landValue: number | string | null;
  improvementValue: number | string | null;
  latitude: number | null;
  longitude: number | null;
  propType: string | null;
  /** The portal's own certification/completeness flag for this row's year -- confirmed both empirically (0 for the not-yet-certified current year, 1 for prior certified years) and from the public client's own source, which renders `marketValue: e.valueReady ? e.marketValue : "N/A"`. Typed loosely since the API returns it as 0/1, not a real boolean. */
  valueReady?: number | boolean | null;
}

interface SearchFieldValue {
  operator: "=" | "begins" | "match" | "mlike";
  value: string;
}

let searchCallCount = 0;

/** Total real (non-cached) HTTP calls made this process, across every page of every search -- exposed for cost/usage reporting, not enforcement (the caller-supplied budget is what actually stops requests). */
export function getSearchCallCount(): number {
  return searchCallCount;
}

/** One entry per (endpoint, query, page) -- so a repeated resolution attempt for the same term never re-fetches a page it already has, even across different search strategies that happen to land on the same query. */
const pageCache = new Map<string, { rows: RawPropertyRow[]; totalCount: number | null }>();

interface PageResult {
  rows: RawPropertyRow[];
  totalCount: number | null;
  /** True when this page could not be fetched because the shared request budget ran out (not because the CAD returned zero results) -- the pagination loop treats this as a hard stop, distinct from a legitimate empty page. */
  budgetExhausted: boolean;
}

async function fetchPage(path: string, body: Record<string, SearchFieldValue>, cacheKeyPrefix: string, page: number, budget?: AppraisalRequestBudget): Promise<PageResult> {
  const cacheKey = `${cacheKeyPrefix}:${JSON.stringify(body)}:page${page}`;
  const cached = pageCache.get(cacheKey);
  if (cached) return { ...cached, budgetExhausted: false };

  if (budget && budget.remaining <= 0) {
    return { rows: [], totalCount: null, budgetExhausted: true };
  }

  const token = await getToken();
  const result = await enqueue(async () => {
    if (budget) budget.remaining -= 1;
    searchCallCount++;
    const response = await rawFetch(`${path}?page=${page}&pageSize=${PAGE_SIZE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(body),
    });
    if (response.status === 409 || response.status === 204) {
      // 409: "No search criteria specified" or a similar validation
      // rejection. 204: the API's own "zero matches" response -- confirmed
      // live for an overly-specific full-text query. Neither is a hard
      // failure, just no usable candidates.
      return { rows: [], totalCount: 0 };
    }
    if (!response.ok) throw new Error(`Hidalgo CAD search failed: HTTP ${response.status} for ${path}`);
    const bodyText = await response.text();
    if (!bodyText) return { rows: [], totalCount: 0 };
    const parsed = JSON.parse(bodyText) as {
      results?: RawPropertyRow[];
      totalProperty?: number | { propertyCount?: number };
    };
    const totalCount =
      typeof parsed.totalProperty === "number" ? parsed.totalProperty : (parsed.totalProperty?.propertyCount ?? null);
    return { rows: parsed.results ?? [], totalCount };
  });

  pageCache.set(cacheKey, result);
  return { ...result, budgetExhausted: false };
}

export interface PaginatedSearchOptions {
  /** Caps how many pages this one search strategy will fetch, regardless of budget. Defaults to HIDALGO_CAD_MAX_PAGES_PER_SEARCH. Pass 1 for broad/last-resort strategies (e.g. owner name alone) where more pages only add noise, never a safer match. */
  maxPages?: number;
  /** Evaluated against the rows accumulated so far after each page; returning true stops pagination early once an adequately precise candidate has already appeared. Purely a recall/cost optimization -- never affects which candidates are returned to the caller or how they're scored. */
  isGoodEnough?: (rowsSoFar: RawPropertyRow[]) => boolean;
  /** Shared across every search strategy for one resolution attempt -- see resolver.ts's RequestBudget. Every real (non-cached) page fetch decrements it by 1; once exhausted, pagination (and further strategies) stop fetching rather than erroring. */
  budget?: AppraisalRequestBudget;
}

/**
 * Fetches page 1, then continues fetching subsequent pages only while all
 * of the following hold: the page limit hasn't been reached, the budget
 * hasn't run out, the last page was full (a short page means there's
 * nothing more), the API's own total count (when present) hasn't been
 * reached, and `isGoodEnough` (if given) hasn't already been satisfied by
 * what's been collected so far. This is deliberately not "fetch every
 * page" -- see HIDALGO_CAD_MAX_PAGES_PER_SEARCH.
 */
async function paginate(
  pageFetcher: (page: number) => Promise<PageResult>,
  options?: PaginatedSearchOptions,
): Promise<RawPropertyRow[]> {
  const maxPages = options?.maxPages ?? MAX_PAGES_PER_SEARCH;
  const allRows: RawPropertyRow[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { rows, totalCount, budgetExhausted } = await pageFetcher(page);
    if (budgetExhausted) break;
    allRows.push(...rows);
    if (options?.isGoodEnough?.(allRows)) break;
    if (rows.length < PAGE_SIZE) break;
    if (totalCount != null && page * PAGE_SIZE >= totalCount) break;
  }
  return allRows;
}

/** Compound free-text search -- the only option for legal-description/subdivision terms, which have no dedicated structured field in this API. */
export async function searchFullText(term: string, options?: PaginatedSearchOptions): Promise<RawPropertyRow[]> {
  const year = await getCurrentYear();
  const body = { pYear: { operator: "=" as const, value: String(year) }, fullTextSearch: { operator: "match" as const, value: term } };
  return paginate((page) => fetchPage("/public/property/searchfulltext", body, "fulltext", page, options?.budget), options);
}

export type StructuredSearchField = "pid" | "geoID" | "name" | "streetPrimary" | "ownerID";

/** Field-specific structured search -- confirmed more precise than full-text for the fields that have a dedicated column (Property ID, GEO ID, Owner Name, Property Address). Defaults to the current appraisal year; pass `year` to query a specific one instead (see searchStructuredForYear / getValuationHistory). */
export async function searchStructured(
  field: StructuredSearchField,
  value: string,
  operator: SearchFieldValue["operator"],
  options?: PaginatedSearchOptions & { year?: number },
): Promise<RawPropertyRow[]> {
  const year = options?.year ?? (await getCurrentYear());
  const body = { pYear: { operator: "=" as const, value: String(year) }, [field]: { operator, value } };
  return paginate((page) => fetchPage("/public/property/search", body, `structured:${field}`, page, options?.budget), options);
}

/**
 * Looks up a specific property's values for its current appraisal year,
 * then walks backward one year at a time -- stopping at the first year
 * whose values are actually populated (see RawPropertyRow.valueReady) --
 * for up to `maxYearsBack` additional years (default
 * HIDALGO_CAD_VALUATION_YEAR_LOOKBACK). Returns every year actually
 * queried, in current-year-first order, so the caller can see both the
 * years that came back empty and the one that didn't. Never fabricates a
 * value: a year with no populated values is still returned, with every
 * value field null and `populated: false`, rather than skipped silently.
 */
export async function getValuationHistory(
  pid: string,
  options?: { maxYearsBack?: number; budget?: AppraisalRequestBudget },
): Promise<AppraisalValueYear[]> {
  const currentYear = await getCurrentYear();
  const maxYearsBack = options?.maxYearsBack ?? VALUATION_YEAR_LOOKBACK;

  const results: AppraisalValueYear[] = [];
  for (let back = 0; back <= maxYearsBack; back++) {
    const year = currentYear - back;
    const rows = await searchStructured("pid", pid, "=", { year, budget: options?.budget, maxPages: 1 });
    const row = rows.find((r) => String(r.pid) === pid) ?? rows[0] ?? null;
    results.push(rowToValueYear(pid, year, row));
    if (results[results.length - 1]!.populated) break;
  }
  return results;
}

function rowToValueYear(pid: string, year: number, row: RawPropertyRow | null): AppraisalValueYear {
  const landValueCents = row ? toCents(row.landValue) : null;
  const improvementValueCents = row ? toCents(row.improvementValue) : null;
  const appraisedValueCents = row ? toCents(row.appraisedValue) : null;
  const marketValueCents = row ? toCents(row.marketValue) : null;
  return {
    taxYear: year,
    landValueCents,
    improvementValueCents,
    appraisedValueCents,
    // Not observed as a distinct field in the live response -- left null
    // rather than guessed (same convention as mapRowToCandidate).
    assessedValueCents: null,
    marketValueCents,
    certified: row?.valueReady === undefined || row?.valueReady === null ? null : Boolean(Number(row.valueReady)),
    populated: landValueCents !== null || improvementValueCents !== null || appraisedValueCents !== null || marketValueCents !== null,
    sourceUrl: `${PORTAL_URL}?pid=${pid}&year=${year}`,
    retrievedAt: new Date().toISOString(),
  };
}

export function mapRowToCandidate(row: RawPropertyRow): AppraisalPropertyCandidate {
  const legalTokens = row.legalDescription ? parseLegalDescriptionTokens(row.legalDescription) : null;
  return {
    sourcePropertyId: String(row.pid),
    sourceUrl: `${PORTAL_URL}?pid=${row.pid}&year=${row.pYear}`,
    ownerName: row.displayName ?? null,
    situsAddress: row.fullSitus ?? row.streetPrimary ?? null,
    city: row.city ?? null,
    zipCode: row.zip ?? null,
    parcelId: String(row.pid),
    geographicId: row.geoID ?? null,
    legalDescription: row.legalDescription ?? null,
    // ProdigyCAD doesn't expose a dedicated subdivision field -- it's
    // embedded in legalDescription text, so it's parsed out the same way
    // notice text is (see legalDescriptionParsing.ts) for consistency.
    subdivision: legalTokens?.subdivision ?? null,
    lot: row.lot ?? legalTokens?.lot ?? null,
    block: row.block ?? legalTokens?.block ?? null,
    acreage: row.legalAcreage ?? row.effectiveSizeAcres ?? legalTokens?.acreage ?? null,
    classification: mapClassification(row.propType),
    landValueCents: toCents(row.landValue),
    improvementValueCents: toCents(row.improvementValue),
    appraisedValueCents: toCents(row.appraisedValue),
    // Not observed in the live response -- left null rather than guessed.
    assessedValueCents: null,
    marketValueCents: toCents(row.marketValue),
    // Not observed in the live response -- left null rather than guessed.
    homestead: null,
    taxYear: row.pYear ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
  };
}

function toCents(value: number | string | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function mapClassification(propType: string | null): "RESIDENTIAL" | "COMMERCIAL" | "UNKNOWN" {
  if (!propType) return "UNKNOWN";
  const normalized = propType.toUpperCase();
  if (normalized.includes("RES")) return "RESIDENTIAL";
  if (normalized.includes("COM")) return "COMMERCIAL";
  return "UNKNOWN";
}
