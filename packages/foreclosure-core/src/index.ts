export { extractDeterministic, needsAiFallback } from "./extraction/deterministic/texasTemplates";
export { parseCurrencyToCents, findAllCurrencyAmountsCents } from "./extraction/deterministic/currency";
export { parseLabeledDate, parseFirstDate, parseLabeledTime } from "./extraction/deterministic/dates";
export { detectStatedPropertyAddress, extractLabeledMailingAddress } from "./extraction/deterministic/addresses";
export { parseLegalDescription } from "./extraction/deterministic/legalDescription";
export type { ParsedLegalDescription } from "./extraction/deterministic/legalDescription";

export { aiExtractionResponseSchema, AI_EXTRACTION_SYSTEM_PROMPT } from "./extraction/ai/schema";
export type { AiExtractionResponse } from "./extraction/ai/schema";
export { extractWithAI } from "./extraction/ai/extractWithAI";
export type { AiExtractionOutcome, BudgetGuard } from "./extraction/ai/extractWithAI";

export { runExtractionPipeline } from "./extraction/pipeline";
export type { ExtractionPipelineResult } from "./extraction/pipeline";

export { resolvePropertyAddress } from "./address-resolution/resolver";
export type { ResolutionInput } from "./address-resolution/resolver";
export { MockAppraisalDistrictConnector } from "./address-resolution/appraisalDistrictConnector";
export type { AppraisalDistrictConnector, AppraisalRecord } from "./address-resolution/appraisalDistrictConnector";

export { estimateRemainingBalance, BALANCE_ESTIMATE_DISCLAIMER } from "./loan/balanceEstimator";
export type { BalanceEstimateInput } from "./loan/balanceEstimator";

export { generateForeclosureSummary } from "./summary/generateSummary";
export type { SummaryInput } from "./summary/generateSummary";
