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
  /** How many live adapter.searchProperties() calls were actually made gathering these candidates. */
  requestsUsed: number;
}

/** Caps how many adapter.searchProperties() calls gatherCandidates() will make for one notice -- a live-access rate/cost control, independent of scoring. Mutated in place as requests are used; omit for unlimited (the default for fixture/mock adapters in tests). */
export interface RequestBudget {
  remaining: number;
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
  budget?: RequestBudget,
): Promise<ResolutionOutcome> {
  if (input.statedPropertyAddress && input.statedAddressMethod) {
    const method = input.statedAddressMethod;
    // The address itself is already known and trusted from the notice
    // text, so it's never replaced here. The CAD is still consulted (bound
    // by the same request budget as an unresolved case) purely to ENRICH
    // this case with appraisal-district data (market/appraised value,
    // parcel ID, etc.) -- pickEnrichmentCandidate() only attaches that data
    // when a single unambiguous match is found, never on owner-name-alone
    // evidence, and never touches resolvedAddress/addressResolutionMethod.
    const { candidates, requestsUsed } = await gatherCandidates(input, appraisalAdapter, budget);
    const enrichment = pickEnrichmentCandidate(candidates, input);

    return {
      address: {
        addressResolutionMethod: method,
        addressResolutionConfidence: method === "EXPLICIT_STATED" ? 0.98 : 0.9,
        addressResolutionExplanation:
          method === "EXPLICIT_STATED"
            ? "The property street address was explicitly stated in the foreclosure notice."
            : 'A "commonly known as" phrase in the notice stated the property street address.',
        resolvedAddress: input.statedPropertyAddress,
        propertyId: enrichment?.sourcePropertyId ?? null,
      },
      resolution: {
        selectedCandidateId: enrichment?.sourcePropertyId ?? null,
        confidence: method === "EXPLICIT_STATED" ? 0.98 : 0.9,
        resolutionMethod: "explicit_address",
        explanation:
          "Address was explicitly stated in the source document; no appraisal-district lookup was needed to resolve it." +
          (enrichment ? " A single unambiguous CAD match was found and used to enrich the case with valuation data." : ""),
        matchedFields: ["statedAddress"],
        conflictingFields: [],
        candidateCount: candidates.length,
        requiresManualReview: false,
      },
      candidates,
      selectedCandidate: enrichment,
      requestsUsed,
    };
  }

  const { candidates, requestsUsed } = await gatherCandidates(input, appraisalAdapter, budget);

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
    requestsUsed,
  };
}

/**
 * Only used for cases whose address was already explicitly stated in the
 * notice (the CAD is enrichment-only there, never a resolution source) --
 * separate from, and deliberately simpler than, scoring.ts's full fuzzy
 * scorer. Attaches valuation data only when exactly one CAD candidate is
 * unambiguous: either it's the sole result and doesn't contradict a known
 * lot/block, or lot+block from the notice narrows multiple results down
 * to exactly one. Anything less certain enriches nothing rather than
 * guessing -- false enrichment on the wrong parcel is worse than none.
 */
