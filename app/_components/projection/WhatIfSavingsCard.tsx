"use client";

import { useMemo, useState } from "react";
import { whatIfExtraMonthly } from "@/lib/projection/whatIf";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact, formatYearsMonths } from "@/lib/format";

const PRESETS = [100, 250, 500, 1000, 2500] as const;

/**
 * "Add $X/mo savings → Independence Y years sooner" exploration card.
 * Pure presentational wrapper around whatIfExtraMonthly.
 *
 * UX:
 *   - Quick-pick chips for common increments + a free-form NumberField
 *     so power users can dial any amount.
 *   - Headline: months-saved with a "sooner / later / no change"
 *     framing. Highlights when monthsSaved >= 12 (the kind of
 *     life-altering improvement that's worth thinking about).
 *   - Reads through useActiveProjection so member-filter and active
 *     scenario both apply: e.g., "Under the 'aggressive' scenario,
 *     adding $500/mo for Spouse advances Independence 2y 4m."
 *
 * Hidden when the baseline doesn't Independence within projection — without
 * a baseline to subtract, the delta is meaningless.
 */
export function WhatIfSavingsCard() {
  const { household, assumptions } = useActiveProjection();
  const [extra, setExtra] = useState<number>(500);

  const result = useMemo(
    () => whatIfExtraMonthly(household, assumptions, extra),
    [household, assumptions, extra],
  );

  // Need a baseline that actually Independence for the comparison to mean anything.
  if (result.baseline.monthsToIndependence == null) return null;
  if (household.accounts.length === 0) return null;

  const monthsSaved = result.monthsSaved ?? 0;
  const wasIndependence = result.baseline.monthsToIndependence;
  const nowIndependence = result.bumped.monthsToIndependence;
  const newDate = result.bumped.independenceDate;

  // Color treatment: 12+ months saved is meaningful enough to call out
  // in accent; smaller deltas stay neutral so the chip doesn't scream
  // for $100 changes that move the needle a few weeks.
  const accentful = monthsSaved >= 12;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">
          What if I save $X more / mo?
        </div>

        <div className="mt-2 scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-elevated p-0.5">
          {PRESETS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setExtra(amt)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:opacity-70 ${
                extra === amt
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              +${amt}/mo
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExtra(0)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:opacity-70 ${
              extra === 0
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            Baseline
          </button>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <div>
            <div
              className={`num text-2xl font-semibold ${
                accentful ? "text-accent" : "text-text"
              }`}
            >
              {monthsSaved > 0
                ? `–${formatYearsMonths(monthsSaved)}`
                : monthsSaved < 0
                  ? `+${formatYearsMonths(-monthsSaved)}`
                  : "Same date"}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {monthsSaved > 0
                ? `Adding ${formatUSDCompact(extra)}/mo gets you to Independence that much sooner`
                : monthsSaved < 0
                  ? `${formatUSDCompact(extra)}/mo wouldn't move it the right way (check CAGR assumptions)`
                  : `${formatUSDCompact(extra)}/mo doesn't shift the Independence date`}
            </div>
          </div>
          {newDate && (
            <div className="shrink-0 text-right">
              <div className="num text-sm text-text">
                {newDate.toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })}
              </div>
              <div className="text-[10px] text-text-dim">new Independence date</div>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-dim">
          <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider">Today</div>
            <div className="num mt-0.5 text-text">
              {formatYearsMonths(wasIndependence)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider">
              + ${extra}/mo
            </div>
            <div className="num mt-0.5 text-text">
              {nowIndependence != null ? formatYearsMonths(nowIndependence) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-text-dim">
          Extra contributions are split across your accounts in
          proportion to their current value (the same dollar-cost-
          averaging assumption the projection uses).
        </div>
      </div>
    </section>
  );
}
