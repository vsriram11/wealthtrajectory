/**
 * Real-estate return metrics — TWR (property), equity CAGR, and
 * true IRR (money-weighted) — accounting for the mortgage-paydown
 * dynamic that makes real estate genuinely TWR ≠ MWR.
 *
 * WHY REAL ESTATE IS DIFFERENT
 *
 * For a stock or bond, TWR and MWR collapse to plain CAGR without
 * explicit cashflow data (see lib/portfolio/historicalReturns.ts
 * docstring). For real estate with a mortgage, they DIVERGE even
 * with only snapshot data, because:
 *
 *   1. The HOLDING's `valueUSD` tracks EQUITY (net of mortgage
 *      principal), not the gross property price.
 *   2. `leverage` captures gross-to-equity. So:
 *        gross_property_value = valueUSD × leverage
 *        mortgage_balance     = valueUSD × (leverage - 1)
 *   3. Between snapshots, BOTH the property value AND the mortgage
 *      balance change. Their difference (= equity) reflects:
 *        equity_change = gross_change + paydown
 *      where `paydown` is the user's actual out-of-pocket capital
 *      contribution toward principal.
 *
 * The three metrics this module exposes:
 *
 *   - twrPctAnnual (TWR) — pure GROSS-property CAGR. Reflects how
 *     the local market did, independent of how much you put in.
 *     Same as you'd get from Zillow/Redfin for that address.
 *
 *   - equityCAGRPctAnnual — CAGR computed on the EQUITY value
 *     (valueUSD). MISLEADING for leveraged positions: small
 *     equity stake + steady paydown = absurdly high "CAGR" that
 *     reflects mostly the user's own contributions, not market
 *     performance. Surface this for honesty + comparison; warn
 *     when leverage > 1.
 *
 *   - irrPctAnnual (MWR / IRR) — the true money-weighted return.
 *     Treats the initial equity as the "investment," each
 *     mortgage paydown between snapshots as additional capital
 *     contributions, and the current equity as the "exit value."
 *     Computes the discount rate that NPVs the cashflow stream
 *     to zero (Newton-Raphson).
 *
 * For a stock-only position TWR === equityCAGR === IRR (no
 * leverage, no flows). For a paid-off real estate position
 * (leverage = 1) they ALSO converge. The divergence is the
 * "value of the leverage" the user sees in the History tab.
 *
 * ENGINE PURITY
 *
 * Pure function of (snapshot[], holdingId). No Date.now(), no
 * Math.random(), no I/O. NaN-safe at boundaries.
 */

import type { Snapshot } from "@/lib/persistence/persistence";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export type RealEstateMetrics = {
  /** Period start. */
  firstT: number;
  /** Period end. */
  lastT: number;
  /** Equity (= valueUSD) at first snapshot. */
  initialEquity: number;
  /** Equity (= valueUSD) at last snapshot. */
  finalEquity: number;
  /** Gross property value at first snapshot (equity × leverage). */
  initialGross: number;
  /** Gross property value at last snapshot. */
  finalGross: number;
  /** Mortgage balance at first snapshot. */
  initialMortgage: number;
  /** Mortgage balance at last snapshot. */
  finalMortgage: number;
  /** Sum of principal paid down across the period. */
  totalPaydown: number;
  /**
   * Time-weighted return — gross-property CAGR. Null if degenerate.
   * Reflects pure market appreciation.
   */
  twrPctAnnual: number | null;
  /**
   * Equity-value CAGR. Misleading for leveraged positions (small
   * initial equity inflates the rate). Returned for honest
   * comparison + the History tab's "divergence" callout.
   */
  equityCAGRPctAnnual: number | null;
  /**
   * Money-weighted return (IRR). The discount rate that zeros
   * the NPV of the cashflow stream { -initialEquity, -paydown_i, +finalEquity }.
   * Null if the IRR solver doesn't converge (rare — only happens
   * for pathological cashflow shapes, e.g. all cashflows the
   * same sign).
   */
  irrPctAnnual: number | null;
};

