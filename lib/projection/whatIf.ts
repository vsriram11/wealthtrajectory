import { projectIndependence, type IndependenceProjection } from "@/lib/projection/independence";
import type { Assumptions, Household } from "@/lib/types";

/**
 * Pure what-if helper for the "add $X/mo to my savings" exploration
 * (PRD §7.8 example: "Increasing savings by $500/month advances Independence
 * by 3 years"). Distributes the extra contribution across the
 * household's accounts in proportion to their current value — same
 * dollar-cost-averaging assumption projectAllocation uses for
 * ongoing contributions, so the two engines stay reconciled.
 *
 * Pure function so the card consumer just memoizes and renders.
 * No store dependency.
 */
export type WhatIfResult = {
  baseline: IndependenceProjection;
  bumped: IndependenceProjection;
  /** Months earlier under bumped (positive = sooner). null when either projection never Independence. */
  monthsSaved: number | null;
};

export function whatIfExtraMonthly(
  household: Household,
  assumptions: Assumptions,
  extraMonthlyUSD: number,
): WhatIfResult {
  const baseline = projectIndependence(household, assumptions);
  const safeExtra = Math.max(0, extraMonthlyUSD);
  if (safeExtra === 0) {
    return { baseline, bumped: baseline, monthsSaved: 0 };
  }

  const totalAcctValue = household.accounts.reduce(
    (s, a) => s + a.holdings.reduce((ss, h) => ss + h.valueUSD, 0),
    0,
  );

  const bumpedHousehold: Household = {
    ...household,
    accounts: household.accounts.map((a) => {
      const acctValue = a.holdings.reduce((s, h) => s + h.valueUSD, 0);
      // Proportional split. If the household is empty (totalAcctValue=0)
      // we don't know where the extra money goes — fall back to even
      // split across accounts.
      const share =
        totalAcctValue > 0
          ? acctValue / totalAcctValue
          : 1 / Math.max(1, household.accounts.length);
      return {
        ...a,
        monthlyContributionUSD: a.monthlyContributionUSD + safeExtra * share,
      };
    }),
  };

  const bumped = projectIndependence(bumpedHousehold, assumptions);

  const monthsSaved =
    baseline.monthsToIndependence != null && bumped.monthsToIndependence != null
      ? baseline.monthsToIndependence - bumped.monthsToIndependence
      : null;

  return { baseline, bumped, monthsSaved };
}
