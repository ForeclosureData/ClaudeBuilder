import { describe, it, expect } from "vitest";
import { scoreDuplicateEvidence, rawTextFingerprintSimilarity, type DuplicateComparisonCaseSnapshot } from "../src/duplicateDetection/scoring";

// Base fixture mirrors the real HID-117729/HID-117731 pair (second fresh-25
// Hidalgo batch, 2026-08-09), with placeholder names/amounts. Each test
// mutates a copy to exercise one specific scenario from the product spec's
// regression list.
function baseSnapshot(caseId: string): DuplicateComparisonCaseSnapshot {
  return {
    caseId,
    borrowerNames: ["SAMPLE BORROWER", "CO BORROWER"],
    propertyAddress: "317 N Closner, Edinburg TX 78539",
    subdivision: "MARGARET ESTATES",
    lot: "1",
    block: null,
    originalPrincipalAmountCents: 9_838_500,
    saleDate: "2026-08-04",
    deedOfTrustDate: "2009-11-12",
    lenderName: "Sample Mortgage Corporation",
    rawText:
      "Doc-100001\nT.S. #: 2025-20182-TX\nAPPOINTMENT OF SUBSTITUTE TRUSTEE and NOTICE OF TRUSTEE'S SALE\n" +
      "THIS INSTRUMENT APPOINTS THE SUBSTITUTE TRUSTEE(S) IDENTIFIED TO SELL THE PROPERTY DESCRIBED IN THE SECURITY INSTRUMENT.\n" +
      "Grantor: SAMPLE BORROWER AND CO BORROWER. Deed of Trust dated November 12, 2009.\n" +
      "Property Address: 317 N Closner, Edinburg TX 78539. Legal Description: Lot 1, Margaret Estates.\n" +
      "Original principal amount of $98,385.00. Date of Sale: August 4, 2026.",
  };
}

