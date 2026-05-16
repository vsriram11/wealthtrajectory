"use client";

/**
 * Commodity holdings list. Surfaces both direct positions (GLD,
 * IAU, manual physical) AND composition-derived exposure (e.g. the
 * gold leg of GDE) so the user sees the total commodity picture,
 * not just direct holdings.
 */

import { formatPercent, formatUSD } from "@/lib/format";
import type { Household } from "@/lib/types";
import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { HoldingListView, type HoldingListItem } from "./HoldingListView";

export function CommodityView({
  household,
  portfolio,
}: {
  household: Household;
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const totalUSD = portfolio.classes.commodityUSD;

  const items: HoldingListItem[] = [];
  let directUSD = 0;
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "commodity") continue;
      items.push({
        key: holding.id,
        label: holding.symbol ?? "?",
        valueUSD: holding.valueUSD,
        detail: `${formatPercent(holding.expectedRealCAGR)} expected real CAGR`,
      });
      directUSD += holding.valueUSD;
    }
  }
  items.sort((a, b) => b.valueUSD - a.valueUSD);

  // Composition-derived exposure = total commodity bucket − direct
  // holdings. This is the portion sourced from multi-asset wrappers
  // like GDE's 90% gold leg.
  const fromComposition = Math.max(0, totalUSD - directUSD);

  return (
    <div>
      <HoldingListView
        items={items}
        totalUSD={totalUSD}
        bucketName="commodities"
        emptyState={
          <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
            No commodity exposure. Add a holding like GLD, IAU, or a multi-
            asset fund (GDE) — or enter a manual commodity (e.g. &ldquo;Gold
            jewelry&rdquo;) on any account.
          </div>
        }
      />
      {fromComposition > 0.5 && (
        <div className="mt-2 rounded-md border border-dashed border-border bg-bg-elevated px-3 py-2 text-[11px] text-text-dim">
          + {formatUSD(fromComposition)} from multi-asset wrappers (e.g.
          GDE&apos;s gold leg) — see those holdings under Stocks.
        </div>
      )}
    </div>
  );
}
