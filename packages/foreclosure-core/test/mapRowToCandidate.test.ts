import { describe, it, expect } from "vitest";
import { mapRowToCandidate, type RawPropertyRow } from "../src/address-resolution/hidalgoCadClient";

// Regression coverage for a real production failure: the live API returns
// pYear/latitude/longitude as JSON strings ("2027", "26.14...") rather than
// numbers, even though they look numeric in every log/debug print. A first
// version of mapRowToCandidate assigned these straight through, which
// passed every local/CI check (JS doesn't care) but broke the instant a
// real row reached Prisma's strictly-typed Int/Float columns during the
// first production run against real CAD data ("Argument `taxYear`:
// Invalid value provided. Expected Int or Null, provided String.").
const BASE_ROW: RawPropertyRow = {
  pid: 557118,
  pYear: "2027",
  geoID: "S3975-04-000-0400-00",
  displayName: "GOMEZ BETSAIDA ARELI",
  streetPrimary: "5600 SOL BRILLA LN",
  fullSitus: "5600 SOL BRILLA LN",
  city: null,
  zip: null,
  legalDescription: "SOL BRILLA PH 4 LOT 400",
  lot: "400",
  block: null,
  legalAcreage: null,
  effectiveSizeAcres: null,
  marketValue: "N/A",
  appraisedValue: "N/A",
  landValue: "N/A",
  improvementValue: "N/A",
  latitude: "26.1399404344",
  longitude: "-98.1977684210",
  propType: null,
};

describe("mapRowToCandidate", () => {
  it("coerces a string pYear/latitude/longitude to real numbers rather than passing the string through", () => {
    const candidate = mapRowToCandidate(BASE_ROW);
    expect(candidate.taxYear).toBe(2027);
    expect(typeof candidate.taxYear).toBe("number");
    expect(candidate.latitude).toBeCloseTo(26.1399404344);
    expect(typeof candidate.latitude).toBe("number");
    expect(candidate.longitude).toBeCloseTo(-98.197768421);
    expect(typeof candidate.longitude).toBe("number");
  });

  it("coerces a numeric-string value field to cents instead of dropping it as unrecognized", () => {
    const candidate = mapRowToCandidate({ ...BASE_ROW, marketValue: "264929" });
    expect(candidate.marketValueCents).toBe(26_492_900);
  });

  it("still treats the literal string 'N/A' as no value, not NaN or 0", () => {
    const candidate = mapRowToCandidate(BASE_ROW);
    expect(candidate.marketValueCents).toBeNull();
    expect(candidate.appraisedValueCents).toBeNull();
  });

  it("coerces a numeric-string legalAcreage/effectiveSizeAcres", () => {
    const candidate = mapRowToCandidate({ ...BASE_ROW, legalAcreage: "0.15" });
    expect(candidate.acreage).toBeCloseTo(0.15);
  });

  it("still works when these fields already arrive as real numbers (not every response is guaranteed to send strings)", () => {
    const candidate = mapRowToCandidate({ ...BASE_ROW, pYear: 2027, latitude: 26.14, longitude: -98.2, marketValue: 100000 });
    expect(candidate.taxYear).toBe(2027);
    expect(candidate.latitude).toBe(26.14);
    expect(candidate.marketValueCents).toBe(10_000_000);
  });
});
