/**
 * Leverage-aware equity bucketing for the historical Monte Carlo
 * engine + the at-retirement deleveraging tax model.
 *
 * The MC simulator has two equity buckets:
 *   - `stocks2x` — routes to the dataset's 2x SPY return series
 *     (RYTNX-derived 2001+, formula-projected pre-2001)
 *   - `stocks` — the 1x equity bucket
 *
 * For each non-recognized leveraged equity holding (i.e. NOT
 * SSO/SPUU/QLD), this module determines an at-retirement
 * "deleveraging strategy" that the simulator then models:
 *
 *   - `to-2x-spy`     UPRO / SPXL → SSO/SPUU (3x S&P → 2x S&P).
 *                      Routed to the `stocks2x` bucket post-tax.
 *   - `to-2x-nasdaq`  TQQQ → QLD (3x Nasdaq-100 → 2x Nasdaq-100).
 *                      Routed to the `stocks2x` bucket post-tax.
 *                      QLD's underlying is Nasdaq-100, not S&P, but
 *                      the RYTNX-derived 2x return series is the
 *                      closest available proxy. The UI surfaces this
 *                      caveat.
 *   - `diversify-to-1x`  Everything else leveraged (SOXL / FAS /
 *                         NAIL / TNA / TMF / TECL / etc.). Sector or
 *                         narrow-index 3x products have catastrophic
 *                         multi-decade survival; the stress test
 *                         assumes the user diversifies them into
 *                         broad 1x equity at retirement. Routed to
 *                         the `stocks` (1x) bucket post-tax.
 *
 * Multi-asset wrappers (NTSX, GDE, RSST, AVGE) are NOT touched here
 * — they decompose into per-leg exposure upstream via the
 * composition system. Flagging them again would double-count.
 *
 * Tax model: at retirement, deleveraging-positions in TAXABLE
 * accounts (BROKERAGE etc., per `TAX_TREATMENT_BY_CATEGORY`) incur
 * capital gains tax equal to `value × gainFraction ×
 * retirementTaxRate`. Tax-advantaged accounts (401K / IRA / HSA /
 * etc.) contribute zero. The simulator reduces the starting NW by
 * the total tax hit, and routes the post-tax dollars to the
 * appropriate target bucket.
 *
 * Cost-basis caveat: the app doesn't track cost basis, so the gain
 * fraction defaults to 1.0 (treat all current value as gain). This
 * is the conservative stress-test assumption — long-held leveraged
 * positions typically have very high gain-to-basis ratios anyway,
 * so 100% gain is a reasonable upper bound and the resulting tax
 * hit is the worst case the user faces.
 *
 * Engine-pure: no React, no store imports.
 */

import { DEFAULT_RETIREMENT_TAX_RATE } from "@/lib/budget/budget";
import { RECOGNIZED_2X_EQUITY_TICKERS } from "@/lib/data/historicalReturns";
import {
  TAX_TREATMENT_BY_CATEGORY,
  type AccountCategory,
  type Household,
} from "@/lib/types";

const RECOGNIZED_SET = new Set<string>(RECOGNIZED_2X_EQUITY_TICKERS);

/**
 * 3x daily-reset S&P 500 LETFs. Deleverages to a 2x S&P equivalent
 * (SSO / SPUU) at retirement. Both go into the stocks2x bucket.
 */
export const RECOGNIZED_3X_SP500_TICKERS = ["UPRO", "SPXL"] as const;
const SET_3X_SP500 = new Set<string>(RECOGNIZED_3X_SP500_TICKERS);

/**
 * 3x daily-reset Nasdaq-100 LETFs. Deleverages to QLD (2x Nasdaq-100)
 * at retirement. The simulator routes QLD-equivalent to the same
 * stocks2x return series as the S&P version — RYTNX is the closest
 * long-history proxy. Nasdaq has historically been more volatile
 * than S&P, so the approximation understates risk slightly; the
 * UI documents this caveat.
 */
export const RECOGNIZED_3X_NASDAQ_TICKERS = ["TQQQ"] as const;
const SET_3X_NASDAQ = new Set<string>(RECOGNIZED_3X_NASDAQ_TICKERS);

