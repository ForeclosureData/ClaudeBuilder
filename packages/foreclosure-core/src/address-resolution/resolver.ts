import type { AppraisalPropertyCandidate, CountyAppraisalAdapter, PropertyResolutionResult } from "@foreclosuredata/types";
import { resolveFromCandidates, type MatchThresholds, type ScoringInput } from "./scoring";
import { normalizeOwnerName } from "./ownerNameNormalization";
import { tokensOverlap } from "./legalDescriptionParsing";

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
  /** True when enrichment specifically found a strong (lot/block/subdivision/address) match whose CAD owner conflicts with the notice's borrower/grantor -- distinct from plain ambiguity, so the caller can raise a more precise manual-review reason. Always false on the non-explicit-address path (see PropertyResolutionResult.conflictingFields there instead). */
  ownerConflictOnBestMatch: boolean;
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
    const { candidates, requestsUsed, addressOnlyCandidates } = await gatherCandidates(input, appraisalAdapter, budget);
    const { candidate: enrichment, ownerConflictOnBestMatch } = pickEnrichmentCandidate(candidates, input, addressOnlyCandidates);

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
          (enrichment
            ? " A single unambiguous CAD match was found and used to enrich the case with valuation data."
            : ownerConflictOnBestMatch
              ? " The best-matching CAD candidate's current owner conflicts with the notice's borrower/grantor -- not auto-attached."
              : ""),
        matchedFields: ["statedAddress"],
        conflictingFields: ownerConflictOnBestMatch ? ["ownerName"] : [],
        candidateCount: candidates.length,
        requiresManualReview: false,
      },
      candidates,
      selectedCandidate: enrichment,
      ownerConflictOnBestMatch,
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
    ownerConflictOnBestMatch: !selectedCandidate && resolution.conflictingFields.includes("ownerName"),
    requestsUsed,
  };
}

/**
 * Only used for cases whose address was already explicitly stated in the
 * notice (the CAD is enrichment-only there, never a resolution source) --
 * separate from, and deliberately simpler than, scoring.ts's full fuzzy
 * scorer. Attaches valuation data only when a match is unambiguous.
 * Anything less certain enriches nothing rather than guessing -- false
 * enrichment on the wrong parcel is worse than none.
 *
 * Checked in order:
 *   1. The situs-address search alone (see gatherCandidates' step 0),
 *      when it returned exactly one result -- the single most selective
 *      strategy available, so it's trusted even when broader strategies
 *      (owner-alone, subdivision-alone) added unrelated candidates to the
 *      full pool below for conflict-detection purposes. If that one
 *      address match conflicts on lot/block/subdivision or owner name,
 *      this returns null outright rather than falling through to weaker
 *      evidence -- an address match that contradicts the notice's own
 *      legal description/owner is a red flag, not something to paper over.
 *   2. Otherwise, the full gathered pool: either it's the sole candidate
 *      and doesn't contradict known evidence, lot+block narrows multiple
 *      results down to exactly one, or (when the notice's legal
 *      description has no block at all, which is common) subdivision+lot
 *      alone does. Real example that motivated the subdivision+lot-only
 *      branch: a notice stating "LOT 1, REDBUD ESTATES" (no block) had
 *      exactly one candidate that was an unambiguous owner+subdivision+lot
 *      match sitting in a 2-candidate pool, but the old code required lot
 *      AND block together and never even tried a lot-only narrowing --
 *      confirmed against the 25-notice production run's cached candidates.
 *
 * Also refuses a candidate whose owner name is clearly unrelated to the
 * notice's borrower(s), or whose subdivision name is clearly a different
 * development than the one stated in the notice -- confirmed live: an
 * address+legal-description match can still belong to a *different
 * current owner* than the notice's defaulting borrower (the property may
 * have already changed hands since the notice was filed), and a
 * subdivision search can return a same-numbered lot from an entirely
 * different plat. Neither is caught by the lot/block check alone. This
 * only tightens acceptance, never loosens it.
 */
