import type { AddressResolutionMethod, AddressResolutionResult } from "@foreclosuredata/types";
import type { AppraisalDistrictConnector, AppraisalRecord } from "./appraisalDistrictConnector";

export interface ResolutionInput {
  statedPropertyAddress: string | null;
  statedAddressMethod: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE" | null;
  legalDescription: { subdivision: string | null; lot: string | null; block: string | null; acreage: number | null } | null;
  ownerName: string | null;
  ownerMailingAddress: string | null;
  propertyIdFromNotice: string | null;
  geocode?: (address: string) => Promise<{ lat: number; lng: number } | null>;
}

/**
 * Implements the 8-step resolution sequence from the product spec, in
 * order, stopping at the first step that produces a confident, unambiguous
 * match. Every path records *why* it chose (or failed to choose) an
 * address — never assumes a mailing address is the property address (step
 * 5 explicitly compares it against the situs address rather than assuming
 * equality).
 */
export async function resolvePropertyAddress(
  input: ResolutionInput,
  appraisalDistrict: AppraisalDistrictConnector,
): Promise<AddressResolutionResult & { candidates: AppraisalRecord[] }> {
  // 1 & 2: explicit address / "commonly known as" phrase already extracted upstream.
  if (input.statedPropertyAddress && input.statedAddressMethod) {
    return {
      addressResolutionMethod: input.statedAddressMethod,
      addressResolutionConfidence: input.statedAddressMethod === "EXPLICIT_STATED" ? 0.95 : 0.85,
      addressResolutionExplanation:
        input.statedAddressMethod === "EXPLICIT_STATED"
          ? "The property street address was explicitly stated in the foreclosure notice."
          : "A \"commonly known as\" phrase in the notice stated the property street address.",
      resolvedAddress: input.statedPropertyAddress,
      propertyId: null,
      candidates: [],
    };
  }

  // 3 & 4: legal description / property-ID / subdivision+lot+block+acreage+owner match against appraisal records.
  if (input.propertyIdFromNotice) {
    const byId = await appraisalDistrict.findByPropertyId(input.propertyIdFromNotice);
    if (byId) {
      return {
        addressResolutionMethod: "PROPERTY_ID_MATCH",
        addressResolutionConfidence: 0.9,
        addressResolutionExplanation: `Property ID "${input.propertyIdFromNotice}" stated in the notice matched a single appraisal district record.`,
        resolvedAddress: byId.situsAddress,
        propertyId: byId.propertyIdNumber,
        candidates: [byId],
      };
    }
  }

  if (input.legalDescription) {
    const legalMatches = await appraisalDistrict.findByLegalDescription(input.legalDescription);
    if (legalMatches.length === 1) {
      const match = legalMatches[0]!;
      const ownerMatches = input.ownerName ? namesLikelyMatch(input.ownerName, match.ownerName) : true;
      return {
        addressResolutionMethod: "LEGAL_DESCRIPTION_MATCH",
        addressResolutionConfidence: ownerMatches ? 0.93 : 0.75,
        addressResolutionExplanation: ownerMatches
          ? `Matched subdivision, lot, block${input.legalDescription.acreage ? ", and acreage" : ""} and owner surname to the county appraisal record.`
          : `Matched subdivision, lot, and block to the county appraisal record, but the owner name on file did not clearly match — verify independently.`,
        resolvedAddress: match.situsAddress,
        propertyId: match.propertyIdNumber,
        candidates: legalMatches,
      };
    }
    if (legalMatches.length > 1) {
      const withOwnerMatch = input.ownerName
        ? legalMatches.filter((m) => namesLikelyMatch(input.ownerName as string, m.ownerName))
        : [];
      if (withOwnerMatch.length === 1) {
        const match = withOwnerMatch[0]!;
        return {
          addressResolutionMethod: "LEGAL_DESCRIPTION_MATCH",
          addressResolutionConfidence: 0.88,
          addressResolutionExplanation:
            "Multiple appraisal records shared the same subdivision/lot/block; the owner surname narrowed it to a single match.",
          resolvedAddress: match.situsAddress,
          propertyId: match.propertyIdNumber,
          candidates: legalMatches,
        };
      }
      // Multiple plausible matches, unresolved by owner name — send to manual review.
      return {
        addressResolutionMethod: "UNRESOLVED",
        addressResolutionConfidence: 0.35,
        addressResolutionExplanation:
          "Legal description matched multiple plausible appraisal district records and the owner name did not narrow it to one — sent to manual review.",
        resolvedAddress: null,
        propertyId: null,
        candidates: legalMatches,
      };
    }
  }

  // 5: compare owner mailing address against situs address (never assume equal) via an owner-name lookup.
  if (input.ownerName) {
    const ownerMatches = await appraisalDistrict.findByOwnerName(input.ownerName);
    if (ownerMatches.length === 1) {
      const match = ownerMatches[0]!;
      const mailingMatchesSitus =
        input.ownerMailingAddress && normalizeAddress(input.ownerMailingAddress) === normalizeAddress(match.situsAddress);
      return {
        addressResolutionMethod: "OWNER_MAILING_ADDRESS_MATCH",
        addressResolutionConfidence: mailingMatchesSitus ? 0.7 : 0.6,
        addressResolutionExplanation: mailingMatchesSitus
          ? "Owner name matched a single appraisal record whose situs address also matches the owner's mailing address (likely owner-occupied)."
          : "Owner name matched a single appraisal district record by name only; the owner's mailing address differs from the situs address, so occupancy should not be assumed.",
        resolvedAddress: match.situsAddress,
        propertyId: match.propertyIdNumber,
        candidates: ownerMatches,
      };
    }
  }

  // 6: geocoding only after a probable address exists — none was found, so we do not invoke it.
  // 7 & 8: no confident match — flag for manual review rather than guessing.
  return {
    addressResolutionMethod: "UNRESOLVED",
    addressResolutionConfidence: 0,
    addressResolutionExplanation:
      "No street address was stated in the notice, and legal-description/owner-name matching against appraisal records did not produce a confident match.",
    resolvedAddress: null,
    propertyId: null,
    candidates: [],
  };
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

function namesLikelyMatch(a: string, b: string): boolean {
  const surnameOf = (name: string) => name.toLowerCase().trim().split(/\s+/).filter(Boolean).pop() ?? "";
  return surnameOf(a) === surnameOf(b);
}

export type { AddressResolutionMethod };
