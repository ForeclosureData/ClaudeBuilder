import { describe, it, expect } from "vitest";
import { Prisma } from "@foreclosuredata/database";
import { isUniqueConstraintViolation } from "./ingestForeclosureNotices";

describe("isUniqueConstraintViolation", () => {
  // This is the specific error a losing concurrent insert against
  // ForeclosureCase's (countyId, countyFilingNumber) unique constraint
  // produces -- the database-level guarantee that makes "concurrent
  // ingestion cannot create duplicates" actually true, not just true when
  // the earlier findUnique check happens to run first.
  it("recognizes a real Prisma unique-constraint-violation (P2002) error", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`county_id`,`county_filing_number`)", {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: { target: ["county_id", "county_filing_number"] },
    });
    expect(isUniqueConstraintViolation(err)).toBe(true);
  });

  it("does not misclassify a different Prisma error code as a duplicate", () => {
    const notFound = new Prisma.PrismaClientKnownRequestError("Record to update not found.", { code: "P2025", clientVersion: "5.22.0" });
    expect(isUniqueConstraintViolation(notFound)).toBe(false);
  });

  it("does not misclassify an unrelated error as a duplicate", () => {
    expect(isUniqueConstraintViolation(new Error("network timeout"))).toBe(false);
    expect(isUniqueConstraintViolation("some string")).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
  });
});
