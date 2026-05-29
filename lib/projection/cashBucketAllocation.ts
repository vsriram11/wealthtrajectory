/**
 * Cash-bucket size override math, factored out of the Monte Carlo
 * UI so it can be tested in isolation and stays out of the
 * 1200-line card component.
 *
 * The simulator consumes a normalized allocation (all class
 * fractions sum to 1). When the user wants a custom cash slice —
 * larger OR smaller than the portfolio's projected cash share —
 * every NON-cash class is rescaled PROPORTIONALLY to make room.
 *
 * Earlier v0 of this logic only stole from `regularStocksFraction`,
 * which silently sums-to-greater-than-100% allocations when the
 * user has little 1x stocks (e.g. mostly TQQQ + RE). The simulator's
 * `resolveWeights` then normalized the excess away, giving a SMALLER
 * actual cash slice than the methodology block displayed. Proportional
 * steal preserves sum-to-1 exactly.
 */

export type RawAllocation = {
  stocksFraction: number;
  stocks2xFraction: number;
  bondsFraction: number;
  cashFraction: number;
  commodityFraction: number;
  realEstateFraction: number;
  otherFraction: number;
};

/**
 * Apply a user-requested cash bucket override to an allocation.
 *
 * `requestedCashFraction == null` is a no-op (returns the raw
 * allocation unchanged). When set, the cash slice is rewritten and
 * every non-cash class is scaled by `(1 - requested) / (1 - today)`
 * so the result still sums to 1.
 *
 * Two-way: requested > today rescales non-cash classes DOWN (sell
 * equity → buy cash); requested < today rescales UP (sell cash →
 * buy equity). Both directions can carry tax implications — the
 * caller is responsible for surfacing that to the user.
 *
 * Edge cases:
 *   - `requestedCashFraction <= 0`: clamped at 0.
 *   - `requestedCashFraction >= 1`: clamped at 1 (all cash, non-cash → 0).
 *   - `rawAllocation.cashFraction == 1` (already all cash): the
 *     denominator `1 - cashToday` is 0 → return the raw allocation
 *     (no proportional re-anchor is meaningful when there's nothing
 *     to rescale).
 */
export function applyCashBucketOverride(
  rawAllocation: RawAllocation,
  requestedCashFraction: number | null,
): RawAllocation {
  if (requestedCashFraction == null) return rawAllocation;
  // NaN-safety at the boundary (CLAUDE.md engine-purity contract).
  // Bad input degrades to a no-op rather than poisoning every
  // class with NaN. The card's vetted shares can't trigger this,
  // but the helper is callable in isolation (test + future callers).
  if (!Number.isFinite(requestedCashFraction)) return rawAllocation;
  if (!Number.isFinite(rawAllocation.cashFraction)) return rawAllocation;
  const requested = Math.max(0, Math.min(1, requestedCashFraction));
  const cashToday = rawAllocation.cashFraction;
  const denominator = 1 - cashToday;
  if (denominator <= 0) return rawAllocation;
  const nonCashScale = (1 - requested) / denominator;
  return {
    stocksFraction: rawAllocation.stocksFraction * nonCashScale,
    stocks2xFraction: rawAllocation.stocks2xFraction * nonCashScale,
    bondsFraction: rawAllocation.bondsFraction * nonCashScale,
    cashFraction: requested,
    commodityFraction: rawAllocation.commodityFraction * nonCashScale,
    realEstateFraction: rawAllocation.realEstateFraction * nonCashScale,
    otherFraction: rawAllocation.otherFraction * nonCashScale,
  };
}
