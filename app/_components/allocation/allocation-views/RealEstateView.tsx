"use client";

import { formatLeverage, formatPercent } from "@/lib/format";
import type { Household } from "@/lib/types";
import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { HoldingListView, type HoldingListItem } from "./HoldingListView";

export function RealEstateView({
  household,
  portfolio,
}: {
  household: Household;
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const totalUSD = portfolio.realEstateUSD;

  const items: HoldingListItem[] = [];
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "real_estate") continue;
      const leverage = holding.leverage ?? 1;
      items.push({
        key: holding.id,
        label: holding.name ?? "Property",
        valueUSD: holding.valueUSD,
        detail: (
          <>
            {formatPercent(holding.expectedRealCAGR)} expected real CAGR
            {leverage > 1.01 ? ` · ${formatLeverage(leverage)} leverage` : ""}
          </>
        ),
      });
    }
  }
  items.sort((a, b) => b.valueUSD - a.valueUSD);

  return (
    <HoldingListView
      items={items}
      totalUSD={totalUSD}
      bucketName="real estate"
      emptyState={
        <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
          No real-estate holdings.
        </div>
      }
    />
  );
}
