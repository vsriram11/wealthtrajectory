import { allocationAtAge, type GlidePath } from "@/lib/portfolio/glidePath";

/**
 * Derive a per-year blended real-CAGR series from a glide-path.
 *
 * The glide-path stores target allocations by age. To produce a
 * forward-looking real return series, we need to convert each
 * year's allocation into an expected blended real return — a
 * weighted average of asset-class long-run real CAGRs.
 *
 * Defaults used here are conservative-ish long-run-mean
 * approximations (Damodaran-equivalent), intentionally a hair
 * below the Trinity-implied 7% real for equity. Users can
 * override via the optional `classCAGRs` map.
 *
 *   equity:    0.065  (S&P 500 long-run real, slightly below
 *                      the 7% headline to bake in some safety)
 *   bond:      0.020  (10y Treasury long-run real)
 *   cash:      0.005  (T-bill long-run real)
 *   crypto:    0.05   (highly speculative; treat as equity-ish)
 *   commodity: 0.005  (gold-ish — historical real return very low)
 *   realEstate:0.04   (rental-yield-net real long-run)
 *   privateStock: 0.07 (illiquidity-premium-bearing equity)
 *   other:     0.04   (mixed; sensible default)
 *
 * Real-terms throughout, matching the rest of the app's model.
 *
 * Engine-pure: no React, no store.
 */

export type AssetClassRealCAGR = {
  equity?: number;
  bond?: number;
  cash?: number;
  crypto?: number;
  commodity?: number;
  real_estate?: number;
  private_stock?: number;
  other?: number;
};

export const DEFAULT_CLASS_REAL_CAGR: Required<AssetClassRealCAGR> = {
  equity: 0.065,
  bond: 0.02,
  cash: 0.005,
  crypto: 0.05,
  commodity: 0.005,
  real_estate: 0.04,
  private_stock: 0.07,
  other: 0.04,
};

/**
 * Compute the blended real CAGR for a single age, given a
 * glide-path and (optional) per-class real CAGR overrides.
 *
 * Returns the long-run-mean blended real return that a
 * portfolio matching the glide-path allocation at this age
 * would have earned in expectation.
 *
 * Returns null when the glide-path has no waypoints (caller
 * should fall back to the static assumption).
 */
export function blendedRealCAGRAtAge(
  gp: GlidePath,
  age: number,
  classCAGRs: AssetClassRealCAGR = {},
): number | null {
  const alloc = allocationAtAge(gp, age);
  if (!alloc) return null;
  const r = { ...DEFAULT_CLASS_REAL_CAGR, ...classCAGRs };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [klass, fraction] of Object.entries(alloc) as Array<
    [keyof AssetClassRealCAGR, number | undefined]
  >) {
    if (fraction == null || fraction <= 0) continue;
    const cagr = r[klass];
    if (cagr == null) continue;
    weightedSum += fraction * cagr;
    weightTotal += fraction;
  }
  if (weightTotal <= 0) return null;
  // Normalize in case allocations don't sum exactly to 1.
  return weightedSum / weightTotal;
}

/**
 * Produce a year-by-year array of blended real CAGRs across a
 * planning horizon, starting at `startingAge` and walking forward
 * one year at a time. Length === `years`.
 *
 * Use this to feed a per-year-variable-CAGR projection (instead of
 * a single static CAGR) when a glide-path is configured.
 */
export function realCAGRSeries(
  gp: GlidePath,
  startingAge: number,
  years: number,
  classCAGRs: AssetClassRealCAGR = {},
): number[] {
  const out: number[] = [];
  for (let y = 0; y < years; y++) {
    const cagr = blendedRealCAGRAtAge(gp, startingAge + y, classCAGRs);
    out.push(cagr ?? 0);
  }
  return out;
}

/**
 * Time-weighted geometric average of the year-by-year blended
 * CAGRs — used to summarize "what's my effective real CAGR over
 * this horizon under this glide-path?" for headline display.
 *
 *   (Π (1 + r_t))^(1/N) − 1
 *
 * Returns the static CAGR if the series is empty.
 */
export function effectiveRealCAGROverHorizon(
  gp: GlidePath,
  startingAge: number,
  years: number,
  classCAGRs: AssetClassRealCAGR = {},
): number {
  const series = realCAGRSeries(gp, startingAge, years, classCAGRs);
  if (series.length === 0) return DEFAULT_CLASS_REAL_CAGR.equity;
  let prod = 1;
  for (const r of series) {
    prod *= 1 + r;
  }
  return Math.pow(prod, 1 / series.length) - 1;
}
