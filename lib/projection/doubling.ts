import { accountValue, accountWeightedCAGR, type Household } from "@/lib/types";

/**
 * Net-worth doubling time + N-doubling roadmap from today.
 *
 * Math: years-to-double = ln(2) / ln(1 + r). With reinvested
 * contributions the effective compounding is faster than r alone,
 * so we solve numerically for the time the *combined* mechanism
 * (compounding + monthly contributions, no withdrawals) takes to
 * reach 2× / 4× / 8× of today's positive net worth. This is a
 * useful gut-check separate from the Independence projection, because:
 *   - the Independence engine targets an absolute number; this one shows
 *     velocity from today, independent of the user's goal
 *   - "your net worth doubles every X years" is one of the most
 *     legible framings in personal finance ("Rule of 72")
 *
 * Returns null when net worth is non-positive (no doubling concept
 * applies) or when the projection diverges (would take > 100 years).
 */

export type DoublingPoint = {
  multiplier: number; // 2, 4, 8 …
  monthsFromNow: number;
};

export type DoublingAnalysis = {
  /** Today's positive net worth (or null if non-positive). */
  startingUSD: number | null;
  /**
   * Rule-of-72 / log doubling time on portfolio-weighted real CAGR
   * alone (no contributions). Provides the "structural" doubling
   * cadence — useful when contributions are small relative to
   * principal.
   */
  baseMonths: number | null;
  /**
   * Doubling time including monthly contributions (re-invested into
   * each account at its weighted CAGR). Always ≤ baseMonths when
   * contributions > 0.
   */
  withContributionsMonths: number | null;
  /** Roadmap of next doublings (2×, 4×, 8×) from today. */
  roadmap: DoublingPoint[];
};

const MAX_MONTHS = 100 * 12;

/**
 * Solve numerically for the month at which the projected (compounding
 * + reinvested monthly contributions) net worth crosses the target
 * multiplier. Returns null if it never crosses within MAX_MONTHS.
 *
 * We project per account so each account's weighted CAGR is honored
 * — same approach the Independence engine uses, just without the withdrawal
 * / target-NW termination logic.
 */
function monthsToMultiple(
  household: Household,
  multiplier: number,
): number | null {
  const accounts = household.accounts.map((a) => ({
    balanceUSD: accountValue(a),
    monthlyRate: Math.pow(1 + accountWeightedCAGR(a), 1 / 12) - 1,
    monthlyContributionUSD: a.monthlyContributionUSD,
  }));
  const liabilitiesNow = household.liabilities.reduce(
    (s, l) => s + l.balanceUSD,
    0,
  );
  const liabilities = household.liabilities.map((l) => ({
    balanceUSD: l.balanceUSD,
    monthlyRate: Math.pow(1 + l.annualInterestRate, 1 / 12) - 1,
    monthlyPaymentUSD: l.monthlyPaymentUSD,
  }));
  const start = accounts.reduce((s, a) => s + a.balanceUSD, 0) - liabilitiesNow;
  if (start <= 0) return null;
  const target = start * multiplier;

  for (let m = 1; m <= MAX_MONTHS; m++) {
    for (const a of accounts) {
      a.balanceUSD =
        a.balanceUSD * (1 + a.monthlyRate) + a.monthlyContributionUSD;
    }
    for (const l of liabilities) {
      const interest = l.balanceUSD * l.monthlyRate;
      l.balanceUSD = Math.max(0, l.balanceUSD + interest - l.monthlyPaymentUSD);
    }
    const nw =
      accounts.reduce((s, a) => s + a.balanceUSD, 0) -
      liabilities.reduce((s, l) => s + l.balanceUSD, 0);
    if (nw >= target) return m;
  }
  return null;
}

/**
 * Portfolio-weighted real CAGR across all accounts. Identical
 * blending to `accountWeightedCAGR` but rolled up at the household
 * level. Returns 0 when net account value is non-positive.
 */
export function householdWeightedCAGR(household: Household): number {
  let total = 0;
  let weighted = 0;
  for (const a of household.accounts) {
    const v = accountValue(a);
    if (v <= 0) continue;
    total += v;
    weighted += v * accountWeightedCAGR(a);
  }
  if (total <= 0) return 0;
  return weighted / total;
}

export function doublingAnalysis(household: Household): DoublingAnalysis {
  const start =
    household.accounts.reduce((s, a) => s + accountValue(a), 0) -
    household.liabilities.reduce((s, l) => s + l.balanceUSD, 0);
  if (start <= 0) {
    return {
      startingUSD: null,
      baseMonths: null,
      withContributionsMonths: null,
      roadmap: [],
    };
  }

  const r = householdWeightedCAGR(household);
  let baseMonths: number | null = null;
  if (r > 0) {
    const years = Math.log(2) / Math.log(1 + r);
    baseMonths = Math.round(years * 12);
    if (baseMonths > MAX_MONTHS) baseMonths = null;
  }

  const withContrib = monthsToMultiple(household, 2);

  const roadmap: DoublingPoint[] = [];
  for (const mult of [2, 4, 8]) {
    const m = monthsToMultiple(household, mult);
    if (m == null) break;
    roadmap.push({ multiplier: mult, monthsFromNow: m });
  }

  return {
    startingUSD: start,
    baseMonths,
    withContributionsMonths: withContrib,
    roadmap,
  };
}