function pickEnrichmentCandidate(candidates: AppraisalPropertyCandidate[], input: ResolutionInput): AppraisalPropertyCandidate | null {
  if (candidates.length === 0) return null;

  const lot = input.legalDescription?.lot ?? null;
  const block = input.legalDescription?.block ?? null;

  if (candidates.length === 1) {
    const only = candidates[0]!;
    if (lot && only.lot && normalizeToken(only.lot) !== normalizeToken(lot)) return null;
    if (block && only.block && normalizeToken(only.block) !== normalizeToken(block)) return null;
    return only;
  }

  if (lot && block) {
    const exact = candidates.filter((c) => c.lot && normalizeToken(c.lot) === normalizeToken(lot) && c.block && normalizeToken(c.block) === normalizeToken(block));
    if (exact.length === 1) return exact[0]!;
  }

  return null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Gathers candidates via every applicable strategy the adapter supports,
 * deduped by sourcePropertyId, in priority order:
 *   A. Parcel ID          B. Geographic ID       C. Subdivision (+lot/block, via scoring)
 *   D. Legal description  E. Owner name alone    F. Owner name + subdivision
 *   G. Owner name + acreage
 * All applicable strategies run (not just until something is found) —
 * scoring.ts, not this function, decides which candidates matter. Owner
 * name is never the *only* thing tried: strategies A-D always run first
 * when the notice has the data for them, and F/G exist specifically so an
 * owner-name search is corroborated by a second field before scoring
 * treats it as strong evidence (step H — fuzzy candidate scoring).
 *
 * `budget`, when provided, caps how many of these strategies actually
 * reach the adapter -- once exhausted, remaining strategies are simply
 * skipped (not retried later), same as if the notice lacked that data.
 */
async function gatherCandidates(
  input: ResolutionInput,
  adapter: CountyAppraisalAdapter,
  budget?: RequestBudget,
): Promise<{ candidates: AppraisalPropertyCandidate[]; requestsUsed: number }> {
  const byId = new Map<string, AppraisalPropertyCandidate>();
  let requestsUsed = 0;
  const add = (list: AppraisalPropertyCandidate[]) => {
    for (const c of list) byId.set(c.sourcePropertyId, c);
  };
  const hasBudget = () => budget === undefined || budget.remaining > 0;
  const spend = async (query: Parameters<CountyAppraisalAdapter["searchProperties"]>[0]) => {
    if (!hasBudget()) return;
    if (budget) budget.remaining -= 1;
    requestsUsed += 1;
    add(await adapter.searchProperties(query));
  };

  // A. Parcel ID
  if (input.propertyIdFromNotice && adapter.capabilities.searchByParcelId) {
    await spend({ parcelId: input.propertyIdFromNotice });
  }
  // B. Geographic ID
  if (input.geographicIdFromNotice && adapter.capabilities.searchByParcelId) {
    await spend({ geographicId: input.geographicIdFromNotice });
  }
  // C. Subdivision — deliberately searched alone (not filtered by lot/block
  // too): a subdivision search should return every lot in it, so scoring.ts
  // can both confirm an exact subdivision+lot+block match *and* detect a
  // conflicting one (a different lot in the same subdivision). Filtering by
  // lot here would silently hide that conflict from the scorer.
  if (input.legalDescription?.subdivision && adapter.capabilities.searchBySubdivision) {
    await spend({ subdivision: input.legalDescription.subdivision });
  }
  // D. Legal description (full text)
  if (input.legalDescription?.rawText && adapter.capabilities.searchByLegalDescription) {
    await spend({ legalDescription: input.legalDescription.rawText });
  }

  const ownerVariants = input.ownerNames.flatMap((n) => normalizeOwnerName(n).people);
  const ownerQueryNames = ownerVariants.length ? ownerVariants : input.ownerNames;

  // E. Owner name alone
  if (ownerQueryNames.length && adapter.capabilities.searchByOwnerName) {
    await spend({ ownerNames: ownerQueryNames });
  }
  // F. Owner name + subdivision
  if (ownerQueryNames.length && input.legalDescription?.subdivision && adapter.capabilities.searchByOwnerName && adapter.capabilities.searchBySubdivision) {
    await spend({ ownerNames: ownerQueryNames, subdivision: input.legalDescription.subdivision });
  }
  // G. Owner name + acreage
  if (ownerQueryNames.length && input.legalDescription?.acreage != null && adapter.capabilities.searchByOwnerName) {
    await spend({ ownerNames: ownerQueryNames, acreage: input.legalDescription.acreage });
  }

  // H. Fuzzy candidate scoring happens downstream in scoring.ts against
  // this full gathered set, not as a separate search step here.

  return { candidates: Array.from(byId.values()), requestsUsed };
}
