"use client";

import { useMemo } from "react";
import { feeAnalysis } from "@/lib/tax/feeDrag";
import { useAllocationView } from "@/lib/portfolio/useAllocationView";
import { formatPercent, formatUSDCompact } from "@/lib/format";

/**
 * Expense-ratio drag card. Uses an in-app table of expense ratios
 * for the most popular tickers, then projects the *fee component*
 * of each position out over a 30-year horizon. The takeaway is the
 * single concrete number "$X over 30 years in fees" — much more
 * legible than "0.0945% expense ratio".
 *
 * Surfaces the per-position cheaper-alternative callout when a
 * meaningfully cheaper equivalent exists (SPY → VOO, GLD → IAU,
 * QQQ → QQQM). These are the highest-leverage 5-minute wins users
 * can implement without touching their strategy.
 *
 * Renders nothing when no recognized symbols are present.
 */
export function FeeDragCard() {
  // Shared allocation view so future-composition time-travel
  // ages the fee-drag analysis alongside everything else on the
  // page. Per-position fees scale with current value, so a
  // 20-year-aged equity position pays meaningfully more in
  // cumulative fees than today's snapshot.
  const { household } = useAllocationView();
  const analysis = useMemo(() => feeAnalysis(household, 30), [household]);

  if (analysis.rows.length === 0) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div>
          <div className="text-sm font-medium text-text">Expense-ratio drag</div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            What your funds&apos; fees cost — projected over the next 30 years.
            Recognized ETFs only.
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Annual fees today"
            value={formatUSDCompact(analysis.totalAnnualFeeUSD)}
            sub={`Across ${analysis.rows.length} recognized fund${analysis.rows.length === 1 ? "" : "s"}`}
          />
          <Stat
            label="Lifetime drag (30y)"
            value={formatUSDCompact(analysis.totalLifetimeDragUSD)}
            sub="Foregone compounded growth"
            negative
          />
        </div>

        <ul className="mt-3 space-y-1.5">
          {analysis.rows.map((r) => (
            <li
              key={r.symbol}
              className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-text">
                      {r.symbol}
                    </span>
                    <span className="num text-[10px] text-text-dim">
                      {(r.expenseRatio * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="num mt-0.5 text-[10px] text-text-dim">
                    {formatUSDCompact(r.bucketUSD)} ·{" "}
                    {formatUSDCompact(r.annualFeeUSD)}/yr
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[12px] font-semibold text-negative/90">
                    −{formatUSDCompact(r.lifetimeDragUSD)}
                  </div>
                  <div className="text-[10px] text-text-dim">over 30y</div>
                </div>
              </div>
              {r.cheaperAlternative && r.switchSavingsUSD != null && (
                <div className="mt-2 rounded-md border border-positive/40 bg-positive/5 px-2 py-1.5 text-[10px] leading-snug">
                  <span className="font-medium text-positive">
                    Switch idea: {r.symbol} → {r.cheaperAlternative.symbol}
                  </span>
                  <span className="text-positive/80">
                    {" "}
                    {r.cheaperAlternative.note} Saves ~
                    <span className="num font-semibold">
                      {formatUSDCompact(r.switchSavingsUSD)}
                    </span>{" "}
                    over 30 years.
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-2 text-[10px] leading-snug text-text-dim">
          Fee table is curated — manual-entry holdings and unknown tickers are
          excluded. Drag assumes growth at each position&apos;s assumed real
          CAGR.{" "}
          {analysis.totalLifetimeDragUSD > 0 &&
            `Effective fee load: ${formatPercent(analysis.totalAnnualFeeUSD / Math.max(1, analysis.rows.reduce((s, r) => s + r.bucketUSD, 0)))} blended.`}
        </div>
        <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
          <span className="font-semibold">Not investment advice.</span> Switch
          suggestions are based on stated expense ratios only; consider
          tax-lot impact, tracking error, and tax-loss-harvesting partner
          rules before selling in a taxable account.
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  negative,
}: {
  label: string;
  value: string;
  sub: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div
        className={`num mt-0.5 text-base font-semibold ${negative ? "text-negative/90" : "text-text"}`}
      >
        {value}
      </div>
      <div className="text-[10px] text-text-dim">{sub}</div>
    </div>
  );
}
