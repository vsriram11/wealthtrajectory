"use client";

import { useMemo } from "react";
import {
  cagrSensitivity,
  savingsRateSensitivity,
} from "@/lib/projection/sensitivity";
import { useScenarioNeutralProjection } from "@/lib/projection/useActiveProjection";
import { formatYearsMonths } from "@/lib/format";

/**
 * Compact sensitivity table — answers "how robust is my Independence date
 * to my key assumptions?" Shows the Independence-date impact of ±2 pts of
 * CAGR and 0.5×–2× of savings rate. Read-only; not interactive
 * (the WhatIfSavingsCard handles interactive savings exploration;
 * Scenarios handles open-ended what-ifs).
 *
 * Two strips:
 *   • Real CAGR (cagrDelta applied via applyScenario for parity)
 *   • Savings rate (contributionMultiplier applied via applyScenario)
 *
 * Reads through `useScenarioNeutralProjection` so the `delta=0` /
 * `multiplier=1` row IS actually baseline. Round-6 audit found this
 * card had the same double-apply bug as ScenarioComparisonChart:
 * using `useActiveProjection` meant the input was already merged
 * with the active scenario, and `cagrSensitivity` /
 * `savingsRateSensitivity` then re-applied PARTIAL overrides on top —
 * so the "Baseline" row label was actually the active scenario,
 * and the table's other rows were the active scenario + deltas.
 *
 * Hidden when household empty or baseline doesn't Independence.
 */
export function SensitivityCard() {
  const { household, assumptions } = useScenarioNeutralProjection();
  const cagr = useMemo(
    () => cagrSensitivity(household, assumptions),
    [household, assumptions],
  );
  const savings = useMemo(
    () => savingsRateSensitivity(household, assumptions),
    [household, assumptions],
  );

  if (household.accounts.length === 0) return null;

  const cagrBaseline = cagr.find((p) => p.delta === 0)?.monthsToIndependence ?? null;
  const savingsBaseline =
    savings.find((p) => p.delta === 1)?.monthsToIndependence ?? null;
  if (cagrBaseline == null && savingsBaseline == null) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">
          Sensitivity
        </div>
        <div className="mt-0.5 text-[11px] text-text-dim">
          Independence-date impact of your key assumptions. Honors active
          member filter + scenario.
        </div>

        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Real CAGR (vs current)
          </div>
          <ul className="mt-1 space-y-1">
            {cagr.map((p) => (
              <SensitivityRow
                key={p.delta}
                label={
                  p.delta > 0
                    ? `+${p.delta.toFixed(1)} pts`
                    : p.delta < 0
                      ? `${p.delta.toFixed(1)} pts`
                      : "Baseline"
                }
                months={p.monthsToIndependence}
                baselineMonths={cagrBaseline}
                isBaseline={p.delta === 0}
              />
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Savings rate (× current)
          </div>
          <ul className="mt-1 space-y-1">
            {savings.map((p) => (
              <SensitivityRow
                key={p.delta}
                label={p.delta === 1 ? "Baseline" : `${p.delta}×`}
                months={p.monthsToIndependence}
                baselineMonths={savingsBaseline}
                isBaseline={p.delta === 1}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SensitivityRow({
  label,
  months,
  baselineMonths,
  isBaseline,
}: {
  label: string;
  months: number | null;
  baselineMonths: number | null;
  isBaseline: boolean;
}) {
  const delta =
    months != null && baselineMonths != null
      ? months - baselineMonths
      : null;
  const tone =
    delta == null
      ? "text-text-dim"
      : delta < 0
        ? "text-positive"
        : delta > 0
          ? "text-amber-300"
          : "text-text-muted";
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-[11px]">
      <span className={`${isBaseline ? "text-text" : "text-text-muted"}`}>
        {label}
      </span>
      <span className="num flex shrink-0 items-baseline gap-2">
        <span className="text-text">
          {months != null ? formatYearsMonths(months) : "—"}
        </span>
        {delta != null && delta !== 0 && (
          <span className={tone}>
            {delta < 0 ? "−" : "+"}
            {formatYearsMonths(Math.abs(delta))}
          </span>
        )}
      </span>
    </li>
  );
}
