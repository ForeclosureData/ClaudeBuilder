import type { BalanceEstimateAssumptions, BalanceEstimateResult } from "@foreclosuredata/types";

export const BALANCE_ESTIMATE_DISCLAIMER =
  "This is an estimate only, not a payoff statement. It does not account for missed payments, " +
  "fees, advances, attorney fees, taxes, insurance, or foreclosure costs. Verify the actual " +
  "payoff amount independently before relying on it.";

export interface BalanceEstimateInput {
  originalPrincipalCents: number;
  originalLoanDateIso: string;
  assumedAnnualInterestRatePct?: number;
  assumedTermYears?: number;
  calculationDate?: Date;
}

const DEFAULT_ANNUAL_RATE_PCT = 6.5;
const DEFAULT_TERM_YEARS = 30;

/**
 * Standalone module (per product requirement) that estimates a remaining
 * principal balance via straightforward fixed-rate amortization. Only
 * called when the notice/loan record has no explicitly stated current
 * balance. The result must always be presented as an estimate — callers
 * must not label it a payoff amount.
 */
export function estimateRemainingBalance(input: BalanceEstimateInput): BalanceEstimateResult {
  const annualRatePct = input.assumedAnnualInterestRatePct ?? DEFAULT_ANNUAL_RATE_PCT;
  const termYears = input.assumedTermYears ?? DEFAULT_TERM_YEARS;
  const calculationDate = input.calculationDate ?? new Date();

  const monthlyRate = annualRatePct / 100 / 12;
  const totalMonths = termYears * 12;
  const loanStart = new Date(input.originalLoanDateIso);
  const monthsElapsed = Math.min(
    totalMonths,
    Math.max(0, Math.round((calculationDate.getTime() - loanStart.getTime()) / (30.44 * 24 * 60 * 60 * 1000))),
  );

  const principal = input.originalPrincipalCents / 100;
  const remainingPrincipal =
    monthlyRate === 0
      ? principal * (1 - monthsElapsed / totalMonths)
      : (principal * (Math.pow(1 + monthlyRate, totalMonths) - Math.pow(1 + monthlyRate, monthsElapsed))) /
        (Math.pow(1 + monthlyRate, totalMonths) - 1);

  const assumptions: BalanceEstimateAssumptions = {
    assumedAnnualInterestRatePct: annualRatePct,
    assumedTermYears: termYears,
    calculationDate: calculationDate.toISOString().slice(0, 10),
  };

  // Confidence is deliberately capped low — this is a model, not observed data.
  const confidence = monthsElapsed > 0 && monthsElapsed < totalMonths ? 0.4 : 0.25;

  return {
    estimatedRemainingBalanceCents: Math.max(0, Math.round(remainingPrincipal * 100)),
    methodology: "amortized_estimate_v1",
    confidence,
    assumptions,
    disclaimer: BALANCE_ESTIMATE_DISCLAIMER,
  };
}
