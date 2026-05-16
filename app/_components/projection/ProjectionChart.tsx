import type { ProjectionPoint } from "@/lib/projection/independence";
import { formatUSDCompact } from "@/lib/format";

/**
 * Overlay lines that come from the historical Monte Carlo engine.
 * Each per-year trajectory begins at the Independence point (when the user
 * starts drawing down) and extends `retirementHorizon` years. We
 * render them as polylines anchored at year boundaries — the chart
 * X-axis is monthly, so year i maps to monthOffset =
 * `startMonthOffset + 12 * i`.
 *
 * Worst trajectory carries an `id` (the historical starting year
 * that produced it, e.g. "1929") so the legend can label it
 * specifically — that's much more informative than "worst case".
 */
export type MonteCarloOverlay = {
  startMonthOffset: number;
  worstId?: string;
  worst?: number[];
  p5?: number[];
  p50?: number[];
  p95?: number[];
};

/**
 * Visibility flags for the chart's optional layers. Defaults keep
 * the historical behavior (target + legacy + stress + the Independence/
 * ruin markers all visible); the MC overlays default off because
 * they're new and we don't want to surprise existing users.
 */
export type ProjectionChartVisibility = {
  target?: boolean;
  legacy?: boolean;
  stress?: boolean;
  independenceMarker?: boolean;
  ruinMarker?: boolean;
  mcWorst?: boolean;
  mcP5?: boolean;
  mcP50?: boolean;
  mcP95?: boolean;
};

type Props = {
  series: ProjectionPoint[];
  stressSeries?: ProjectionPoint[] | null;
  independenceSeriesIndex: number | null;
  ruinIndex: number | null;
  targetUSD: number;
  legacyFloorUSD: number;
  width?: number;
  height?: number;
  visibility?: ProjectionChartVisibility;
  mcOverlay?: MonteCarloOverlay | null;
};

