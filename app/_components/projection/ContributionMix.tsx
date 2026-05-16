"use client";

import { useMemo } from "react";
import { projectIndependence } from "@/lib/projection/independence";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatPercent, formatUSD } from "@/lib/format";

export function ContributionMix() {
  const { household: filtered, assumptions } = useActiveProjection();
  const projection = useMemo(
    () => projectIndependence(filtered, assumptions),
    [filtered, assumptions],
  );

  if (filtered.accounts.length === 0) return null;
  if (projection.independenceSeriesIndex == null) return null;

  const independence = projection.series[projection.independenceSeriesIndex];
  if (!independence) return null;

  const principal = independence.startingPrincipalUSD;
  const contrib = independence.cumulativeContributionsUSD;
  const growth = Math.max(0, independence.netWorthUSD - principal - contrib);
  const total = principal + contrib + growth;
  if (total <= 0) return null;

  const principalShare = principal / total;
  const contribShare = contrib / total;
  const growthShare = growth / total;

  const segs = [
    { key: "principal", label: "Starting principal", v: principal, share: principalShare, color: "#64748b" },
    { key: "contrib", label: "Contributions", v: contrib, share: contribShare, color: "#a78bfa" },
    { key: "growth", label: "Market growth", v: growth, share: growthShare, color: "#4ade80" },
  ];

  return (
    <section className="px-5 pt-6">
      <h2 className="mb-3 px-1 text-xs font-medium uppercase tracking-wider text-text-muted">
        How you get to Independence
      </h2>
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="num text-2xl font-semibold text-text">
          {formatUSD(independence.netWorthUSD)}
        </div>
        <div className="mt-0.5 text-[11px] text-text-muted">
          Projected net worth at Independence date — broken down by source
        </div>

        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-bg-elevated">
          {segs.map(
            (s) =>
              s.share > 0 && (
                <div
                  key={s.key}
                  style={{
                    width: `${s.share * 100}%`,
                    backgroundColor: s.color,
                  }}
                />
              ),
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {segs.map((s) => (
            <li
              key={s.key}
              className="flex items-center justify-between text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-text">{s.label}</span>
              </span>
              <span className="num flex items-baseline gap-2 text-text-muted">
                <span className="font-medium text-text">
                  {formatPercent(s.share)}
                </span>
                <span className="text-[11px] text-text-dim">
                  {formatUSD(s.v)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 text-[11px] text-text-dim">
          Compounding does the heavy lifting once your portfolio is large
          enough — the growth slice gets bigger the longer the runway.
        </div>
      </div>
    </section>
  );
}
