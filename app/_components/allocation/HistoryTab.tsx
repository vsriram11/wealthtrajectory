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
import { summarizeAllRealEstate } from "@/lib/portfolio/realEstateReturns";
import { formatPercent, formatUSD } from "@/lib/format";
import {
  filterHousehold,
  householdForRollups,
  type AssetClass,
  type Household,
} from "@/lib/types";

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
  // Member-filter cascade: when the user has filtered the view
  // to one member (via MemberFilter), the History tab MUST scope
  // its per-class series to that member's holdings — same
  // contract as every other rollup-aware surface (PRD §rollup,
  // lib/rollupContract.test.ts). Otherwise a single-member view
  // silently shows household totals here.
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  // Hydration + sync state for the "loading…" UX. Without these
  // the History tab can render "Not enough history yet" while
  // PersistenceHydrator is still loading IDB OR while a Drive
  // pull is in flight — confusing on slow-disk / first-load /
  // cross-device-resume paths. Round-3 audit WARN #5.
  const hydrated = useAppStore((s) => s.hydrated);
  const googleSyncing = useAppStore((s) => s.googleSyncing);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  // Hoist the demo anchor into a useState initializer so it's
  // captured ONCE per mount rather than re-read inside the
  // effect. Round-3 audit NIT #9: this stabilizes the demo
  // timeline across hot-reload, remount, and StrictMode
  // double-invocation, and makes it deterministic for testing
  // (with vi.setSystemTime before mount). The trade-off:
  // re-mounting the tab re-anchors the timeline to a fresh
  // moment — which is exactly the documented behavior
  // (demo timeline is stable across the session, regenerated
  // on entry into demo mode).
  const [demoAnchor] = useState(() => Date.now());

  // Two independent effect branches per audit fix UI#6 — the
  // demo branch must NOT depend on snapshotsRevision (which only
  // bumps on real-mode IDB writes); otherwise a leftover real-
  // mode revision value triggers spurious regeneration of the
  // demo timeline (with a fresh Date.now() anchor, silently
  // shifting the whole 5-year window).
  useEffect(() => {
    if (mode !== "demo") return;
    // Demo timeline is stable across the session — generated
    // once per entry into demo mode. Anchored to the moment of
    // entry so the back-cast 5-year window doesn't shift if the
    // user sits on the tab past midnight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnapshots(buildDemoSnapshots(demoAnchor));
    setLoading(false);
  }, [mode, demoAnchor]);

  useEffect(() => {
    if (mode === "demo") return;
    let cancelled = false;
    void (async () => {
      const rows = await loadSnapshots();
      if (cancelled) return;
      setSnapshots(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotsRevision, mode]);

  // Two-stage cascade per the rollup contract (CLAUDE.md +
  // lib/rollupContract.test.ts):
  //   1. ALWAYS apply householdForRollups — drops members whose
  //      `includeInRollup === false` flag is set. Same routing
  //      every other rollup-aware surface uses. Round-3 audit
  //      BLOCK fix #1: previously, the History tab bypassed
  //      this and showed rollup-excluded members' holdings in
  //      CAGR/drawdown, contradicting NetWorthCard /
  //      AllocationPanel / Insights.
  //   2. THEN apply filterHousehold(memberId) if a per-member
  //      view is active. When memberId is null, this is a
  //      no-op pass-through and we save the second map.
  const scopedSnapshots = useMemo(() => {
    return snapshots.map((snap) => {
      if (!snap.household) return snap;
      let scoped: Household = householdForRollups(snap.household);
      if (selectedMemberId != null) {
        scoped = filterHousehold(scoped, selectedMemberId);
      }
      return { ...snap, household: scoped };
    });
  }, [snapshots, selectedMemberId]);
  const buckets = useMemo(
    () => buildAssetClassSeries(scopedSnapshots),
    [scopedSnapshots],
  );
  const rows = useMemo(() => summarizeClassReturns(buckets), [buckets]);

  // Snapshots-with-household — anything else has no class data.
  const withHousehold = scopedSnapshots.filter((s) => s.household);

  if (loading) {
    return (
      <section className="px-5 pt-3 pb-6">
        <p className="text-[12px] text-text-muted">Loading history…</p>
      </section>
    );
  }

  // Don't show the "Not enough history yet" empty state while
  // PersistenceHydrator hasn't finished loading IDB or while a
  // Drive pull is in flight. Surfacing "no history" prematurely
  // is misleading when the data is actually still being fetched.
  // Round-3 audit WARN #5 fix.
  if (mode === "real" && (!hydrated || googleSyncing) && snapshots.length === 0) {
    return (
      <section className="px-5 pt-3 pb-6">
        <p className="text-[12px] text-text-muted">
          {googleSyncing ? "Syncing snapshots from Drive…" : "Loading history…"}
        </p>
      </section>
    );
  }

  if (withHousehold.length < 2 || rows.length === 0) {
    // Two failure modes share this empty state:
    //   1. < 2 snapshots carry `household` (the common new-user
    //      or pre-feature case).
    //   2. >=2 snapshots carry household, but every account is
    //      empty or every holding has valueUSD that doesn't
    //      bucket (e.g. all liabilities, no assets). The rows
    //      table would otherwise render with a title and no
    //      content — worse UX than a clean empty state.
    const message =
      withHousehold.length === 0
        ? "No composition-bearing snapshots found."
        : withHousehold.length === 1
          ? "Only one composition-bearing snapshot found."
          : "Snapshots are present, but no holdings could be bucketed. Add accounts and holdings to see allocation history.";
    return (
      <section className="px-5 pt-3 pb-6">
        <div className="rounded-2xl border border-dashed border-border bg-bg-surface px-4 py-6 text-center">
          <h2 className="text-sm font-semibold">
            Not enough history yet
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
            History needs at least two snapshots that include holdings
            composition. {message}{" "}
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
      <TargetDriftCard snapshots={withHousehold} />
      <RealEstateCard snapshots={withHousehold} />
      <Disclaimer />
    </section>
  );
}

/**
 * Real-estate per-property card — shows TWR (gross property
 * CAGR), equity CAGR (often misleadingly high), and true IRR
 * (money-weighted, accounting for mortgage paydown as ongoing
 * capital contribution).
 *
 * Renders nothing when no real-estate holdings span the full
 * snapshot window. When present, surfaces the TWR/MWR
 * divergence that makes real estate the canonical real-world
 * example of where these metrics differ — see Glossary for the
 * conceptual story.
 */
function RealEstateCard({ snapshots }: { snapshots: Snapshot[] }) {
  const rows = useMemo(() => summarizeAllRealEstate(snapshots), [snapshots]);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
      <h2 className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
        Real estate returns
      </h2>
      <p className="px-4 pb-2 text-[11px] text-text-dim">
        Property TWR (market) vs. equity IRR (your actual return,
        including mortgage paydown).
      </p>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.holdingId} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold">{row.name}</span>
              <span className="num text-[12px] font-semibold">
                {formatUSD(row.finalGross)} gross
              </span>
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              Equity {formatUSD(row.finalEquity)} ·{" "}
              Mortgage {formatUSD(row.finalMortgage)} ·{" "}
              Paid down {formatUSD(row.totalPaydown)}
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <dt className="text-text-dim uppercase tracking-wider">
                  TWR (property)
                </dt>
                <dd
                  className={`num font-semibold ${
                    row.twrPctAnnual == null
                      ? "text-text-muted"
                      : row.twrPctAnnual >= 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {row.twrPctAnnual == null
                    ? "—"
                    : formatPercent(row.twrPctAnnual)}
                </dd>
              </div>
              <div>
                <dt className="text-text-dim uppercase tracking-wider">
                  IRR (you, MWR)
                </dt>
                <dd
                  className={`num font-semibold ${
                    row.irrPctAnnual == null
                      ? "text-text-muted"
                      : row.irrPctAnnual >= 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {row.irrPctAnnual == null
                    ? "—"
                    : formatPercent(row.irrPctAnnual)}
                </dd>
              </div>
              <div>
                <dt className="text-text-dim uppercase tracking-wider">
                  Equity CAGR*
                </dt>
                <dd
                  className={`num font-semibold ${
                    row.equityCAGRPctAnnual == null
                      ? "text-text-muted"
                      : row.equityCAGRPctAnnual >= 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {row.equityCAGRPctAnnual == null
                    ? "—"
                    : formatPercent(row.equityCAGRPctAnnual)}
                </dd>
              </div>
            </dl>
            {row.totalPaydown > 0 && (
              <p className="mt-2 text-[10px] leading-snug text-text-dim">
                *Equity CAGR ignores your paydown as capital
                contribution and overstates return on leveraged
                positions. IRR is the honest money-weighted answer.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Target allocation drift" — uses the newly-captured
 * `appState.targetAllocation` to show how the user's TARGET per
 * class (not realized) has evolved across the snapshot window.
 *
 * Renders nothing when fewer than 2 snapshots carry a non-null
 * target (e.g., the user has never set a target, or the field
 * pre-dates this PR's schema extension). Up-front gate keeps
 * the rest of the tab tidy for users without the data.
 *
 * The card shows the FIRST and LAST snapshot side-by-side with
 * per-class deltas — minimum-viable visualization that proves
 * the appState capture works end-to-end. A future stacked-bar
 * trajectory could replace this if richer evolution becomes
 * worth showing.
 */
function TargetDriftCard({ snapshots }: { snapshots: Snapshot[] }) {
  const withTarget = snapshots.filter(
    (s) =>
      s.appState?.targetAllocation != null &&
      Object.keys(s.appState.targetAllocation).length > 0,
  );
  if (withTarget.length < 2) return null;
  const first = withTarget[0];
  const last = withTarget[withTarget.length - 1];
  const firstTarget = first.appState!.targetAllocation!;
  const lastTarget = last.appState!.targetAllocation!;
  // Union of class keys across both endpoints — handles the
  // case where a class was added to or removed from the target
  // over time.
  const keys = new Set<AssetClass>([
    ...(Object.keys(firstTarget) as AssetClass[]),
    ...(Object.keys(lastTarget) as AssetClass[]),
  ]);

  const rows = Array.from(keys)
    .map((k) => {
      const from = firstTarget[k] ?? 0;
      const to = lastTarget[k] ?? 0;
      return { cls: k, from, to, delta: to - from };
    })
    .filter((r) => r.from !== 0 || r.to !== 0)
    .sort((a, b) => b.to - a.to);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
      <h2 className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
        Target allocation drift
      </h2>
      <p className="px-4 pb-2 text-[11px] text-text-dim">
        How your TARGET (not realized) per class moved between{" "}
        {formatDate(first.t)} and {formatDate(last.t)}.
      </p>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.cls} className="px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: CLASS_COLOR[r.cls] ?? "#64748b" }}
              />
              <span className="text-[12px] font-medium">
                {CLASS_LABEL[r.cls] ?? r.cls}
              </span>
            </div>
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="num text-text-muted">
                {formatPercent(r.from)}
              </span>
              <span className="text-text-dim" aria-hidden>
                →
              </span>
              <span className="num font-semibold">
                {formatPercent(r.to)}
              </span>
              <span
                className={`num text-[11px] tabular-nums ${
                  r.delta > 0
                    ? "text-positive"
                    : r.delta < 0
                      ? "text-negative"
                      : "text-text-dim"
                }`}
                aria-label={`Delta ${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)} percentage points`}
              >
                {r.delta === 0
                  ? "±0"
                  : `${r.delta > 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}pp`}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
        <Sparkline
          series={series}
          color={color}
          label={`${label} bucket trajectory${
            row.totalReturn != null
              ? `, ${formatPercent(row.totalReturn)} total return`
              : ""
          }`}
        />
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
// Exported for unit tests (HistoryTab.spark.test.tsx). Not part
// of the public component API.
export function Sparkline({
  series,
  color,
  label,
  width = 320,
  height = 40,
}: {
  series: ClassSeries;
  color: string;
  label: string;
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
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full h-10"
    >
      <title>{label}</title>
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
