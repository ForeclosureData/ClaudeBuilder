import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawPropertyRow } from "../src/address-resolution/hidalgoCadClient";

const searchFullText = vi.fn<(term: string) => Promise<RawPropertyRow[]>>();
const searchStructured = vi.fn<(field: string, value: string, operator: string) => Promise<RawPropertyRow[]>>();

vi.mock("../src/address-resolution/hidalgoCadClient", async () => {
  const actual = await vi.importActual<typeof import("../src/address-resolution/hidalgoCadClient")>(
    "../src/address-resolution/hidalgoCadClient",
  );
  return { ...actual, searchFullText, searchStructured };
});

const { HidalgoCountyAppraisalAdapter, extractStreetSearchTerm } = await import("../src/address-resolution/appraisalAdapter");

describe("extractStreetSearchTerm", () => {
  // Regression coverage for a real bug caught by the live 5-case test: the
  // first implementation stripped a trailing "city, state zip" with a
  // regex that had nothing stopping it from also consuming the entire
  // street name whenever the address had only one comma before the state
  // (a common real format) or no comma at all -- collapsing e.g. "1416 W
  // McKinley Ave Alton. Texas 78573" down to just "1416" and turning a
  // precise 1-result CAD query into a 100+-result one.
  it("keeps the full street name when the city has no comma before it at all", () => {
    expect(extractStreetSearchTerm("1416 W McKinley Ave Alton. Texas 78573")).toBe("1416 McKinley Ave");
  });

  it("keeps the full street name when there's only one comma, immediately before the state", () => {
    expect(extractStreetSearchTerm("700 W La Quinta Dr Pharr, Texas 78577")).toBe("700 La Quinta Dr");
  });

  it("keeps the full street name with two commas (street, city, state zip)", () => {
    expect(extractStreetSearchTerm("1958 Sabal Palm Dr, Mercedes, Texas 78570")).toBe("1958 Sabal Palm Dr");
  });

  it("strips only the directional prefix when there is no city/state/zip tail at all", () => {
    expect(extractStreetSearchTerm("1958 Sabal Palm Dr")).toBe("1958 Sabal Palm Dr");
  });
});

const ROW: RawPropertyRow = {
  pid: 1,
  pYear: 2027,
  geoID: "10038-00-000-0001-00",
  displayName: "SAMPLE OWNER",
  streetPrimary: "1 SAMPLE LN",
  fullSitus: "1 SAMPLE LN, PHARR, TX 78577",
  city: "PHARR",
  zip: "78577",
  legalDescription: "SOL BRILLA PH 1 LOT 1",
  lot: "1",
  block: null,
  legalAcreage: 0.15,
  effectiveSizeAcres: null,
  marketValue: 100000,
  appraisedValue: 95000,
  landValue: 20000,
  improvementValue: 75000,
  latitude: 26.1,
  longitude: -98.2,
  propType: "RES",
};

describe("HidalgoCountyAppraisalAdapter.searchProperties", () => {
  beforeEach(() => {
    searchFullText.mockReset().mockResolvedValue([ROW]);
    searchStructured.mockReset().mockResolvedValue([ROW]);
  });

  it("strips a trailing 'SUBDIVISION' suffix before issuing the full-text query (confirmed live: the suffixed phrase returns zero results from the real API, the stripped one doesn't)", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ subdivision: "SOL BRILLA SUBDIVISION" });
    expect(searchFullText).toHaveBeenCalledWith("SOL BRILLA", expect.anything());
  });

  it("leaves a subdivision name with no generic suffix untouched", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ subdivision: "INDIAN HARBOR" });
    expect(searchFullText).toHaveBeenCalledWith("INDIAN HARBOR", expect.anything());
  });

  it("prefers parcel ID over every other search strategy", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ parcelId: "12345", ownerNames: ["JOHN SAMPLE"], subdivision: "SOL BRILLA SUBDIVISION" });
    expect(searchStructured).toHaveBeenCalledWith("pid", "12345", "=", expect.anything());
    expect(searchFullText).not.toHaveBeenCalled();
  });

  it("combines owner name + subdivision into one live full-text call filtered client-side by owner surname (the API has no combined-field query)", async () => {
    searchFullText.mockResolvedValue([ROW, { ...ROW, pid: 2, displayName: "OTHER PERSON" }]);
    const adapter = new HidalgoCountyAppraisalAdapter();
    const result = await adapter.searchProperties({ ownerNames: ["JANE SAMPLE OWNER"], subdivision: "SOL BRILLA SUBDIVISION" });
    expect(searchFullText).toHaveBeenCalledTimes(1);
    expect(searchFullText).toHaveBeenCalledWith("SOL BRILLA", expect.anything());
    expect(result).toHaveLength(1);
    expect(result[0]!.sourcePropertyId).toBe("1");
  });

  it("tries the complete owner name as a precise full-text query before falling back to a broad single-page surname sweep", async () => {
    searchFullText.mockResolvedValueOnce([ROW]);
    const adapter = new HidalgoCountyAppraisalAdapter();
    const result = await adapter.searchProperties({ ownerNames: ["Jane Sample Owner"] });
    expect(searchFullText).toHaveBeenCalledWith("Jane Sample Owner", expect.anything());
    expect(searchStructured).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("falls back to the broad surname search when the precise full-name full-text query finds nothing", async () => {
    searchFullText.mockResolvedValueOnce([]);
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ ownerNames: ["Jane Sample Owner"] });
    expect(searchStructured).toHaveBeenCalledWith("name", "OWNER", "begins", expect.objectContaining({ maxPages: 1 }));
  });

  it("narrows a subdivision+lot search to the matching lot when the CAD returns one", async () => {
    searchFullText.mockResolvedValueOnce([ROW, { ...ROW, pid: 2, lot: "99" }]);
    const adapter = new HidalgoCountyAppraisalAdapter();
    const result = await adapter.searchProperties({ subdivision: "SOL BRILLA", lot: "1" });
    expect(result).toHaveLength(1);
    expect(result[0]!.sourcePropertyId).toBe("1");
  });

  it("returns no candidates for an empty query rather than guessing", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    const result = await adapter.searchProperties({});
    expect(result).toEqual([]);
    expect(searchFullText).not.toHaveBeenCalled();
    expect(searchStructured).not.toHaveBeenCalled();
  });
});
