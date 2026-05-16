"use client";

/**
 * Projection tab content for the home-page NetWorthCard. Renders:
 *
 *   1. A line-toggle chip strip (reference lines on the left; Monte
 *      Carlo overlays on the right) — toggling an MC chip is what
 *      lazily kicks off the Monte Carlo run upstream.
 *   2. The interactive {@link ProjectionChart} (NW over time with
 *      target / legacy / lost-decade / MC overlays).
 *   3. A two-up summary row: Independence date | Drawdown headline.
 *
 * All projection inputs (deterministic + stress) are computed
 * upstream; this view is presentation only.
 */

import {
  formatMonthYear,
  formatUSDCompact,
  formatYearsMonths,
} from "@/lib/format";
import type { projectIndependence } from "@/lib/projection/independence";
import type { Assumptions } from "@/lib/types";
import {
  ProjectionChart,
  type MonteCarloOverlay,
  type ProjectionChartVisibility,
} from "@/app/_components/projection/ProjectionChart";

type Projection = ReturnType<typeof projectIndependence>;

export function ProjectionView({
  projection,
  stressProjection,
  assumptions,
  empty,
  lineVis,
  toggleLine,
  mcOverlay,
  mcLoading,
}: {
  projection: Projection;
  stressProjection: Projection | null;
  assumptions: Assumptions;
  empty: boolean;
  lineVis: ProjectionChartVisibility;
  toggleLine: (k: keyof ProjectionChartVisibility) => void;
  mcOverlay: MonteCarloOverlay | null;
  mcLoading: boolean;
}) {
  const independenceLabel = projection.independenceDate
    ? formatMonthYear(projection.independenceDate)
    : "Out of reach";

  const independenceSub =
    projection.monthsToIndependence == null
      ? "Try increasing savings or lowering the target."
      : projection.monthsToIndependence === 0
        ? "You're already there."
        : `${formatYearsMonths(projection.monthsToIndependence)} away`;

  const hasStress = stressProjection != null;
  const legacyAtHorizonUSD = hasStress
    ? (stressProjection.legacyAtHorizonUSD ?? 0)
    : (projection.legacyAtHorizonUSD ?? 0);
  const sustained = hasStress
    ? stressProjection.sustained
    : projection.sustained;

  return (
    <>
      {!empty && projection.series.length > 1 && (
        <div className="mt-4 -mx-1">
          {/* Line-toggle chip strip. Two groups separated so users
              read "reference lines" (target / legacy / stress are
              the chart's editorial dotted lines) and "Monte Carlo
              overlays" (worst / p5 / p50 / p95 from the historical-
              MC engine) as distinct concepts. MC chips lazily kick
              off the engine run when first toggled. */}
          <div className="-mx-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px]">
            <span className="text-text-dim">Lines:</span>
            <LineChip
              label="Target"
              color="#38bdf8"
              active={!!lineVis.target}
              onClick={() => toggleLine("target")}
            />
            {assumptions.legacyFloorUSD > 0 && (
              <LineChip
                label="Legacy"
                color="#8a94a3"
                active={!!lineVis.legacy}
                onClick={() => toggleLine("legacy")}
              />
            )}
            {stressProjection && (
              <LineChip
                label="Lost-decade"
                color="#fbbf24"
                active={!!lineVis.stress}
                onClick={() => toggleLine("stress")}
              />
            )}
            <span className="ml-1 text-text-dim">MC:</span>
            <LineChip
              label={
                mcOverlay?.worstId ? `Worst (${mcOverlay.worstId})` : "Worst"
              }
              color="#f87171"
              active={!!lineVis.mcWorst}
              onClick={() => toggleLine("mcWorst")}
            />
            <LineChip
              label="p5"
              color="#fbbf24"
              active={!!lineVis.mcP5}
              onClick={() => toggleLine("mcP5")}
            />
            <LineChip
              label="p50"
              color="#94a3b8"
              active={!!lineVis.mcP50}
              onClick={() => toggleLine("mcP50")}
            />
            <LineChip
              label="p95"
              color="#34d399"
              active={!!lineVis.mcP95}
              onClick={() => toggleLine("mcP95")}
            />
            {mcLoading && <span className="text-text-dim">computing…</span>}
          </div>
          <ProjectionChart
            series={projection.series}
            stressSeries={stressProjection?.series ?? null}
            independenceSeriesIndex={projection.independenceSeriesIndex}
            ruinIndex={projection.ruinMonthIndex}
            targetUSD={assumptions.targetNetWorthUSD}
            legacyFloorUSD={assumptions.legacyFloorUSD}
            visibility={lineVis}
            mcOverlay={mcOverlay}
            width={360}
            height={170}
          />
          {stressProjection && projection.independenceDate && (
            <div className="mt-1 flex items-center justify-end gap-3 px-2 text-[10px] text-text-dim">
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-3"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, #8a94a3 0 3px, transparent 3px 6px)",
                  }}
                />
                0% volatility
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-3"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, #fbbf24 0 3px, transparent 3px 5px)",
                  }}
                />
                Lost decade at Independence
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Independence date
          </div>
          <div className="num mt-1 text-2xl font-semibold text-accent">
            {empty ? "—" : independenceLabel}
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {empty ? "Add holdings to see a projection" : independenceSub}
          </div>
          {/* Independence target from the member-effective assumptions —
              respects the per-member override when the global filter
              is on a specific member (matches the "Mar 2045 for who?"
              context the user is reading the card in). */}
          {!empty && assumptions.targetNetWorthUSD > 0 && (
            <div className="num mt-1 text-[11px] text-text-dim">
              Target{" "}
              <span className="text-text-muted">
                {formatUSDCompact(assumptions.targetNetWorthUSD)}
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Drawdown
          </div>
          <div className="num mt-1 text-2xl font-semibold text-text">
            {empty || projection.independenceDate == null
              ? "—"
              : `${formatUSDCompact(projection.monthlyWithdrawalUSD * 12)}/yr`}
          </div>
          <div
            className={`mt-0.5 text-[11px] ${
              projection.independenceDate == null
                ? "text-text-muted"
                : sustained
                  ? "text-positive"
                  : "text-negative"
            }`}
          >
            {empty || projection.independenceDate == null
              ? "Run drawdown after Independence"
              : sustained
                ? hasStress
                  ? `Sustained · ${formatUSDCompact(legacyAtHorizonUSD)} legacy after lost decade`
                  : `Sustained · ${formatUSDCompact(legacyAtHorizonUSD)} legacy at horizon`
                : hasStress
                  ? "Portfolio depletes before horizon (stress)"
                  : "Portfolio depletes before horizon"}
          </div>
        </div>
      </div>
      {!empty && (
        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          Projection is a model output using your assumptions — not a
          prediction or guarantee. Real returns vary; past performance does
          not predict future results.
        </div>
      )}
    </>
  );
}

/** Small toggle chip used by the line-visibility strip. */
function LineChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition active:opacity-70 ${
        active
          ? "border-border-strong bg-bg-elevated text-text"
          : "border-border bg-bg-surface text-text-dim hover:text-text-muted"
      }`}
    >
      <span
        className="inline-block h-1.5 w-3 rounded-sm"
        style={{
          backgroundColor: active ? color : "transparent",
          border: active ? "none" : `1px solid ${color}80`,
        }}
        aria-hidden
      />
      {label}
    </button>
  );
}
