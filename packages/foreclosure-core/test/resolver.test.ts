import { describe, it, expect } from "vitest";
import { resolvePropertyAddress } from "../src/address-resolution/resolver";
import { MockCountyAppraisalAdapter } from "../src/address-resolution/appraisalAdapter";
import type { AppraisalPropertyCandidate, CountyAppraisalAdapter } from "@foreclosuredata/types";

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
    // And the caller can tell this was specifically an owner conflict, not plain ambiguity.
    expect(result.ownerConflictOnBestMatch).toBe(true);
  });

  it("narrows to a single candidate via subdivision+lot alone when the notice's legal description has no block (common real case)", async () => {
    const noBlockMatch: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-010", parcelId: null, geographicId: null, block: null };
    const unrelated: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-011", parcelId: null, geographicId: null, ownerName: "Someone Else", situsAddress: "9 Other Ave", subdivision: "North Main Place", lot: "2", block: "1" };
    const adapter = new MockCountyAppraisalAdapter([noBlockMatch, unrelated]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: "9999 Nonexistent Ln, Nowhere, TX 78500",
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: { rawText: "LOT 14, Sunrise Terrace Subdivision", subdivision: "Sunrise Terrace Subdivision", lot: "14", block: null, acreage: null },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.selectedCandidate?.sourcePropertyId).toBe("P-010");
  });

  it("refuses to enrich via subdivision+lot alone when the matching candidate's owner conflicts, even with no block to check", async () => {
    const noBlockConflictingOwner: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-012", parcelId: null, geographicId: null, block: null, ownerName: "Someone Entirely Different" };
    const adapter = new MockCountyAppraisalAdapter([noBlockConflictingOwner]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: "9999 Nonexistent Ln, Nowhere, TX 78500",
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: { rawText: "LOT 14, Sunrise Terrace Subdivision", subdivision: "Sunrise Terrace Subdivision", lot: "14", block: null, acreage: null },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.selectedCandidate).toBeNull();
    expect(result.ownerConflictOnBestMatch).toBe(true);
  });

  it("refuses to enrich when the only lot-matching candidate sits in a clearly different subdivision", async () => {
    const differentSubdivision: AppraisalPropertyCandidate = { ...baseRecord, sourcePropertyId: "P-013", parcelId: null, geographicId: null, block: null, subdivision: "Inspiration Road Unit No. 3" };
    const adapter = new MockCountyAppraisalAdapter([differentSubdivision]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: "9999 Nonexistent Ln, Nowhere, TX 78500",
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: { rawText: "LOT 14, Buchanan Estates", subdivision: "Buchanan Estates", lot: "14", block: null, acreage: null },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    // Same lot number, same (matching) owner, but a different named subdivision --
    // never silently accepted as if the lot number alone proved it's the same plat.
    expect(result.selectedCandidate).toBeNull();
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

  it("flags ownerConflictOnBestMatch on the no-stated-address path too, not just the enrichment path", async () => {
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
        ownerNames: ["Someone Entirely Different"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      adapter,
    );
    expect(result.resolution.requiresManualReview).toBe(true);
    expect(result.ownerConflictOnBestMatch).toBe(true);
  });

  it("isolates a single search strategy's failure so remaining strategies still run (HID-118198-style CAD error)", async () => {
    // Simulates a live CAD HTTP error (e.g. an HTTP 400 from a malformed
    // full-text query) on the legal-description strategy specifically --
    // the owner-name-alone strategy after it should still get a chance to
    // run and find the real candidate, rather than the whole resolution
    // attempt dying with zero candidates.
    const throwingAdapter: CountyAppraisalAdapter = {
      countyCode: "hidalgo-tx",
      countyName: "Hidalgo",
      stateCode: "TX",
      sourceName: "Simulated failing source",
      sourceUrl: "https://example-fixture.local",
      capabilities: {
        searchByOwnerName: true,
        searchByAddress: false,
        searchByParcelId: false,
        searchByLegalDescription: true,
        searchBySubdivision: false,
        searchByLotBlock: false,
        searchByMap: false,
        bulkDataAvailable: false,
        officialApiAvailable: true,
      },
      async searchProperties(query) {
        if (query.legalDescription) {
          throw new Error("Hidalgo CAD search failed: HTTP 400 for /public/property/searchfulltext");
        }
        if (query.ownerNames?.length) {
          return [baseRecord];
        }
        return [];
      },
      async getPropertyDetails(sourcePropertyId: string) {
        if (sourcePropertyId === baseRecord.sourcePropertyId) return baseRecord;
        throw new Error("not found");
      },
      async getAccessMetadata() {
        return { officialApiAvailable: true, bulkDataAvailable: false, requiresManualAccess: false, notes: "test" };
      },
    };

    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: {
          rawText: "North 5 acres of the North 9.59 acres of LOT 44 (subdivision name obscured by handwriting on the source document)",
          subdivision: null,
          lot: "44 (N 5ac of N 9.59ac)",
          block: null,
          acreage: null,
        },
        ownerNames: ["John A. Smith"],
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
        geographicIdFromNotice: null,
        city: null,
      },
      throwingAdapter,
    );

    // The legal-description strategy threw and contributed nothing, but
    // the owner-name-alone strategy after it still ran and found the
    // candidate -- the whole resolution attempt did not die.
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.sourcePropertyId).toBe(baseRecord.sourcePropertyId);
  });
});
