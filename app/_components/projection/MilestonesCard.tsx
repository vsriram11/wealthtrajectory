"use client";

import { useMemo } from "react";
import { projectIndependence, type ProjectionPoint } from "@/lib/projection/independence";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact, formatYearsMonths } from "@/lib/format";

const MILESTONE_LADDER: number[] = [
  50_000, 100_000, 250_000, 500_000,
  1_000_000, 2_500_000, 5_000_000,
  10_000_000, 25_000_000, 50_000_000,
];

/**
 * Forecast when the user's net worth crosses each round-number
 * threshold above their current NW (the Independence target is already shown
 * elsewhere). Up to four ahead — keeps the card short. Driven by
 * projectIndependence's accumulation series so it honors per-account
 * CAGRs and contributions.
 *
 * Uses useActiveProjection so the card reactively updates when the
 * user switches the member-filter (Household ↔ a specific member)
 * or selects a what-if scenario.
 *
 * Hides itself if there's no projection (empty household) or
 * everything in the ladder is already in the rear-view.
 */
export function MilestonesCard() {
  const { household, assumptions } = useActiveProjection();
  const portfolio = useMemo(() => computePortfolio(household), [household]);
  const projection = useMemo(
    () => projectIndependence(household, assumptions),
    [household, assumptions],
  );

  const upcoming = useMemo(() => {
    if (portfolio.netWorthUSD <= 0) return [];
    const remaining = MILESTONE_LADDER.filter(
      (m) => m > portfolio.netWorthUSD * 1.001,
    );
    const matches: Array<{ amount: number; monthsAway: number }> = [];
    for (const m of remaining) {
      const idx = findCrossing(projection.series, m);
      if (idx == null) continue;
      matches.push({ amount: m, monthsAway: projection.series[idx].monthOffset });
      if (matches.length >= 4) break;
    }
    return matches;
  }, [projection.series, portfolio.netWorthUSD]);

  if (upcoming.length === 0) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">
          Upcoming milestones
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {upcoming.map((m, i) => (
            <li
              key={i}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2"
            >
              <div className="num text-sm font-semibold text-accent">
                {formatUSDCompact(m.amount)}
              </div>
              <div className="mt-0.5 text-[10px] text-text-muted">
                in {formatYearsMonths(m.monthsAway)}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[10px] text-text-dim">
          Based on your current contributions + real CAGRs. Updates live
          as you tweak holdings.
        </div>
      </div>
    </section>
  );
}

/**
 * Find the first index where the series crosses the threshold from
 * below. Returns null if it never gets there within the projection
 * window.
 */
function findCrossing(
  series: ProjectionPoint[],
  threshold: number,
): number | null {
  for (let i = 0; i < series.length; i++) {
    if (series[i].netWorthUSD >= threshold) return i;
  }
  return null;
}
