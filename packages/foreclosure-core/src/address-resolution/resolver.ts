import type { AppraisalPropertyCandidate, CountyAppraisalAdapter, PropertyResolutionResult } from "@foreclosuredata/types";
import { resolveFromCandidates, type MatchThresholds, type ScoringInput } from "./scoring";
import { normalizeOwnerName } from "./ownerNameNormalization";

export interface ResolutionInput {
  statedPropertyAddress: string | null;
  statedAddressMethod: "EXPLICIT_STATED" | "COMMONLY_KNOWN_AS_PHRASE" | null;
  legalDescription: { rawText?: string | null; subdivision: string | null; lot: string | null; block: string | null; acreage: number | null } | null;
  ownerNames: string[];
  ownerMailingAddress: string | null;
  propertyIdFromNotice: string | null;
  geographicIdFromNotice: string | null;
  city: string | null;
}

export interface ResolvedAddress {
  addressResolutionMethod:
    | "EXPLICIT_STATED"
    | "COMMONLY_KNOWN_AS_PHRASE"
    | "LEGAL_DESCRIPTION_MATCH"
    | "PROPERTY_ID_MATCH"
    | "GEOGRAPHIC_ID_MATCH"
    | "OWNER_MAILING_ADDRESS_MATCH"
    | "MULTI_FIELD_MATCH"
    | "UNRESOLVED";
  addressResolutionConfidence: number;
  addressResolutionExplanation: string;
  resolvedAddress: string | null;
  propertyId: string | null;
}

export interface ResolutionOutcome {
  address: ResolvedAddress;
  resolution: PropertyResolutionResult;
  candidates: AppraisalPropertyCandidate[];
  selectedCandidate: AppraisalPropertyCandidate | null;
}

/**
 * Orchestrates the 10-step resolution sequence from the product spec:
 * 1-2 (explicit address / "commonly known as") are handled here directly,
 * short-circuiting everything else. 3-9 gather candidates from the
 * CountyAppraisalAdapter (parcel ID, geographic ID, legal description,
 * subdivision+lot+block, owner name — in that priority) and hand them to
 * scoring.ts, which implements the weighted evidence and auto-accept/
 * review/margin thresholds (step 10, fuzzy scoring + manual review).
 *
 * Never assumes the owner's mailing address is the foreclosed property —
 * step 9's mailing-address comparison is a low-weight corroborating
 * signal in scoring.ts, not a resolution method on its own.
 */
export async function resolvePropertyAddress(
  input: ResolutionInput,
  appraisalAdapter: CountyAppraisalAdapter,
  thresholds?: MatchThresholds,
): Promise<ResolutionOutcome> {
  if (input.statedPropertyAddress && input.statedAddressMethod) {
    const method = input.statedAddressMethod;
    return {
      address: {
        addressResolutionMethod: method,
        addressResolutionConfidence: method === "EXPLICIT_STATED" ? 0.98 : 0.9,
        addressResolutionExplanation:
          method === "EXPLICIT_STATED"
            ? "The property street address was explicitly stated in the foreclosure notice."
            : 'A "commonly known as" phrase in the notice stated the property street address.',
        resolvedAddress: input.statedPropertyAddress,
        propertyId: null,
      },
      resolution: {
        selectedCandidateId: null,
        confidence: method === "EXPLICIT_STATED" ? 0.98 : 0.9,
        resolutionMethod: "explicit_address",
        explanation: "Address was explicitly stated in the source document; no appraisal-district lookup was needed.",
        matchedFields: ["statedAddress"],
        conflictingFields: [],
        candidateCount: 0,
        requiresManualReview: false,
      },
      candidates: [],
      selectedCandidate: null,
    };
  }

  const candidates = await gatherCandidates(input, appraisalAdapter);

  const scoringInput: ScoringInput = {
    ownerNames: input.ownerNames,
    streetAddress: null,
    city: input.city,
    parcelId: input.propertyIdFromNotice,
    geographicId: input.geographicIdFromNotice,
    legalDescriptionRawText: input.legalDescription?.rawText ?? null,
    subdivision: input.legalDescription?.subdivision ?? null,
    lot: input.legalDescription?.lot ?? null,
    block: input.legalDescription?.block ?? null,
    acreage: input.legalDescription?.acreage ?? null,
    ownerMailingAddress: input.ownerMailingAddress,
  };

  const resolution = resolveFromCandidates(scoringInput, candidates, thresholds);
  const selectedCandidate = resolution.selectedCandidateId
    ? candidates.find((c) => c.sourcePropertyId === resolution.selectedCandidateId) ?? null
    : null;

  const methodMap: Record<PropertyResolutionResult["resolutionMethod"], ResolvedAddress["addressResolutionMethod"]> = {
    explicit_address: "EXPLICIT_STATED",
    parcel_id_match: "PROPERTY_ID_MATCH",
    geographic_id_match: "GEOGRAPHIC_ID_MATCH",
    exact_legal_description: "LEGAL_DESCRIPTION_MATCH",
    subdivision_lot_block: "LEGAL_DESCRIPTION_MATCH",
    multi_field_match: "MULTI_FIELD_MATCH",
    manual: "OWNER_MAILING_ADDRESS_MATCH",
    unresolved: "UNRESOLVED",
  };

  return {
    address: {
      addressResolutionMethod: methodMap[resolution.resolutionMethod],
      addressResolutionConfidence: resolution.requiresManualReview ? 0 : resolution.confidence,
      addressResolutionExplanation: resolution.explanation,
      resolvedAddress: selectedCandidate?.situsAddress ?? null,
      propertyId: selectedCandidate?.sourcePropertyId ?? null,
    },
    resolution,
    candidates,
    selectedCandidate,
  };
}

/** Gathers candidates via every applicable search the adapter supports, deduped by sourcePropertyId. */
async function gatherCandidates(input: ResolutionInput, adapter: CountyAppraisalAdapter): Promise<AppraisalPropertyCandidate[]> {
  const byId = new Map<string, AppraisalPropertyCandidate>();
  const add = (list: AppraisalPropertyCandidate[]) => {
    for (const c of list) byId.set(c.sourcePropertyId, c);
  };

  if (input.propertyIdFromNotice && adapter.capabilities.searchByParcelId) {
    add(await adapter.searchProperties({ parcelId: input.propertyIdFromNotice }));
  }
  if (input.geographicIdFromNotice && adapter.capabilities.searchByParcelId) {
    add(await adapter.searchProperties({ geographicId: input.geographicIdFromNotice }));
  }
  if (input.legalDescription?.subdivision && adapter.capabilities.searchBySubdivision) {
    // Deliberately search by subdivision alone (not lot/block too) — a
    // subdivision search should return every lot in it, so scoring.ts can
    // both confirm an exact lot/block match *and* detect a conflicting one
    // (a different lot in the same subdivision). Filtering by lot here
    // would silently hide that conflict from the scorer.
    add(await adapter.searchProperties({ subdivision: input.legalDescription.subdivision }));
  }
  if (input.legalDescription?.rawText && adapter.capabilities.searchByLegalDescription && byId.size === 0) {
    add(await adapter.searchProperties({ legalDescription: input.legalDescription.rawText }));
  }
  if (input.ownerNames.length && adapter.capabilities.searchByOwnerName) {
    const variants = input.ownerNames.flatMap((n) => normalizeOwnerName(n).people);
    add(await adapter.searchProperties({ ownerNames: variants.length ? variants : input.ownerNames }));
  }

  return Array.from(byId.values());
}
