"use client";

/**
 * Equity class detail: a 3×3 Morningstar-style box (size × style)
 * rendered as a heatmap, plus a "share of portfolio" caption.
 *
 * Respects:
 *   - basis: face value vs effective exposure (leverage-aware)
 *   - scope: full portfolio vs US / Developed / Emerging slice
 */

import { formatPercent } from "@/lib/format";
import {
  geoScopeWeight,
  pickEquityStyleBox,
  type GeoScope,
  type computePortfolio,
} from "@/lib/portfolio/portfolio";
import { StyleBoxGrid } from "@/app/_components/allocation/StyleBoxGrid";

export function EquityView({
  portfolio,
  basis,
  scope,
}: {
  portfolio: ReturnType<typeof computePortfolio>;
  basis: "face" | "exposure";
  scope: GeoScope;
}) {
  if (portfolio.equity.totalUSD === 0) {
    return <div className="text-xs text-text-dim">No stock holdings yet.</div>;
  }

  const styleBox = pickEquityStyleBox(portfolio.equity, basis, scope);
  const scopeWeight = geoScopeWeight(portfolio.equity, scope);
  const sub =
    scope === "ALL"
      ? `${formatPercent(portfolio.classes.equityShare)} of portfolio`
      : `${formatPercent(scopeWeight * portfolio.classes.equityShare)} of portfolio · ${formatPercent(scopeWeight)} of stocks`;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-dim">
            Size × Style
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {basis === "exposure"
              ? "% of effective stock exposure"
              : "% of stock capital"}
          </div>
        </div>
        <div className="text-[11px] text-text-muted">{sub}</div>
      </div>
      <div className="mt-3">
        <StyleBoxGrid allocation={styleBox} size="md" />
      </div>
    </div>
  );
}