/**
 * Build the (t, equity, gross, mortgage) series for a single
 * real-estate holding across snapshots that carry it. Skips
 * snapshots without household or without this holding.
 *
 * Per the FIRST + LAST presence gate (matching perHoldingCAGR),
 * returns an empty array if the holding is missing from either
 * endpoint — refusing to compute partial-window metrics.
 */
function buildRealEstateSeries(
  snapshots: Snapshot[],
  holdingId: string,
): Array<{ t: number; equity: number; gross: number; mortgage: number }> {
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  const composition = sorted.filter((s) => s.household);
  if (composition.length < 2) return [];
  // First + last presence gate.
  const presentIn = (snap: Snapshot): boolean => {
    if (!snap.household) return false;
    for (const acct of snap.household.accounts) {
      if ((acct.holdings ?? []).some((h) => h.id === holdingId)) return true;
    }
    return false;
  };
  if (
    !presentIn(composition[0]) ||
    !presentIn(composition[composition.length - 1])
  ) {
    return [];
  }
  const out: Array<{ t: number; equity: number; gross: number; mortgage: number }> = [];
  for (const snap of composition) {
    if (!snap.household) continue;
    // Round-5 audit BLOCK #2: aggregate by GROSS across accounts,
    // not equity-then-overwrite-leverage. For a holding appearing
    // in multiple accounts (co-trust ownership), gross is the
    // additively-meaningful quantity. Implied leverage =
    // gross/equity (matches the per-account formula in the
    // typical single-account case).
    let equitySum = 0;
    let grossSum = 0;
    for (const acct of snap.household.accounts) {
      const h = (acct.holdings ?? []).find((x) => x.id === holdingId);
      if (h && h.kind === "real_estate") {
        const equity = Number.isFinite(h.valueUSD) ? h.valueUSD : 0;
        // Round-5 audit BLOCK #3: floor leverage at 1.
        // leverage < 1 produces negative mortgage (pathological);
        // leverage = NaN / Infinity goes through the
        // Number.isFinite check. No upper clamp — real-world
        // distressed positions can have very high leverage and
        // the math is well-behaved for finite positive values.
        const rawLev = Number.isFinite(h.leverage) ? h.leverage : 1;
        const lev = rawLev >= 1 ? rawLev : 1;
        equitySum += equity;
        grossSum += equity * lev;
      }
    }
    if (equitySum === 0 && grossSum === 0) continue;
    const equity = equitySum;
    const gross = grossSum;
    const mortgage = gross - equity;
    out.push({ t: snap.t, equity, gross, mortgage });
  }
  return out;
}

/**
 * CAGR helper (= (end/start)^(1/years) - 1). Local-private rather
 * than imported from historicalReturns to keep this module self-
 * contained and avoid circular-import risk.
 */
function cagr(
  startValue: number,
  endValue: number,
  elapsedMs: number,
): number | null {
  if (startValue <= 0) return null;
  if (elapsedMs < 24 * 60 * 60 * 1000) return null;
  if (endValue === 0) return -1;
  if (!Number.isFinite(endValue) || endValue < 0) return null;
  const years = elapsedMs / MS_PER_YEAR;
  const ratio = endValue / startValue;
  const result = Math.pow(ratio, 1 / years) - 1;
  return Number.isFinite(result) ? result : null;
}

/**
 * Newton-Raphson IRR solver. Finds the discount rate `r` such that
 *
 *   ∑ cashflow_i / (1 + r)^t_i_years = 0
 *
 * where t_i_years is years elapsed since the first cashflow.
 *
 * Returns null when the solver fails to converge or NPV doesn't
 * cross zero (all cashflows same sign — common when paydown
 * approximations don't produce a valid investment shape).
 */
