import { describe, it, expect } from "vitest";
import { parseLegalDescriptionTokens, tokensOverlap, buildLegalDescriptionCacheKey } from "../src/address-resolution/legalDescriptionParsing";

describe("parseLegalDescriptionTokens", () => {
  it("extracts subdivision, lot, and block from a typical notice string", () => {
    const parsed = parseLegalDescriptionTokens("LOT 14, BLOCK 3, Sunrise Terrace Subdivision, Hidalgo County, Texas");
    expect(parsed.lot).toBe("14");
    expect(parsed.block).toBe("3");
    expect(parsed.subdivision).toMatch(/Sunrise Terrace Subdivision/i);
    expect(parsed.rawText).toContain("Hidalgo County");
  });

  it("extracts phase and acreage when present", () => {
    const parsed = parseLegalDescriptionTokens("LOT 58, West Gate Crossing Phase 2, 4.99 acres, Weslaco, Hidalgo County, Texas");
    expect(parsed.lot).toBe("58");
    expect(parsed.phase).toBe("2");
    expect(parsed.acreage).toBeCloseTo(4.99);
  });

  it("preserves the original raw text unchanged regardless of parsing outcome", () => {
    const raw = "Some unparseable legal description with no recognizable tokens at all";
    const parsed = parseLegalDescriptionTokens(raw);
    expect(parsed.rawText).toBe(raw);
    expect(parsed.lot).toBeNull();
  });

  it("extracts a property/parcel ID when labeled", () => {
    const parsed = parseLegalDescriptionTokens("APN 178670 | G2500-00-001-0005-00");
    expect(parsed.propertyIdNumber).toBe("178670");
  });
});

describe("tokensOverlap", () => {
  it("matches case-insensitively and ignores punctuation", () => {
    expect(tokensOverlap("Sunrise Terrace Subdivision", "SUNRISE TERRACE SUBDIVISION")).toBe(true);
  });

  it("returns false when either value is missing", () => {
    expect(tokensOverlap(null, "Sunrise Terrace Subdivision")).toBe(false);
    expect(tokensOverlap("Sunrise Terrace Subdivision", undefined)).toBe(false);
  });

  it("returns false for clearly different values", () => {
    expect(tokensOverlap("Sunrise Terrace Subdivision", "Green Meadows Subdivision")).toBe(false);
  });
});

describe("buildLegalDescriptionCacheKey", () => {
  it("keys on normalized subdivision + lot + block when a subdivision is present", () => {
    const key = buildLegalDescriptionCacheKey({ subdivision: "Sunrise Terrace Subdivision", lot: "14", block: "3", rawText: "irrelevant" });
    expect(key).toBe("SUBDIVISION:SUNRISE TERRACE SUBDIVISION|LOT:14|BLOCK:3");
  });

  it("is case- and punctuation-insensitive so the same lot matches regardless of transcription formatting", () => {
    const a = buildLegalDescriptionCacheKey({ subdivision: "Sunrise Terrace Subdivision", lot: "14", block: "3" });
    const b = buildLegalDescriptionCacheKey({ subdivision: "SUNRISE TERRACE SUBDIVISION", lot: "14", block: "3." });
    expect(a).toBe(b);
  });

  it("falls back to normalized raw text when no subdivision was parsed", () => {
    const key = buildLegalDescriptionCacheKey({ rawText: "Metes and bounds description, Hidalgo County" });
    expect(key).toBe("RAWTEXT:METES AND BOUNDS DESCRIPTION HIDALGO COUNTY");
  });

  it("returns null when there is nothing stable to key on", () => {
    expect(buildLegalDescriptionCacheKey({})).toBeNull();
  });
});
