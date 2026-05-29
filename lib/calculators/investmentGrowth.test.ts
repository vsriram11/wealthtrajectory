import { describe, expect, it } from "vitest";

import {
  annualContributionForYear,
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

describe("simulateInvestmentGrowth — annualContributionIncreasePct (escalator)", () => {
  it("with 0% escalator, behavior matches the omitted-escalator baseline", () => {
    const r1 = simulateInvestmentGrowth(BASE);
    const r2 = simulateInvestmentGrowth({
      ...BASE,
      annualContributionIncreasePct: 0,
    });
    expect(r2.futureValueUSD).toBeCloseTo(r1.futureValueUSD, 6);
  });

  it("escalator > 0 increases each year's contribution geometrically", () => {
    // 3% escalator, monthly $100 base → year 1 = $1200 annual, year 2
    // = $1236, year 3 = $1273.08, ...
    const r = simulateInvestmentGrowth({
      ...BASE,
      contributionUSD: 100,
      contributionFrequency: "monthly",
      annualContributionIncreasePct: 0.03,
      years: 3,
      annualRateOfReturn: 0,
    });
    expect(r.yearlyBreakdown[0].contributionsThisYear).toBeCloseTo(1200, 2);
    expect(r.yearlyBreakdown[1].contributionsThisYear).toBeCloseTo(1236, 2);
    expect(r.yearlyBreakdown[2].contributionsThisYear).toBeCloseTo(1273.08, 2);
  });

  it("escalator > 0 strictly increases future value vs flat contributions (positive rate)", () => {
    const flat = simulateInvestmentGrowth({ ...BASE, years: 30 });
    const escalated = simulateInvestmentGrowth({
      ...BASE,
      years: 30,
      annualContributionIncreasePct: 0.03,
    });
    expect(escalated.futureValueUSD).toBeGreaterThan(flat.futureValueUSD);
  });

  it("escalator NaN/Infinity degrades to 0 (no escalation)", () => {
    const nanEsc = simulateInvestmentGrowth({
      ...BASE,
      annualContributionIncreasePct: Number.NaN,
    });
    const baseline = simulateInvestmentGrowth(BASE);
    expect(nanEsc.futureValueUSD).toBeCloseTo(baseline.futureValueUSD, 6);
  });
});

describe("simulateInvestmentGrowth — perYearContributionOverridesUSD", () => {
  it("override on a single year REPLACES the escalated default, leaves other years alone", () => {
    const escalated = simulateInvestmentGrowth({
      ...BASE,
      contributionUSD: 100,
      contributionFrequency: "monthly",
      annualContributionIncreasePct: 0.03,
      years: 5,
      annualRateOfReturn: 0,
    });
    const withOverride = simulateInvestmentGrowth({
      ...BASE,
      contributionUSD: 100,
      contributionFrequency: "monthly",
      annualContributionIncreasePct: 0.03,
      years: 5,
      annualRateOfReturn: 0,
      // Override year 3 to $5000 total annual contribution
      perYearContributionOverridesUSD: [null, null, 5000, null, null],
    });
    // Year 1, 2, 4, 5 unchanged (matching escalator)
    expect(withOverride.yearlyBreakdown[0].contributionsThisYear).toBeCloseTo(
      escalated.yearlyBreakdown[0].contributionsThisYear,
      2,
    );
    expect(withOverride.yearlyBreakdown[1].contributionsThisYear).toBeCloseTo(
      escalated.yearlyBreakdown[1].contributionsThisYear,
      2,
    );
    // Year 3: $5000 (override), not the escalated default
    expect(withOverride.yearlyBreakdown[2].contributionsThisYear).toBeCloseTo(
      5000,
      2,
    );
    expect(withOverride.yearlyBreakdown[3].contributionsThisYear).toBeCloseTo(
      escalated.yearlyBreakdown[3].contributionsThisYear,
      2,
    );
    expect(withOverride.yearlyBreakdown[4].contributionsThisYear).toBeCloseTo(
      escalated.yearlyBreakdown[4].contributionsThisYear,
      2,
    );
  });

  it("override of 0 means 'contribute nothing this year' (NOT 'use default')", () => {
    const r = simulateInvestmentGrowth({
      ...BASE,
      years: 3,
      annualRateOfReturn: 0,
      perYearContributionOverridesUSD: [null, 0, null],
    });
    expect(r.yearlyBreakdown[1].contributionsThisYear).toBe(0);
  });

  it("null/undefined overrides fall back to escalated default (sparse array semantics)", () => {
    const baseline = simulateInvestmentGrowth({
      ...BASE,
      years: 3,
      annualContributionIncreasePct: 0.03,
      annualRateOfReturn: 0,
    });
    const sparse = simulateInvestmentGrowth({
      ...BASE,
      years: 3,
      annualContributionIncreasePct: 0.03,
      annualRateOfReturn: 0,
      perYearContributionOverridesUSD: [null, undefined, null],
    });
    expect(sparse.futureValueUSD).toBeCloseTo(baseline.futureValueUSD, 6);
  });

  it("overrides array shorter than years is fine (years past the end use default)", () => {
    const baseline = simulateInvestmentGrowth({
      ...BASE,
      years: 5,
      annualRateOfReturn: 0,
    });
    const partial = simulateInvestmentGrowth({
      ...BASE,
      years: 5,
      annualRateOfReturn: 0,
      perYearContributionOverridesUSD: [null], // only year 1 covered
    });
    expect(partial.futureValueUSD).toBeCloseTo(baseline.futureValueUSD, 6);
  });

  it("negative override clamps at 0", () => {
    const r = simulateInvestmentGrowth({
      ...BASE,
      years: 2,
      annualRateOfReturn: 0,
      perYearContributionOverridesUSD: [-500, null],
    });
    expect(r.yearlyBreakdown[0].contributionsThisYear).toBe(0);
  });

  it("annual contribution frequency: override deposits the FULL amount at month 12 of that year", () => {
    const r = simulateInvestmentGrowth({
      startingBalanceUSD: 0,
      contributionUSD: 1000,
      contributionFrequency: "annually",
      years: 3,
      annualRateOfReturn: 0,
      compoundFrequency: "annually",
      perYearContributionOverridesUSD: [null, 5000, null],
    });
    expect(r.yearlyBreakdown[1].contributionsThisYear).toBeCloseTo(5000, 6);
    // Total = 1000 + 5000 + 1000 = 7000
    expect(r.totalContributionsUSD).toBeCloseTo(7000, 6);
  });
});

describe("annualContributionForYear (helper consumed by both engine and UI)", () => {
  it("flat contribution, no escalator, no override → baseAnnual", () => {
    expect(annualContributionForYear(1, 100, "monthly", 0, undefined)).toBe(
      1200,
    );
    expect(annualContributionForYear(5, 100, "monthly", 0, undefined)).toBe(
      1200,
    );
  });

  it("annual contribution frequency: base is per-year, not multiplied", () => {
    expect(annualContributionForYear(1, 1000, "annually", 0, undefined)).toBe(
      1000,
    );
  });

  it("escalator compounds geometrically year over year", () => {
    expect(
      annualContributionForYear(1, 100, "monthly", 0.05, undefined),
    ).toBeCloseTo(1200, 6);
    expect(
      annualContributionForYear(2, 100, "monthly", 0.05, undefined),
    ).toBeCloseTo(1260, 6);
    expect(
      annualContributionForYear(3, 100, "monthly", 0.05, undefined),
    ).toBeCloseTo(1323, 6);
  });

  it("override wins over both base and escalator", () => {
    expect(
      annualContributionForYear(5, 100, "monthly", 0.05, [
        null,
        null,
        null,
        null,
        9999,
      ]),
    ).toBe(9999);
  });

  it("override of NaN is ignored (falls through to escalated default)", () => {
    expect(
      annualContributionForYear(2, 100, "monthly", 0.05, [
        null,
        Number.NaN,
      ]),
    ).toBeCloseTo(1260, 6);
  });
});
