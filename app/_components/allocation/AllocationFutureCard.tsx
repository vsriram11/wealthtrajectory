"use client";

import { useEffect, useMemo, useState } from "react";
import {
  projectAllocation,
  type AllocationFuturePoint,
} from "@/lib/portfolio/futureAllocation";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { useAppStore } from "@/lib/store";
import { householdYoungestAge } from "@/lib/types";
import {
  formatLeverage,
  formatPercent,
  formatUSD,
  formatUSDCompact,
} from "@/lib/format";

// Same palette as the Allocation tab so the user instantly maps
// "this purple wedge in allocation = this purple band in the future".
const CLASS_COLORS: Array<{
  key: keyof AllocationFuturePoint["classes"];
  label: string;
  color: string;
}> = [
  { key: "equityUSD", label: "Stocks", color: "#38bdf8" },
  { key: "bondUSD", label: "Bonds", color: "#a78bfa" },
  { key: "cashUSD", label: "Cash", color: "#64748b" },
  { key: "cryptoUSD", label: "Crypto", color: "#f59e0b" },
  { key: "realEstateUSD", label: "Real estate", color: "#10b981" },
  { key: "privateStockUSD", label: "Private stock", color: "#ec4899" },
  { key: "otherUSD", label: "Other", color: "#94a3b8" },
];

// Cap on the slider when the household has no member age set. 60
// is chosen because it covers every plausible Independence horizon (even a
// 30-year-old retiring at 90 only needs 60y), and longer
// projections compound model error (especially for cash and
// leverage CAGRs) past the point of usefulness.
const DEFAULT_MAX_YEARS = 60;
// We project to age 110 (slightly longer than oldest-recorded
// lifespan) as the natural ceiling — past this, the youngest
// member is past life-expectancy and the projection is largely
// nonsensical. Subtract the youngest age to get years remaining.
const PROJECT_TO_AGE = 110;

/**
 * Future projection of the household's class composition + effective
 * leverage. The user scrubs a slider for ANY year between 1 and
 * `min(60, 110 − youngest_member_age)` and reads the projected
 * class breakdown at that future point. The stacked-area chart
 * makes drift between asset classes visually obvious (e.g. "my
 * bonds shrink to a sliver in 20 years if I never rebalance"). The
 * leverage curve overlays on the right y-axis since it has totally
 * different units.
 *
 * "Apply to allocation above": pressing this writes the slider
 * value to `appliedFutureYears` in the store. AllocationPanel
 * reads this and ages the household before computing today's
 * breakdowns — so the user can see "what do my class shares and
 * effective leverage look like at year +N" reflected holistically
 * in the rollups above this card. A banner with a one-tap reset
 * surfaces the active state to prevent confusion.
 */
