import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { holdingLeverage, type Household } from "@/lib/types";

/**
 * Pure stress-test math. Given a household, its current portfolio
 * metrics, and a shock fraction (0.1 = 10% drop), returns the
 * projected new net worth and the absolute / relative change.
 *
 * Math:
 *   per-class drop = face × effective leverage × shock
 *   newNW = max(0, NW - Σ class drops)
 *
 * Examples:
 *   1× equity, $100K, 10% shock → drops $10K
 *   3× TQQQ, $100K, 10% shock → drops $30K
 *   NTSX (1.5× composition), $100K, 10% shock → drops $15K
 *   $100K equity on $500K home (5× leverage), 10% housing drop → drops $50K
 *
 * Cash and "other" face-value assets are untouched (they don't track
 * market beta). Liabilities don't shrink under a market shock — your
 * mortgage balance stays the same when housing drops, which is why
 * leveraged real-estate hits net worth so hard.
 *
 * Composition wrappers (NTSX, GDE) are handled implicitly: their
 * leverage is already baked into the per-class effective leverage by
 * computePortfolio's decompose pipeline. NTSX in equity bucket
 * contributes $60K × 1.5 = $90K equity drop-base; in bond bucket
 * contributes $40K × 1.5 = $60K bond drop-base; total = 1.5 × face.
 */
export function computeStress(
  household: Household,
  portfolio: ReturnType<typeof computePortfolio>,
  shock: number,
): {
  newNW: number;
  deltaUSD: number;
  pctDrop: number;
  breakdown: {
    equityDropUSD: number;
    bondDropUSD: number;
    cryptoDropUSD: number;
    commodityDropUSD: number;
    realEstateDropUSD: number;
    privateStockDropUSD: number;
  };
} {
  const equityDropUSD =
    portfolio.classes.equityUSD * portfolio.equity.effectiveLeverage * shock;
  const bondDropUSD =
    portfolio.classes.bondUSD * portfolio.bond.effectiveLeverage * shock;
  const cryptoDropUSD = portfolio.classes.cryptoUSD * shock;
  // Commodities apply the shock at 1× their face value. Gold sometimes
  // holds up in equity drawdowns (negative correlation in flight-to-
  // safety regimes), but for a generic broad-market stress test we
  // treat it as a 1× exposure rather than modeling the regime.
  // Composition-derived commodity legs (GDE's 90% gold) carry their
  // wrapper's intrinsic leverage via commodityExposureUSD — but the
  // grand-total here uses classes.commodityUSD (face) for symmetry
  // with the per-class drop framing.
  const commodityDropUSD = portfolio.classes.commodityUSD * shock;
  const realEstateDropUSD =
    portfolio.classes.realEstateUSD * weightedRELeverage(household) * shock;
  const privateStockDropUSD =
    portfolio.classes.privateStockUSD *
    weightedPSLeverage(household) *
    shock;

  const totalDropUSD =
    equityDropUSD +
    bondDropUSD +
    cryptoDropUSD +
    commodityDropUSD +
    realEstateDropUSD +
    privateStockDropUSD;

  // Cap the drop so net worth never goes negative from a single
  // broad-market shock. In practice a 50% shock on a heavily levered
  // portfolio could push NW below zero arithmetically; floor at $0
  // because the UI's "after the shock" framing implies a snapshot,
  // not a margin-call cascade.
  const newNW = Math.max(0, portfolio.netWorthUSD - totalDropUSD);
  const deltaUSD = newNW - portfolio.netWorthUSD;
  const pctDrop =
    portfolio.netWorthUSD > 0 ? deltaUSD / portfolio.netWorthUSD : 0;

  return {
    newNW,
    deltaUSD,
    pctDrop,
    breakdown: {
      equityDropUSD,
      bondDropUSD,
      cryptoDropUSD,
      commodityDropUSD,
      realEstateDropUSD,
      privateStockDropUSD,
    },
  };
}

function weightedRELeverage(h: Household): number {
  let face = 0;
  let exposure = 0;
  for (const a of h.accounts) {
    for (const holding of a.holdings) {
      if (holding.kind !== "real_estate") continue;
      face += holding.valueUSD;
      exposure += holding.valueUSD * holdingLeverage(holding);
    }
  }
  return face > 0 ? exposure / face : 1;
}

function weightedPSLeverage(h: Household): number {
  let face = 0;
  let exposure = 0;
  for (const a of h.accounts) {
    for (const holding of a.holdings) {
      if (holding.kind !== "private_stock") continue;
      face += holding.valueUSD;
      exposure += holding.valueUSD * holdingLeverage(holding);
    }
  }
  return face > 0 ? exposure / face : 1;
}
