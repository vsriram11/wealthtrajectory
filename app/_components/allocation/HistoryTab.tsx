"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadSnapshots,
  type Snapshot,
} from "@/lib/persistence/persistence";
import { buildDemoSnapshots } from "@/lib/demoSnapshots";
import { useAppStore } from "@/lib/store";
import {
  buildAssetClassSeries,
  summarizeClassReturns,
  type ClassReturnRow,
  type ClassSeries,
} from "@/lib/portfolio/historicalReturns";
import { formatPercent, formatUSD } from "@/lib/format";
import type { AssetClass } from "@/lib/types";

const CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Stocks",
  bond: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  commodity: "Commodities",
  real_estate: "Real estate",
  private_stock: "Private equity",
  other: "Other",
};

const CLASS_COLOR: Record<AssetClass, string> = {
  equity: "#3b82f6",
  bond: "#a78bfa",
  cash: "#94a3b8",
  crypto: "#f97316",
  commodity: "#facc15",
  real_estate: "#34d399",
  private_stock: "#ec4899",
  other: "#64748b",
};

/**
 * Allocation → History sub-tab.
 *
 * Surfaces what the snapshot history tells you about how your
 * portfolio has actually performed: per-asset-class growth
 * trajectories, CAGR, total return, and max drawdown over the
 * full snapshot window.
 *
 * Reads snapshots directly from IDB on mount (and on the
 * snapshotsRevision signal so new snapshots show up live). Stays
 * empty + helpful when there's no history yet — < 2 snapshots
 * means nothing meaningful to render, just an empty-state banner
 * pointing at SnapshotsManager.
 */
export function HistoryTab() {
  const snapshotsRevision = useAppStore((s) => s.snapshotsRevision);
  const mode = useAppStore((s) => s.mode);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Demo mode: PersistenceHydrator never writes to IDB in demo
      // (gated by mode === "real"), so loadSnapshots would always
      // be empty. Fall back to the synthetic 5-year demo history
      // so the tab has substantive content to show — the same
      // back-cast holdings the rest of the demo persona uses.
      if (mode === "demo") {
        setSnapshots(buildDemoSnapshots(Date.now()));
        setLoading(false);
        return;
      }
      const rows = await loadSnapshots();
      if (cancelled) return;
      setSnapshots(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotsRevision, mode]);

  const buckets = useMemo(
    () => buildAssetClassSeries(snapshots),
    [snapshots],
  );
  const rows = useMemo(() => summarizeClassReturns(buckets), [buckets]);

  // Snapshots-with-household — anything else has no class data.
  const withHousehold = snapshots.filter((s) => s.household);

  if (loading) {
    return (
      <section className="px-5 pt-3 pb-6">
        <p className="text-[12px] text-text-muted">Loading history…</p>
      </section>
    );
  }

  if (withHousehold.length < 2) {
    return (
      <section className="px-5 pt-3 pb-6">
        <div className="rounded-2xl border border-dashed border-border bg-bg-surface px-4 py-6 text-center">
          <h2 className="text-sm font-semibold">
            Not enough history yet
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
            History needs at least two snapshots that include holdings
            composition. {withHousehold.length === 0
              ? "No composition-bearing snapshots found."
              : "Only one composition-bearing snapshot found."}{" "}
            New snapshots are taken automatically once per calendar
            month, or you can record one manually from the Data page.
          </p>
        </div>
      </section>
    );
  }

  // Period summary — uses the FIRST and LAST composition-bearing
  // snapshot, since rows without household are excluded from the
  // engine. Mirrors what the engine sees.
  const firstT = withHousehold[0].t;
  const lastT = withHousehold[withHousehold.length - 1].t;
  const months = Math.max(
    1,
    Math.round((lastT - firstT) / (30.44 * 24 * 60 * 60 * 1000)),
  );

  return (
    <section className="px-5 pt-3 pb-6 space-y-4">
      <div className="rounded-2xl border border-border bg-bg-surface px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          History window
        </h2>
        <p className="mt-1 text-[13px]">
          <span className="num font-semibold">{formatDate(firstT)}</span>
          {" → "}
          <span className="num font-semibold">{formatDate(lastT)}</span>
          <span className="text-text-muted">
            {" "}
            ({months} {months === 1 ? "month" : "months"}, {withHousehold.length}{" "}
            snapshots)
          </span>
        </p>
      </div>

      <PerClassTable rows={rows} buckets={buckets} />
      <Disclaimer />
    </section>
  );
}

