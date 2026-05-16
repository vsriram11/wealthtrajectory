/**
 * Per-asset-class metadata registry.
 *
 * Eight asset classes (equity / bond / cash / crypto / commodity /
 * real_estate / private_stock / other) flow through the codebase as
 * the {@link AssetClass} discriminant. Many surfaces need to know
 * the same per-class facts: plural label for class tabs, singular
 * label for per-holding context, default expected real-CAGR when no
 * preset / user override applies, default canonical display order.
 *
 * Before this registry existed those facts were scattered across at
 * least four files (lib/types.ts, lib/holdingFactory.ts,
 * app/_components/HoldingCreator.tsx, app/_components/HoldingEditor
 * .tsx, app/_components/allocation-views/helpers.tsx) — drifting
 * silently in two places already (AssetClass "commodity" was
 * "Commodities" in some surfaces and "Commodity" in others).
 *
 * Adding the 9th asset class is now a single file edit here.
 */

import type { AssetClass } from "@/lib/types";

export type HoldingKindMeta = {
  /** Stable discriminant value. */
  kind: AssetClass;
  /**
   * Plural display label for class-tab headers, allocation pies,
   * dashboard chips. e.g. "Stocks", "Bonds", "Commodities".
   */
  pluralLabel: string;
  /**
   * Singular display label for per-holding context — "This Stock",
   * "This Bond". e.g. "Stock", "Bond", "Commodity".
   */
  singularLabel: string;
  /**
   * Default expected real (after-inflation) CAGR for fresh holdings
   * of this kind when no preset / user override provides one.
   *
   * Sourced from long-run real-return benchmarks:
   *   - equity 7%        Damodaran S&P real-return baseline
   *   - bond 1.5%        long-run real Treasury yield
   *   - cash 0.5%        HYSA real yield baseline (assumes ~3.5% nominal − 3% CPI)
   *   - crypto 5%        debatable; conservative baseline
   *   - commodity 1%     Damodaran gold real-return baseline
   *   - real_estate 2%   Case-Shiller real-return baseline
   *   - private_stock 7% same as equity (until liquid)
   *   - other 0%         null hypothesis (caller should override)
   */
  defaultRealCAGR: number;
};

/**
 * Canonical display order — used wherever the UI iterates over
 * every asset class. Sorted by visual prominence rather than
 * alphabetically: liquid public assets first, then alts, then
 * physical / illiquid, then catch-all.
 */
export const HOLDING_KINDS: readonly AssetClass[] = [
  "equity",
  "bond",
  "cash",
  "crypto",
  "commodity",
  "real_estate",
  "private_stock",
  "other",
] as const;

export const HOLDING_KIND_META: Record<AssetClass, HoldingKindMeta> = {
  equity: {
    kind: "equity",
    pluralLabel: "Stocks",
    singularLabel: "Stock",
    defaultRealCAGR: 0.07,
  },
  bond: {
    kind: "bond",
    pluralLabel: "Bonds",
    singularLabel: "Bond",
    defaultRealCAGR: 0.015,
  },
  cash: {
    kind: "cash",
    pluralLabel: "Cash",
    singularLabel: "Cash",
    defaultRealCAGR: 0.005,
  },
  crypto: {
    kind: "crypto",
    pluralLabel: "Crypto",
    singularLabel: "Crypto",
    defaultRealCAGR: 0.05,
  },
  commodity: {
    kind: "commodity",
    pluralLabel: "Commodities",
    singularLabel: "Commodity",
    defaultRealCAGR: 0.01,
  },
  real_estate: {
    kind: "real_estate",
    pluralLabel: "Real estate",
    singularLabel: "Real estate",
    defaultRealCAGR: 0.02,
  },
  private_stock: {
    kind: "private_stock",
    pluralLabel: "Private stock",
    singularLabel: "Private stock",
    defaultRealCAGR: 0.07,
  },
  other: {
    kind: "other",
    pluralLabel: "Other",
    singularLabel: "Other",
    defaultRealCAGR: 0,
  },
};

/** Plural display label ("Stocks", "Bonds", "Commodities"). */
export function pluralLabel(kind: AssetClass): string {
  return HOLDING_KIND_META[kind].pluralLabel;
}

/** Singular display label ("Stock", "Bond", "Commodity"). */
export function singularLabel(kind: AssetClass): string {
  return HOLDING_KIND_META[kind].singularLabel;
}

/** Default expected real-CAGR for this kind. */
export function defaultRealCAGR(kind: AssetClass): number {
  return HOLDING_KIND_META[kind].defaultRealCAGR;
}
