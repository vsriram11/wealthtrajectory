"use client";

import { formatPercent, formatUSD } from "@/lib/format";
import { GEOGRAPHIES, GEOGRAPHY_LABELS } from "@/lib/types";
import type { GeoScope, computePortfolio } from "@/lib/portfolio/portfolio";

export function CashView({
  portfolio,
  scope,
}: {
  portfolio: ReturnType<typeof computePortfolio>;
  scope: GeoScope;
}) {
  if (portfolio.cash.totalUSD === 0) {
    return <div className="text-xs text-text-dim">No cash holdings yet.</div>;
  }
  const cashShare = portfolio.classes.cashShare;

  // Slice view: just a headline + percent-of-cash breakdown.
  if (scope !== "ALL") {
    const scopeWeight = portfolio.cash.geography[scope];
    const scopeUSD = portfolio.cash.totalUSD * scopeWeight;
    return (
      <div>
        <div className="num text-3xl font-semibold text-text">
          {formatUSD(scopeUSD)}
        </div>
        <div className="mt-1 text-[11px] text-text-muted">
          {formatPercent(scopeWeight)} of cash ·{" "}
          {formatPercent(scopeWeight * cashShare)} of portfolio
        </div>
      </div>
    );
  }

  // Aggregate view: headline + per-geography stacked bars.
  return (
    <div>
      <div className="num text-3xl font-semibold text-text">
        {formatUSD(portfolio.cash.totalUSD)}
      </div>
      <div className="mt-1 text-[11px] text-text-muted">
        {formatPercent(cashShare)} of portfolio · earning{" "}
        {formatPercent(portfolio.cash.weightedRealCAGR)} real
      </div>
      <div className="mt-3 space-y-2">
        {GEOGRAPHIES.map((geo) => {
          const weight = portfolio.cash.geography[geo];
          if (weight === 0) return null;
          return (
            <div key={geo}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{GEOGRAPHY_LABELS[geo]}</span>
                <span className="num font-medium text-text">
                  {formatPercent(weight)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, weight * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
