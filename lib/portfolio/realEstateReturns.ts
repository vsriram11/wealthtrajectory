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
    let equity: number | undefined;
    let leverage: number | undefined;
    for (const acct of snap.household.accounts) {
      const h = (acct.holdings ?? []).find((x) => x.id === holdingId);
      if (h && h.kind === "real_estate") {
        equity = (equity ?? 0) + (Number.isFinite(h.valueUSD) ? h.valueUSD : 0);
        // For a holding appearing in multiple accounts (unusual),
        // weight leverage by equity. In practice real-estate is
        // per-account so this collapses to just h.leverage.
        leverage = Number.isFinite(h.leverage) ? h.leverage : 1;
      }
    }
    if (equity === undefined) continue;
    const lev = leverage ?? 1;
    const gross = equity * lev;
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
      if (y === 0) continue; // derivative term vanishes
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
    if (Math.abs(df) < 1e-12) return null;
    const next = r - f / df;
    // Bound r > -1 (avoids the (1+r)^y singularity at r = -1)
    // and reject runaway values.
    if (!Number.isFinite(next) || next <= -0.99 || next > 100) return null;
    if (Math.abs(next - r) < TOLERANCE) {
      return Number.isFinite(next) ? next : null;
    }
    r = next;
  }
  return null;
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
  //   For each interval: -(paydown_i) where paydown_i is the
  //     decrease in mortgage balance from t_{i-1} to t_i (≥ 0).
  //     This is the principal portion of mortgage payments
  //     between snapshots — out-of-pocket capital the user
  //     contributed toward the equity stake.
  //   t_N: +finalEquity (the "exit value")
  // Negative cashflows = money out (investment + paydowns).
  // Positive cashflows = money in (final equity sale).
  const cashflows: Array<{ t: number; amount: number }> = [
    { t: first.t, amount: -first.equity },
  ];
  let totalPaydown = 0;
  for (let i = 1; i < series.length - 1; i++) {
    const paydown = Math.max(0, series[i - 1].mortgage - series[i].mortgage);
    if (paydown > 0) {
      cashflows.push({ t: series[i].t, amount: -paydown });
      totalPaydown += paydown;
    }
  }
  // The penultimate-to-last paydown is folded into the final
  // cashflow as part of "what the user took out." Compute it
  // separately for the summary stats.
  const finalIntervalPaydown = Math.max(
    0,
    series[series.length - 2].mortgage - last.mortgage,
  );
  totalPaydown += finalIntervalPaydown;
  cashflows.push({ t: last.t, amount: last.equity });

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