export function AllocationFutureCard() {
  // useActiveProjection applies the current member filter (Household
  // ↔ specific member) AND any selected scenario, so the future
  // composition reactively re-projects when the user switches
  // member or scenario.
  const { household, assumptions } = useActiveProjection();
  const appliedFutureYears = useAppStore((s) => s.appliedFutureYears);
  const setAppliedFutureYears = useAppStore((s) => s.setAppliedFutureYears);

  // Slider bound: 1 .. min(60, 110−youngest_age). Default horizon
  // is 20y when an age is known; if no age, default 30.
  const youngestAge = useMemo(
    () => householdYoungestAge(household),
    [household],
  );
  const maxHorizon = useMemo(() => {
    if (youngestAge == null) return DEFAULT_MAX_YEARS;
    return Math.max(1, Math.min(DEFAULT_MAX_YEARS, PROJECT_TO_AGE - youngestAge));
  }, [youngestAge]);
  const [horizon, setHorizon] = useState<number>(() =>
    Math.min(20, maxHorizon),
  );
  // If the upper bound changes (member added/removed/age edited),
  // clamp the slider so we never project past life-expectancy.
  // In-render adjustment — runs when maxHorizon shrinks below the
  // current horizon, equivalent to the previous effect but without
  // the extra commit-then-rerender bounce.
  if (horizon > maxHorizon) {
    setHorizon(maxHorizon);
  }

  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(
    () => projectAllocation(household, assumptions, horizon, 1),
    [household, assumptions, horizon],
  );

  if (series.length === 0 || series[0].netWorthUSD <= 0) return null;

  const peakNW = Math.max(...series.map((p) => p.netWorthUSD));
  const peakLeverage = Math.max(
    1.05,
    ...series.map((p) => p.effectiveLeverage),
  );
  const selectedIdx = hover ?? series.length - 1;
  const selected = series[selectedIdx];

  return (
    <section className="px-5 pt-6">
      <div className="rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Future composition
          </span>
          <span className="text-[10px] text-text-dim">
            {youngestAge != null ? (
              <>
                up to <span className="num">+{maxHorizon}y</span> · youngest{" "}
                age <span className="num">{youngestAge}</span>
              </>
            ) : (
              <>
                up to <span className="num">+{maxHorizon}y</span> · no age
                set
              </>
            )}
          </span>
        </div>

        <div className="mt-1 num text-2xl font-semibold text-text">
          {formatUSD(selected.netWorthUSD)}
          <span className="ml-2 text-xs text-text-dim">
            in {selected.yearOffset === 0
              ? "today"
              : `+${selected.yearOffset}y`}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-text-dim">
          {formatLeverage(selected.effectiveLeverage)} effective leverage ·{" "}
          {formatPercent(selected.weightedRealCAGR)} weighted real CAGR
        </div>

        {/* Year slider + Apply button. Slider drives `horizon`
            which controls how far out the projection runs; Apply
            writes the same value to the store so AllocationPanel
            above renders the aged-forward household. */}
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={maxHorizon}
            value={horizon}
            onChange={(e) => {
              setHorizon(Number(e.target.value));
              setHover(null);
            }}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-bg-elevated accent-accent"
            aria-label={`Projection horizon in years (1 to ${maxHorizon})`}
          />
          <div className="shrink-0 num min-w-[3.5rem] rounded-md border border-border bg-bg-elevated px-2 py-0.5 text-center text-[11px] font-medium text-text">
            +{horizon}y
          </div>
          <button
            type="button"
            onClick={() =>
              setAppliedFutureYears(
                appliedFutureYears === horizon ? null : horizon,
              )
            }
            className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
              appliedFutureYears === horizon
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-border bg-bg-elevated text-text-muted hover:text-text"
            }`}
            aria-pressed={appliedFutureYears === horizon}
            title={
              appliedFutureYears === horizon
                ? "Reset allocation rollups above to today"
                : "Apply this future state to the allocation rollups above"
            }
          >
            {appliedFutureYears === horizon ? "Applied · reset" : "Apply above"}
          </button>
        </div>

        <StackedAreaChart
          series={series}
          peakNW={peakNW}
          peakLeverage={peakLeverage}
          onHover={setHover}
          hoverIdx={hover}
        />

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          {CLASS_COLORS.map((c) => {
            const v = selected.classes[c.key];
            if (v <= 0) return null;
            const share =
              selected.netWorthUSD > 0 ? v / selected.netWorthUSD : 0;
            return (
              <span key={c.key} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: c.color }}
                  aria-hidden
                />
                <span className="text-text-muted">{c.label}</span>
                <span className="num text-text">
                  {formatPercent(share)}
                </span>
                <span className="text-text-dim">
                  ({formatUSDCompact(v)})
                </span>
              </span>
            );
          })}
        </div>

        <div className="mt-3 text-[11px] text-text-dim">
          Each holding grows at its own real CAGR. Monthly contributions
          fan into the account&apos;s existing holdings proportionally — i.e.
          no rebalancing. If you DO rebalance regularly, this chart
          overstates drift.
        </div>
      </div>
    </section>
  );
}

function StackedAreaChart({
  series,
  peakNW,
  peakLeverage,
  onHover,
  hoverIdx,
}: {
  series: AllocationFuturePoint[];
  peakNW: number;
  peakLeverage: number;
  onHover: (idx: number | null) => void;
  hoverIdx: number | null;
}) {
  const width = 360;
  const height = 160;
  const padX = 12;
  const padY = 8;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const n = series.length;
  if (n < 2) return null;

  const xAt = (i: number) => padX + (i / (n - 1)) * innerW;
  const yNW = (v: number) =>
    padY + innerH - (peakNW > 0 ? (v / peakNW) * innerH : 0);
  const yLev = (v: number) =>
    padY + innerH - ((v - 0) / (peakLeverage - 0)) * innerH;

  // Build stacked bands bottom-up so each band represents this class's
  // CONTRIBUTION at each x. We pre-compute cumulative tops.
  const stacks: number[][] = series.map(() => []);
  for (let i = 0; i < n; i++) {
    let running = 0;
    for (const c of CLASS_COLORS) {
      running += Math.max(0, series[i].classes[c.key]);
      stacks[i].push(running);
    }
  }

  const bandPath = (classIdx: number): string => {
    let top = "";
    let bottom = "";
    for (let i = 0; i < n; i++) {
      const above = classIdx === 0 ? 0 : stacks[i][classIdx - 1];
      const here = stacks[i][classIdx];
      top += `${i === 0 ? "M" : "L"}${xAt(i)},${yNW(here)} `;
      bottom = `L${xAt(i)},${yNW(above)} ${bottom}`;
    }
    return `${top}${bottom}Z`;
  };

  const leveragePath = series
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xAt(i)},${yLev(p.effectiveLeverage)}`,
    )
    .join(" ");

  return (
    <div
      className="mt-3 rounded-lg border border-border bg-bg-elevated"
      onMouseLeave={() => onHover(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-40 w-full touch-none"
        role="img"
        aria-label="Future composition over time"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const idx = Math.max(
            0,
            Math.min(n - 1, Math.round(((x - padX) / innerW) * (n - 1))),
          );
          onHover(idx);
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x =
            ((e.touches[0].clientX - rect.left) / rect.width) * width;
          const idx = Math.max(
            0,
            Math.min(n - 1, Math.round(((x - padX) / innerW) * (n - 1))),
          );
          onHover(idx);
        }}
        onTouchEnd={() => onHover(null)}
      >
        {CLASS_COLORS.map((c, idx) => (
          <path
            key={c.key}
            d={bandPath(idx)}
            fill={c.color}
            fillOpacity={0.85}
            stroke="none"
          />
        ))}
        <path
          d={leveragePath}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />
        {hoverIdx != null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={padY}
            y2={height - padY}
            stroke="#fff"
            strokeOpacity={0.6}
            strokeWidth={1}
          />
        )}
        {/* X-axis tick labels at start, mid, end */}
        <text
          x={padX}
          y={height - 1}
          fill="currentColor"
          fontSize="9"
          className="fill-text-dim"
        >
          now
        </text>
        <text
          x={width / 2 - 8}
          y={height - 1}
          fill="currentColor"
          fontSize="9"
          className="fill-text-dim"
        >
          {Math.round(series[Math.floor(n / 2)].yearOffset)}y
        </text>
        <text
          x={width - padX - 18}
          y={height - 1}
          fill="currentColor"
          fontSize="9"
          className="fill-text-dim"
        >
          +{series[n - 1].yearOffset}y
        </text>
      </svg>
    </div>
  );
}