interface EnrichmentPick {
  candidate: AppraisalPropertyCandidate | null;
  /** True when the reason nothing was auto-attached is specifically a conflicting current owner on an otherwise strong (lot/block/subdivision/address) match -- as opposed to plain ambiguity or a lot/block/subdivision mismatch -- so the caller can raise a distinct, more precise manual-review reason. */
  ownerConflictOnBestMatch: boolean;
}

function pickEnrichmentCandidate(
  candidates: AppraisalPropertyCandidate[],
  input: ResolutionInput,
  addressOnlyCandidates: AppraisalPropertyCandidate[] | null,
): EnrichmentPick {
  const lot = input.legalDescription?.lot ?? null;
  const block = input.legalDescription?.block ?? null;
  const subdivision = input.legalDescription?.subdivision ?? null;
  const fieldConflicts = (c: AppraisalPropertyCandidate) =>
    (lot !== null && c.lot !== null && normalizeToken(c.lot) !== normalizeToken(lot)) ||
    (block !== null && c.block !== null && normalizeToken(c.block) !== normalizeToken(block)) ||
    (subdivision !== null && c.subdivision !== null && !tokensOverlap(subdivision, c.subdivision));
  const hasOwnerConflict = (c: AppraisalPropertyCandidate) => ownerNameConflicts(c.ownerName, input.ownerNames);
  const conflicts = (c: AppraisalPropertyCandidate) => fieldConflicts(c) || hasOwnerConflict(c);
  // True only when a candidate otherwise matches on every known field (lot/
  // block/subdivision) but is rejected purely because its owner conflicts --
  // the specific case that must never be silently overridden by a strong
  // score, per the "never auto-accept despite a genuine owner conflict"
  // requirement.
  const isOwnerOnlyConflict = (c: AppraisalPropertyCandidate) => !fieldConflicts(c) && hasOwnerConflict(c);

  if (addressOnlyCandidates && addressOnlyCandidates.length === 1) {
    const only = addressOnlyCandidates[0]!;
    return conflicts(only) ? { candidate: null, ownerConflictOnBestMatch: isOwnerOnlyConflict(only) } : { candidate: only, ownerConflictOnBestMatch: false };
  }

  if (candidates.length === 0) return { candidate: null, ownerConflictOnBestMatch: false };

  if (candidates.length === 1) {
    const only = candidates[0]!;
    return conflicts(only) ? { candidate: null, ownerConflictOnBestMatch: isOwnerOnlyConflict(only) } : { candidate: only, ownerConflictOnBestMatch: false };
  }

  if (lot && block) {
    const fieldMatches = candidates.filter((c) => !fieldConflicts(c) && c.lot && normalizeToken(c.lot) === normalizeToken(lot) && c.block && normalizeToken(c.block) === normalizeToken(block));
    const exact = fieldMatches.filter((c) => !hasOwnerConflict(c));
    if (exact.length === 1) return { candidate: exact[0]!, ownerConflictOnBestMatch: false };
    if (exact.length === 0 && fieldMatches.length === 1 && hasOwnerConflict(fieldMatches[0]!)) {
      return { candidate: null, ownerConflictOnBestMatch: true };
    }
  }

  // Common real case: the notice's legal description states a subdivision
  // and lot but no block at all (many Texas plats simply don't have one).
  // Narrows on subdivision + lot instead, still refusing any owner/
  // subdivision conflict -- deliberately not tried when block IS known but
  // didn't narrow to exactly one above, since that would silently ignore a
  // real block mismatch instead of surfacing it as unresolved.
  if (!block && lot && subdivision) {
    const fieldMatches = candidates.filter((c) => !fieldConflicts(c) && c.lot && normalizeToken(c.lot) === normalizeToken(lot) && c.subdivision && tokensOverlap(subdivision, c.subdivision));
    const exact = fieldMatches.filter((c) => !hasOwnerConflict(c));
    if (exact.length === 1) return { candidate: exact[0]!, ownerConflictOnBestMatch: false };
    if (exact.length === 0 && fieldMatches.length === 1 && hasOwnerConflict(fieldMatches[0]!)) {
      return { candidate: null, ownerConflictOnBestMatch: true };
    }
  }

  return { candidate: null, ownerConflictOnBestMatch: false };
}

