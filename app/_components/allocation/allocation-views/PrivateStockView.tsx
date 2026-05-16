"use client";

import type { Household } from "@/lib/types";
import type { computePortfolio } from "@/lib/portfolio/portfolio";
import { HoldingListView, type HoldingListItem } from "./HoldingListView";

export function PrivateStockView({
  household,
  portfolio,
}: {
  household: Household;
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const totalUSD = portfolio.privateStockUSD;

  const items: HoldingListItem[] = [];
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (holding.kind !== "private_stock") continue;
      const shares = holding.shares ?? 0;
      const fmv = holding.lastPriceUSD ?? 0;
      const preferred = holding.preferredRoundPricePerShareUSD ?? null;
      items.push({
        key: holding.id,
        label: holding.symbol ?? "Private company",
        valueUSD: holding.valueUSD,
        detail: (
          <span className="num">
            {shares.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            {" sh × $"}
            {fmv.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            {" (409A)"}
            {preferred != null
              ? `  ·  preferred $${preferred.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : ""}
          </span>
        ),
      });
    }
  }
  items.sort((a, b) => b.valueUSD - a.valueUSD);

  return (
    <HoldingListView
      items={items}
      totalUSD={totalUSD}
      bucketName="private"
      emptyState={
        <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
          No private-stock holdings.
        </div>
      }
    />
  );
}