export function ProjectionChart({
  series,
  stressSeries,
  independenceSeriesIndex,
  ruinIndex,
  targetUSD,
  legacyFloorUSD,
  width = 360,
  height = 160,
  visibility,
  mcOverlay,
}: Props) {
  const vis: Required<ProjectionChartVisibility> = {
    target: visibility?.target ?? true,
    legacy: visibility?.legacy ?? true,
    stress: visibility?.stress ?? true,
    independenceMarker: visibility?.independenceMarker ?? true,
    ruinMarker: visibility?.ruinMarker ?? true,
    mcWorst: visibility?.mcWorst ?? false,
    mcP5: visibility?.mcP5 ?? false,
    mcP50: visibility?.mcP50 ?? false,
    mcP95: visibility?.mcP95 ?? false,
  };
  if (series.length < 2) return null;

  const padX = 36;
  const padTop = 12;
  const padBot = 22;
  const innerW = width - padX - 8;
  const innerH = height - padTop - padBot;

  const xs = series.map((p) => p.monthOffset);
  const ys = series.map((p) => p.netWorthUSD);
  const stressYs = stressSeries?.map((p) => p.netWorthUSD) ?? [];
  const dataMaxY = Math.max(...ys, ...stressYs, targetUSD) * 1.05;
  // Cap the y-axis at 10× the target so a long-horizon optimistic
  // path doesn't squash the rest of the chart. Anything taller still
  // gets drawn (clipped visually by the SVG viewBox).
  const cap = targetUSD > 0 ? targetUSD * 10 : Infinity;
  const maxY = Math.min(dataMaxY, cap);
  const minY = Math.min(0, ...ys, ...stressYs, legacyFloorUSD);
  const minX = xs[0];
  const maxX = xs[xs.length - 1];

  const xScale = (m: number) => padX + ((m - minX) / (maxX - minX || 1)) * innerW;
  const yScale = (v: number) =>
    padTop + (1 - (v - minY) / (maxY - minY || 1)) * innerH;

  const accumulationPath = pathFor(
    series.filter((p) => p.phase === "accumulation"),
    xScale,
    yScale,
  );
  const drawdownPath = pathFor(
    series.filter((p) => p.phase === "drawdown"),
    xScale,
    yScale,
  );
  const accAreaPath =
    accumulationPath +
    ` L ${xScale(series.find((p) => p.phase !== "accumulation")?.monthOffset ?? maxX)},${yScale(minY)}` +
    ` L ${xScale(minX)},${yScale(minY)} Z`;

  const targetY = yScale(targetUSD);
  const legacyY = legacyFloorUSD > 0 ? yScale(legacyFloorUSD) : null;

  const independenceX =
    independenceSeriesIndex == null ? null : xScale(series[independenceSeriesIndex].monthOffset);
  const independenceY =
    independenceSeriesIndex == null ? null : yScale(series[independenceSeriesIndex].netWorthUSD);

  const ruinX =
    ruinIndex == null ? null : xScale(series[ruinIndex].monthOffset);

  const ticks = niceTicks(minY, maxY, 3);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[160px] w-full"
      role="img"
      aria-label="Projected net worth over time"
    >
      <defs>
        <linearGradient id="acc-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padX}
            x2={width - 8}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="#1f2730"
            strokeWidth={1}
          />
          <text
            x={padX - 4}
            y={yScale(t) + 3}
            textAnchor="end"
            fontSize={9}
            fill="#5b6573"
          >
            {formatUSDCompact(t)}
          </text>
        </g>
      ))}

      {vis.target && (
        <>
          <line
            x1={padX}
            x2={width - 8}
            y1={targetY}
            y2={targetY}
            stroke="#38bdf8"
            strokeOpacity={0.45}
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text
            x={width - 10}
            y={targetY - 3}
            textAnchor="end"
            fontSize={9}
            fill="#38bdf8"
            fillOpacity={0.7}
          >
            Target
          </text>
        </>
      )}

      {vis.legacy && legacyY != null && (
        <>
          <line
            x1={padX}
            x2={width - 8}
            y1={legacyY}
            y2={legacyY}
            stroke="#8a94a3"
            strokeOpacity={0.4}
            strokeDasharray="2 4"
            strokeWidth={1}
          />
          <text
            x={width - 10}
            y={legacyY - 3}
            textAnchor="end"
            fontSize={9}
            fill="#8a94a3"
          >
            Legacy
          </text>
        </>
      )}

      <path d={accAreaPath} fill="url(#acc-fill)" />
      <path
        d={accumulationPath}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {vis.stress && stressSeries && stressSeries.length > 1 && (
        <path
          d={pathFor(
            stressSeries.filter((p) => p.phase === "drawdown"),
            xScale,
            yScale,
          )}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="2 3"
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Monte Carlo overlays. Each trajectory is per-year USD,
          rendered as a polyline anchored at year boundaries
          (year i → monthOffset = startMonthOffset + 12i). Colors:
          worst=red, p5=amber, p50=gray, p95=emerald. Worst label
          uses the historical start year (e.g. "1929") when known. */}
      {mcOverlay && vis.mcP95 && mcOverlay.p95 && (
        <path
          d={mcLinePath(mcOverlay.p95, mcOverlay.startMonthOffset, xScale, yScale)}
          fill="none"
          stroke="#34d399"
          strokeWidth={1.25}
          strokeDasharray="3 2"
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {mcOverlay && vis.mcP50 && mcOverlay.p50 && (
        <path
          d={mcLinePath(mcOverlay.p50, mcOverlay.startMonthOffset, xScale, yScale)}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.25}
          strokeDasharray="4 2"
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {mcOverlay && vis.mcP5 && mcOverlay.p5 && (
        <path
          d={mcLinePath(mcOverlay.p5, mcOverlay.startMonthOffset, xScale, yScale)}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.25}
          strokeDasharray="3 2"
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {mcOverlay && vis.mcWorst && mcOverlay.worst && (
        <path
          d={mcLinePath(mcOverlay.worst, mcOverlay.startMonthOffset, xScale, yScale)}
          fill="none"
          stroke="#f87171"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          strokeOpacity={0.9}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {drawdownPath && (
        <path
          d={drawdownPath}
          fill="none"
          stroke="#8a94a3"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {vis.independenceMarker && independenceX != null && independenceY != null && (
        <g>
          <line
            x1={independenceX}
            x2={independenceX}
            y1={padTop}
            y2={height - padBot}
            stroke="#38bdf8"
            strokeOpacity={0.6}
            strokeWidth={1}
          />
          <circle
            cx={independenceX}
            cy={independenceY}
            r={4}
            fill="#38bdf8"
            stroke="#0a0d12"
            strokeWidth={2}
          />
          <text
            x={independenceX + 5}
            y={padTop + 9}
            fontSize={10}
            fill="#38bdf8"
            fontWeight={600}
          >
            Independence
          </text>
        </g>
      )}

      {vis.ruinMarker && ruinX != null && (
        <g>
          <line
            x1={ruinX}
            x2={ruinX}
            y1={padTop}
            y2={height - padBot}
            stroke="#f87171"
            strokeOpacity={0.7}
            strokeWidth={1}
          />
          <text
            x={ruinX + 4}
            y={height - padBot - 4}
            fontSize={10}
            fill="#f87171"
            fontWeight={600}
          >
            Depleted
          </text>
        </g>
      )}

      <text
        x={padX}
        y={height - 6}
        fontSize={9}
        fill="#5b6573"
      >
        Now
      </text>
      <text
        x={width - 8}
        y={height - 6}
        textAnchor="end"
        fontSize={9}
        fill="#5b6573"
      >
        +{Math.round(maxX / 12)}y
      </text>
    </svg>
  );
}

function pathFor(
  pts: ProjectionPoint[],
  xScale: (m: number) => number,
  yScale: (v: number) => number,
): string {
  if (pts.length === 0) return "";
  return (
    `M ${xScale(pts[0].monthOffset)},${yScale(pts[0].netWorthUSD)} ` +
    pts
      .slice(1)
      .map((p) => `L ${xScale(p.monthOffset)},${yScale(p.netWorthUSD)}`)
      .join(" ")
  );
}

/**
 * Build an SVG path for a Monte Carlo trajectory. The trajectory
 * is per-year (year 0 = start of retirement). We anchor it to the
 * chart by translating year i to month offset `startMonth + 12i`,
 * then run the same xScale/yScale used by the rest of the chart so
 * units line up.
 */
function mcLinePath(
  trajectory: number[],
  startMonth: number,
  xScale: (m: number) => number,
  yScale: (v: number) => number,
): string {
  if (trajectory.length === 0) return "";
  const cmds: string[] = [];
  for (let i = 0; i < trajectory.length; i++) {
    const monthOffset = startMonth + i * 12;
    const x = xScale(monthOffset);
    const y = yScale(trajectory[i]);
    cmds.push(`${i === 0 ? "M" : "L"} ${x},${y}`);
  }
  return cmds.join(" ");
}

function niceTicks(min: number, max: number, n: number): number[] {
  const range = max - min;
  if (range <= 0) return [];
  const step = niceStep(range / n);
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max; v += step) out.push(v);
  return out;
}

function niceStep(rough: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / exp;
  let nice = 10;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  return nice * exp;
}