const NAME_SUFFIX_WORDS = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/**
 * Significant, comparable tokens from a raw name string: uppercased,
 * punctuation stripped, split on whitespace/"&", suffixes and single-
 * letter middle initials dropped. Deliberately simpler than (and doesn't
 * reuse) ownerNameNormalization.ts's first/last-name splitting, which
 * assumes a "First ... Last" token order -- CAD's own displayName format
 * is "Surname First Middle" and, for a multi-person household, often a
 * single compound string ("CISNEROS JOSE ALBERTO JR & GABRIELA ISABEL"),
 * neither of which that splitter handles correctly. A plain token-overlap
 * check needs no name-order assumption to tell "these are almost
 * certainly the same household" from "these are unrelated people."
 */
function significantNameTokens(name: string): Set<string> {
  return new Set(
    name
      .toUpperCase()
      .replace(/[.,]/g, "")
      .split(/[\s&]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !NAME_SUFFIX_WORDS.has(t)),
  );
}

/** True only when both a candidate owner name and at least one notice-stated owner name exist, and they share no significant name token -- i.e. an actual, checkable mismatch, not merely "we don't know." */
function ownerNameConflicts(candidateOwnerName: string | null, inputOwnerNames: string[]): boolean {
  if (!candidateOwnerName || inputOwnerNames.length === 0) return false;
  const candidateTokens = significantNameTokens(candidateOwnerName);
  if (candidateTokens.size === 0) return false;
  const anyOverlap = inputOwnerNames.some((name) => {
    const inputTokens = significantNameTokens(name);
    for (const token of inputTokens) if (candidateTokens.has(token)) return true;
    return false;
  });
  return !anyOverlap;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Gathers candidates via every applicable strategy the adapter supports,
 * deduped by sourcePropertyId, in priority order (most selective first):
 *   0. Situs address (only when the notice already states one)
 *   A. Parcel ID          B. Geographic ID       C. Subdivision (+lot/block)
 *   D. Legal description  F. Owner name + subdivision (+lot)
 *   G. Owner name + acreage   E. Owner name alone (last resort)
 * All applicable strategies run (not just until something is found) —
 * scoring.ts, not this function, decides which candidates matter. Owner
 * name alone (E) is deliberately tried *last*: F/G corroborate an owner
 * search with a second field first, and even E itself asks the adapter to
 * prefer a precise full-name match over a broad surname sweep (see
 * appraisalAdapter.ts) before scoring ever sees the result (step H —
 * fuzzy candidate scoring).
 *
 * `budget`, when provided, is threaded all the way into the adapter (see
 * AppraisalRequestBudget) so it bounds every real HTTP request the
 * adapter makes for a strategy -- including every page fetched inside a
 * single searchProperties() call, not just "1 request per strategy".
 * `requestsUsed` in the return value reflects that same real count
 * (falling back to a per-strategy-attempted count when no budget object
 * is supplied, e.g. the fixture/mock adapter in tests).
 */
async function gatherCandidates(
  input: ResolutionInput,
  adapter: CountyAppraisalAdapter,
  budget?: RequestBudget,
): Promise<{ candidates: AppraisalPropertyCandidate[]; requestsUsed: number; addressOnlyCandidates: AppraisalPropertyCandidate[] | null }> {
  const byId = new Map<string, AppraisalPropertyCandidate>();
  const initialRemaining = budget?.remaining;
  let strategiesAttempted = 0;
  const add = (list: AppraisalPropertyCandidate[]) => {
    for (const c of list) byId.set(c.sourcePropertyId, c);
  };
  const hasBudget = () => budget === undefined || budget.remaining > 0;
  const spend = async (query: Parameters<CountyAppraisalAdapter["searchProperties"]>[0]) => {
    if (!hasBudget()) return null;
    strategiesAttempted += 1;
    const result = await adapter.searchProperties(query, budget);
    add(result);
    return result;
  };

  // 0. Situs address -- the most selective query the adapter supports, so
  // it's tried before any broader subdivision/owner sweep whenever the
  // notice already states one (mainly matters for the enrichment path,
  // since this function's other caller -- the no-stated-address path --
  // naturally has nothing here to search on). Its own result is tracked
  // separately (not just merged into the pool) so pickEnrichmentCandidate
  // can trust an unambiguous address match even when a later, broader
  // strategy (owner-alone, subdivision-alone) adds unrelated candidates
  // to the pool for conflict-detection purposes.
  let addressOnlyCandidates: AppraisalPropertyCandidate[] | null = null;
  if (input.statedPropertyAddress && adapter.capabilities.searchByAddress) {
    addressOnlyCandidates = await spend({ streetAddress: input.statedPropertyAddress });
  }
  // A. Parcel ID
  if (input.propertyIdFromNotice && adapter.capabilities.searchByParcelId) {
    await spend({ parcelId: input.propertyIdFromNotice });
  }
  // B. Geographic ID
  if (input.geographicIdFromNotice && adapter.capabilities.searchByParcelId) {
    await spend({ geographicId: input.geographicIdFromNotice });
  }
  // C. Subdivision (+ lot/block when known) — still searched by
  // subdivision alone rather than lot-filtered only: a subdivision search
  // should surface every lot in it, so scoring.ts can both confirm an
  // exact subdivision+lot+block match *and* detect a conflicting one (a
  // different lot in the same subdivision). The adapter narrows to the
  // exact lot when it can and paginates until it finds it (or gives up),
  // but always falls back to the full set rather than hiding a conflict.
  if (input.legalDescription?.subdivision && adapter.capabilities.searchBySubdivision) {
    await spend({
      subdivision: input.legalDescription.subdivision,
      lot: input.legalDescription.lot ?? undefined,
      block: input.legalDescription.block ?? undefined,
    });
  }
  // D. Legal description (full text)
  if (input.legalDescription?.rawText && adapter.capabilities.searchByLegalDescription) {
    await spend({ legalDescription: input.legalDescription.rawText });
  }

  const ownerVariants = input.ownerNames.flatMap((n) => normalizeOwnerName(n).people);
  const ownerQueryNames = ownerVariants.length ? ownerVariants : input.ownerNames;

  // F. Owner name + subdivision (+ lot, so the adapter can stop paginating
  // once the exact lot appears)
  if (ownerQueryNames.length && input.legalDescription?.subdivision && adapter.capabilities.searchByOwnerName && adapter.capabilities.searchBySubdivision) {
    await spend({ ownerNames: ownerQueryNames, subdivision: input.legalDescription.subdivision, lot: input.legalDescription.lot ?? undefined });
  }
  // G. Owner name + acreage
  if (ownerQueryNames.length && input.legalDescription?.acreage != null && adapter.capabilities.searchByOwnerName) {
    await spend({ ownerNames: ownerQueryNames, acreage: input.legalDescription.acreage });
  }
  // E. Owner name alone -- last resort; see appraisalAdapter.ts for why
  // this still isn't simply "the broadest possible search" (it tries the
  // complete stated name as one precise full-text query before falling
  // back to a bare-surname sweep).
  if (ownerQueryNames.length && adapter.capabilities.searchByOwnerName) {
    await spend({ ownerNames: ownerQueryNames });
  }

  // H. Fuzzy candidate scoring happens downstream in scoring.ts against
  // this full gathered set, not as a separate search step here.

  const requestsUsed = budget && initialRemaining !== undefined ? initialRemaining - budget.remaining : strategiesAttempted;
  return { candidates: Array.from(byId.values()), requestsUsed, addressOnlyCandidates };
}
