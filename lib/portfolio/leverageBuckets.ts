import type { AssetClass, Household, Holding } from "@/lib/types";
import { holdingLeverage } from "@/lib/types";

/**
 * Face-value breakdown of holdings across leverage buckets.
 *
 * Four buckets — chosen to match how a retirement-planning user
 * actually thinks about their portfolio's risk shape:
 *
 *   "0–1x"     (inclusive): cash, unleveraged stocks/bonds/
 *                          commodities/crypto, paid-off real
 *                          estate, private stock owned outright.
 *                          Capital equals exposure (no
 *                          amplification). Includes exactly 1×.
 *   "1–2x"     (exclusive): mild capital-efficient wrappers —
 *                          NTSX (1.5×), GDE (1.8×), RSSB.
 *                          Strictly between 1× and 2×; neither
 *                          end included.
 *   "2x+"     (inclusive): true daily-reset leveraged financial
 *                          plays — 2× ETFs like QLD, 3× ETFs
 *                          like TQQQ / TMF / EDV / SOXL, margin-
 *                          funded equity. Boundary inclusive of
 *                          exactly 2×.
 *   "Real estate (mortgaged)": any real-estate holding with
 *                          equity-leverage > 1× (a typical 20%-
 *                          down primary residence sits at 5×).
 *                          Broken out as its OWN bucket because
 *                          mortgage leverage has fundamentally
 *                          different risk dynamics from leveraged
 *                          ETFs: housing volatility is far lower
 *                          than equity volatility, the loan is
 *                          fixed-rate over 30 years (no margin
 *                          call), and the borrower can service
 *                          the loan from income — none of which
 *                          is true for a 5× equity position.
 *
 * Buckets the FACE value (capital actually deployed), not the
 * leveraged exposure, because the rest of the allocation surface
 * is face-weighted: a $10k 2× ETF should appear as $10k of "2x+"
 * holdings, not $20k of synthetic equity.
 *
 * Pure data: takes a (pre-filtered) household and an optional
 * class filter; returns buckets + total. The caller is
 * responsible for member-filtering + liquidity-filtering before
 * passing in — same convention `computePortfolio` follows.
 *
 * Use `filterHouseholdByClass(h, classTab)` to scope to a single
 * asset class for per-tab breakdowns ("of your stocks, X% is
 * unleveraged"). Pass "ALL" to skip the class filter.
 */

export type LeverageBucketKey = "low" | "mid" | "high" | "re_levered";

export type LeverageBucketEntry = {
  key: LeverageBucketKey;
  label: string;
  faceUSD: number;
  share: number;
};

export type LeverageBucketBreakdown = {
  buckets: LeverageBucketEntry[];
  totalFaceUSD: number;
};

export function leverageBuckets(
  household: Household,
): LeverageBucketBreakdown {
  let low = 0;
  let mid = 0;
  let high = 0;
  let reLevered = 0;
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      const face = h.valueUSD;
      if (!Number.isFinite(face) || face <= 0) continue;
      const lev = holdingLeverage(h);
      // Real estate with any mortgage gets its own bucket — the
      // risk profile is genuinely different from leveraged ETFs.
      // Paid-off real estate (leverage = 1) falls through to the
      // standard "0–1x" bucket like any other unleveraged asset.
      if (
        h.kind === "real_estate" &&
        Number.isFinite(lev) &&
        lev > 1
      ) {
        reLevered += face;
        continue;
      }
      if (!Number.isFinite(lev) || lev <= 1) {
        low += face;
      } else if (lev < 2) {
        mid += face;
      } else {
        high += face;
      }
    }
  }
  const total = low + mid + high + reLevered;
  const share = (v: number) => (total > 0 ? v / total : 0);
  return {
    buckets: [
      { key: "low", label: "0–1× leverage", faceUSD: low, share: share(low) },
      { key: "mid", label: "1–2× leverage", faceUSD: mid, share: share(mid) },
      { key: "high", label: "2×+ leverage", faceUSD: high, share: share(high) },
      {
        key: "re_levered",
        label: "Mortgaged real estate",
        faceUSD: reLevered,
        share: share(reLevered),
      },
    ],
    totalFaceUSD: total,
  };
}

/**
 * Per-tab scope filter — returns a household containing only
 * holdings of the given asset class (or the household unchanged
 * if "ALL"). Used by the Allocation page so the leverage breakdown
 * scopes to whichever tab the user is on.
 *
 * Holding-kind-based, not exposure-decomposed: a composition
 * wrapper like NTSX (equity-kind, with bond legs) shows up on the
 * stocks tab as one $10k holding in whichever leverage bucket its
 * total composition weight falls into. Decomposed bond-leg
 * surfacing would belong in a separate "exposure" view, not this
 * face-value bucketing.
 */
export function filterHouseholdByClass(
  household: Household,
  klass: AssetClass | "ALL",
): Household {
  if (klass === "ALL") return household;
  return {
    ...household,
    accounts: household.accounts.map((a) => ({
      ...a,
      holdings: a.holdings.filter(
        (h: Holding) => h.kind === klass,
      ),
    })),
  };
}