/**
 * Multi-asset "capital-efficient" wrappers that ARE FINE to hold in
 * retirement as-is. These combine equity with bonds / gold / managed
 * futures via mild leverage (typically 1.5×–2×) and are explicitly
 * designed for long-term holding. The diversification across asset
 * classes offsets the daily-reset volatility decay that makes
 * single-asset 3× LETFs catastrophic.
 *
 * Two reasons we list these by ticker rather than rely purely on
 * the composition-spec check:
 *
 * 1. **Defense-in-depth.** The composition system (in the presets
 *    file) already gives the simulator a proper per-class breakdown
 *    when the user picks one of these from the preset list. But a
 *    user can also add a holding manually with the symbol typed in
 *    and the composition field left blank — in which case the
 *    composition check wouldn't catch it, and my code would
 *    incorrectly flag NTSX-like positions as needing deleveraging.
 *    The ticker-based skip handles this edge case cleanly.
 *
 * 2. **UX clarity.** The warning card explicitly tells users these
 *    wrappers are intentionally not flagged — so a user who holds
 *    NTSX + TQQQ doesn't wonder whether the NTSX was missed. We
 *    can only do that reliably if the skip is ticker-named.
 *
 * Kept aligned with the multi-asset preset list (lib/portfolio/
 * presets.ts:519+) — adding a new preset that's truly capital-
 * efficient should also extend this list.
 */
export const MULTI_ASSET_WRAPPER_TICKERS = [
  // WisdomTree Efficient Core series (90/60 stocks/bonds, ~1.5×)
  "NTSX",
  "NTSI",
  "NTSE",
  "NTSG",
  // WisdomTree Efficient Gold + Equity (90/90, ~1.8×)
  "GDE",
  // Return Stacked series (100/100 stocks + alt sleeve, 2.0×)
  "RSST",
  "RSSY",
  "RSSB",
  // Avantis multi-asset blend (single-class but listed for parity)
  "AVGE",
] as const;
const SET_MULTI_ASSET_WRAPPER = new Set<string>(MULTI_ASSET_WRAPPER_TICKERS);

export type DeleverageStrategy =
  | "to-2x-spy"
  | "to-2x-nasdaq"
  | "diversify-to-1x";

export type NonRecognizedLeveragedHolding = {
  /** Account containing the holding, for context in the warning UI. */
  accountId: string;
  /** Holding's stable id. */
  holdingId: string;
  /** Ticker symbol. */
  symbol: string;
  /** Face value (USD). */
  valueUSD: number;
  /** Configured leverage (e.g. 3.0 for TQQQ/UPRO/SOXL). */
  leverage: number;
  /** Account category — for displaying tax context in the UI. */
  accountCategory: AccountCategory;
  /** True when the account is taxable (BROKERAGE etc.). */
  inTaxableAccount: boolean;
  /** What the MC stress test assumes the user does at retirement. */
  deleverageStrategy: DeleverageStrategy;
  /**
   * Capital-gains tax incurred if this position were sold at
   * retirement to deleverage. Zero for tax-advantaged accounts;
   * for taxable, = valueUSD × gainFraction × retirementTaxRate.
   */
  taxHitUSD: number;
};

export type LeveragedEquityBuckets = {
  /**
   * Face value of recognized 2x SPY proxies (SSO/SPUU/QLD). These
   * stay at full face value — no tax hit, no deleveraging.
   */
  stocks2xUSD: number;
  /** Face value of leveraged equity OTHER than the recognized 2x set. */
  nonRecognizedLeveragedUSD: number;
  /** Affected non-recognized holdings, for the warning UI. */
  nonRecognizedHoldings: NonRecognizedLeveragedHolding[];
  /**
   * Total deleveraging tax hit across all taxable non-recognized
   * leveraged holdings. The MC simulator subtracts this from
   * starting NW to reflect the cost of the at-retirement
   * portfolio restructure.
   */
  deleveragingTaxHitUSD: number;
  /**
   * Post-tax value of holdings being deleveraged FROM 3x to 2x
   * (UPRO/SPXL → SSO/SPUU, TQQQ → QLD). These route to the
   * stocks2x bucket in the MC simulator.
   */
  postTaxDeleverageToStocks2xUSD: number;
  /**
   * Post-tax value of holdings being diversified from concentrated/
   * sector leverage to 1x broad equity. These route to the regular
   * stocks (1x) bucket in the MC simulator.
   */
  postTaxDiversifyToStocks1xUSD: number;
};

/**
 * Conservative stress-test default. With no cost-basis tracking we
 * treat all current value as gain — defensible because a leveraged
 * ETF held through accumulation will typically have a very high
 * gain-to-basis ratio anyway, and this gives the worst-case tax hit.
 */
const DEFAULT_GAIN_FRACTION = 1.0;

/**
 * Determine the deleveraging strategy for a non-recognized
 * leveraged equity holding. Exported for use in UI grouping logic.
 */
