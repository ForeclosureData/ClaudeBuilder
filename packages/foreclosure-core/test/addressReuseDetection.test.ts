import { describe, it, expect } from "vitest";
import { normalizeAddressForReuseCheck, isRepeatedAcrossCases } from "../src/extraction/deterministic/addressReuseDetection";

describe("normalizeAddressForReuseCheck", () => {
  it("uppercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeAddressForReuseCheck("3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539")).toBe(
      "3111 W FREDDY GONZALEZ DRIVE EDINBURG TEXAS 78539",
    );
  });

  it("treats extra internal whitespace as equivalent", () => {
    expect(normalizeAddressForReuseCheck("123  Main   St")).toBe(normalizeAddressForReuseCheck("123 Main St"));
  });
});

describe("isRepeatedAcrossCases", () => {
  it("detects an exact repeat regardless of punctuation/case differences", () => {
    const seen = ["3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539"];
    expect(isRepeatedAcrossCases("3111 w freddy gonzalez drive edinburg texas 78539", seen)).toBe(true);
  });

  it("does not flag a genuinely distinct address", () => {
    const seen = ["3111 W. Freddy Gonzalez Drive, Edinburg, Texas 78539"];
    expect(isRepeatedAcrossCases("112 Wisteria Ave, McAllen, TX 78504", seen)).toBe(false);
  });

  it("returns false for an empty candidate rather than matching everything", () => {
    expect(isRepeatedAcrossCases("", ["123 Main St"])).toBe(false);
  });

  it("returns false against an empty history", () => {
    expect(isRepeatedAcrossCases("123 Main St", [])).toBe(false);
  });
});
