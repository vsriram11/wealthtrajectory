/**
 * Leverage-aware equity bucketing for the historical Monte Carlo
 * engine.
 *
 * The MC engine has a `stocks2xFraction` allocation bucket that gets
 * routed to the `stocks2x` (RYTNX-derived + projected) real-return
 * series. This helper walks the household's equity holdings and
 * computes:
 *
 *   - `stocks2xUSD`: face value of holdings recognized as 2x SPY
 *     proxies (SSO, SPUU, QLD). These get the dedicated stocks2x
 *     return series in the simulator.
 *   - `nonRecognizedLeveragedUSD`: face value of equity holdings with
 *     leverage > 1.0 whose ticker is NOT in
 *     `RECOGNIZED_2X_EQUITY_TICKERS` (e.g. TQQQ, UPRO, SOXL). These
 *     stay in the regular `stocks` bucket for projection purposes
 *     — projecting 3x daily-reset behavior backwards across 1928-2000
 *     would be dishonest given the catastrophic survival rates.
 *   - `nonRecognizedHoldings`: details of each flagged non-recognized
 *     leveraged equity position, for the warning-card UI.
 *
 * Multi-asset wrappers (NTSX, GDE, RSST, AVGE, etc.) are NOT flagged
 * here — they're handled by the composition system in
 * `computePortfolio.decompose`, which expands them into per-leg
 * exposure (e.g. NTSX → 0.9× S&P + 0.6× Treasuries). Their "leverage"
 * is already accounted for via the composition; flagging them again
 * would double-count.
 *
 * Engine-pure: no React, no store imports.
 */

import {
  RECOGNIZED_2X_EQUITY_TICKERS,
} from "@/lib/data/historicalReturns";
import type { Household } from "@/lib/types";

const RECOGNIZED_SET = new Set<string>(RECOGNIZED_2X_EQUITY_TICKERS);

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
};

export type LeveragedEquityBuckets = {
  /** Face value of recognized 2x SPY proxies (SSO/SPUU/QLD). */
  stocks2xUSD: number;
  /** Face value of leveraged equity OTHER than the recognized 2x set. */
  nonRecognizedLeveragedUSD: number;
  /** Affected non-recognized holdings, for the warning UI. */
  nonRecognizedHoldings: NonRecognizedLeveragedHolding[];
};

/**
 * Walk a household's equity holdings and compute the leverage-aware
 * buckets used by the MC engine + warning UI.
 *
 * Only counts equity holdings WITHOUT a composition spec — composition-
 * wrapped holdings (NTSX, etc.) get their leverage handled by the
 * composition system upstream, and shouldn't be flagged here.
 */
export function computeLeveragedEquityBuckets(
  household: Household,
): LeveragedEquityBuckets {
  let stocks2xUSD = 0;
  let nonRecognizedLeveragedUSD = 0;
  const nonRecognizedHoldings: NonRecognizedLeveragedHolding[] = [];

  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "equity") continue;
      // Holdings with composition decompose into per-leg exposure
      // upstream; their leverage is already split across asset
      // classes. Don't re-flag here.
      if (holding.composition && holding.composition.length > 0) continue;
      const lev = holding.leverage;
      if (!(lev > 1.0)) continue;
      const symbol = holding.symbol;
      if (RECOGNIZED_SET.has(symbol)) {
        stocks2xUSD += holding.valueUSD;
      } else {
        nonRecognizedLeveragedUSD += holding.valueUSD;
        nonRecognizedHoldings.push({
          accountId: account.id,
          holdingId: holding.id,
          symbol,
          valueUSD: holding.valueUSD,
          leverage: lev,
        });
      }
    }
  }

  return {
    stocks2xUSD,
    nonRecognizedLeveragedUSD,
    nonRecognizedHoldings,
  };
}