export function classifyDeleverageStrategy(
  symbol: string,
): DeleverageStrategy {
  if (SET_3X_SP500.has(symbol)) return "to-2x-spy";
  if (SET_3X_NASDAQ.has(symbol)) return "to-2x-nasdaq";
  return "diversify-to-1x";
}

/**
 * Walk a household's equity holdings and compute the leverage-aware
 * buckets used by the MC engine + warning UI.
 *
 * Only counts equity holdings WITHOUT a composition spec —
 * composition-wrapped holdings (NTSX, etc.) get their leverage
 * handled by the composition system upstream, and shouldn't be
 * flagged here.
 *
 * @param household  The household to analyze (typically the active-
 *                   projection-resolved household so it respects
 *                   member + liquidity + scenario filters)
 * @param retirementTaxRate  The blended tax rate the user has
 *                           configured for retirement (from
 *                           assumptions.retirementTaxRate). Defaults
 *                           to DEFAULT_RETIREMENT_TAX_RATE (20%).
 * @param gainFraction  Fraction of holding value treated as
 *                      capital gain for the tax calc. Defaults to
 *                      1.0 (conservative). Pass a lower value
 *                      (e.g. 0.5) for a less-conservative model;
 *                      future feature could let the user tune this.
 */
export function computeLeveragedEquityBuckets(
  household: Household,
  retirementTaxRate: number = DEFAULT_RETIREMENT_TAX_RATE,
  gainFraction: number = DEFAULT_GAIN_FRACTION,
): LeveragedEquityBuckets {
  let stocks2xUSD = 0;
  let nonRecognizedLeveragedUSD = 0;
  let deleveragingTaxHitUSD = 0;
  let postTaxDeleverageToStocks2xUSD = 0;
  let postTaxDiversifyToStocks1xUSD = 0;
  const nonRecognizedHoldings: NonRecognizedLeveragedHolding[] = [];

  // Clamp to a sane range — same convention as the budget engine.
  const clampedTaxRate = Math.max(0, Math.min(0.99, retirementTaxRate));
  const clampedGainFraction = Math.max(0, Math.min(1.0, gainFraction));

  for (const account of household.accounts) {
    const inTaxableAccount =
      TAX_TREATMENT_BY_CATEGORY[account.category] === "TAXABLE";
    for (const holding of account.holdings) {
      if (holding.kind !== "equity") continue;
      // Holdings with composition decompose into per-leg exposure
      // upstream; their leverage is already split across asset
      // classes. Don't re-flag here.
      if (holding.composition && holding.composition.length > 0) continue;
      const lev = holding.leverage;
      if (!(lev > 1.0)) continue;
      const symbol = holding.symbol;

      // Multi-asset capital-efficient wrappers (NTSX/GDE/RSSB/RSST/
      // etc.) are intentionally NOT flagged — they're designed to be
      // held long-term and their leverage is offset by diversification
      // across asset classes. Usually they have a composition spec
      // (caught above), but a defense-in-depth ticker check catches
      // them when the user adds the symbol manually without the
      // preset.
      if (SET_MULTI_ASSET_WRAPPER.has(symbol)) continue;

      if (RECOGNIZED_SET.has(symbol)) {
        // Recognized 2x SPY proxy — already at the modeled leverage,
        // no deleveraging needed, no tax hit.
        stocks2xUSD += holding.valueUSD;
        continue;
      }

      // Non-recognized leveraged: figure out deleverage strategy
      const strategy = classifyDeleverageStrategy(symbol);
      const value = holding.valueUSD;
      nonRecognizedLeveragedUSD += value;

      // Tax hit (if taxable account); tax-advantaged contributes 0.
      const taxHit = inTaxableAccount
        ? value * clampedGainFraction * clampedTaxRate
        : 0;
      deleveragingTaxHitUSD += taxHit;
      const postTaxValue = value - taxHit;

      // Route post-tax value to the appropriate target bucket.
      if (strategy === "to-2x-spy" || strategy === "to-2x-nasdaq") {
        postTaxDeleverageToStocks2xUSD += postTaxValue;
      } else {
        postTaxDiversifyToStocks1xUSD += postTaxValue;
      }

      nonRecognizedHoldings.push({
        accountId: account.id,
        holdingId: holding.id,
        symbol,
        valueUSD: value,
        leverage: lev,
        accountCategory: account.category,
        inTaxableAccount,
        deleverageStrategy: strategy,
        taxHitUSD: taxHit,
      });
    }
  }

  return {
    stocks2xUSD,
    nonRecognizedLeveragedUSD,
    nonRecognizedHoldings,
    deleveragingTaxHitUSD,
    postTaxDeleverageToStocks2xUSD,
    postTaxDiversifyToStocks1xUSD,
  };
}