function PerClassTable({
  rows,
  buckets,
}: {
  rows: ClassReturnRow[];
  buckets: ReturnType<typeof buildAssetClassSeries>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
      <h2 className="px-4 pt-3 pb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
        Asset-class returns
      </h2>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <ClassRow
            key={row.assetClass}
            row={row}
            series={buckets[row.assetClass] ?? []}
          />
        ))}
      </ul>
    </div>
  );
}

function ClassRow({
  row,
  series,
}: {
  row: ClassReturnRow;
  series: ClassSeries;
}) {
  const label = CLASS_LABEL[row.assetClass] ?? row.assetClass;
  const color = CLASS_COLOR[row.assetClass] ?? "#64748b";
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-[13px] font-semibold">{label}</span>
        </div>
        <span className="num text-[13px] font-semibold">
          {formatUSD(row.lastValueUSD)}
        </span>
      </div>

      <div className="mt-2">
        <Sparkline series={series} color={color} />
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-text-dim uppercase tracking-wider">CAGR</dt>
          <dd
            className={`num font-semibold ${
              row.cagr == null
                ? "text-text-muted"
                : row.cagr >= 0
                  ? "text-positive"
                  : "text-negative"
            }`}
          >
            {row.cagr == null ? "—" : formatPercent(row.cagr)}
          </dd>
        </div>
        <div>
          <dt className="text-text-dim uppercase tracking-wider">
            Total return
          </dt>
          <dd
            className={`num font-semibold ${
              row.totalReturn == null
                ? "text-text-muted"
                : row.totalReturn >= 0
                  ? "text-positive"
                  : "text-negative"
            }`}
          >
            {row.totalReturn == null ? "—" : formatPercent(row.totalReturn)}
          </dd>
        </div>
        <div>
          <dt className="text-text-dim uppercase tracking-wider">
            Max drawdown
          </dt>
          <dd
            className={`num font-semibold ${
              row.drawdown == null ? "text-text-muted" : "text-negative"
            }`}
          >
            {row.drawdown == null ? "—" : `−${formatPercent(row.drawdown.lossPct)}`}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * Tiny inline SVG sparkline. No external chart lib — same SVG
 * primitives pattern other charts in this codebase use (cf.
 * ProjectionChart).
 *
 * Renders a polyline normalized to the bounding box, plus a
 * baseline at min and a faint area fill for visual weight.
 * Hides if the series is degenerate (< 2 points, or min == max).
 */
function Sparkline({
  series,
  color,
  width = 320,
  height = 40,
}: {
  series: ClassSeries;
  color: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;
  const values = series.map((p) => p.valueUSD);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  // If everything's flat we still want to show the line, just at
  // mid-height — avoid div-by-zero by mapping all points to 0.5.
  const norm = (v: number) => (range === 0 ? 0.5 : (v - min) / range);
  const xs = series.map(
    (_, i) => (series.length === 1 ? width / 2 : (i / (series.length - 1)) * width),
  );
  const points = series
    .map((p, i) => `${xs[i]},${(1 - norm(p.valueUSD)) * height}`)
    .join(" ");
  // Area under the curve — polygon clamped to bottom.
  const area = `${xs[0]},${height} ${points} ${xs[xs.length - 1]},${height}`;

  return (
    <svg
      role="img"
      aria-label="Value trajectory"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full h-10"
    >
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Disclaimer() {
  return (
    <p className="px-1 text-[11px] leading-relaxed text-text-dim">
      <span className="font-semibold">Note on returns:</span> The app
      records portfolio VALUE at each snapshot but not explicit
      deposits/withdrawals. With no flow data, Time-Weighted Return,
      Money-Weighted IRR, and CAGR algebraically collapse to the same
      figure — what&apos;s shown above. The numbers blend market
      performance with any contributions/withdrawals into each bucket.
      See Glossary → &ldquo;Time-Weighted Return&rdquo; and
      &ldquo;Money-Weighted Return&rdquo; for the worked-example
      distinction.
    </p>
  );
}

function formatDate(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
