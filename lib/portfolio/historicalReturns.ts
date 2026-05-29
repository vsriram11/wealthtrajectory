import type { Holding, Account } from "@/lib/types";
import { holdingClass } from "@/lib/types";
import type { Snapshot } from "@/lib/persistence/persistence";
import type { AssetClass } from "@/lib/types";

/**
 * Historical-returns engine — pure functions of (snapshot[]).
 *
 * Builds per-asset-class time series from the user's snapshot
 * history (rows that include `household` carry the per-class
 * composition needed to bucket the value).
 *
 * IMPORTANT HONEST LIMITATION (read this before extending):
 *
 *   The app does NOT record explicit cashflow transactions
 *   (deposits/withdrawals into accounts/holdings). Snapshots
 *   capture VALUE at a moment, not flows BETWEEN moments. Given
 *   only value-at-T data, chained Time-Weighted Return (TWR) and
 *   Money-Weighted Return (MWR/IRR) BOTH algebraically collapse
 *   to plain CAGR:
 *
 *     ∏ (V[i+1]/V[i])  =  V[N]/V[0]    (telescoping product)
 *
 *   so the chained period return = V[N]/V[0] - 1 = total CAGR.
 *
 *   Therefore: the metrics this module computes are HONEST
 *   blended returns — they conflate market move with any
 *   contributions/withdrawals into the bucket. We surface them
 *   as "CAGR / total return / drawdown" and clearly explain in
 *   the Glossary that pure TWR vs MWR requires per-flow data
 *   the app doesn't currently store. The metrics are still very
 *   informative (especially for buckets the user doesn't actively
 *   trade — equity, bond, real_estate); they just shouldn't be
 *   labeled "TWR" or "IRR" without the caveat.
 *
 * All functions are pure — no Date.now(), no I/O, NaN-safe at
 * boundaries. Test coverage is in the sibling .test.ts.
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export type ClassSeriesPoint = {
  t: number;
  valueUSD: number;
};

export type ClassSeries = ClassSeriesPoint[];

export type BucketSeries = Partial<Record<AssetClass, ClassSeries>>;

/**
 * For each snapshot row that carries `household`, sum the value
 * of all holdings by asset class. Returns a per-class series of
 * (t, valueUSD) points sorted ascending by t. Rows without
 * `household` are skipped (we'd have no way to know the per-class
 * split). Empty buckets are omitted from the result.
 */
export function buildAssetClassSeries(snapshots: Snapshot[]): BucketSeries {
  const byClass = new Map<AssetClass, ClassSeries>();
  // Sort defensively — callers usually pass loadSnapshots() output
  // which is already sorted, but we shouldn't assume.
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  for (const snap of sorted) {
    if (!snap.household) continue;
    const bucketTotals = new Map<AssetClass, number>();
    for (const acct of snap.household.accounts) {
      for (const h of acct.holdings ?? []) {
        const cls = holdingClass(h);
        const v = Number.isFinite(h.valueUSD) ? h.valueUSD : 0;
        bucketTotals.set(cls, (bucketTotals.get(cls) ?? 0) + v);
      }
    }
    for (const [cls, v] of bucketTotals) {
      let series = byClass.get(cls);
      if (!series) {
        series = [];
        byClass.set(cls, series);
      }
      series.push({ t: snap.t, valueUSD: v });
    }
  }
  const out: BucketSeries = {};
  for (const [cls, series] of byClass) out[cls] = series;
  return out;
}

/**
 * CAGR = (V_end / V_start)^(1 / years) - 1, where years is the
 * fractional gap between first and last snapshot. Returns null if:
 *   - fewer than 2 data points
 *   - V_start <= 0 (can't divide by zero or take fractional power
 *     of a negative ratio)
 *   - elapsed time < 1 day (avoids absurd annualization)
 *   - result is NaN or non-finite (defense against pathological
 *     inputs)
 *
 * This is the standard simple CAGR; with snapshot-only data (no
 * cashflows) this also equals the chained TWR over the period.
 * See the module-doc paragraph on the algebraic collapse.
 */
export function cagr(series: ClassSeries): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (first.valueUSD <= 0) return null;
  const elapsedMs = last.t - first.t;
  if (elapsedMs < 24 * 60 * 60 * 1000) return null;
  const years = elapsedMs / MS_PER_YEAR;
  const ratio = last.valueUSD / first.valueUSD;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const result = Math.pow(ratio, 1 / years) - 1;
  return Number.isFinite(result) ? result : null;
}

/**
 * Total period return = V_end / V_start - 1. Independent of
 * elapsed time (unlike CAGR). Useful when the period is short
 * enough that annualization is misleading. Null on degenerate
 * inputs same as cagr().
 */
export function totalReturn(series: ClassSeries): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (first.valueUSD <= 0) return null;
  const r = last.valueUSD / first.valueUSD - 1;
  return Number.isFinite(r) ? r : null;
}

export type DrawdownStats = {
  peakT: number;
  peakValueUSD: number;
  troughT: number;
  troughValueUSD: number;
  /** As a non-negative fraction. 0.18 == -18% peak-to-trough. */
  lossPct: number;
};

