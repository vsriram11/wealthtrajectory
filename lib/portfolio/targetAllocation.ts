import { computePortfolio } from "@/lib/portfolio/portfolio";
import type { AssetClass, Household } from "@/lib/types";

/**
 * User-defined target allocation: a map from AssetClass → desired
 * fraction (0..1). Implicit invariant: sum to 1 if any value is set;
 * an unconstrained (all-zero) target is treated as "no target" by
 * consumers.
 *
 * Stored as Partial because users typically only think about the
 * classes they care about (e.g. just stocks/bonds/cash); unspecified
 * classes are assumed to target 0.
 */
export type TargetAllocation = Partial<Record<AssetClass, number>>;

/**
 * Drift between current and target for a single class:
 *   driftPct = currentShare - targetShare (positive = over-allocated)
 *   driftUSD = how many $ to MOVE to hit target (positive = sell)
 */
export type ClassDrift = {
  klass: AssetClass;
  currentShare: number;
  targetShare: number;
  driftPct: number;
  driftUSD: number;
};

const ALL_CLASSES: AssetClass[] = [
  "equity",
  "bond",
  "cash",
  "crypto",
  "commodity",
  "real_estate",
  "private_stock",
  "other",
];

/**
 * Compute the per-class drift vector for a household against its
 * target allocation. Pure function — no store coupling. Returns one
 * entry per AssetClass (zero current AND zero target both produce a
 * row, so consumers can filter as they choose).
 */
export function computeDrift(
  household: Household,
  target: TargetAllocation,
): {
  drifts: ClassDrift[];
  totalUSD: number;
  /** Sum of absolute driftUSD / 2 — the minimum dollars you'd need to move to hit target exactly. */
  totalImbalanceUSD: number;
} {
  const m = computePortfolio(household);
  const totalUSD = m.classes.totalUSD;
  const currentShareByClass: Record<AssetClass, number> = {
    equity: m.classes.equityShare,
    bond: m.classes.bondShare,
    cash: m.classes.cashShare,
    crypto: m.classes.cryptoShare,
    commodity: m.classes.commodityShare,
    real_estate: m.classes.realEstateShare,
    private_stock: m.classes.privateStockShare,
    other: m.classes.otherShare,
  };
  const drifts: ClassDrift[] = ALL_CLASSES.map((klass) => {
    const currentShare = currentShareByClass[klass];
    const targetShare = target[klass] ?? 0;
    const driftPct = currentShare - targetShare;
    const driftUSD = driftPct * totalUSD;
    return { klass, currentShare, targetShare, driftPct, driftUSD };
  });
  // Sum of all over-allocated driftUSD = sum of all under-allocated
  // |driftUSD|. Half-the-absolute-sum is the same number reached
  // from either direction.
  const totalImbalanceUSD =
    drifts.reduce((s, d) => s + Math.abs(d.driftUSD), 0) / 2;
  return { drifts, totalUSD, totalImbalanceUSD };
}

/**
 * Common preset target allocations. Stored as percentages summing to
 * 100 for readability; consumers divide by 100 when applying.
 */
export const TARGET_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  target: TargetAllocation;
}> = [
  {
    id: "all-equity",
    label: "All Equity",
    description: "100% stocks. Maximum growth, maximum volatility.",
    target: { equity: 1 },
  },
  {
    id: "80-20",
    label: "80 / 20",
    description: "Classic growth-tilted: 80% stocks, 20% bonds.",
    target: { equity: 0.8, bond: 0.2 },
  },
  {
    id: "60-40",
    label: "60 / 40",
    description: "Traditional balanced: 60% stocks, 40% bonds.",
    target: { equity: 0.6, bond: 0.4 },
  },
  {
    id: "permanent",
    label: "Permanent Portfolio",
    description:
      "Harry Browne's all-weather: 25% each in stocks, bonds, cash, gold.",
    target: { equity: 0.25, bond: 0.25, cash: 0.25, commodity: 0.25 },
  },
  {
    id: "all-weather",
    label: "All Weather",
    description:
      "Bridgewater-style: 30% stocks, 55% bonds, 7.5% gold, 7.5% other commodities.",
    target: { equity: 0.3, bond: 0.55, commodity: 0.15 },
  },
];
