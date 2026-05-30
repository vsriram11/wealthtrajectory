"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { runScenarios } from "@/lib/insights/scenarios";
import { projectIndependence, type IndependenceProjection } from "@/lib/projection/independence";
import { useScenarioNeutralProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact, formatYearsMonths } from "@/lib/format";

/**
 * Overlay-style projection comparison chart (PRD §7.9: "Scenario
 * comparison"). Shows the baseline net-worth-over-time curve plus
 * one curve per defined scenario. Highlights where each crosses
 * the Independence target.
 *
 * Reads through `useScenarioNeutralProjection` (filter-aware,
 * SCENARIO-NEUTRAL) so the comparison overlay sits on top of an
 * explicit baseline rather than on top of whatever scenario the
 * user happened to activate elsewhere.
 *
 * Bug history: this component used to call `useActiveProjection`,
 * which silently applies the active scenario's overrides to its
 * outputs. Effects: (1) the curve labeled "Baseline" was actually
 * the active scenario's projection; (2) `runScenarios` then
 * re-applied each scenario's overrides on top of the already-
 * modified base — the ACTIVE scenario's overrides applied TWICE,
 * making its curve diverge wildly, and other scenarios' curves
 * landed in the wrong place. The user observed this as "switching
 * scenarios makes the comparison plot stop showing all scenarios
 * and mislabel baseline." Fixed by switching to the scenario-
 * neutral hook.
 */
export function ScenarioComparisonChart() {
  const scenarios = useAppStore((s) => s.scenarios);
  const { household, assumptions } = useScenarioNeutralProjection();

  const baseline = useMemo(
    () => projectIndependence(household, assumptions),
    [household, assumptions],
  );
  const runs = useMemo(
    () => runScenarios(household, assumptions, scenarios),
    [household, assumptions, scenarios],
  );

  if (scenarios.length === 0) return null;
  if (household.accounts.length === 0) return null;

  const allSeries: Array<{
    name: string;
    color: string;
    projection: IndependenceProjection;
    monthsToIndependence: number | null;
  }> = [
    {
      name: "Baseline",
      color: "#64748b",
      projection: baseline,
      monthsToIndependence: baseline.monthsToIndependence,
    },
    ...runs.map((r) => ({
      name: r.scenario.name,
      color: r.scenario.color,
      projection: r.projection,
      monthsToIndependence: r.projection.monthsToIndependence,
    })),
  ];

  // Chart geometry. Max months = longest projection (so baseline and
  // worst-case scenarios fit).
  const maxMonths = Math.max(
    ...allSeries.map((s) => s.projection.series.length),
  );
  const maxNW = Math.max(
    ...allSeries.flatMap((s) =>
      s.projection.series.map((p) => p.netWorthUSD),
    ),
    assumptions.targetNetWorthUSD,
  );
  const minNW = Math.min(
    0,
    ...allSeries.flatMap((s) =>
      s.projection.series.map((p) => p.netWorthUSD),
    ),
  );

  const width = 360;
  const height = 200;
  const padX = 36;
  const padTop = 16;
  const padBot = 24;
  const innerW = width - padX - 8;
  const innerH = height - padTop - padBot;

  const xScale = (m: number) =>
    padX + (m / Math.max(1, maxMonths - 1)) * innerW;
  const yScale = (nw: number) =>
    padTop + (1 - (nw - minNW) / (maxNW - minNW || 1)) * innerH;

  return (
    <section className="px-5 pt-6">
      <div className="mb-3 px-1 flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Side-by-side projection
        </h2>
        <span className="text-[11px] text-text-dim">
          Target {formatUSDCompact(assumptions.targetNetWorthUSD)}
        </span>
      </div>
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-[200px] w-full"
          role="img"
          aria-label="Scenario comparison chart"
        >
          {/* Target NW horizontal line */}
          <line
            x1={padX}
            y1={yScale(assumptions.targetNetWorthUSD)}
            x2={width - 8}
            y2={yScale(assumptions.targetNetWorthUSD)}
            stroke="#1e2630"
            strokeDasharray="2 3"
            strokeWidth="1"
          />
          <text
            x={width - 8}
            y={yScale(assumptions.targetNetWorthUSD) - 4}
            textAnchor="end"
            className="fill-text-dim text-[9px]"
          >
            Independence target
          </text>

          {/* Curves */}
          {allSeries.map((s, idx) => {
            const pts = s.projection.series.map((p) =>
              [xScale(p.monthOffset), yScale(p.netWorthUSD)] as const,
            );
            const path =
              `M ${pts[0][0]},${pts[0][1]} ` +
              pts
                .slice(1)
                .map(([x, y]) => `L ${x},${y}`)
                .join(" ");
            return (
              <g key={idx}>
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.5"
                  opacity="0.9"
                />
                {/* Independence crossing marker */}
                {s.monthsToIndependence != null &&
                  s.monthsToIndependence < s.projection.series.length && (
                    <circle
                      cx={xScale(s.monthsToIndependence)}
                      cy={yScale(
                        s.projection.series[s.monthsToIndependence].netWorthUSD,
                      )}
                      r="3"
                      fill={s.color}
                    />
                  )}
              </g>
            );
          })}
        </svg>

        <ul className="mt-3 space-y-1.5">
          {allSeries.map((s, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 text-[12px]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-2 w-4 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="truncate text-text">{s.name}</span>
              </span>
              <span className="num shrink-0 text-text-muted">
                {s.monthsToIndependence != null
                  ? `Independence in ${formatYearsMonths(s.monthsToIndependence)}`
                  : "doesn't reach target"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