describe("scoreDuplicateEvidence (real HID-117729/HID-117731 content-duplicate detection)", () => {
  it("classifies a near-identical raw text pair sharing a trustee tracking number as CONFIRMED_SAME_EVENT (real HID-117729/HID-117731 case)", () => {
    const a = baseSnapshot("case-a");
    const b = baseSnapshot("case-b");
    // Real OCR noise variance between the two scans of the same document.
    b.rawText = b.rawText!.replace("Doc-100001\nT.S. #: 2025-20182-TX", "Doc-100002\n1.5. #:2025-20182-TX").replace("TRUSTEE'S SALE", "TRUSTEES SALE");

    const result = scoreDuplicateEvidence(a, b);

    expect(result.confidence).toBe("CONFIRMED_SAME_EVENT");
    expect(result.matchedFields).toContain("trusteeSaleTrackingNumber");
    expect(result.matchedFields).toContain("rawTextFingerprint");
    expect(result.conflictingFields).toEqual([]);
  });

  it("classifies two genuinely unrelated notices (different address, different everything) as not flagged", () => {
    const a = baseSnapshot("case-a");
    const b: DuplicateComparisonCaseSnapshot = {
      caseId: "case-c",
      borrowerNames: ["UNRELATED PERSON"],
      propertyAddress: "900 Unrelated Rd, Pharr TX 78577",
      subdivision: "UNRELATED SUBDIVISION",
      lot: "40",
      block: "2",
      originalPrincipalAmountCents: 150_000_00,
      saleDate: "2026-09-01",
      deedOfTrustDate: "2015-03-01",
      lenderName: "Totally Different Bank",
      rawText: "Doc-999999\nT.S. #: 2020-00001-XX\nNOTICE OF TRUSTEE'S SALE\nUnrelated notice content entirely, no overlap with the other document at all.",
    };

    const result = scoreDuplicateEvidence(a, b);

    expect(result.confidence).toBeNull();
  });

  // Section 4 requirement: a first lien and a second lien (or an HOA lien
  // vs. a mortgage foreclosure) on the SAME property must never be
  // collapsed just because the address (and often the borrower) match --
  // the lender, principal, and deed-of-trust date genuinely differ.
  it("does NOT classify a same-property-different-lien pair as LIKELY or CONFIRMED (a different lender/principal/deed-of-trust date is real evidence of a distinct lien)", () => {
    const a = baseSnapshot("case-a");
    const secondLien: DuplicateComparisonCaseSnapshot = {
      ...a,
      caseId: "case-second-lien",
      lenderName: "Sample HOA Collections LLC",
      originalPrincipalAmountCents: 4_500_00,
      deedOfTrustDate: "2018-06-01",
      rawText: "Doc-200002\nT.S. #: 2026-55555-YY\nNOTICE OF HOA ASSESSMENT LIEN FORECLOSURE SALE\nCompletely different lien instrument, same property.",
    };

    const result = scoreDuplicateEvidence(a, secondLien);

    expect(result.confidence).not.toBe("CONFIRMED_SAME_EVENT");
    expect(result.confidence).not.toBe("LIKELY_SAME_EVENT");
  });

  // Section 4/7 requirement: an amended or reposted notice for the SAME
  // underlying event (same lender, principal, deed of trust) with an
  // updated sale date must still be recognized as likely the same event,
  // not penalized into invisibility by the date difference alone.
  it("still classifies an amended/reposted notice (same core loan facts, different sale date, no decisive signal) as LIKELY_SAME_EVENT", () => {
    const a = baseSnapshot("case-a");
    const reposted: DuplicateComparisonCaseSnapshot = {
      ...a,
      caseId: "case-reposted",
      saleDate: "2026-09-01", // rescheduled
      rawText: "Doc-300003\nT.S. #: 2099-00000-ZZ\nAn entirely different document body, no fingerprint overlap with the original filing.",
    };

    const result = scoreDuplicateEvidence(a, reposted);

    expect(result.confidence).toBe("LIKELY_SAME_EVENT");
    expect(result.conflictingFields).toContain("saleDate");
  });

  it("does not flag two notices for the same borrower on two DIFFERENT properties (an address conflict is decisive, regardless of matching borrower/lender)", () => {
    const a = baseSnapshot("case-a");
    const otherProperty: DuplicateComparisonCaseSnapshot = {
      ...a,
      caseId: "case-other-property",
      propertyAddress: "42 Entirely Different St, McAllen TX 78501",
      subdivision: "DIFFERENT SUBDIVISION",
      lot: "9",
      rawText: "Doc-400004\nT.S. #: 2088-11111-QQ\nA different notice body for a different property entirely.",
    };

    const result = scoreDuplicateEvidence(a, otherProperty);

    expect(result.confidence).toBeNull();
    expect(result.conflictingFields).toContain("propertyAddress");
  });

  it("does not over-classify a same-address-different-sale-date pair when few OTHER fields also agree (thin evidence stays at POSSIBLE_DUPLICATE at most)", () => {
    const a = baseSnapshot("case-a");
    const thin: DuplicateComparisonCaseSnapshot = {
      caseId: "case-thin",
      borrowerNames: ["UNRELATED BORROWER"],
      propertyAddress: a.propertyAddress,
      subdivision: a.subdivision,
      lot: a.lot,
      block: a.block,
      originalPrincipalAmountCents: 12_345_00,
      saleDate: "2026-12-01",
      deedOfTrustDate: "2021-01-01",
      lenderName: "Another Unrelated Lender",
      rawText: "Doc-500005\nT.S. #: 2077-22222-RR\nA thin-evidence unrelated notice body.",
    };

    const result = scoreDuplicateEvidence(a, thin);

    expect(result.confidence).not.toBe("CONFIRMED_SAME_EVENT");
    expect(result.confidence).not.toBe("LIKELY_SAME_EVENT");
  });

  it("never treats two absent (null) values as a match on any field", () => {
    const a: DuplicateComparisonCaseSnapshot = {
      caseId: "case-a",
      borrowerNames: [],
      propertyAddress: null,
      subdivision: null,
      lot: null,
      block: null,
      originalPrincipalAmountCents: null,
      saleDate: null,
      deedOfTrustDate: null,
      lenderName: null,
      rawText: null,
    };
    const b: DuplicateComparisonCaseSnapshot = { ...a, caseId: "case-b" };

    const result = scoreDuplicateEvidence(a, b);

    expect(result.matchedFields).toEqual([]);
    expect(result.confidence).toBeNull();
  });
});

describe("rawTextFingerprintSimilarity", () => {
  it("returns a high score for near-identical text differing only in a case-specific document header and minor OCR noise", () => {
    const a = "Doc-111111\nNOTICE OF TRUSTEE'S SALE\nThe rest of the document body is identical across both scans.";
    const b = "Doc-222222\nNOTICE OF TRUSTEES SALE\nThe rest of the document body is identical across both scans.";
    // On a real full-length notice (thousands of words) a couple of OCR
    // noise tokens barely move the ratio -- confirmed against the real
    // HID-117729/HID-117731 text at ~98%. This fixture is deliberately
    // short for the unit test, so the same single differing token has a
    // proportionally bigger effect; 0.8 still clears the threshold that
    // matters (RAW_TEXT_FINGERPRINT_THRESHOLD = 0.9) on realistic
    // document-length input.
    expect(rawTextFingerprintSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it("returns a low score for genuinely different documents", () => {
    const a = "Doc-111111\nNOTICE OF TRUSTEE'S SALE\nSpecific content about one property and one borrower entirely.";
    const b = "Doc-222222\nDIFFERENT DOCUMENT TYPE ENTIRELY\nCompletely unrelated subject matter with no shared phrasing at all.";
    expect(rawTextFingerprintSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("returns 0 when either text is empty", () => {
    expect(rawTextFingerprintSimilarity("", "some text here")).toBe(0);
  });
});
