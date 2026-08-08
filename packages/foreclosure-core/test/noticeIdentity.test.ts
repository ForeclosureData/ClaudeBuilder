import { describe, it, expect } from "vitest";
import { normalizeCountyFilingNumber, buildNoticeIdentityKey } from "../src/identity/noticeIdentity";

describe("normalizeCountyFilingNumber", () => {
  it("trims whitespace and uppercases", () => {
    expect(normalizeCountyFilingNumber("  117634  ")).toBe("117634");
    expect(normalizeCountyFilingNumber("abc123")).toBe("ABC123");
  });

  it("strips internal whitespace and common OCR-introduced punctuation", () => {
    expect(normalizeCountyFilingNumber("117 634")).toBe("117634");
    expect(normalizeCountyFilingNumber("117-634")).toBe("117634");
    expect(normalizeCountyFilingNumber("117.634")).toBe("117634");
    expect(normalizeCountyFilingNumber("117_634")).toBe("117634");
  });

  it("never strips leading zeros or reinterprets digits", () => {
    expect(normalizeCountyFilingNumber("0117634")).toBe("0117634");
  });

  it("returns null for null, undefined, empty, or whitespace-only input", () => {
    expect(normalizeCountyFilingNumber(null)).toBeNull();
    expect(normalizeCountyFilingNumber(undefined)).toBeNull();
    expect(normalizeCountyFilingNumber("")).toBeNull();
    expect(normalizeCountyFilingNumber("   ")).toBeNull();
  });

  it("produces the same normalized value for two different-looking transcriptions of the same real filing number", () => {
    expect(normalizeCountyFilingNumber("117634")).toBe(normalizeCountyFilingNumber(" 117634 "));
    expect(normalizeCountyFilingNumber("117634")).toBe(normalizeCountyFilingNumber("117-634".replace("-", "")));
  });
});

describe("buildNoticeIdentityKey", () => {
  // The whole point of this function: notice identity is derived ONLY from
  // (county, filing number) -- it has no parameter for file bytes/content
  // at all, so it is structurally impossible for a re-rendered file (same
  // filing number, different bytes) to produce a different key. This is
  // the fix for the real production bug where a byte-hash-based dedup
  // check let the same real notice get re-ingested as a second case every
  // time the source bundle was re-rendered.
  it("re-rendering the same notice never changes its identity key (byte content plays no part in identity)", () => {
    const a = buildNoticeIdentityKey("hidalgo-county-id", "117634");
    const b = buildNoticeIdentityKey("hidalgo-county-id", "117634");
    expect(a).toEqual(b);
    expect(a).toEqual({ countyId: "hidalgo-county-id", countyFilingNumber: "117634" });
  });

  it("the same filing number in two different counties never collides", () => {
    const hidalgo = buildNoticeIdentityKey("hidalgo-county-id", "117634");
    const willacy = buildNoticeIdentityKey("willacy-county-id", "117634");
    expect(hidalgo).not.toEqual(willacy);
    expect(hidalgo?.countyFilingNumber).toBe(willacy?.countyFilingNumber);
    expect(hidalgo?.countyId).not.toBe(willacy?.countyId);
  });

  it("returns null for a missing or unparseable filing number -- never silently treated as a unique identity", () => {
    expect(buildNoticeIdentityKey("hidalgo-county-id", null)).toBeNull();
    expect(buildNoticeIdentityKey("hidalgo-county-id", undefined)).toBeNull();
    expect(buildNoticeIdentityKey("hidalgo-county-id", "")).toBeNull();
    expect(buildNoticeIdentityKey("hidalgo-county-id", "   ")).toBeNull();
  });

  it("normalizes the filing number as part of building the key", () => {
    expect(buildNoticeIdentityKey("hidalgo-county-id", " 117634 ")).toEqual({ countyId: "hidalgo-county-id", countyFilingNumber: "117634" });
  });
});
