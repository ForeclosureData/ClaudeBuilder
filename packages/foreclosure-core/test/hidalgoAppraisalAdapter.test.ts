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

const { HidalgoCountyAppraisalAdapter } = await import("../src/address-resolution/appraisalAdapter");

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
    expect(searchFullText).toHaveBeenCalledWith("SOL BRILLA");
  });

  it("leaves a subdivision name with no generic suffix untouched", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ subdivision: "INDIAN HARBOR" });
    expect(searchFullText).toHaveBeenCalledWith("INDIAN HARBOR");
  });

  it("prefers parcel ID over every other search strategy", async () => {
    const adapter = new HidalgoCountyAppraisalAdapter();
    await adapter.searchProperties({ parcelId: "12345", ownerNames: ["JOHN SAMPLE"], subdivision: "SOL BRILLA SUBDIVISION" });
    expect(searchStructured).toHaveBeenCalledWith("pid", "12345", "=");
    expect(searchFullText).not.toHaveBeenCalled();
  });

  it("combines owner name + subdivision into one live full-text call filtered client-side by owner surname (the API has no combined-field query)", async () => {
    searchFullText.mockResolvedValue([ROW, { ...ROW, pid: 2, displayName: "OTHER PERSON" }]);
    const adapter = new HidalgoCountyAppraisalAdapter();
    const result = await adapter.searchProperties({ ownerNames: ["JANE SAMPLE OWNER"], subdivision: "SOL BRILLA SUBDIVISION" });
    expect(searchFullText).toHaveBeenCalledTimes(1);
    expect(searchFullText).toHaveBeenCalledWith("SOL BRILLA");
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
