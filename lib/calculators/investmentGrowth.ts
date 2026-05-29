/**
 * Investment-growth calculator engine.
 *
 * Pure compound-interest-with-contributions math, modeled after the
 * NerdWallet "Investment Calculator" surface — the canonical
 * back-of-envelope projection that anyone planning savings goals
 * runs first. NOT to be confused with the deterministic
 * `projectIndependence` engine (which models the user's ACTUAL
 * portfolio composition, scenarios, member rollups, etc.). This
 * calculator is intentionally simple: a single rate, one
 * contribution stream, no taxes, no inflation. Convenience math for
 * "if I save $X/mo at Y% for Z years, where does it land?"
 *
 * Math convention — ORDINARY ANNUITY (end-of-period contributions):
 *   - The simulation steps month-by-month.
 *   - At each month: apply this month's interest portion based on
 *     compound frequency, THEN add contributions due in that month.
 *   - Contributions deposited in month M earn no interest in M;
 *     they begin earning in M+1. This is the same convention used
 *     by NerdWallet, Bankrate, and most consumer-facing calculators.
 *   - "Annual" compounding credits the full year's interest at
 *     month 12 (no interest in months 1-11), so a year-end-only
 *     contribution AND a year-end-only interest crediting compose
 *     cleanly.
 *
 * NaN-safety (CLAUDE.md engine-purity contract): every numeric
 * input is sanitized at the boundary. Bad input degrades to a
 * trivial result (0-balance, no growth), not NaN.
 */

export type ContributionFrequency = "monthly" | "annually";
export type CompoundFrequency = "annually" | "monthly" | "daily";

export type InvestmentGrowthInputs = {
  /** Initial deposit at time zero. */
  startingBalanceUSD: number;
  /** Amount added EACH contribution period (per-period, not annual). */
  contributionUSD: number;
  /** How often the user contributes. */
  contributionFrequency: ContributionFrequency;
  /** Investment horizon in years (whole number; fractions truncate). */
  years: number;
  /** Expected annual rate of return, expressed as a decimal (0.07 = 7%). */
  annualRateOfReturn: number;
  /** How often interest is credited to the account. */
  compoundFrequency: CompoundFrequency;
  /**
   * Optional contribution escalator. Each year's per-period contribution
   * grows by this fraction relative to the previous year (compounded).
   * 0.03 = "3% raise each year." Default 0 = flat contributions.
   *
   * Models the common "I save X% of my salary, and my salary grows
   * Y% per year" pattern without forcing the user to compute the
   * year-by-year contribution themselves.
   */
  annualContributionIncreasePct?: number;
  /**
   * Optional per-year contribution overrides. Sparse — index 0 = year 1.
   * A number REPLACES the escalated default for that year; null or
   * undefined keeps the default. The override is the TOTAL ANNUAL
   * contribution for that year (distributed according to
   * `contributionFrequency` — split across 12 months when monthly,
   * deposited at month 12 when annually).
   *
   * Enables one-off injections (windfall year, bonus, college tuition
   * pull-out) without abandoning the escalator for the rest of the
   * horizon.
   */
  perYearContributionOverridesUSD?: ReadonlyArray<number | null | undefined>;
};

export type InvestmentGrowthYear = {
  /** 1-indexed year number (year 1 = first 12 months). */
  year: number;
  /** Balance at the start of the year. */
  startingBalanceUSD: number;
  /** Sum of contributions deposited during this year. */
  contributionsThisYear: number;
  /** Interest credited during this year. */
  interestEarned: number;
  /** Balance at the end of the year. */
  endingBalanceUSD: number;
  /** Running total of contributions (incl. starting balance). */
  totalContributions: number;
  /** Running total of interest accumulated. */
  totalInterest: number;
};

export type InvestmentGrowthResult = {
  /** Year-by-year breakdown (length = `years`). Empty if years <= 0. */
  yearlyBreakdown: InvestmentGrowthYear[];
  /** Ending balance at the end of the horizon. */
  futureValueUSD: number;
  /** Total dollars deposited over the horizon (including starting). */
  totalContributionsUSD: number;
  /** Total interest earned over the horizon. */
  totalInterestUSD: number;
};

function safeFinite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute the per-month interest multiplier for a given compound
 * frequency. Returns the factor to multiply the balance by ONCE
 * per month (i.e., balance *= factor).
 *
 *   - "monthly":  factor = 1 + r/12 every month
 *   - "daily":    factor = (1 + r/365)^(365/12) every month
 *   - "annually": factor = 1 for months 1-11, (1 + r) at month 12
 *
 * Returned as a function of (monthOfYear: 1..12) so the caller
 * doesn't need to special-case "annually".
 */
function monthlyInterestFactor(
  compoundFrequency: CompoundFrequency,
  annualRate: number,
): (monthOfYear: number) => number {
  switch (compoundFrequency) {
    case "monthly":
      return () => 1 + annualRate / 12;
    case "daily":
      return () => Math.pow(1 + annualRate / 365, 365 / 12);
    case "annually":
      return (monthOfYear) => (monthOfYear === 12 ? 1 + annualRate : 1);
  }
}

