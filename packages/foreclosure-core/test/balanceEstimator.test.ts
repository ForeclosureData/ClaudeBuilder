import { describe, it, expect } from "vitest";
import { estimateRemainingBalance, BALANCE_ESTIMATE_DISCLAIMER } from "../src/loan/balanceEstimator";

describe("estimateRemainingBalance", () => {
  it("returns the full principal when the loan just originated", () => {
    const result = estimateRemainingBalance({
      originalPrincipalCents: 200_000_00,
      originalLoanDateIso: new Date().toISOString().slice(0, 10),
    });
    expect(result.estimatedRemainingBalanceCents).toBeGreaterThan(199_000_00);
    expect(result.estimatedRemainingBalanceCents).toBeLessThanOrEqual(200_000_00);
  });

  it("amortizes down over time under default assumptions", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const result = estimateRemainingBalance({
      originalPrincipalCents: 200_000_00,
      originalLoanDateIso: tenYearsAgo.toISOString().slice(0, 10),
    });
    expect(result.estimatedRemainingBalanceCents).toBeLessThan(200_000_00);
    expect(result.estimatedRemainingBalanceCents).toBeGreaterThan(0);
  });

  it("never returns a balance below zero once the term has elapsed", () => {
    const fortyYearsAgo = new Date();
    fortyYearsAgo.setFullYear(fortyYearsAgo.getFullYear() - 40);
    const result = estimateRemainingBalance({
      originalPrincipalCents: 200_000_00,
      originalLoanDateIso: fortyYearsAgo.toISOString().slice(0, 10),
      assumedTermYears: 30,
    });
    expect(result.estimatedRemainingBalanceCents).toBe(0);
  });

  it("always labels the result as an estimate with assumptions and a disclaimer", () => {
    const result = estimateRemainingBalance({
      originalPrincipalCents: 150_000_00,
      originalLoanDateIso: "2020-01-01",
    });
    expect(result.methodology).toBe("amortized_estimate_v1");
    expect(result.disclaimer).toBe(BALANCE_ESTIMATE_DISCLAIMER);
    expect(result.assumptions.assumedAnnualInterestRatePct).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.6); // never presented as a verified figure
  });

  it("respects custom rate/term assumptions", () => {
    const baseline = estimateRemainingBalance({ originalPrincipalCents: 100_000_00, originalLoanDateIso: "2020-01-01" });
    const higherRate = estimateRemainingBalance({
      originalPrincipalCents: 100_000_00,
      originalLoanDateIso: "2020-01-01",
      assumedAnnualInterestRatePct: 12,
    });
    expect(higherRate.estimatedRemainingBalanceCents).toBeGreaterThan(baseline.estimatedRemainingBalanceCents);
  });
});