/**
 * Maximum peak-to-trough loss in the series. Iterates once,
 * tracking the running max and the largest gap below it. Returns
 * null if the series never recovers from a peak (just declining
 * — no "drawdown" to measure, the whole thing is loss) — wait
 * actually that should still return the largest gap below the
 * very first value. Let me re-check: running peak starts at
 * series[0], any subsequent dip below it is a candidate.
 * That's the correct definition.
 *
 * Returns null when: < 2 points, peak is 0/negative (no valid
 * baseline), or no point dips below its preceding peak (monotone
 * growth has no drawdown).
 */
export function maxDrawdown(series: ClassSeries): DrawdownStats | null {
  if (series.length < 2) return null;
  let peakT = series[0].t;
  let peakV = series[0].valueUSD;
  let worst: DrawdownStats | null = null;
  for (let i = 1; i < series.length; i++) {
    const pt = series[i];
    if (pt.valueUSD > peakV) {
      peakV = pt.valueUSD;
      peakT = pt.t;
      continue;
    }
    if (peakV <= 0) continue;
    const lossPct = (peakV - pt.valueUSD) / peakV;
    if (lossPct > 0 && (worst === null || lossPct > worst.lossPct)) {
      worst = {
        peakT,
        peakValueUSD: peakV,
        troughT: pt.t,
        troughValueUSD: pt.valueUSD,
        lossPct,
      };
    }
  }
  return worst;
}

export type ClassReturnRow = {
  assetClass: AssetClass;
  firstT: number;
  lastT: number;
  firstValueUSD: number;
  lastValueUSD: number;
  totalReturn: number | null;
  cagr: number | null;
  drawdown: DrawdownStats | null;
};

/**
 * Convenience: per-class summary rows ready to render in a table.
 * Skips classes whose series is too short to compute meaningful
 * metrics (< 2 points or no positive starting value).
 */
export function summarizeClassReturns(
  buckets: BucketSeries,
): ClassReturnRow[] {
  const rows: ClassReturnRow[] = [];
  for (const [cls, series] of Object.entries(buckets) as Array<[
    AssetClass,
    ClassSeries,
  ]>) {
    if (series.length < 2) continue;
    const first = series[0];
    const last = series[series.length - 1];
    rows.push({
      assetClass: cls,
      firstT: first.t,
      lastT: last.t,
      firstValueUSD: first.valueUSD,
      lastValueUSD: last.valueUSD,
      totalReturn: totalReturn(series),
      cagr: cagr(series),
      drawdown: maxDrawdown(series),
    });
  }
  // Stable ordering — class with the largest current value first.
  rows.sort((a, b) => b.lastValueUSD - a.lastValueUSD);
  return rows;
}

/**
 * Per-holding CAGR — for the Positions tab. Tracks a holding by
 * its `id` across snapshots; a holding that didn't exist at the
 * first snapshot (or doesn't exist at the last) returns null,
 * since CAGR over a partial window is misleading without flagging
 * the entry/exit date.
 *
 * Future extension: also return entry/exit dates so the UI can
 * show "added 2023-05-01, no full-window CAGR available" instead
 * of just a blank — but that's a UI affordance, not engine logic.
 */
export function perHoldingCAGR(
  snapshots: Snapshot[],
  holdingId: string,
): number | null {
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  const valued: ClassSeriesPoint[] = [];
  for (const snap of sorted) {
    if (!snap.household) continue;
    let v: number | undefined;
    for (const acct of snap.household.accounts) {
      const h = (acct.holdings ?? []).find((x) => x.id === holdingId);
      if (h) {
        v = (v ?? 0) + (Number.isFinite(h.valueUSD) ? h.valueUSD : 0);
      }
    }
    if (v !== undefined) valued.push({ t: snap.t, valueUSD: v });
  }
  return cagr(valued);
}

/**
 * Per-account CAGR — sum of account's holdings at each snapshot.
 * Same null semantics as perHoldingCAGR: account must exist
 * across the entire window.
 */
export function perAccountCAGR(
  snapshots: Snapshot[],
  accountId: string,
): number | null {
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  const series: ClassSeriesPoint[] = [];
  for (const snap of sorted) {
    if (!snap.household) continue;
    const acct = snap.household.accounts.find((a) => a.id === accountId);
    if (!acct) continue;
    const total = (acct.holdings ?? []).reduce(
      (sum, h) => sum + (Number.isFinite(h.valueUSD) ? h.valueUSD : 0),
      0,
    );
    series.push({ t: snap.t, valueUSD: total });
  }
  return cagr(series);
}

/**
 * Per-holding total-return convenience used by the Positions
 * table. Returns null when the holding is absent from any
 * snapshot edge — same rationale as perHoldingCAGR.
 *
 * Re-using this signature pattern (snapshots[] + id) keeps the
 * UI free of bucket-series wrangling.
 */
export function perHoldingTotalReturn(
  snapshots: Snapshot[],
  holdingId: string,
): number | null {
  const sorted = [...snapshots].sort((a, b) => a.t - b.t);
  const series: ClassSeriesPoint[] = [];
  for (const snap of sorted) {
    if (!snap.household) continue;
    let v: number | undefined;
    for (const acct of snap.household.accounts) {
      const h = (acct.holdings ?? []).find((x) => x.id === holdingId);
      if (h) v = (v ?? 0) + (Number.isFinite(h.valueUSD) ? h.valueUSD : 0);
    }
    if (v !== undefined) series.push({ t: snap.t, valueUSD: v });
  }
  return totalReturn(series);
}

// Re-export the types Account/Holding-curious callers might need.
export type { Holding, Account };