/**
 * Compute the ANNUAL contribution for year N, factoring in the
 * optional escalator and any per-year override. Pure helper used by
 * both the simulator and the UI's "default" column.
 *
 *   - With no escalator, no override → baseAnnualContribution.
 *   - With escalator, no override   → baseAnnualContribution × (1 + g)^(N-1).
 *   - With override (number)         → the override (escalator ignored
 *                                       for that year, NOT subsequent years).
 */
export function annualContributionForYear(
  yearIndex: number, // 1-indexed
  baseContributionPerPeriod: number,
  contributionFrequency: ContributionFrequency,
  annualIncreasePct: number,
  overrides: ReadonlyArray<number | null | undefined> | undefined,
): number {
  const baseAnnual =
    contributionFrequency === "monthly"
      ? baseContributionPerPeriod * 12
      : baseContributionPerPeriod;
  const override = overrides?.[yearIndex - 1];
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.max(0, override);
  }
  const escalator = Math.pow(1 + annualIncreasePct, yearIndex - 1);
  return Math.max(0, baseAnnual * escalator);
}

export function simulateInvestmentGrowth(
  inputs: InvestmentGrowthInputs,
): InvestmentGrowthResult {
  // Boundary sanitization. Bad input → trivial 0-result; downstream
  // UI shows "$0" rather than rendering NaN/Infinity.
  const startingBalance = Math.max(0, safeFinite(inputs.startingBalanceUSD, 0));
  const contribution = Math.max(0, safeFinite(inputs.contributionUSD, 0));
  const years = Math.max(0, Math.floor(safeFinite(inputs.years, 0)));
  // Rate can be negative (modeling a declining portfolio) or 0.
  // Clamp to [-1, +Infinity) — a rate <= -1 implies "lose 100%+ per
  // year" which collapses balances to <= 0 immediately, fine, but
  // -1 exactly produces (1 + r) = 0 and the daily formula's pow
  // returns 0. Safe.
  const annualRate = Math.max(-1, safeFinite(inputs.annualRateOfReturn, 0));
  // Escalator: 0 by default. Lower-bounded at -1 by the same logic
  // (a "100% reduction per year" cuts contributions to 0 from y=2 on;
  // fine), upper-bounded at +Infinity but float-clamped to something
  // sane to avoid overflow over a 100-year horizon. 10x growth per
  // year is already an absurd input the UI will guard against.
  const escalator = Math.max(
    -1,
    safeFinite(inputs.annualContributionIncreasePct ?? 0, 0),
  );

  if (years === 0) {
    return {
      yearlyBreakdown: [],
      futureValueUSD: startingBalance,
      totalContributionsUSD: startingBalance,
      totalInterestUSD: 0,
    };
  }

  const factorAt = monthlyInterestFactor(inputs.compoundFrequency, annualRate);

  let balance = startingBalance;
  let totalContributions = startingBalance;
  let totalInterest = 0;
  const yearlyBreakdown: InvestmentGrowthYear[] = [];

  for (let year = 1; year <= years; year++) {
    const yearStartBalance = balance;
    let contributionsThisYear = 0;
    let interestThisYear = 0;

    // Resolve this year's TOTAL contribution: escalator default or
    // explicit per-year override. Then derive the per-period amount
    // for the contribution frequency. Monthly deposits split the
    // annual evenly across 12 months; annual deposits land at
    // month 12.
    const annualForYear = annualContributionForYear(
      year,
      contribution,
      inputs.contributionFrequency,
      escalator,
      inputs.perYearContributionOverridesUSD,
    );
    const perPeriod =
      inputs.contributionFrequency === "monthly"
        ? annualForYear / 12
        : annualForYear;

    for (let month = 1; month <= 12; month++) {
      // 1. Apply interest BEFORE this month's contribution
      //    (ordinary-annuity convention; contributions earn no
      //    interest in their deposit month).
      const factor = factorAt(month);
      // Guard against pathological factors (e.g. rate = -1 ⇒ 0);
      // post-multiply balance can become negative if interest is
      // negative AND larger than balance. Floor at 0 since a real
      // account can't carry a negative balance under this model
      // (no margin).
      const newBalance = Math.max(0, balance * factor);
      const interest = newBalance - balance;
      balance = newBalance;
      interestThisYear += interest;

      // 2. Add contribution for this period.
      if (inputs.contributionFrequency === "monthly") {
        balance += perPeriod;
        contributionsThisYear += perPeriod;
      } else if (
        inputs.contributionFrequency === "annually" &&
        month === 12
      ) {
        balance += perPeriod;
        contributionsThisYear += perPeriod;
      }
    }

    totalContributions += contributionsThisYear;
    totalInterest += interestThisYear;

    yearlyBreakdown.push({
      year,
      startingBalanceUSD: yearStartBalance,
      contributionsThisYear,
      interestEarned: interestThisYear,
      endingBalanceUSD: balance,
      totalContributions,
      totalInterest,
    });
  }

  return {
    yearlyBreakdown,
    futureValueUSD: balance,
    totalContributionsUSD: totalContributions,
    totalInterestUSD: totalInterest,
  };
}
