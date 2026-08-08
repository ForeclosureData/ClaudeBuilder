import { describe, it, expect } from "vitest";
import { normalizeOwnerName, ownerNamesLikelyRelated, surnamesMatch } from "../src/address-resolution/ownerNameNormalization";

describe("normalizeOwnerName", () => {
  it("splits 'Lastname, Firstname & Firstname' into two people sharing the surname", () => {
    const result = normalizeOwnerName("SMITH, JOHN A & MARY L");
    expect(result.people).toEqual(["JOHN A SMITH", "MARY L SMITH"]);
    expect(result.isEntity).toBe(false);
  });

  it("splits 'First Last and First Last' into two people", () => {
    const result = normalizeOwnerName("John A. Smith and Mary L. Smith");
    expect(result.people).toHaveLength(2);
    expect(result.people[0]).toMatch(/John A\. Smith/i);
    expect(result.people[1]).toMatch(/Mary L\. Smith/i);
  });

  it("handles 'ET UX' by returning only the named person, not a guessed spouse name", () => {
    const result = normalizeOwnerName("JOHN SMITH ET UX");
    expect(result.people).toEqual(["JOHN SMITH"]);
  });

  it("detects business entities and does not attempt person-splitting on them", () => {
    const result = normalizeOwnerName("Rio Valley Holdings LLC");
    expect(result.isEntity).toBe(true);
    expect(result.people).toEqual(["Rio Valley Holdings LLC"]);
  });

  it("does not merge two distinct people into one without supporting evidence", () => {
    const a = normalizeOwnerName("John Smith");
    const b = normalizeOwnerName("Jane Doe");
    expect(ownerNamesLikelyRelated(a.original, b.original)).toBe(false);
  });

  it("recognizes surname-first vs first-name-first as the same person", () => {
    expect(ownerNamesLikelyRelated("Smith, John", "John Smith")).toBe(true);
  });
});

describe("surnamesMatch", () => {
  it("treats an abbreviated first name as sharing a surname, not conflicting", () => {
    expect(surnamesMatch("J. Smith", "John A. Smith")).toBe(true);
  });

  it("returns false for genuinely different surnames", () => {
    expect(surnamesMatch("John Smith", "Maria Garcia")).toBe(false);
  });

  // Real, common Texas pattern: a homeowner places their homestead in a revocable
  // living trust for estate planning. The CAD's owner-of-record then reads as an
  // entity name, but it's still the same person -- not a genuine ownership conflict.
  it("credits a person's surname embedded in their own revocable living trust name", () => {
    expect(surnamesMatch("John Smith", "John Smith Revocable Living Trust")).toBe(true);
    expect(surnamesMatch("John Smith", "Smith Family Trust")).toBe(true);
  });

  it("still flags a genuinely unrelated entity as conflicting, not just because it's a trust/LLC", () => {
    expect(surnamesMatch("Jamichael Green", "Compass Creative Capital LLC")).toBe(false);
    expect(surnamesMatch("John Smith", "Garcia Family Trust")).toBe(false);
  });
});
