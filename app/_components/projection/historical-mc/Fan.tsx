"use client";

/**
 * Interactive trajectory fan for the Historical Monte Carlo card.
 *
 * Renders five percentile bands (p5 / p25 / p50 / p75 / p95) plus
 * optional worst/best path overlays, with a vertical trace line
 * that follows mouse / touch position. At the trace line, exact
 * USD values for each visible percentile are listed in a panel
 * beneath the chart.
 *
 * Three orthogonal interactions:
 *   1. Drag horizontally → vertical line follows; legend updates.
 *   2. "Show" filter chips → restrict which percentile bands are
 *      drawn ("All" / "≤ p50" / "≤ p25" / "≤ p5" / "≤ p1"). Helps
 *      users zoom into the downside without the upside dominating.
 *   3. Overlay chips → draw the actual worst or best simulated
 *      path as a dashed line for additional context.
 *
 * Pattern adopted from AllocationFutureCard's draggable line so
 * the two charts feel consistent.
 */

import { useState } from "react";
import { formatUSDCompact } from "@/lib/format";
import type { SimulationPath } from "@/lib/projection/monteCarlo";

type PercentileKey = "p1" | "p5" | "p25" | "p50" | "p75" | "p95";

type ChartData = Record<PercentileKey, number[]> & { years: number[] };

type BandFilter = "all" | "p50" | "p25" | "p5" | "p1";

type OverlayMode = "none" | "worst" | "best";