function newtonRaphsonIRR(
  cashflows: Array<{ t: number; amount: number }>,
): number | null {
  if (cashflows.length < 2) return null;
  const t0 = cashflows[0].t;
  const years = (t: number) => (t - t0) / MS_PER_YEAR;
  // Sanity: at least one negative AND one positive cashflow,
  // otherwise NPV is monotone in r and has no root.
  const hasNeg = cashflows.some((c) => c.amount < 0);
  const hasPos = cashflows.some((c) => c.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const npv = (r: number): number => {
    let sum = 0;
    for (const cf of cashflows) {
      const y = years(cf.t);
      sum += cf.amount / Math.pow(1 + r, y);
    }
    return sum;
  };
  const dnpv = (r: number): number => {
    let sum = 0;
    for (const cf of cashflows) {
      const y = years(cf.t);
      sum += (-y * cf.amount) / Math.pow(1 + r, y + 1);
    }
    return sum;
  };

  // Start with 5% as a reasonable initial guess for residential RE.
  let r = 0.05;
  const MAX_ITERS = 60;
  const TOLERANCE = 1e-8;
  for (let i = 0; i < MAX_ITERS; i++) {
    const f = npv(r);
    if (Math.abs(f) < TOLERANCE) {
      return Number.isFinite(r) ? r : null;
    }
    const df = dnpv(r);
    if (Math.abs(df) < 1e-12) break; // fall through to bisection
    const next = r - f / df;
    // Bound r > -1 (avoids (1+r)^y singularity) and reject
    // runaway values. On out-of-bounds, fall through to bisection
    // instead of returning null.
    if (!Number.isFinite(next) || next <= -0.99 || next > 1e6) break;
    if (Math.abs(next - r) < TOLERANCE) {
      return Number.isFinite(next) ? next : null;
    }
    r = next;
  }
  // Bisection fallback for cases where Newton diverges (deeply-
  // negative IRRs, steep NPV curves). Round-5 audit fix.
  return bisectionIRR(cashflows, npv);
}

/**
 * Bisection IRR over [-0.99, +10] — covers the practical range
 * of real-world property returns (total loss → moonshot). Slow
 * but guaranteed to converge IF the NPV function changes sign
 * within the bracket. Falls back to null only when no sign change
 * exists (degenerate cashflow shape).
 */
function bisectionIRR(
  cashflows: Array<{ t: number; amount: number }>,
  npv: (r: number) => number,
): number | null {
  void cashflows;
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) return null; // no sign change → no root in bracket
  const TOLERANCE = 1e-8;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < TOLERANCE || hi - lo < 1e-12) {
      return Number.isFinite(mid) ? mid : null;
    }
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
      void fHi;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return Number.isFinite((lo + hi) / 2) ? (lo + hi) / 2 : null;
}

/**
 * Compute the full real-estate metrics summary for one holding.
 * Returns null when the holding is absent from the snapshot
 * endpoints (matches perHoldingCAGR semantics).
 */
