import { describe, it, expect } from "vitest";
import { computePublicationStatus, isPubliclyVisibleStatus, type PublicationInput } from "../src/publication/publicationStatus";

function baseInput(overrides: Partial<PublicationInput> = {}): PublicationInput {
  return {
    archivedAt: null,
    hasSourceDocument: true,
    saleDate: new Date("2026-09-01"),
    borrowerName: "Jane Doe",
    propertyStreetAddress: "123 Main St",
    addressResolutionMethod: "EXPLICIT_STATED",
    addressResolutionConfidence: null,
    hasLegalDescription: true,
    hasCadConfirmedProperty: true,
    openManualReviewReasons: [],
    hasActiveDuplicateLink: false,
    ...overrides,
  };
}

describe("computePublicationStatus", () => {
  it("archived case is always ARCHIVED regardless of other fields", () => {
    const r = computePublicationStatus(baseInput({ archivedAt: new Date() }));
    expect(r.status).toBe("ARCHIVED");
  });

  it("no source document or no sale date is WITHHELD", () => {
    expect(computePublicationStatus(baseInput({ hasSourceDocument: false })).status).toBe("WITHHELD");
    expect(computePublicationStatus(baseInput({ saleDate: null })).status).toBe("WITHHELD");
  });

  it("a critical-blocker review reason forces PENDING_REVIEW even with otherwise complete data", () => {
    const r = computePublicationStatus(baseInput({ openManualReviewReasons: ["CAD_OWNER_CONFLICT"] }));
    expect(r.status).toBe("PENDING_REVIEW");
    expect(r.blockingReasons).toContain("CAD_OWNER_CONFLICT");
  });

  it("SALE_DATE_CONFLICT, BORROWER_NAME_CONFLICT, MISSING_FILING_NUMBER, POSSIBLE_CONTENT_DUPLICATE, POOR_TEXT_QUALITY are all blockers", () => {
    for (const reason of ["SALE_DATE_CONFLICT", "BORROWER_NAME_CONFLICT", "MISSING_FILING_NUMBER", "POSSIBLE_CONTENT_DUPLICATE", "POOR_TEXT_QUALITY"]) {
      expect(computePublicationStatus(baseInput({ openManualReviewReasons: [reason] })).status).toBe("PENDING_REVIEW");
    }
  });

  it("an active LIKELY/CONFIRMED duplicate link forces PENDING_REVIEW even with no matching review-task reason", () => {
    const r = computePublicationStatus(baseInput({ hasActiveDuplicateLink: true }));
    expect(r.status).toBe("PENDING_REVIEW");
  });

  it("non-blocking reasons (missing lender/servicer/valuation/CAD/no-address/multi-candidate) never force PENDING_REVIEW by themselves", () => {
    for (const reason of ["NO_ADDRESS_RESOLVED", "MULTIPLE_APPRAISAL_MATCHES", "PROPERTY_CLASSIFICATION_UNCERTAIN", "LOW_CONFIDENCE", "USER_REPORTED"]) {
      const r = computePublicationStatus(baseInput({ openManualReviewReasons: [reason] }));
      expect(r.status).not.toBe("PENDING_REVIEW");
    }
  });

  it("no address and no legal description at all is PENDING_REVIEW (can't identify the property)", () => {
    const r = computePublicationStatus(baseInput({ propertyStreetAddress: null, addressResolutionMethod: "UNRESOLVED", hasLegalDescription: false }));
    expect(r.status).toBe("PENDING_REVIEW");
  });

  it("full core + enrichment + CAD-confirmed + real borrower is PUBLISHED with the 'Verified property' label", () => {
    const r = computePublicationStatus(baseInput());
    expect(r.status).toBe("PUBLISHED");
    expect(r.investorLabel).toBe("Verified property");
    expect(r.blockingReasons).toEqual([]);
  });

  it("a real notice-stated address without CAD confirmation is PUBLISHED_WITH_LIMITED_DATA / 'Source address', not held back", () => {
    const r = computePublicationStatus(baseInput({ hasCadConfirmedProperty: false }));
    expect(r.status).toBe("PUBLISHED_WITH_LIMITED_DATA");
    expect(r.investorLabel).toBe("Source address");
  });

  it("missing lender/servicer/valuation/principal never blocks PUBLISHED -- those aren't part of the input at all, confirming the model doesn't require them", () => {
    // computePublicationStatus's input type has no lender/servicer/valuation/principal fields --
    // this test documents that omission is intentional, not an oversight.
    const r = computePublicationStatus(baseInput());
    expect(r.status).toBe("PUBLISHED");
  });

  it("no trustworthy street address but a legal description present is PUBLISHED_WITH_LIMITED_DATA with addressPending true, never PUBLISHED", () => {
    const r = computePublicationStatus(baseInput({ propertyStreetAddress: null, addressResolutionMethod: "UNRESOLVED" }));
    expect(r.status).toBe("PUBLISHED_WITH_LIMITED_DATA");
    expect(r.addressPending).toBe(true);
    expect(r.investorLabel).toContain("address pending");
  });

  it("placeholder 'Unknown owner' borrower name never blocks publication but keeps it out of the full PUBLISHED tier", () => {
    const r = computePublicationStatus(baseInput({ borrowerName: "Unknown owner" }));
    expect(r.status).toBe("PUBLISHED_WITH_LIMITED_DATA");
    expect(r.blockingReasons).toContain("borrower_unavailable");
  });

  it("a low-confidence, non-explicit address resolution below the trust floor is treated as address-pending, not trustworthy", () => {
    const r = computePublicationStatus(baseInput({ addressResolutionMethod: "LEGAL_DESCRIPTION_MATCH", addressResolutionConfidence: 0.5 }));
    expect(r.addressPending).toBe(true);
  });

  it("a high-confidence non-explicit resolution above the trust floor counts as trustworthy", () => {
    const r = computePublicationStatus(baseInput({ addressResolutionMethod: "LEGAL_DESCRIPTION_MATCH", addressResolutionConfidence: 0.97 }));
    expect(r.addressPending).toBe(false);
  });
});

describe("isPubliclyVisibleStatus", () => {
  it("is true only for PUBLISHED and PUBLISHED_WITH_LIMITED_DATA", () => {
    expect(isPubliclyVisibleStatus("PUBLISHED")).toBe(true);
    expect(isPubliclyVisibleStatus("PUBLISHED_WITH_LIMITED_DATA")).toBe(true);
    expect(isPubliclyVisibleStatus("PENDING_REVIEW")).toBe(false);
    expect(isPubliclyVisibleStatus("WITHHELD")).toBe(false);
    expect(isPubliclyVisibleStatus("ARCHIVED")).toBe(false);
  });
});
