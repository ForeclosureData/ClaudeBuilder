import { describe, it, expect, beforeEach, vi } from "vitest";

// The module reads HIDALGO_CAD_REQUEST_DELAY_MS/HIDALGO_CAD_CONCURRENCY at
// import time, so it's stubbed before the dynamic import below rather than
// via top-level env vars -- a real 2000ms default delay between requests
// would make this suite unusably slow.
vi.stubEnv("HIDALGO_CAD_REQUEST_DELAY_MS", "0");
vi.stubEnv("HIDALGO_CAD_CONCURRENCY", "1");

// The module caches its token/year/search results in private module-level
// state, so each test needs a fresh module instance (vi.resetModules) --
// otherwise a token cached by an earlier test silently skips the mocked
// fetch call a later test expects, desynchronizing mockResolvedValueOnce
// from the calls that actually happen.
async function freshClient() {
  vi.resetModules();
  return import("../src/address-resolution/hidalgoCadClient");
}

function jsonResponse(body: unknown, init?: Partial<{ status: number }>) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number) {
  return new Response(null, { status, headers: { "content-type": "application/json" } });
}

const SAMPLE_TOKEN =
  "eyJhbGciOiJIUzUxMiJ9." +
  Buffer.from(JSON.stringify({ office: "Hidalgo", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64") +
  ".sig";

describe("hidalgoCadClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("bootstraps a public token with no Bearer prefix and fetches the current year", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }));

    const rows = await client.searchStructured("pid", "12345", "=");
    expect(rows).toEqual([]);

    const tokenCall = fetchMock.mock.calls[0]!;
    expect(tokenCall[0]).toContain("/trueprodigy/cadpublic/auth/token");
    expect(JSON.parse(tokenCall[1].body)).toEqual({ office: "Hidalgo" });

    const yearCall = fetchMock.mock.calls[1]!;
    expect(yearCall[0]).toContain("/public/config/currentyear");
    expect(yearCall[1].headers.Authorization).toBe(SAMPLE_TOKEN);
    expect(yearCall[1].headers.Authorization).not.toContain("Bearer");
  });

  it("sends a flat (non-wrapped) body for structured search and returns rows", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ pid: 1, pYear: 2027 }] }));

    const rows = await client.searchStructured("streetPrimary", "LA QUINTA", "mlike");
    expect(rows).toHaveLength(1);

    const searchCall = fetchMock.mock.calls[2]!;
    expect(searchCall[0]).toContain("/public/property/search?page=1&pageSize=20");
    const body = JSON.parse(searchCall[1].body);
    expect(body).toEqual({
      pYear: { operator: "=", value: "2027" },
      streetPrimary: { operator: "mlike", value: "LA QUINTA" },
    });
    expect(body.payload).toBeUndefined();
  });

  it("treats a 204 No Content response as zero results rather than throwing", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(emptyResponse(204));

    const rows = await client.searchFullText("some phrase with zero matches");
    expect(rows).toEqual([]);
  });

  it("treats a 409 validation rejection as zero results rather than throwing", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ warning: "No search criteria was specified." }, { status: 409 }));

    const rows = await client.searchStructured("name", "", "begins");
    expect(rows).toEqual([]);
  });

  it("detects a CAPTCHA challenge from a non-JSON response and stops rather than retrying", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(
        new Response("<html>Please complete the CAPTCHA</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    await expect(client.searchFullText("triggers a challenge")).rejects.toThrow(client.HidalgoCaptchaDetectedError);
  });

  it("pages until a short (non-full) page signals there's nothing more", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const page1Rows = Array.from({ length: 20 }, (_, i) => ({ pid: i, pYear: 2027 }));
    const page2Rows = Array.from({ length: 5 }, (_, i) => ({ pid: 100 + i, pYear: 2027 }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: page1Rows, totalProperty: { propertyCount: 25 } }))
      .mockResolvedValueOnce(jsonResponse({ results: page2Rows, totalProperty: { propertyCount: 25 } }));

    const rows = await client.searchFullText("a broad term");
    expect(rows).toHaveLength(25);
    // token + year + page1 + page2, no 3rd page attempted since page2 was short
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it("stops paginating early once isGoodEnough is satisfied, without fetching further pages", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const page1Rows = Array.from({ length: 20 }, (_, i) => ({ pid: i, pYear: 2027, lot: i === 5 ? "68" : String(i) }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: page1Rows, totalProperty: { propertyCount: 100 } }));

    const rows = await client.searchFullText("a broad term", { isGoodEnough: (soFar) => soFar.some((r) => r.lot === "68") });
    expect(rows).toHaveLength(20);
    // Would otherwise keep paging (totalProperty says 100 available) -- only page 1 was fetched.
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("stops paginating when the shared request budget runs out, without erroring", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const page1Rows = Array.from({ length: 20 }, (_, i) => ({ pid: i, pYear: 2027 }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: page1Rows, totalProperty: { propertyCount: 100 } }));

    const budget = { remaining: 1 };
    const rows = await client.searchFullText("a broad term", { budget });
    expect(rows).toHaveLength(20);
    expect(budget.remaining).toBe(0);
    // Only page 1 was fetched -- budget ran out before page 2.
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("caches identical queries in-process instead of re-fetching", async () => {
    const client = await freshClient();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ pid: 1, pYear: 2027 }] }));

    await client.searchStructured("pid", "999", "=");
    const callsAfterFirst = fetchMock.mock.calls.length;
    await client.searchStructured("pid", "999", "=");
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  describe("getValuationHistory", () => {
    function rowForYear(year: number, opts: { populated: boolean }) {
      return opts.populated
        ? { pid: "717490", pYear: year, marketValue: 264929, appraisedValue: 264929, landValue: 67500, improvementValue: 197429, valueReady: 1 }
        : { pid: "717490", pYear: year, marketValue: "N/A", appraisedValue: "N/A", landValue: "N/A", improvementValue: "N/A", valueReady: 0 };
    }

    it("stops at the first populated year, confirmed against the real observed shape (2027 uncertified, 2026 certified)", async () => {
      const client = await freshClient();
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
        .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2027, { populated: false })] }))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2026, { populated: true })] }));

      const years = await client.getValuationHistory("717490");
      expect(years.map((y) => y.taxYear)).toEqual([2027, 2026]);
      expect(years[0]!.populated).toBe(false);
      expect(years[0]!.certified).toBe(false);
      expect(years[1]!.populated).toBe(true);
      expect(years[1]!.certified).toBe(true);
      expect(years[1]!.marketValueCents).toBe(26_492_900);
      expect(years[1]!.landValueCents).toBe(6_750_000);
      // Only 2 years queried, not the full lookback -- stopped once populated.
      expect(fetchMock.mock.calls.length).toBe(4);
    });

    it("gives up after HIDALGO_CAD_VALUATION_YEAR_LOOKBACK years and returns every year queried, all unpopulated, without fabricating a value", async () => {
      const client = await freshClient();
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
        .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2027, { populated: false })] }))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2026, { populated: false })] }))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2025, { populated: false })] }));

      const years = await client.getValuationHistory("717490", { maxYearsBack: 2 });
      expect(years.map((y) => y.taxYear)).toEqual([2027, 2026, 2025]);
      expect(years.every((y) => !y.populated)).toBe(true);
      expect(years.every((y) => y.marketValueCents === null)).toBe(true);
    });

    it("treats a year with no matching row at all the same as an unpopulated year, not an error", async () => {
      const client = await freshClient();
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user: { token: SAMPLE_TOKEN } }, { status: 201 }))
        .mockResolvedValueOnce(jsonResponse({ results: { year: 2027 } }))
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse({ results: [rowForYear(2026, { populated: true })] }));

      const years = await client.getValuationHistory("717490");
      expect(years[0]!.populated).toBe(false);
      expect(years[0]!.certified).toBeNull();
      expect(years[1]!.populated).toBe(true);
    });
  });
});
