"use client";

import { useMemo, useState } from "react";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { computeStress } from "@/lib/projection/stress";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSD } from "@/lib/format";
import { holdingLeverage, type Household } from "@/lib/types";

const SHOCKS = [10, 20, 30, 50] as const;

/**
 * Single-shock snapshot test. Worst-case correlation-=-1 framing:
 * what happens to net worth if every risk-bearing asset class drops
 * by the same percentage on the same day. This is a stress floor —
 * real markets rarely move that uniformly (gold and Treasuries often
 * diverge from stocks in panic regimes), but it gives the user a
 * defensible worst case to anchor risk tolerance.
 *
 * Per-class math (lib/stress.ts):
 *   drop_USD = face × effective_leverage × shock
 * Where effective_leverage on RE is the household's weighted-avg
 * mortgage leverage. A $1M home with $200k mortgage has $800k equity
 * and 1.25× leverage; a 20% home-price drop wipes 25% of equity
 * (1.25 × 20%). The breakdown row exposes this so users can see
 * which holdings amplify damage.
 *
 * Cash and "other" face-value assets are left alone — they don't
 * track market beta. Liabilities don't shrink, which is why leverage
 * concentrates damage onto equity holdings.
 *
 * Free for all users. Reads through useActiveProjection so the card
 * respects the active member filter and any selected scenario.
 */
export function StressTestCard() {
  const { household } = useActiveProjection();
  const [shockPct, setShockPct] = useState<number>(20);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const portfolio = useMemo(() => computePortfolio(household), [household]);

  const stress = useMemo(
    () => computeStress(household, portfolio, shockPct / 100),
    [household, portfolio, shockPct],
  );

  // Per-class leverage actually applied for this scope. RE and PS
  // come from household-level weighted-avg; equity/bond/crypto/
  // commodity come from the portfolio metrics. Surfaced in the
  // breakdown so users can see why a 20% shock can wipe 25% of an
  // RE equity stake.
  const reLeverage = useMemo(() => weightedLeverage(household, "real_estate"), [household]);
  const psLeverage = useMemo(() => weightedLeverage(household, "private_stock"), [household]);

  if (portfolio.netWorthUSD <= 0) return null;

  const { newNW, deltaUSD, pctDrop, breakdown } = stress;

  const rows: BreakdownRow[] = [
    {
      label: "Stocks",
      equityUSD: portfolio.classes.equityUSD,
      leverage: portfolio.equity.effectiveLeverage,
      dropUSD: breakdown.equityDropUSD,
    },
    {
      label: "Bonds",
      equityUSD: portfolio.classes.bondUSD,
      leverage: portfolio.bond.effectiveLeverage,
      dropUSD: breakdown.bondDropUSD,
    },
    {
      label: "Crypto",
      equityUSD: portfolio.classes.cryptoUSD,
      leverage: 1,
      dropUSD: breakdown.cryptoDropUSD,
    },
    {
      label: "Commodities",
      equityUSD: portfolio.classes.commodityUSD,
      leverage: 1,
      dropUSD: breakdown.commodityDropUSD,
    },
    {
      label: "Real estate",
      equityUSD: portfolio.classes.realEstateUSD,
      leverage: reLeverage,
      dropUSD: breakdown.realEstateDropUSD,
    },
    {
      label: "Private stock",
      equityUSD: portfolio.classes.privateStockUSD,
      leverage: psLeverage,
      dropUSD: breakdown.privateStockDropUSD,
    },
  ].filter((r) => r.equityUSD > 0);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Same-day market drop
            </div>
            <div className="mt-0.5 text-[10px] text-text-dim">
              Worst-case correlation: every risk-bearing class falls
              by the chip below at once.
            </div>
          </div>
          <div className="flex shrink-0 gap-1 rounded-full border border-border bg-bg-elevated p-0.5">
            {SHOCKS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShockPct(s)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition active:opacity-70 ${
                  shockPct === s
                    ? "bg-negative/15 text-negative"
                    : "text-text-muted hover:text-text"
                }`}
              >
                −{s}%
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="num text-2xl font-semibold text-text">
              {formatUSD(newNW)}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              net worth after a −{shockPct}% same-day drop
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`num text-sm font-medium ${
                pctDrop < -0.2 ? "text-negative" : "text-amber-300"
              }`}
            >
              {formatUSD(deltaUSD)} ({Math.round(pctDrop * 100)}%)
            </div>
            <div className="mt-0.5 text-[10px] text-text-dim">
              vs {formatUSD(portfolio.netWorthUSD)} today
            </div>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2">
            <button
              type="button"
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] text-text-muted transition hover:text-text"
            >
              <span>
                {showBreakdown ? "Hide" : "Show"} per-class breakdown
              </span>
              <span className="text-text-dim">
                {showBreakdown ? "−" : "+"}
              </span>
            </button>
            {showBreakdown && (
              <div className="mt-2 space-y-1.5">
                {rows.map((r) => (
                  <BreakdownRowView
                    key={r.label}
                    row={r}
                    shockPct={shockPct}
                  />
                ))}
                <div className="mt-2 border-t border-border pt-1.5 text-[10px] leading-snug text-text-dim">
                  Drop = equity × leverage × shock. Leverage &gt; 1
                  means a mortgage / margin / wrapper composition is
                  amplifying the move. Cash &amp; &quot;other&quot; are
                  untouched. Liabilities don&apos;t shrink, so a
                  20% drop on a 1.25× home wipes 25% of the
                  homeowner&apos;s equity, not 20%.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          <span className="text-text">Reading this:</span> it&apos;s
          a snapshot, not a 30-year forecast — use the historical
          Monte Carlo above for sequence-of-returns risk. Real-world
          crashes rarely hit every class equally (in 2008 gold rose,
          in 2022 stocks &amp; bonds both fell). Treat this as a
          correlation-1 floor, not a base case.
        </div>
      </div>
    </section>
  );
}

type BreakdownRow = {
  label: string;
  equityUSD: number;
  leverage: number;
  dropUSD: number;
};

function BreakdownRowView({
  row,
  shockPct,
}: {
  row: BreakdownRow;
  shockPct: number;
}) {
  // The effective % drop on this class's equity stake = leverage ×
  // shock. We show both the raw shock and the equity-level drop so
  // users see the amplification factor explicitly.
  const equityDropPct = row.leverage * (shockPct / 100);
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <div className="min-w-0">
        <div className="text-text">{row.label}</div>
        <div className="text-[10px] text-text-dim">
          {formatUSD(row.equityUSD)} equity
          {row.leverage > 1.01 && (
            <>
              {" "}
              × <span className="text-amber-300">{row.leverage.toFixed(2)}× lev</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-negative">
          {formatUSD(-row.dropUSD)}
        </div>
        <div className="text-[10px] text-text-dim">
          ({Math.round(equityDropPct * 100)}% of equity)
        </div>
      </div>
    </div>
  );
}

function weightedLeverage(
  h: Household,
  kind: "real_estate" | "private_stock",
): number {
  let face = 0;
  let exposure = 0;
  for (const a of h.accounts) {
    for (const holding of a.holdings) {
      if (holding.kind !== kind) continue;
      face += holding.valueUSD;
      exposure += holding.valueUSD * holdingLeverage(holding);
    }
  }
  return face > 0 ? exposure / face : 1;
}
