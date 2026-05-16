"use client";

import { formatPercent } from "@/lib/format";
import type { Household } from "@/lib/types";
import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { HoldingListView, type HoldingListItem } from "./HoldingListView";

export function CryptoView({
  household,
  portfolio,
}: {
  household: Household;
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const totalUSD = portfolio.cryptoUSD;

  const items: HoldingListItem[] = [];
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "crypto") continue;
      items.push({
        key: holding.id,
        label: (holding.symbol ?? "?").toUpperCase(),
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
      bucketName="crypto"
      emptyState={
        <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
          No crypto holdings.
        </div>
      }
    />
  );
}
