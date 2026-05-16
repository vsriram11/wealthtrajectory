import { formatPercent0 } from "@/lib/format";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import {
  liquidNetWorth,
  taxBucketTotals,
  type Assumptions,
  type Household,
} from "@/lib/types";

/**
 * Composite 0-100 portfolio-health score with the four sub-scores
 * that produced it, so the UI can explain WHY the headline is what
 * it is. Pure function — no store coupling.
 *
 * The four pillars (each 0-100, averaged equally):
 *
 * 1. PROGRESS — how close to the Independence target.
 *    Linear: NW / target, clamped to [0, 1] × 100.
 *
 * 2. DIVERSIFICATION — Shannon-entropy of the tax-bucket mix.
 *    Max entropy = log(N_active_buckets). Normalize so 100 = max
 *    entropy across the available buckets, 0 = single-bucket
 *    concentration.
 *
 * 3. LIQUIDITY — share of NW that's liquid.
 *    100 × (liquidNetWorth / netWorth). A primary residence + a
 *    private-stock position will pull this down.
 *
 * 4. LEVERAGE SAFETY — inverse of how aggressive the effective
 *    leverage is. 100 at ≤ 1×, drops linearly to 0 at 4× (the
 *    point where a 25% drawdown wipes you out completely).
 */
export type HealthScore = {
  overall: number;
  progress: number;
  diversification: number;
  liquidity: number;
  leverageSafety: number;
  // Verbatim explanation strings — used by the UI to render the
  // "why" beneath each sub-score.
  explanations: {
    progress: string;
    diversification: string;
    liquidity: string;
    leverageSafety: string;
  };
};

export function computeHealthScore(
  household: Household,
  assumptions: Assumptions,
): HealthScore | null {
  const m = computePortfolio(household);
  if (m.netWorthUSD <= 0 || assumptions.targetNetWorthUSD <= 0) return null;

  // 1. Progress
  const progressRaw = m.netWorthUSD / assumptions.targetNetWorthUSD;
  const progress = clamp(progressRaw, 0, 1) * 100;

  // 2. Diversification (Shannon entropy of tax bucket mix)
  const buckets = taxBucketTotals(household);
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  let entropy = 0;
  let activeCount = 0;
  if (total > 0) {
    for (const v of Object.values(buckets)) {
      if (v <= 0) continue;
      activeCount++;
      const p = v / total;
      entropy -= p * Math.log2(p);
    }
  }
  // Max entropy with N buckets is log2(N). Normalize 0..1 against the
  // theoretical max for the number of buckets currently in use, then
  // boost the ceiling so 100% requires actually using multiple
  // buckets (a single-bucket portfolio would otherwise score 100).
  const numBucketsTotal = 5; // pre-tax, roth, taxable, hsa, education
  const maxEntropy = Math.log2(numBucketsTotal);
  const diversification = total > 0 ? (entropy / maxEntropy) * 100 : 0;

  // 3. Liquidity
  const liquidNW = liquidNetWorth(household);
  const liquidity =
    m.netWorthUSD > 0
      ? clamp(liquidNW / m.netWorthUSD, 0, 1) * 100
      : 0;

  // 4. Leverage safety
  // 1.0× → 100. 4.0× → 0. Above 4×, clamp to 0.
  const lev = m.effectiveLeverage;
  const leverageSafety = clamp(1 - Math.max(0, lev - 1) / 3, 0, 1) * 100;

  const overall =
    (progress + diversification + liquidity + leverageSafety) / 4;

  return {
    overall: round(overall),
    progress: round(progress),
    diversification: round(diversification),
    liquidity: round(liquidity),
    leverageSafety: round(leverageSafety),
    explanations: {
      progress:
        progressRaw >= 1
          ? "You're at or past your Independence target."
          : `You're ${formatPercent0(progressRaw)} of the way to your target.`,
      diversification:
        activeCount <= 1
          ? "All assets sit in one tax bucket — consider diversifying across pre-tax / Roth / taxable for drawdown flexibility."
          : activeCount >= 4
            ? `Using ${activeCount} tax buckets — strong flexibility for retirement drawdown.`
            : `Using ${activeCount} of 5 tax buckets.`,
      liquidity:
        liquidity >= 80
          ? "Most of your net worth is spendable."
          : liquidity >= 50
            ? "Roughly half your wealth is in liquid form."
            : "Significant illiquid exposure (primary residence, private stock, or flagged holdings). Plan drawdown carefully.",
      leverageSafety:
        lev <= 1.05
          ? "No meaningful leverage — drawdowns hit at face value."
          : lev <= 1.5
            ? `${lev.toFixed(2)}× effective leverage — modest amplification.`
            : lev <= 2.5
              ? `${lev.toFixed(2)}× effective leverage — meaningful drawdown amplification. Stress-test scenarios.`
              : `${lev.toFixed(2)}× effective leverage — high risk. A 25% market drop would wipe out most of your equity.`,
    },
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function round(x: number): number {
  return Math.round(x);
}
// formatPct removed — call sites now use `formatPercent0` from
// `./format`, which is byte-for-byte equivalent (Intl integer-
// percent format).