export function realEstateMetrics(
  snapshots: Snapshot[],
  holdingId: string,
): RealEstateMetrics | null {
  const series = buildRealEstateSeries(snapshots, holdingId);
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const elapsedMs = last.t - first.t;

  // Build the IRR cashflow series:
  //   t_0: -initialEquity (the "investment")
  //   For each interval [i-1, i]: -(paydown) where paydown =
  //     decrease in mortgage balance over the interval (≥ 0).
  //     The paydown for interval [N-2, N-1] is bundled at t_N
  //     as a separate -outflow alongside the terminal inflow,
  //     so the IRR sees BOTH the final-period capital
  //     contribution AND the terminal equity. Without this,
  //     the IRR would systematically OVERSTATE return by the
  //     final paydown (sometimes 0.1-0.3% per year for typical
  //     amortization profiles).
  //   t_N: +finalEquity (the "exit value")
  // Negative cashflows = money out (investment + paydowns).
  // Positive cashflows = money in (final equity sale).
  const cashflows: Array<{ t: number; amount: number }> = [
    { t: first.t, amount: -first.equity },
  ];
  let totalPaydown = 0;
  let totalCashOut = 0;
  // Round-5 audit BLOCK #1: symmetric paydown / cash-out
  // treatment. mortgage DECREASE = paydown (money out of pocket
  // toward principal, negative cashflow). mortgage INCREASE =
  // cash-out refi or HELOC draw (money INTO pocket, positive
  // cashflow). The previous `Math.max(0, …)` clamped cash-outs
  // to zero → IRR computed as if the user did nothing → looked
  // catastrophic for a user who legitimately extracted equity.
  //
  // Refinement: net cash-out against any concurrent gross
  // INCREASE. A user who pulled $100K via refi but spent $80K
  // on renovations (which increases gross by ~$80K) effectively
  // pocketed $20K — the renovation isn't a "cashflow" because
  // it's reinvested in the asset. Documented assumption: any
  // gross increase concurrent with a mortgage increase is treated
  // as renovation funded by the cash-out.
  for (let i = 1; i < series.length; i++) {
    const dMortgage = series[i - 1].mortgage - series[i].mortgage;
    if (dMortgage > 0) {
      // Paydown — money out toward principal.
      cashflows.push({ t: series[i].t, amount: -dMortgage });
      totalPaydown += dMortgage;
    } else if (dMortgage < 0) {
      // Cash-out / HELOC draw. Net against concurrent gross
      // increase (renovation reinvestment) to avoid
      // double-counting renovation dollars as "in pocket".
      const cashExtracted = -dMortgage;
      const dGross = series[i].gross - series[i - 1].gross;
      const cashToPocket = Math.max(0, cashExtracted - Math.max(0, dGross));
      if (cashToPocket > 0) {
        cashflows.push({ t: series[i].t, amount: cashToPocket });
        totalCashOut += cashToPocket;
      }
    }
  }
  cashflows.push({ t: last.t, amount: last.equity });
  // totalCashOut is exposed in the metrics for transparency —
  // the UI can surface "you extracted $X via refi" alongside
  // "you paid down $Y in principal."
  void totalCashOut;

  return {
    firstT: first.t,
    lastT: last.t,
    initialEquity: first.equity,
    finalEquity: last.equity,
    initialGross: first.gross,
    finalGross: last.gross,
    initialMortgage: first.mortgage,
    finalMortgage: last.mortgage,
    totalPaydown,
    twrPctAnnual: cagr(first.gross, last.gross, elapsedMs),
    equityCAGRPctAnnual: cagr(first.equity, last.equity, elapsedMs),
    irrPctAnnual: newtonRaphsonIRR(cashflows),
  };
}

/**
 * Convenience: find every real-estate holding represented in the
 * snapshot's most-recent composition and compute metrics for each.
 * Used by the History tab's per-real-estate section.
 */
export function summarizeAllRealEstate(
  snapshots: Snapshot[],
): Array<RealEstateMetrics & { holdingId: string; name: string }> {
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  const composition = sorted.filter((s) => s.household);
  if (composition.length < 2) return [];
  const latest = composition[composition.length - 1];
  if (!latest.household) return [];
  const rows: Array<RealEstateMetrics & { holdingId: string; name: string }> =
    [];
  for (const acct of latest.household.accounts) {
    for (const h of acct.holdings ?? []) {
      if (h.kind !== "real_estate") continue;
      const metrics = realEstateMetrics(sorted, h.id);
      if (metrics) {
        rows.push({ ...metrics, holdingId: h.id, name: h.name });
      }
    }
  }
  // Sort by final gross value desc — largest property first.
  rows.sort((a, b) => b.finalGross - a.finalGross);
  return rows;
}

// Test seam — internal helpers exposed for unit tests of the
// IRR solver + series builder in isolation.
export const __testHooks = {
  buildRealEstateSeries,
  newtonRaphsonIRR,
};
