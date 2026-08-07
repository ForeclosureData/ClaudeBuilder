import { describe, it, expect } from "vitest";
import { resolvePropertyAddress } from "../src/address-resolution/resolver";
import { MockCountyAppraisalAdapter } from "../src/address-resolution/appraisalAdapter";
import type { AppraisalPropertyCandidate } from "@foreclosuredata/types";

const baseRecord: AppraisalPropertyCandidate = {
  sourcePropertyId: "P-001",
  sourceUrl: "https://example-fixture.local/appraisal-district/P-001",
  ownerName: "John A. Smith",
  situsAddress: "1417 N Cage Blvd, Pharr, TX 78577",
  city: "Pharr",
  zipCode: "78577",
  parcelId: "P-001",
  geographicId: "G-001",
  legalDescription: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
  subdivision: "Sunrise Terrace Subdivision",
  lot: "14",
  block: "3",
  acreage: 0.21,
  classification: "RESIDENTIAL",
  landValueCents: 5_000_00,
  improvementValueCents: 13_500_00,
  appraisedValueCents: 18_500_00,
  assessedValueCents: 18_500_00,
  marketValueCents: 19_000_00,
  homestead: true,
  taxYear: 2026,
  latitude: 26.1758,
  longitude: -98.2375,
};

describe("resolvePropertyAddress", () => {
  it("prefers an explicitly stated address over any lookup", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: "900 S 10th St, McAllen, TX 78501",
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: null,
        ownerNames: [],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.address.addressResolutionMethod).toBe("EXPLICIT_STATED");
    expect(result.address.addressResolutionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(result.address.resolvedAddress).toBe("900 S 10th St, McAllen, TX 78501");
    expect(result.resolution.requiresManualReview).toBe(false);
  });

  it("resolves via legal description + owner surname when no address is stated", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: {
          rawText: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
          subdivision: "Sunrise Terrace Subdivision",
          lot: "14",
          block: "3",
          acreage: 0.21,
        },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.address.addressResolutionMethod).toBe("LEGAL_DESCRIPTION_MATCH");
    expect(result.address.resolvedAddress).toBe(baseRecord.situsAddress);
    expect(result.address.addressResolutionConfidence).toBeGreaterThan(0.9);
    expect(result.resolution.requiresManualReview).toBe(false);
  });

  it("sends tied legal-description matches to manual review rather than guessing, even at high confidence", async () => {
    const secondRecord: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-002", parcelId: "P-002", geographicId: "G-002", ownerName: "Maria Garcia", situsAddress: "2 Other St" };
    const adapter = new MockCountyAppraisalAdapter([baseRecord, secondRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: {
          rawText: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
          subdivision: "Sunrise Terrace Subdivision",
          lot: "14",
          block: "3",
          acreage: 0.21,
        },
        ownerNames: ["Someone Else"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    // Both candidates share the same subdivision/lot/block (a strong,
    // high-confidence pattern), but neither can be told apart, so this must
    // never auto-publish — the resolved address stays null and the case
    // requires manual review regardless of how confident the pattern is.
    expect(result.address.resolvedAddress).toBeNull();
    expect(result.address.propertyId).toBeNull();
    expect(result.resolution.requiresManualReview).toBe(true);
    expect(result.resolution.selectedCandidateId).toBeNull();
    expect(result.candidates.length).toBe(2);
  });

  it("never assumes the owner's mailing address is the property address", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: null,
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: "PO Box 999, Some Other City, TX 00000",
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    // Owner-name-only match (no legal description, no parcel/geo ID) never
    // clears the auto-accept threshold on its own — it should land in
    // manual review, and the explanation must not claim occupancy since
    // the mailing address doesn't match the situs address.
    expect(result.resolution.requiresManualReview).toBe(true);
    expect(result.address.addressResolutionExplanation).not.toMatch(/owner-occupied/i);
  });

  it("returns UNRESOLVED with zero confidence when nothing matches", async () => {
    const adapter = new MockCountyAppraisalAdapter([]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: { rawText: "LOT 1, BLOCK 1, Nonexistent", subdivision: "Nonexistent", lot: "1", block: "1", acreage: null },
        ownerNames: ["Nobody Here"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.address.addressResolutionMethod).toBe("UNRESOLVED");
    expect(result.address.addressResolutionConfidence).toBe(0);
    expect(result.resolution.requiresManualReview).toBe(true);
  });

  it("auto-accepts an exact parcel ID match even with a different owner-name spelling", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: {
          rawText: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
          subdivision: "Sunrise Terrace Subdivision",
          lot: "14",
          block: "3",
          acreage: 0.21,
        },
        ownerNames: ["J. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: "P-001",
        geographicIdFromNotice: null,
        city: "Pharr",
      },
      adapter,
    );
    expect(result.address.addressResolutionMethod).toBe("PROPERTY_ID_MATCH");
    expect(result.resolution.requiresManualReview).toBe(false);
    expect(result.address.resolvedAddress).toBe(baseRecord.situsAddress);
  });

  it("enriches an explicit-stated-address case with a single unambiguous CAD match whose owner name agrees with the notice", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: baseRecord.situsAddress!,
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: null,
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.address.resolvedAddress).toBe(baseRecord.situsAddress);
    expect(result.selectedCandidate?.sourcePropertyId).toBe(baseRecord.sourcePropertyId);
  });

  it("refuses to enrich an explicit-stated-address case when the sole CAD match's owner name is unrelated to the notice's borrower -- the property may have changed hands since the notice was filed", async () => {
    const adapter = new MockCountyAppraisalAdapter([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: baseRecord.situsAddress!,
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: null,
        ownerNames: ["Someone Entirely Different"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    // The notice-stated address itself is untouched either way.
    expect(result.address.resolvedAddress).toBe(baseRecord.situsAddress);
    expect(result.address.addressResolutionMethod).toBe("EXPLICIT_STATED");
    // But no valuation data gets attached to a record with a conflicting owner.
    expect(result.selectedCandidate).toBeNull();
    expect(result.address.propertyId).toBeNull();
  });

  it("still enriches from an unambiguous address-only match even when a broader owner-name strategy adds unrelated noise to the full candidate pool", async () => {
    const unrelatedSameSurname: AppraisalPropertyCandidate = {
      ...baseRecord,
      sourcePropertyId: "P-999",
      parcelId: "P-999",
      geographicId: "G-999",
      situsAddress: "42 Somewhere Else Rd, Weslaco, TX 78596",
      lot: "40",
      block: "9",
    };
    const adapter = new MockCountyAppraisalAdapter([baseRecord, unrelatedSameSurname]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: baseRecord.situsAddress!,
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: null,
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    // The owner-alone strategy also matches `unrelatedSameSurname` (same
    // surname, unrelated property), so the full candidate pool has 2
    // entries -- but the address search alone found exactly baseRecord,
    // and that's what should get attached, not "give up because the pool
    // isn't unambiguous."
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.selectedCandidate?.sourcePropertyId).toBe(baseRecord.sourcePropertyId);
  });

  it("routes a conflicting lot number to manual review even when the subdivision and owner both match", async () => {
    const conflictingLot: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-003", parcelId: null, geographicId: null, lot: "99" };
    const adapter = new MockCountyAppraisalAdapter([conflictingLot]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: {
          rawText: "LOT 14, BLOCK 3, Sunrise Terrace Subdivision",
          subdivision: "Sunrise Terrace Subdivision",
          lot: "14",
          block: "3",
          acreage: 0.21,
        },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.resolution.requiresManualReview).toBe(true);
    expect(result.resolution.conflictingFields).toContain("lot");
  });
});
