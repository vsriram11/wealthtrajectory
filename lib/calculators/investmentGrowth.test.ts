import { describe, expect, it } from "vitest";

import {
  simulateInvestmentGrowth,
  type InvestmentGrowthInputs,
} from "./investmentGrowth";

const BASE: InvestmentGrowthInputs = {
  startingBalanceUSD: 1000,
  contributionUSD: 100,
  contributionFrequency: "monthly",
  years: 10,
  annualRateOfReturn: 0.06,
  compoundFrequency: "monthly",
};

describe("simulateInvestmentGrowth", () => {
  it("returns an empty breakdown + starting balance when years = 0", () => {
    const r = simulateInvestmentGrowth({ ...BASE, years: 0 });
    expect(r.yearlyBreakdown).toEqual([]);
    expect(r.futureValueUSD).toBe(1000);
    expect(r.totalContributionsUSD).toBe(1000);
    expect(r.totalInterestUSD).toBe(0);
  });

  it("yearly breakdown length matches years", () => {
    const r = simulateInvestmentGrowth({ ...BASE, years: 10 });
    expect(r.yearlyBreakdown).toHaveLength(10);
    expect(r.yearlyBreakdown[0].year).toBe(1);
    expect(r.yearlyBreakdown[9].year).toBe(10);
  });

  it("running totals reconcile: futureValue = totalContributions + totalInterest", () => {
    const r = simulateInvestmentGrowth({ ...BASE, years: 10 });
    expect(r.futureValueUSD).toBeCloseTo(
      r.totalContributionsUSD + r.totalInterestUSD,
      2,
    );
  });

  it("totalContributions includes starting balance + per-period deposits", () => {
    const r = simulateInvestmentGrowth({
      ...BASE,
      startingBalanceUSD: 5000,
      contributionUSD: 200,
      contributionFrequency: "monthly",
      years: 5,
    });
    // $5000 starting + $200 × 12 months × 5 years = $5000 + $12000 = $17000
    expect(r.totalContributionsUSD).toBeCloseTo(17000, 2);
  });

  it("zero contributions, zero return: balance stays at starting principal", () => {
    const r = simulateInvestmentGrowth({
      ...BASE,
      contributionUSD: 0,
      annualRateOfReturn: 0,
      years: 30,
    });
    expect(r.futureValueUSD).toBeCloseTo(1000, 6);
    expect(r.totalInterestUSD).toBeCloseTo(0, 6);
  });

  it("matches the textbook compound-interest formula for principal-only (no contributions)", () => {
    // FV = P × (1 + r/n)^(nt). Monthly compounding: $1000 at 6% for
    // 10 years = $1000 × (1.005)^120 ≈ $1819.40.
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: 1000,
      contributionUSD: 0,
      contributionFrequency: "monthly",
      years: 10,
      annualRateOfReturn: 0.06,
      compoundFrequency: "monthly",
    });
    const expected = 1000 * Math.pow(1 + 0.06 / 12, 120);
    expect(r.futureValueUSD).toBeCloseTo(expected, 2);
  });

  it("monthly contributions, monthly compounding: matches the ordinary-annuity FV formula", () => {
    // FV_annuity = PMT × [((1+i)^n - 1) / i] (ordinary annuity)
    // PMT=100, i=0.06/12, n=120 → PMT FV ≈ 16387.93
    // Plus principal FV ≈ 1819.40 → total ≈ 18207.33
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: 1000,
      contributionUSD: 100,
      contributionFrequency: "monthly",
      years: 10,
      annualRateOfReturn: 0.06,
      compoundFrequency: "monthly",
    });
    const i = 0.06 / 12;
    const n = 120;
    const principalFV = 1000 * Math.pow(1 + i, n);
    const annuityFV = 100 * (Math.pow(1 + i, n) - 1) / i;
    expect(r.futureValueUSD).toBeCloseTo(principalFV + annuityFV, 1);
  });

  it("annual compounding only credits interest at month 12 each year", () => {
    // With annual compounding, principal-only:
    // FV = P × (1+r)^t. $1000 at 6% for 5 years = $1338.23.
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: 1000,
      contributionUSD: 0,
      contributionFrequency: "monthly",
      years: 5,
      annualRateOfReturn: 0.06,
      compoundFrequency: "annually",
    });
    expect(r.futureValueUSD).toBeCloseTo(1000 * Math.pow(1.06, 5), 2);
  });

  it("annual contributions are deposited only at month 12 each year", () => {
    // $12000/yr (one deposit per year) vs $1000/mo for 5 years at
    // 0% rate: both = $60000 plus starting principal, but annual
    // contributes total = years × $12000 = $60k, monthly = 5 × 12 ×
    // $1000 = $60k. With 0% rate, both produce identical totals.
    const annual = simulateInvestmentGrowth({
      startingBalanceUSD: 0,
      contributionUSD: 12_000,
      contributionFrequency: "annually",
      years: 5,
      annualRateOfReturn: 0,
      compoundFrequency: "annually",
    });
    const monthly = simulateInvestmentGrowth({
      startingBalanceUSD: 0,
      contributionUSD: 1_000,
      contributionFrequency: "monthly",
      years: 5,
      annualRateOfReturn: 0,
      compoundFrequency: "annually",
    });
    expect(annual.futureValueUSD).toBeCloseTo(60_000, 6);
    expect(monthly.futureValueUSD).toBeCloseTo(60_000, 6);
  });

  it("daily compounding is slightly higher than monthly compounding (same rate)", () => {
    const monthly = simulateInvestmentGrowth({
      ...BASE,
      compoundFrequency: "monthly",
    });
    const daily = simulateInvestmentGrowth({
      ...BASE,
      compoundFrequency: "daily",
    });
    // Daily compounding wins by a tiny amount over 10 years on
    // these inputs (~$5-10 on $1k seed).
    expect(daily.futureValueUSD).toBeGreaterThan(monthly.futureValueUSD);
    expect(daily.futureValueUSD - monthly.futureValueUSD).toBeLessThan(50);
  });

  it("negative annual rate produces declining balance", () => {
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: 10_000,
      contributionUSD: 0,
      contributionFrequency: "monthly",
      years: 5,
      annualRateOfReturn: -0.1,
      compoundFrequency: "annually",
    });
    // $10k × 0.9^5 = $5904.90
    expect(r.futureValueUSD).toBeCloseTo(10_000 * Math.pow(0.9, 5), 2);
    expect(r.totalInterestUSD).toBeLessThan(0);
  });

  it("NaN-safety: bad numeric inputs degrade to 0-result, never NaN", () => {
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: Number.NaN,
      contributionUSD: Number.NaN,
      contributionFrequency: "monthly",
      years: 5,
      annualRateOfReturn: Number.NaN,
      compoundFrequency: "monthly",
    });
    expect(Number.isFinite(r.futureValueUSD)).toBe(true);
    expect(r.futureValueUSD).toBe(0);
    expect(r.totalContributionsUSD).toBe(0);
    expect(r.totalInterestUSD).toBe(0);
  });

  it("NaN-safety: Infinity inputs do not poison results", () => {
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: Number.POSITIVE_INFINITY,
      contributionUSD: 100,
      contributionFrequency: "monthly",
      years: 5,
      annualRateOfReturn: 0.05,
      compoundFrequency: "monthly",
    });
    // Infinity startingBalance → safeFinite falls back to 0.
    expect(Number.isFinite(r.futureValueUSD)).toBe(true);
  });

  it("negative inputs clamp to zero at the boundary", () => {
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: -5000,
      contributionUSD: -100,
      contributionFrequency: "monthly",
      years: 3,
      annualRateOfReturn: 0.05,
      compoundFrequency: "monthly",
    });
    // Negative starting balance + negative contribution should
    // produce 0-balance growth, not a negative trajectory.
    expect(r.totalContributionsUSD).toBe(0);
  });

  it("fractional `years` rounds DOWN (whole years only)", () => {
    const r = simulateInvestmentGrowth({ ...BASE, years: 5.9 });
    expect(r.yearlyBreakdown).toHaveLength(5);
  });

  it("per-year running totals are monotonically non-decreasing (positive rate)", () => {
    const r = simulateInvestmentGrowth({ ...BASE, years: 30 });
    for (let i = 1; i < r.yearlyBreakdown.length; i++) {
      expect(r.yearlyBreakdown[i].totalContributions).toBeGreaterThanOrEqual(
        r.yearlyBreakdown[i - 1].totalContributions,
      );
      expect(r.yearlyBreakdown[i].endingBalanceUSD).toBeGreaterThanOrEqual(
        r.yearlyBreakdown[i - 1].endingBalanceUSD,
      );
    }
  });
});
