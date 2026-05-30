/**
 * Shared internal helpers for the household-mutation slices
 * (holdings / accounts / liabilities / members). These functions
 * operate on a structurally-typed slice context containing only
 * the `household` field — that's all they need to read/write —
 * so they're reusable across every sub-slice without dragging
 * in the full AppState.
 *
 * Underscore-prefixed module name signals "private to the
 * store layer." Components should never import these directly.
 */

import {
  isLivePriceable,
  isPricedHolding,
  type Holding,
  type Household,
} from "@/lib/types";

/**
 * Apply a per-holding transformation. Walks every account and
 * substitutes the function's return value for the holding with
 * the matching id; leaves everything else untouched.
 */
export function mapHolding<Ctx extends { household: Household }>(
  state: Ctx,
  id: string,
  fn: (h: Holding) => Holding,
): { household: Household } {
  return {
    household: {
      ...state.household,
      accounts: state.household.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) => (h.id === id ? fn(h) : h)),
      })),
    },
  };
}

/**
 * Merge a partial patch into a holding by id. Thin wrapper over
 * mapHolding for the common "set one or two fields" cases.
 */
export function updateHolding<Ctx extends { household: Household }>(
  state: Ctx,
  id: string,
  patch: Record<string, unknown>,
): { household: Household } {
  return mapHolding(state, id, (h) => ({ ...h, ...patch }) as Holding);
}

/**
 * Update a holding's USD value. Path depends on price model:
 *   - Non-priced (cash / RE / other / private_stock) → write
 *     valueUSD directly.
 *   - Manual-priced holdings collapse value + price into one
 *     number with shares = 1 (the user typed dollars).
 *   - Live-priced holdings recompute shares = value / price so
 *     the next refresh preserves the user's intended dollars.
 */
export function updateHoldingValue<Ctx extends { household: Household }>(
  state: Ctx,
  id: string,
  value: number,
): { household: Household } {
  return mapHolding(state, id, (h) => {
    if (!isPricedHolding(h)) return { ...h, valueUSD: value };
    // Zero/negative-price priced holding (corrupted state, or a
    // live-fetched holding whose upstream returned 0): treat as
    // MANUAL so we don't compute `shares = value` (i.e. 50,000
    // shares for a $50k edit) — that nonsense share count then
    // poisons the next live-refresh as the live price gets
    // multiplied by the fake share count. Fall through to the
    // manual-price branch which writes shares=1.
    if (h.lastPriceUSD <= 0 || h.isManualPrice) {
      return { ...h, valueUSD: value, lastPriceUSD: value, shares: 1 };
    }
    return { ...h, valueUSD: value, shares: value / h.lastPriceUSD };
  });
}

/**
 * Update a holding's share count. Re-derives `valueUSD` from the
 * current `lastPriceUSD`. No-op on holdings that don't carry
 * shares (cash / real_estate / other).
 */
export function updateHoldingShares<Ctx extends { household: Household }>(
  state: Ctx,
  id: string,
  shares: number,
): { household: Household } {
  return mapHolding(state, id, (h) => {
    if (!isPricedHolding(h)) return h;
    const price = h.lastPriceUSD;
    return { ...h, shares, valueUSD: shares * price };
  });
}

/**
 * Update a holding's price. Re-derives `valueUSD` from current
 * shares. The `manual` flag is sticky — once a price is entered
 * manually, the holding stays in manual mode unless the caller
 * explicitly passes `manual: false`.
 */
export function updateHoldingPrice<Ctx extends { household: Household }>(
  state: Ctx,
  id: string,
  price: number,
  manual: boolean,
  ts: number,
): { household: Household } {
  return mapHolding(state, id, (h) => {
    if (!isPricedHolding(h)) return h;
    return {
      ...h,
      lastPriceUSD: price,
      lastPricedAt: ts,
      isManualPrice: manual || h.isManualPrice,
      valueUSD: h.shares * price,
    };
  });
}

/**
 * Apply a live-price quote to every matching live-priceable
 * holding in the household.
 *
 * First-fetch behavior: the user's intended dollar value is
 * preserved by recomputing shares against the new price —
 * UNLESS the holding was originally entered by share count
 * (`enteredAsShares`), in which case shares stay fixed and the
 * dollar value floats. Subsequent refreshes always keep shares
 * fixed (the price moves, the dollar value moves with it).
 *
 * Manual-priced holdings are skipped — they don't subscribe to
 * live quotes.
 *
 * `mode`:
 *   - "live" (default): the production refresh path. First-fetch
 *     recomputes shares from the entered dollar value.
 *   - "historical": time-travel apply. SKIPS the first-fetch
 *     share-recompute — for a freshly-added holding during a
 *     backdated session, the user's entered dollar value should
 *     NOT be divided by the historical price (that would give
 *     nonsense shares like "$5000 / $300 = 16.67 shares" when
 *     the user intended just to record "$5000 in VOO on date D").
 *     Round-5 audit BLOCK.
 */
export function applyLivePriceTo<Ctx extends { household: Household }>(
  state: Ctx,
  symbol: string,
  price: number,
  pricedAt: number,
  mode: "live" | "historical" = "live",
): { household: Household } {
  const upperSymbol = symbol.toUpperCase();
  return {
    household: {
      ...state.household,
      accounts: state.household.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) => {
          if (!isLivePriceable(h)) return h;
          if (h.isManualPrice) return h;
          if (h.symbol.toUpperCase() !== upperSymbol) return h;
          const firstFetch = h.lastPricedAt == null;
          // Historical mode: NEVER recompute valueUSD from
          // existing shares × historical price. The shares were
          // computed at TODAY's price → multiplying by past
          // price yields garbage (audit R1 C2). Only update
          // the lastPriceUSD + lastPricedAt fields so the UI
          // can show "Last refreshed at <date>" without
          // corrupting the user's dollar values.
          //
          // For the firstFetch case, same rule: user's
          // entered dollar value is authoritative; don't divide
          // by historical price to derive shares either (that
          // would yield garbage shares).
          if (mode === "historical") {
            return {
              ...h,
              lastPriceUSD: price,
              lastPricedAt: pricedAt,
              // valueUSD + shares untouched.
            };
          }
          const shares =
            firstFetch && !h.enteredAsShares ? h.valueUSD / price : h.shares;
          return {
            ...h,
            shares,
            lastPriceUSD: price,
            lastPricedAt: pricedAt,
            valueUSD: shares * price,
          };
        }),
      })),
    },
  };
}
