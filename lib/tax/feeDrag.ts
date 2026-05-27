/**
 * Lifetime fee-drag estimator. Most users underestimate how much
 * expense ratios compound: a 1% fee on a 7% real CAGR is ~14% of
 * gross return — over 30 years that becomes ~25% of terminal wealth.
 *
 * We carry a small built-in expense-ratio table for the most popular
 * tickers; anything not on the list is silently skipped (we'd rather
 * surface nothing than make up a number). All ratios in decimal
 * (0.0003 = 3 bps).
 *
 * Strategy is purely informational — the projection engine uses the
 * user's `expectedRealCAGR` directly, so fees are already
 * implicitly baked in if the user enters net returns. This card
 * exists to make the *cost component* visible so users can ask
 * "could I get this exposure cheaper?".
 */

import type { Holding, Household } from "@/lib/types";

export type FundFeeRow = {
  symbol: string;
  expenseRatio: number;
  /**
   * Optional cheaper alternative when the same exposure exists at
   * a meaningfully lower fee. Renders the "Switching X → Y saves
   * roughly $Z over the horizon" callout.
   */
  cheaperAlternative?: { symbol: string; expenseRatio: number; note: string };
};

const FEE_TABLE: Record<string, FundFeeRow> = {
  // Total US equity
  VTI: { symbol: "VTI", expenseRatio: 0.0003 },
  ITOT: { symbol: "ITOT", expenseRatio: 0.0003 },
  SCHB: { symbol: "SCHB", expenseRatio: 0.0003 },
  // S&P 500
  VOO: { symbol: "VOO", expenseRatio: 0.0003 },
  IVV: { symbol: "IVV", expenseRatio: 0.0003 },
  SPY: {
    symbol: "SPY",
    expenseRatio: 0.000945,
    cheaperAlternative: {
      symbol: "VOO",
      expenseRatio: 0.0003,
      note: "Same S&P 500 exposure — ~6 bps cheaper.",
    },
  },
  // Nasdaq
  QQQ: {
    symbol: "QQQ",
    expenseRatio: 0.002,
    cheaperAlternative: {
      symbol: "QQQM",
      expenseRatio: 0.0015,
      note: "Nasdaq-100 — same index, ~5 bps cheaper.",
    },
  },
  QQQM: { symbol: "QQQM", expenseRatio: 0.0015 },
  // International
  VXUS: { symbol: "VXUS", expenseRatio: 0.0005 },
  IXUS: { symbol: "IXUS", expenseRatio: 0.0007 },
  VEA: { symbol: "VEA", expenseRatio: 0.0006 },
  VWO: { symbol: "VWO", expenseRatio: 0.0008 },
  // Bonds
  BND: { symbol: "BND", expenseRatio: 0.0003 },
  AGG: { symbol: "AGG", expenseRatio: 0.0003 },
  TLT: { symbol: "TLT", expenseRatio: 0.0015 },
  VTIP: { symbol: "VTIP", expenseRatio: 0.0004 },
  SCHP: { symbol: "SCHP", expenseRatio: 0.0003 },
  // Sectors / factor tilts
  AVUV: { symbol: "AVUV", expenseRatio: 0.0025 },
  VBR: { symbol: "VBR", expenseRatio: 0.0007 },
  // Composition wrappers
  NTSX: { symbol: "NTSX", expenseRatio: 0.002 },
  GDE: { symbol: "GDE", expenseRatio: 0.0019 },
  // Crypto
  IBIT: { symbol: "IBIT", expenseRatio: 0.0012 },
  FBTC: { symbol: "FBTC", expenseRatio: 0.0025 },
  BITX: { symbol: "BITX", expenseRatio: 0.0195 },
  // Commodities
  GLD: {
    symbol: "GLD",
    expenseRatio: 0.004,
    cheaperAlternative: {
      symbol: "IAU",
      expenseRatio: 0.0025,
      note: "Same physical gold — ~15 bps cheaper.",
    },
  },
  IAU: { symbol: "IAU", expenseRatio: 0.0025 },
  GLDM: { symbol: "GLDM", expenseRatio: 0.001 },
  SLV: { symbol: "SLV", expenseRatio: 0.005 },
};

export function lookupFee(symbol: string): FundFeeRow | null {
  if (!symbol) return null;
  return FEE_TABLE[symbol.toUpperCase()] ?? null;
}

