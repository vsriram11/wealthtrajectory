"use client";

import { useMemo } from "react";
import { doublingAnalysis, householdWeightedCAGR } from "@/lib/projection/doubling";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatPercent } from "@/lib/format";

/**
 * "Your net worth doubles every X years" — one of the most legible
 * framings in personal finance (Rule of 72). Standalone from the Independence
 * card because doubling time is a *velocity* metric independent of
 * any absolute target. Helps users gut-check whether their CAGR
 * assumptions match their intuition.
 *
 * Honors per-member view, per-member assumption overrides, and
 * active scenario through useActiveProjection.
 */
export function DoublingTimeCard() {
  const { household, scenarioName } = useActiveProjection();

  const analysis = useMemo(() => doublingAnalysis(household), [household]);
  const r = useMemo(() => householdWeightedCAGR(household), [household]);

  if (analysis.startingUSD == null) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">Doubling time</div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              At your weighted real CAGR of{" "}
              <span className="num text-text-muted">{formatPercent(r)}</span>
              {scenarioName && (
                <>
                  {" · "}
                  <span className="text-accent">{scenarioName}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Pure compounding"
            value={
              analysis.baseMonths != null
                ? formatYearsMonths(analysis.baseMonths)
                : "—"
            }
            sub="Rule of 72"
          />
          <Stat
            label="Including contributions"
            value={
              analysis.withContributionsMonths != null
                ? formatYearsMonths(analysis.withContributionsMonths)
                : "—"
            }
            sub="Reinvested monthly"
          />
        </div>

        {analysis.roadmap.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Roadmap from today
            </div>
            <ul className="mt-2 space-y-1.5">
              {analysis.roadmap.map((p) => (
                <li
                  key={p.multiplier}
                  className="flex items-center justify-between text-[12px]"
                >
                  <span className="text-text-muted">
                    {p.multiplier}× net worth
                  </span>
                  <span className="num text-text">
                    {formatYearsMonths(p.monthsFromNow)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[10px] leading-snug text-text-dim">
              Real (inflation-adjusted) — purchasing power doubles, not just the
              dollar headline. Doesn&apos;t account for Independence-day withdrawals;
              for accumulation-phase pace only.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatYearsMonths(months: number): string {
  if (months <= 0) return "now";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="num mt-0.5 text-base font-semibold text-text">
        {value}
      </div>
      <div className="text-[10px] text-text-dim">{sub}</div>
    </div>
  );
}
