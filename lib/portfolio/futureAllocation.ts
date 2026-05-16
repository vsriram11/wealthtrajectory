import { computePortfolio, type PortfolioMetrics } from "@/lib/portfolio/portfolio";
import type { Assumptions, Holding, Household } from "@/lib/types";

export type AllocationFuturePoint = {
  yearOffset: number; // 0 = today, fractional supported
  netWorthUSD: number;
  classes: PortfolioMetrics["classes"];
  effectiveLeverage: number;
  weightedRealCAGR: number;
};

/**
 * Project how the household's *composition* evolves over time.
 *
 * Whereas projectIndependence produces a single net-worth scalar per month,
 * this returns the full per-class breakdown at each waypoint — so
 * the UI can show the user "what will my equity / bond / cash mix
 * look like in 10 years if I keep doing what I'm doing?"
 *
 * Each holding grows at its own expectedRealCAGR (real, inflation-
 * adjusted). Per-account monthly contributions fan into the account's
 * holdings proportionally by current value. Liabilities pay down at
 * their monthlyPayment.
 *
 * Pure function, no scenario logic — call once per stepYears to get
 * a smooth series.
 */
export function projectAllocation(
  household: Household,
  assumptions: Assumptions,
  totalYears = 30,
  stepYears = 1,
): AllocationFuturePoint[] {
  const steps = Math.max(1, Math.round(totalYears / stepYears));
  const out: AllocationFuturePoint[] = [];
  let h = household;
  // Step 0: snapshot today.
  out.push(snapshotPoint(h, 0));
  for (let i = 1; i <= steps; i++) {
    h = ageHousehold(h, stepYears);
    out.push(snapshotPoint(h, i * stepYears));
  }
  // (assumptions param reserved for future extensions — e.g. honoring
  // a custom inflation override on cash, or stress modes.)
  void assumptions;
  return out;
}

function snapshotPoint(h: Household, yearOffset: number): AllocationFuturePoint {
  const m = computePortfolio(h);
  return {
    yearOffset,
    netWorthUSD: m.netWorthUSD,
    classes: m.classes,
    effectiveLeverage: m.effectiveLeverage,
    weightedRealCAGR: m.weightedRealCAGR,
  };
}

/**
 * Grow each holding by `years` at its own expectedRealCAGR AND
 * accumulate contributions throughout the period using the
 * future-value-of-an-annuity formula:
 *
 *   FV_existing       = value × (1 + r_m)^n
 *   FV_contributions  = monthly_contrib × ((1 + r_m)^n - 1) / r_m
 *
 * where r_m is the holding's monthly rate (derived from its annual
 * real CAGR) and n is the total months in the period.
 *
 * The prior implementation aged each holding for the full period
 * and then dumped a lump-sum of contributions in at the END, which
 * missed the compounded growth on the early-period contributions.
 * Over a 20-year horizon at 7% CAGR, the FV-correct math returns
 * ~14% more than the lump-end model — material when the user is
 * staring at the chart trying to plan retirement.
 *
 * Contributions are split across the account's existing holdings in
 * proportion to their start-of-period values (since that's the most
 * realistic representation of buy-and-hold dollar-cost-averaging
 * into the current mix). Liabilities pay down by monthlyPayment ×
 * months, floored at zero.
 */
/**
 * Build a synthetic future Household by ageing each holding forward
 * `years` years (each at its own expectedRealCAGR), accumulating
 * monthly contributions throughout the period, and amortizing
 * liabilities at their stated rates.
 *
 * Exposed for surfaces (e.g. AllocationPanel) that want to render
 * "what does my portfolio look like in N years if I keep doing
 * what I'm doing" without re-implementing the math.
 *
 * Pure — never mutates the input.
 */
export function ageHousehold(h: Household, years: number): Household {
  const months = Math.round(years * 12);
  const accounts = h.accounts.map((a) => {
    const totalNow = a.holdings.reduce((s, hh) => s + hh.valueUSD, 0);
    const accountMonthlyContrib = a.monthlyContributionUSD;
    const holdings = a.holdings.map((holding) => {
      const share = totalNow > 0 ? holding.valueUSD / totalNow : 0;
      const perHoldingMonthly = accountMonthlyContrib * share;
      return ageHolding(holding, months, perHoldingMonthly);
    });
    return { ...a, holdings };
  });
  // Liabilities amortize month-by-month at their annual rate: each
  // month, balance accrues interest then the payment is applied.
  // The previous lump-sum subtraction silently understated mortgages
  // by ~25K / yr on a typical 400K @ 6% loan (because the payment is
  // mostly interest in the early years, not principal). That made
  // future NW look too high in any RE-heavy household.
  const liabilities = h.liabilities.map((l) => {
    let bal = l.balanceUSD;
    const rate = annualToMonthly(l.annualInterestRate);
    for (let i = 0; i < months && bal > 0; i++) {
      bal = Math.max(0, bal * (1 + rate) - l.monthlyPaymentUSD);
    }
    return { ...l, balanceUSD: bal };
  });
  return { ...h, accounts, liabilities };
}

function annualToMonthly(annual: number): number {
  if (annual === 0) return 0;
  if (annual <= -0.999) return -0.999;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

function fvAnnuity(monthlyContrib: number, monthlyRate: number, months: number): number {
  if (monthlyContrib <= 0 || months <= 0) return 0;
  if (monthlyRate === 0) return monthlyContrib * months;
  return (
    monthlyContrib * (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate
  );
}

function ageHolding(
  h: Holding,
  months: number,
  monthlyContrib: number,
): Holding {
  const r = annualToMonthly(h.expectedRealCAGR);
  const factor = Math.pow(1 + r, months);
  const fvExisting = h.valueUSD * factor;
  const fvContrib = fvAnnuity(monthlyContrib, r, months);
  const newValue = fvExisting + fvContrib;

  if (h.kind === "cash" || h.kind === "real_estate" || h.kind === "other") {
    return { ...h, valueUSD: newValue };
  }
  if (h.kind === "private_stock") {
    // Keep shares fixed; per-share value reflects ageing. The
    // contribution-driven addition expands valueUSD beyond what
    // shares × lastPriceUSD would suggest, but PS is manually-
    // priced anyway — the share count stays as the user entered
    // it.
    const newPrice = h.shares > 0 ? newValue / h.shares : h.lastPriceUSD;
    return { ...h, valueUSD: newValue, lastPriceUSD: newPrice };
  }
  // equity / bond / crypto / commodity: shares-tracked. Price grows
  // by the CAGR factor (same as the existing value), and the
  // contribution FV becomes new shares purchased at the future price.
  if (
    h.kind === "equity" ||
    h.kind === "bond" ||
    h.kind === "crypto" ||
    h.kind === "commodity"
  ) {
    const newPrice = h.lastPriceUSD * factor;
    const newShares = newPrice > 0 ? newValue / newPrice : h.shares;
    return { ...h, lastPriceUSD: newPrice, shares: newShares, valueUSD: newValue };
  }
  return h;
}
