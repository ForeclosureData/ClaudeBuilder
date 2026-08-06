import { describe, it, expect } from "vitest";
import { resolvePropertyAddress } from "../src/address-resolution/resolver";
import { MockAppraisalDistrictConnector, type AppraisalRecord } from "../src/address-resolution/appraisalDistrictConnector";

const baseRecord: AppraisalRecord = {
  propertyIdNumber: "P-001",
  geographicId: "G-001",
  ownerName: "John A. Smith",
  situsAddress: "1417 N Cage Blvd, Pharr, TX 78577",
  city: "Pharr",
  zipCode: "78577",
  subdivision: "Sunrise Terrace Subdivision",
  lot: "14",
  block: "3",
  acreage: 0.21,
  appraisedValueCents: 18_500_00,
};

describe("resolvePropertyAddress", () => {
  it("prefers an explicitly stated address over any lookup", async () => {
    const connector = new MockAppraisalDistrictConnector([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: "900 S 10th St, McAllen, TX 78501",
        statedAddressMethod: "EXPLICIT_STATED",
        legalDescription: null,
        ownerName: null,
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
      },
      connector,
    );
    expect(result.addressResolutionMethod).toBe("EXPLICIT_STATED");
    expect(result.addressResolutionConfidence).toBeGreaterThanOrEqual(0.9);
    expect(result.resolvedAddress).toBe("900 S 10th St, McAllen, TX 78501");
  });

  it("resolves via legal description + owner surname when no address is stated", async () => {
    const connector = new MockAppraisalDistrictConnector([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: { subdivision: "Sunrise Terrace Subdivision", lot: "14", block: "3", acreage: 0.21 },
        ownerName: "John A. Smith",
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
      },
      connector,
    );
    expect(result.addressResolutionMethod).toBe("LEGAL_DESCRIPTION_MATCH");
    expect(result.resolvedAddress).toBe(baseRecord.situsAddress);
    expect(result.addressResolutionConfidence).toBeGreaterThan(0.9);
  });

  it("flags multiple plausible legal-description matches as unresolved rather than guessing", async () => {
    const secondRecord: AppraisalRecord = { ...baseRecord, propertyIdNumber: "P-002", ownerName: "Maria Garcia", situsAddress: "2 Other St" };
    const connector = new MockAppraisalDistrictConnector([baseRecord, secondRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: { subdivision: "Sunrise Terrace Subdivision", lot: "14", block: "3", acreage: 0.21 },
        ownerName: "Someone Else",
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
      },
      connector,
    );
    expect(result.addressResolutionMethod).toBe("UNRESOLVED");
    expect(result.resolvedAddress).toBeNull();
    expect(result.candidates.length).toBe(2);
  });

  it("never assumes the owner's mailing address is the property address", async () => {
    const connector = new MockAppraisalDistrictConnector([baseRecord]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: null,
        ownerName: "John A. Smith",
        ownerMailingAddress: "PO Box 999, Some Other City, TX 00000",
        propertyIdFromNotice: null,
      },
      connector,
    );
    // Resolved via owner-name match, but confidence is lower and the
    // explanation must not claim occupancy since the mailing address
    // doesn't match the situs address.
    expect(result.addressResolutionMethod).toBe("OWNER_MAILING_ADDRESS_MATCH");
    expect(result.resolvedAddress).toBe(baseRecord.situsAddress);
    expect(result.addressResolutionExplanation).not.toMatch(/owner-occupied/i);
  });

  it("returns UNRESOLVED with zero confidence when nothing matches", async () => {
    const connector = new MockAppraisalDistrictConnector([]);
    const result = await resolvePropertyAddress(
      {
        statedPropertyAddress: null,
        statedAddressMethod: null,
        legalDescription: { subdivision: "Nonexistent", lot: "1", block: "1", acreage: null },
        ownerName: "Nobody Here",
        ownerMailingAddress: null,
        propertyIdFromNotice: null,
      },
      connector,
    );
    expect(result.addressResolutionMethod).toBe("UNRESOLVED");
    expect(result.addressResolutionConfidence).toBe(0);
  });
});
