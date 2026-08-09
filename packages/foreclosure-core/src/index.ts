export { extractDeterministic, needsAiFallback } from "./extraction/deterministic/texasTemplates";
export { extractLenderParties } from "./extraction/deterministic/lenderExtraction";
export type { LenderExtractionResult } from "./extraction/deterministic/lenderExtraction";
export { parseCurrencyToCents, findAllCurrencyAmountsCents } from "./extraction/deterministic/currency";
export { parseLabeledDate, parseFirstDate, parseLabeledTime } from "./extraction/deterministic/dates";
export { detectStatedPropertyAddress, extractLabeledMailingAddress } from "./extraction/deterministic/addresses";
export { normalizeAddressForReuseCheck, isRepeatedAcrossCases } from "./extraction/deterministic/addressReuseDetection";
export { parseLegalDescription } from "./extraction/deterministic/legalDescription";
export type { ParsedLegalDescription } from "./extraction/deterministic/legalDescription";

export { aiExtractionResponseSchema, AI_EXTRACTION_SYSTEM_PROMPT } from "./extraction/ai/schema";
export type { AiExtractionResponse } from "./extraction/ai/schema";
export { extractWithAI } from "./extraction/ai/extractWithAI";
export type { AiExtractionOutcome, BudgetGuard } from "./extraction/ai/extractWithAI";

export { runExtractionPipeline } from "./extraction/pipeline";
export type { ExtractionPipelineResult } from "./extraction/pipeline";

export { resolvePropertyAddress } from "./address-resolution/resolver";
export type { ResolutionInput, ResolvedAddress, ResolutionOutcome, RequestBudget } from "./address-resolution/resolver";
export { MockCountyAppraisalAdapter, HidalgoCountyAppraisalAdapter, selectDisplayValuation, extractStreetSearchTerm } from "./address-resolution/appraisalAdapter";
export type {
  CountyAppraisalAdapter,
  AppraisalPropertySearchQuery,
  AppraisalPropertyCandidate,
  AppraisalPropertyRecord,
  AppraisalSourceAccessMetadata,
  AppraisalValueYear,
} from "./address-resolution/appraisalAdapter";
export { getValuationHistory as getHidalgoValuationHistory } from "./address-resolution/hidalgoCadClient";
export { scoreCandidates, resolveFromCandidates, getMatchThresholdsFromEnv, explainMatch } from "./address-resolution/scoring";
export type { ScoringInput, ScoredCandidate, MatchThresholds } from "./address-resolution/scoring";
export { normalizeOwnerName, ownerNamesLikelyRelated, surnamesMatch } from "./address-resolution/ownerNameNormalization";
export type { NormalizedOwnerName } from "./address-resolution/ownerNameNormalization";
export { parseLegalDescriptionTokens, normalizeToken, tokensOverlap, buildLegalDescriptionCacheKey, sanitizeCadSearchText } from "./address-resolution/legalDescriptionParsing";
export type { ParsedLegalDescriptionTokens } from "./address-resolution/legalDescriptionParsing";

export { estimateRemainingBalance, BALANCE_ESTIMATE_DISCLAIMER } from "./loan/balanceEstimator";
export type { BalanceEstimateInput } from "./loan/balanceEstimator";

export { generateForeclosureSummary } from "./summary/generateSummary";
export type { SummaryInput } from "./summary/generateSummary";

export { normalizeCountyFilingNumber, buildNoticeIdentityKey } from "./identity/noticeIdentity";
export type { NoticeIdentityKey } from "./identity/noticeIdentity";

export { chooseCanonicalCase, scoreCanonicalCandidate } from "./dedup/chooseCanonical";
export type { CanonicalCandidateInput, CanonicalSelectionResult, ScoredCanonicalCandidate } from "./dedup/chooseCanonical";

export { scoreDuplicateEvidence, rawTextFingerprintSimilarity } from "./duplicateDetection/scoring";
export type { DuplicateComparisonCaseSnapshot, DuplicateConfidence, DuplicateEvidenceResult } from "./duplicateDetection/scoring";

export { computePublicationStatus, isPubliclyVisibleStatus, CRITICAL_BLOCKER_REVIEW_REASONS, NON_BLOCKING_REVIEW_REASONS } from "./publication/publicationStatus";
export type { PublicationStatus, PublicationInput, PublicationResult } from "./publication/publicationStatus";