/** Which percentiles are visible at each filter level. */
const VISIBLE_BY_FILTER: Record<BandFilter, ReadonlyArray<PercentileKey>> = {
  all: ["p5", "p25", "p50", "p75", "p95"],
  p50: ["p5", "p25", "p50"],
  p25: ["p5", "p25"],
  p5: ["p1", "p5"],
  p1: ["p1"],
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 140;
const CHART_PADDING = 10;

export function Fan({
  chart,
  worstPath,
  bestPath,
}: {
  chart: ChartData;
  worstPath: SimulationPath | null;
  bestPath: SimulationPath | null;
}) {
  const [bandFilter, setBandFilter] = useState<BandFilter>("all");
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (chart.years.length < 2) return null;
  const yearCount = chart.years.length;

  // Y-max across currently-visible series so the chart re-scales
  // when the user filters to a downside-only view (hiding p95 lets
  // the worst-case band fill the canvas).
  const visiblePercentiles = VISIBLE_BY_FILTER[bandFilter];
  const visibleSeries = visiblePercentiles.map((k) => chart[k]);
  const overlaySeries =
    overlay === "worst"
      ? worstPath?.trajectory
      : overlay === "best"
        ? bestPath?.trajectory
        : undefined;
  const maxY = Math.max(1, ...visibleSeries.flat(), ...(overlaySeries ?? []));

  // Coordinate mappers.
  const xAt = (i: number) =>
    CHART_PADDING + (i / (yearCount - 1)) * (CHART_WIDTH - 2 * CHART_PADDING);
  const yAt = (v: number) =>
    CHART_PADDING + (1 - v / maxY) * (CHART_HEIGHT - 2 * CHART_PADDING);

  const buildBandPath = (low: number[], high: number[]) => {
    const top = high.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
    const bottom = low
      .map((_, i) => `${xAt(yearCount - 1 - i)},${yAt(low[yearCount - 1 - i])}`)
      .join(" ");
    return `M ${top} L ${bottom} Z`;
  };
  const buildLinePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const idx = Math.max(
      0,
      Math.min(
        yearCount - 1,
        Math.round(
          ((xPx / rect.width) * CHART_WIDTH - CHART_PADDING) /
            ((CHART_WIDTH - 2 * CHART_PADDING) / (yearCount - 1)),
        ),
      ),
    );
    setHoverIdx(idx);
  };

  // 0 + maxY + midpoint — three ticks for a sense of scale without
  // crowding the canvas.
  const yTicks = [0, maxY / 2, maxY];
  const traceIdx = hoverIdx ?? 0;

  // Legend rows for the trace line. Built from a single config so
  // the per-filter logic lives in one place instead of nested
  // arrays inside JSX.
  const legendRows = buildLegendRows({
    bandFilter,
    chart,
    traceIdx,
    overlay,
    worstPath,
    bestPath,
  });

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-bg-elevated p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          Trajectory fan (real $)
        </div>
        <div className="text-[10px] text-text-dim">
          {hoverIdx == null ? "drag to trace" : `year ${hoverIdx}`}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="mt-1 h-36 w-full touch-none select-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Monte Carlo outcome fan — percentile bands of simulated portfolio NW across the retirement horizon"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((v, i) => (
          <line
            key={i}
            x1={CHART_PADDING}
            x2={CHART_WIDTH - CHART_PADDING}
            y1={yAt(v)}
            y2={yAt(v)}
            stroke="currentColor"
            strokeOpacity={0.06}
            className="text-text"
          />
        ))}

        <FanBands
          bandFilter={bandFilter}
          chart={chart}
          buildBandPath={buildBandPath}
          buildLinePath={buildLinePath}
        />

        {overlay !== "none" && overlaySeries && (
          <path
            d={buildLinePath(overlaySeries)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            className={
              overlay === "worst" ? "text-amber-300" : "text-emerald-300"
            }
          />
        )}

        {hoverIdx != null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={CHART_PADDING}
            y2={CHART_HEIGHT - CHART_PADDING}
            stroke="currentColor"
            strokeOpacity={0.55}
            strokeDasharray="2 2"
            className="text-text"
          />
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[9px] text-text-dim">
        <span>Year 0</span>
        <span>Year {yearCount - 1}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <FilterChipGroup
          value={bandFilter}
          onChange={setBandFilter}
          options={[
            { value: "all", label: "All" },
            { value: "p50", label: "≤ p50" },
            { value: "p25", label: "≤ p25" },
            { value: "p5", label: "≤ p5" },
            { value: "p1", label: "≤ p1" },
          ]}
        />
        <FilterChipGroup
          value={overlay}
          onChange={setOverlay}
          options={[
            { value: "none", label: "No overlay" },
            { value: "worst", label: "Worst" },
            { value: "best", label: "Best" },
          ]}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] sm:grid-cols-3">
        {legendRows.map((row) => (
          <div key={row.key} className="flex justify-between gap-1">
            <span className="text-text-dim">{row.label}</span>
            <span className={`num font-medium ${row.tone}`}>
              {formatUSDCompact(row.usd ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Per-filter band rendering. Each branch sets the fill opacities
 * and color tints appropriate to its zoom level — broader bands
 * are translucent accent-color (upside still in frame); deeper
 * tails switch to opaque negative-color tinting (downside-focused).
 */
function FanBands({
  bandFilter,
  chart,
  buildBandPath,
  buildLinePath,
}: {
  bandFilter: BandFilter;
  chart: ChartData;
  buildBandPath: (low: number[], high: number[]) => string;
  buildLinePath: (vals: number[]) => string;
}) {
  switch (bandFilter) {
    case "all":
      // Full fan: p5–p95 outer + p25–p75 inner + p50 median line.
      return (
        <>
          <path d={buildBandPath(chart.p5, chart.p95)} fill="currentColor" opacity={0.08} className="text-accent" />
          <path d={buildBandPath(chart.p25, chart.p75)} fill="currentColor" opacity={0.16} className="text-accent" />
          <path d={buildLinePath(chart.p50)} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
        </>
      );
    case "p50":
      // Downside half: p5–p50 outer + p25–p50 inner + p50 line.
      return (
        <>
          <path d={buildBandPath(chart.p5, chart.p50)} fill="currentColor" opacity={0.10} className="text-accent" />
          <path d={buildBandPath(chart.p25, chart.p50)} fill="currentColor" opacity={0.18} className="text-accent" />
          <path d={buildLinePath(chart.p50)} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
        </>
      );
    case "p25":
      // Bottom quartile: p5–p25 band + p25 line.
      return (
        <>
          <path d={buildBandPath(chart.p5, chart.p25)} fill="currentColor" opacity={0.22} className="text-negative" />
          <path d={buildLinePath(chart.p25)} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-text" />
        </>
      );
    case "p5":
      // Deep tail: p1–p5 band + p5 line.
      return (
        <>
          <path d={buildBandPath(chart.p1, chart.p5)} fill="currentColor" opacity={0.26} className="text-negative" />
          <path d={buildLinePath(chart.p5)} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-negative" />
        </>
      );
    case "p1":
      // 99th-worst line only — single most-conservative summary.
      return (
        <path d={buildLinePath(chart.p1)} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-negative" />
      );
  }
}

/** Compose the trace-legend rows for the currently-visible bands. */
function buildLegendRows({
  bandFilter,
  chart,
  traceIdx,
  overlay,
  worstPath,
  bestPath,
}: {
  bandFilter: BandFilter;
  chart: ChartData;
  traceIdx: number;
  overlay: OverlayMode;
  worstPath: SimulationPath | null;
  bestPath: SimulationPath | null;
}) {
  const rows: { key: string; label: string; usd: number; tone: string }[] = [];

  if (bandFilter === "all") {
    rows.push(
      { key: "p95", label: "p95", usd: chart.p95[traceIdx], tone: "text-positive" },
      { key: "p75", label: "p75", usd: chart.p75[traceIdx], tone: "text-text" },
    );
  }
  if (bandFilter === "all" || bandFilter === "p50") {
    rows.push({
      key: "p50",
      label: "p50 median",
      usd: chart.p50[traceIdx],
      tone: "text-accent",
    });
  }
  if (bandFilter === "all" || bandFilter === "p50" || bandFilter === "p25") {
    rows.push({
      key: "p25",
      label: "p25",
      usd: chart.p25[traceIdx],
      tone: "text-text",
    });
  }
  if (bandFilter !== "p1") {
    rows.push({
      key: "p5",
      label: "p5 worst",
      usd: chart.p5[traceIdx],
      tone: "text-negative",
    });
  }
  if (bandFilter === "p5" || bandFilter === "p1") {
    rows.push({
      key: "p1",
      label: "p1 99th-worst",
      usd: chart.p1[traceIdx],
      tone: "text-negative",
    });
  }

  if (overlay === "worst" && worstPath) {
    rows.push({
      key: "worst-path",
      label: `Worst start (${worstPath.id})`,
      usd: worstPath.trajectory[traceIdx],
      tone: "text-amber-300",
    });
  }
  if (overlay === "best" && bestPath) {
    rows.push({
      key: "best-path",
      label: `Best start (${bestPath.id})`,
      usd: bestPath.trajectory[traceIdx],
      tone: "text-emerald-300",
    });
  }

  return rows;
}

/** Generic chip-group control. Caller supplies the option list. */
function FilterChipGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex shrink-0 flex-wrap gap-0.5 rounded-full border border-border bg-bg-surface p-0.5">
      {options.map((opt) => (
        <FilterChip
          key={opt.value}
          label={opt.label}
          active={value === opt.value}
          onClick={() => onChange(opt.value)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition active:opacity-70 ${
        active ? "bg-accent text-bg" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
