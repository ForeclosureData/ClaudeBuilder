/**
 * Low-level client for Hidalgo County's public ProdigyCAD property-search
 * API. The endpoint, request/response shapes, and token-bootstrap
 * mechanism were reverse-engineered entirely from the portal's own
 * public, unauthenticated client-side JavaScript (shipped to every
 * visitor of https://hidalgo.prodigycad.com/property-search), confirmed
 * against a handful of real test requests using non-personal search
 * terms (a subdivision name, a street name). The product owner manually
 * verified the ordinary public search flow requires no login, no
 * CAPTCHA, and no payment.
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
 * a time, a configurable minimum delay between requests, and results
 * cached in-memory by exact query so the same term is never re-fetched
 * within a process. Per-notice request budgets are enforced by the
 * caller (see resolver.ts's RequestBudget), not here.
 */
import type { AppraisalPropertyCandidate } from "@foreclosuredata/types";
import { parseLegalDescriptionTokens } from "./legalDescriptionParsing";

const API_BASE = "https://prod-container.trueprodigyapi.com";
const OFFICE = "Hidalgo";
const PORTAL_URL = "https://hidalgo.prodigycad.com/property-search";

const REQUEST_DELAY_MS = Number(process.env.HIDALGO_CAD_REQUEST_DELAY_MS ?? 2000);
const CONCURRENCY = Number(process.env.HIDALGO_CAD_CONCURRENCY ?? 1);

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

/** Shape of a raw property row as returned by both /public/property/search and /public/property/searchfulltext -- confirmed by inspection of a live response. Only the fields this adapter actually uses are typed; the real response has more. */
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
  marketValue: number | null;
  appraisedValue: number | null;
  landValue: number | null;
  improvementValue: number | null;
  latitude: number | null;
  longitude: number | null;
  propType: string | null;
}

interface SearchFieldValue {
  operator: "=" | "begins" | "match" | "mlike";
  value: string;
}

let searchCallCount = 0;

/** Total live search calls made this process -- exposed for cost/usage reporting, not enforcement (per-notice budgets are the caller's job). */
export function getSearchCallCount(): number {
  return searchCallCount;
}

const searchCache = new Map<string, RawPropertyRow[]>();

async function runSearch(path: string, body: Record<string, SearchFieldValue>, cacheKeyPrefix: string): Promise<RawPropertyRow[]> {
  const cacheKey = `${cacheKeyPrefix}:${JSON.stringify(body)}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const token = await getToken();
  const results = await enqueue(async () => {
    searchCallCount++;
    const response = await rawFetch(`${path}?page=1&pageSize=20`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(body),
    });
    if (response.status === 409 || response.status === 204) {
      // 409: "No search criteria specified" or a similar validation
      // rejection. 204: the API's own "zero matches" response -- confirmed
      // live for an overly-specific full-text query (a whole raw legal-
      // description sentence with punctuation). Neither is a hard failure,
      // just no usable candidates.
      return [];
    }
    if (!response.ok) throw new Error(`Hidalgo CAD search failed: HTTP ${response.status} for ${path}`);
    const bodyText = await response.text();
    if (!bodyText) return [];
    const parsed = JSON.parse(bodyText) as { results?: RawPropertyRow[] };
    return parsed.results ?? [];
  });

  searchCache.set(cacheKey, results);
  return results;
}

/** Compound free-text search -- the only option for legal-description/subdivision terms, which have no dedicated structured field in this API. */
export async function searchFullText(term: string): Promise<RawPropertyRow[]> {
  const year = await getCurrentYear();
  return runSearch(
    "/public/property/searchfulltext",
    { pYear: { operator: "=", value: String(year) }, fullTextSearch: { operator: "match", value: term } },
    "fulltext",
  );
}

export type StructuredSearchField = "pid" | "geoID" | "name" | "streetPrimary" | "ownerID";

/** Field-specific structured search -- confirmed more precise than full-text for the fields that have a dedicated column (Property ID, GEO ID, Owner Name, Property Address). */
export async function searchStructured(
  field: StructuredSearchField,
  value: string,
  operator: SearchFieldValue["operator"],
): Promise<RawPropertyRow[]> {
  const year = await getCurrentYear();
  return runSearch(
    "/public/property/search",
    { pYear: { operator: "=", value: String(year) }, [field]: { operator, value } },
    `structured:${field}`,
  );
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

function toCents(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function mapClassification(propType: string | null): "RESIDENTIAL" | "COMMERCIAL" | "UNKNOWN" {
  if (!propType) return "UNKNOWN";
  const normalized = propType.toUpperCase();
  if (normalized.includes("RES")) return "RESIDENTIAL";
  if (normalized.includes("COM")) return "COMMERCIAL";
  return "UNKNOWN";
}
