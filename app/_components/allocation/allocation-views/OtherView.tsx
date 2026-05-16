"use client";

import { formatPercent } from "@/lib/format";
import type { Household } from "@/lib/types";
import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { HoldingListView, type HoldingListItem } from "./HoldingListView";

export function OtherView({
  household,
  portfolio,
}: {
  household: Household;
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const totalUSD = portfolio.otherUSD;

  const items: HoldingListItem[] = [];
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "other") continue;
      items.push({
        key: holding.id,
        label: holding.name ?? "Asset",
        valueUSD: holding.valueUSD,
        detail: `${formatPercent(holding.expectedRealCAGR)} expected real CAGR`,
      });
    }
  }
  items.sort((a, b) => b.valueUSD - a.valueUSD);

  return (
    <HoldingListView
      items={items}
      totalUSD={totalUSD}
      bucketName="other"
      emptyState={
        <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
          No other holdings.
        </div>
      }
    />
  );
}