export type FeeFinding = {
  symbol: string;
  bucketUSD: number;
  expenseRatio: number;
  /** Annual fee $ at current value. */
  annualFeeUSD: number;
  /**
   * Estimated lifetime cost over the horizon assuming the bucket
   * grows at netCAGR (i.e. fees already netted out of the assumed
   * return) but the same gross return without the fee would have
   * compounded faster. Returns the delta in terminal value.
   */
  lifetimeDragUSD: number;
  cheaperAlternative: FundFeeRow["cheaperAlternative"];
  /** Lifetime saving if user switched to the cheaper alternative. */
  switchSavingsUSD: number | null;
};

export type FeeAnalysis = {
  totalAnnualFeeUSD: number;
  totalLifetimeDragUSD: number;
  rows: FeeFinding[];
  horizonYears: number;
};

/**
 * Compound the "saved fee" scenario over `years` to get an
 * intuition-friendly lifetime number. With fee f and base net
 * return r (after fees), the corresponding gross return is r + f.
 *
 * If the user had paid (r + f) instead of r for `years`, the bucket
 * would be V * (1+r+f)^y instead of V * (1+r)^y. The delta is the
 * lifetime drag attributable to the expense ratio.
 *
 * This is an *approximation* — real fee-drag is more nuanced when
 * the user is contributing or withdrawing — but it's an order-of-
 * magnitude estimate that's much more legible than "you pay 0.3%".
 */
function lifetimeFeeDrag(
  valueUSD: number,
  netCAGR: number,
  feeRate: number,
  years: number,
): number {
  if (valueUSD <= 0 || years <= 0 || feeRate <= 0) return 0;
  const baseGrossCAGR = Math.max(0, netCAGR);
  const withFee = valueUSD * Math.pow(1 + baseGrossCAGR, years);
  const withoutFee = valueUSD * Math.pow(1 + baseGrossCAGR + feeRate, years);
  return withoutFee - withFee;
}

function holdingSymbol(h: Holding): string | null {
  if ("symbol" in h && typeof h.symbol === "string" && h.symbol.length > 0) {
    return h.symbol;
  }
  return null;
}

export function feeAnalysis(
  household: Household,
  horizonYears = 30,
): FeeAnalysis {
  const rows: FeeFinding[] = [];
  let totalAnnual = 0;
  let totalDrag = 0;

  // Aggregate per symbol across accounts so a 401k + brokerage
  // VTI position appears once.
  const bySymbol = new Map<
    string,
    { valueUSD: number; weightedCAGR: number; row: FundFeeRow }
  >();
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      const sym = holdingSymbol(h);
      if (!sym) continue;
      const row = lookupFee(sym);
      if (!row) continue;
      const cur = bySymbol.get(sym.toUpperCase());
      if (cur) {
        // Value-weight the CAGR so heterogeneous user overrides still
        // produce a sensible "net" rate per symbol.
        const newTotal = cur.valueUSD + h.valueUSD;
        // Guard against divide-by-zero when both the existing
        // aggregate and the new entry sum to 0 (corrupted /
        // zero-value holding) — without it, weightedCAGR
        // becomes NaN and propagates into `lifetimeDragUSD`,
        // poisoning the fee-drag display.
        if (newTotal > 0) {
          cur.weightedCAGR =
            (cur.weightedCAGR * cur.valueUSD +
              h.expectedRealCAGR * h.valueUSD) /
            newTotal;
        }
        cur.valueUSD = newTotal;
      } else {
        bySymbol.set(sym.toUpperCase(), {
          valueUSD: h.valueUSD,
          weightedCAGR: h.expectedRealCAGR,
          row,
        });
      }
    }
  }

  for (const [sym, { valueUSD, weightedCAGR, row }] of bySymbol) {
    const annualFee = valueUSD * row.expenseRatio;
    const drag = lifetimeFeeDrag(
      valueUSD,
      weightedCAGR,
      row.expenseRatio,
      horizonYears,
    );
    totalAnnual += annualFee;
    totalDrag += drag;
    let switchSavings: number | null = null;
    if (row.cheaperAlternative) {
      const feeDiff =
        row.expenseRatio - row.cheaperAlternative.expenseRatio;
      switchSavings = lifetimeFeeDrag(
        valueUSD,
        weightedCAGR,
        feeDiff,
        horizonYears,
      );
    }
    rows.push({
      symbol: sym,
      bucketUSD: valueUSD,
      expenseRatio: row.expenseRatio,
      annualFeeUSD: annualFee,
      lifetimeDragUSD: drag,
      cheaperAlternative: row.cheaperAlternative,
      switchSavingsUSD: switchSavings,
    });
  }

  rows.sort((a, b) => b.lifetimeDragUSD - a.lifetimeDragUSD);

  return {
    totalAnnualFeeUSD: totalAnnual,
    totalLifetimeDragUSD: totalDrag,
    rows,
    horizonYears,
  };
}

