"use client";

/**
 * History tab content for the home-page NetWorthCard. Replays the
 * household's net-worth over time, splicing three data sources:
 *
 *   1. Live-quote history for liquid holdings (from yfinance via
 *      `lib/quotes.ts`).
 *   2. User-recorded snapshots (full household composition or just
 *      a scalar NW point) from `lib/persistence.ts`.
 *   3. Back-projection using each holding's expected real CAGR for
 *      windows that pre-date any recorded snapshot.
 *
 * The right edge is always pinned to the live headline NW so the
 * chart cannot disagree with the number shown above it. Hovering
 * the chart surfaces a portfolio-composition strip at that point
 * when a rich snapshot covers the window — useful for "wait, what
 * was my mix in 2022?" recall.
 *
 * Milestone markers ($50K, $100K, $250K, $1M, …) are auto-detected
 * at threshold crossings so the user can see when they hit each
 * round number without any manual annotation.
 */

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  HISTORY_RANGE_LABELS,
  memberFilteredSnapshots,
  overlaySnapshots,
  reconstructHistory,
  uniqueSymbols,
  type HistoryPoint,
  type HistoryRange,
} from "@/lib/data/history";
import { loadSnapshots, type Snapshot } from "@/lib/persistence/persistence";
import { buildDemoSnapshots } from "@/lib/demoSnapshots";
import { isDemoHouseholdStrict } from "@/lib/demo";
import {
  getCachedQuote,
  getQuote,
  priceAtDetailed,
  type Quote,
} from "@/lib/data/quotes";
import {
  formatPercent,
  formatPercentTight,
  formatUSD,
  formatUSDCompact,
} from "@/lib/format";
import type { Holding, Household } from "@/lib/types";
import { SnapshotsManager } from "@/app/_components/data/SnapshotsManager";

/** Range chips shown above the history chart. */
const HISTORY_RANGES: HistoryRange[] = [
  "1M",
  "3M",
  "6M",
  "1Y",
  "YTD",
  "5Y",
  "ALL",
  "CUSTOM",
];

/** ISO YYYY-MM-DD ↔ ms timestamp helpers for date-picker UI. */
function isoFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function msFromIso(iso: string): number | null {
  // Treat ISO date as UTC noon to dodge timezone-edge bugs in
  // bucket boundaries.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0,
  );
  return Number.isFinite(t) ? t : null;
}

export function HistoryView({
  household,
  netWorth,
  memberId,
  empty,
  scenarioName,
  scenarioAdjustedNetWorth,
}: {
  household: Household;
  netWorth: number;
  /** Active member-filter id, or null for the rolled-up Household view.
   *  Used to filter snapshot households so the past line and the live
   *  headline stay member-consistent. */
  memberId: string | null;
  empty: boolean;
  /** Active scenario name, or null when on the base. Surfaces the
   *  mismatch between the dashboard headline (scenario-adjusted) and
   *  the chart's today-pin (base — matches past snapshots). */
  scenarioName?: string | null;
  scenarioAdjustedNetWorth?: number;
}) {
  const symbols = useMemo(() => uniqueSymbols(household), [household]);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<HistoryRange>("1Y");
  // Custom date-range state — only used when range === "CUSTOM".
  // Defaults to 1y window so the picker opens on a sensible
  // interval the user can adjust. Persisted across chip switches
  // so toggling between Custom and a preset doesn't reset the
  // user's picked dates.
  const [customStart, setCustomStart] = useState<string>(() =>
    isoFromMs(Date.now() - 365 * 24 * 60 * 60 * 1000),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    isoFromMs(Date.now()),
  );
  // Stable snapshot of "today" for the date-input max cap.
  // Using useState with a lazy initializer (rather than a
  // top-level expression) so Date.now() runs once at mount, not
  // on every render (would otherwise drift each render AND trip
  // React's impure-function rule).
  const [todayIso] = useState(() => isoFromMs(Date.now()));
  const [hovered, setHovered] = useState<HistoryPoint | null>(null);
  // Audit fix (round-3 BLOCK #2): subscribe to snapshotsRevision
  // so the NW history view re-fetches on snapshot mutations
  // (Add, Edit, Delete via SnapshotsManager; Save from
  // TimeTravelBanner; auto-snapshotter writes). Without the
  // dep, this view showed stale data until next mount.
  const snapshotsRevision = useAppStore((s) => s.snapshotsRevision);
  // Stable anchor for the synthetic demo snapshots — pin it once
  // per mount so buildDemoSnapshots returns identical timestamps
  // across re-renders (otherwise hover-state, chart-keys, and
  // memoized series would churn on every render).
  const [demoAnchor] = useState(() => Date.now());

  // Use the strict household-identity check (NOT `mode === "demo"`)
  // as the gate for synthesizing demo snapshots. Reason:
  //   - A fresh visitor lands in mode === "demo" → strict-demo, use
  //     the synthesized 10y timeline. ✓
  //   - The visitor edits any persisted slice (assumptions slider,
  //     budget item, goal, etc.) → Frame B auto-promotes mode to
  //     "real" → BUT the household tree is still the verbatim demo
  //     seed → still strict-demo, KEEP showing the synthetic
  //     timeline. ✓
  //   - The visitor renames a member or adds an account →
  //     isDemoHouseholdStrict flips to false → switch to IDB
  //     snapshots (their own real history starts now). ✓
  //
  // Without this gate, the auto-promote left the user in
  // "real-mode-with-demo-household" — the previous `mode === "demo"`
  // branch never fired, and the chart silently reverted to its
  // pre-fix flat-back-projection-plus-cliff appearance.
  const useSyntheticDemo = isDemoHouseholdStrict(household);

  useEffect(() => {
    let cancelled = false;
    if (useSyntheticDemo) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        // Pass the LIVE household (post-PriceRefresher) so snap.shares
        // are derived from actual today-price shares, not the
        // preset.referencePriceUSD-derived shares baked into the
        // DEMO_HOUSEHOLD constant. Without this, snap.shares ×
        // cache_real_price > live_household.valueUSD by 15-25% (the
        // ratio of real_price / preset.referencePriceUSD), producing
        // a plateau-above-live cliff at the chart's right edge.
        setSnapshots(
          buildDemoSnapshots(demoAnchor, undefined, undefined, household),
        );
      });
      return () => {
        cancelled = true;
      };
    }
    void loadSnapshots().then((snaps) => {
      if (!cancelled) setSnapshots(snaps);
    });
    return () => {
      cancelled = true;
    };
    // household is read inside the closure when in demo mode — list
    // it as a dep so a PriceRefresher update (changing
    // household.holdings[].valueUSD/shares) re-runs the build with
    // the latest shares.
  }, [snapshotsRevision, useSyntheticDemo, demoAnchor, household]);

  // setLoading(true) below is the canonical "start an async data
  // load" pattern. The React 19 idiomatic alternative is Suspense
  // + `use()`, which would require lifting the quote fetch out of
  // this component and into a Promise-returning parent — a larger
  // refactor we're not undertaking yet. The setState is gated by a
  // symbol change, so it never cascades on its own commits.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next: Record<string, Quote | null> = {};
      for (const s of symbols) {
        const cached = await getCachedQuote(s);
        if (cached) next[s] = cached;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setQuotes((q) => ({ ...q, ...next }));
      }
      for (const s of symbols) {
        if (next[s] && next[s]!.history.length > 0) continue;
        const live = await getQuote(s);
        if (cancelled) return;
        setQuotes((q) => ({ ...q, [s]: live }));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbols.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // Filter snapshots to the active member view so the historical
  // composition path AND the scalar-overlay path both project the
  // chosen member's slice — without this, switching to Member A
  // historically over-reports because the snapshot's embedded
  // household still contains the full family's accounts.
  const filteredSnapshots = useMemo(
    () => memberFilteredSnapshots(snapshots, memberId),
    [snapshots, memberId],
  );

  const customRangeBounds = useMemo(() => {
    if (range !== "CUSTOM") return undefined;
    const start = msFromIso(customStart);
    const end = msFromIso(customEnd);
    if (start == null || end == null || start >= end) return undefined;
    return { start, end };
  }, [range, customStart, customEnd]);

  // When Custom range is active with INVALID bounds (user mid-
  // typing in the date inputs, or start >= end), suppress the
  // chart series rather than passing degenerate input downstream.
  // Degenerate input (e.g., start === end) collapses the bucket
  // loop into `days = 2` with all buckets at the same `t`, which
  // crashed the SVG path math (zero-width axis → NaN coordinates).
  const customInvalid = range === "CUSTOM" && !customRangeBounds;

  const series = useMemo(() => {
    if (customInvalid) return [] as HistoryPoint[];
    return overlaySnapshots(
      reconstructHistory(
        household,
        quotes,
        range,
        undefined,
        filteredSnapshots,
        customRangeBounds,
      ),
      filteredSnapshots,
      // Pin today's bucket to the live headline NW so the chart
      // can never disagree with the number shown at the top of
      // the card.
      netWorth,
      // Live household for the backdated-holding augmentation:
      // snapshots recorded BEFORE the user added a backdated
      // holding get their anchor NW bumped up to include the
      // holding.
      household,
      // Quotes + now: snap anchor uses the SAME compose math
      // as the pre-snap reconstruction.
      quotes,
      undefined,
    );
  }, [
    customInvalid,
    household,
    quotes,
    range,
    filteredSnapshots,
    netWorth,
    customRangeBounds,
  ]);

  const hasLiveData = symbols.some(
    (s) => quotes[s] && (quotes[s] as Quote).history.length > 0,
  );
  const hasSnapshots = snapshots.length > 1;
  const allFailed = !loading && symbols.length > 0 && !hasLiveData;

  const first = series[0];
  const last = series[series.length - 1];
  const change = last && first ? last.netWorthUSD - first.netWorthUSD : 0;
  const changePct =
    first && first.netWorthUSD !== 0 ? change / first.netWorthUSD : 0;
  const positive = change >= 0;

  if (empty) {
    return (
      <div className="mt-4 text-center text-[11px] text-text-dim">
        Add holdings to see history.
      </div>
    );
  }

  // Round-6 audit HIGH: when a scenario is active AND it materially
  // shifts NW, the chart's today-pin (base) will disagree with the
  // dashboard headline (scenario). Surface that so the user
  // understands the chart shows actual recorded state, not the
  // active scenario.
  const showScenarioMismatchNotice =
    scenarioName != null &&
    typeof scenarioAdjustedNetWorth === "number" &&
    Math.abs(scenarioAdjustedNetWorth - netWorth) >= 1;

  return (
    <>
      {showScenarioMismatchNotice && (
        <div
          className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-2 py-1.5 text-[10px] text-amber-300"
          role="status"
        >
          History chart shows <em>actual</em> recorded state (today-pin{" "}
          {formatUSD(netWorth)}). The headline NW above includes the
          active scenario <em>{scenarioName}</em> projection (
          {formatUSD(scenarioAdjustedNetWorth)}).
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <div className="num text-base font-semibold text-text">
          {formatUSD(hovered ? hovered.netWorthUSD : netWorth)}
        </div>
        {!hovered && first && last && (
          <span
            className={`num text-xs font-medium ${
              positive ? "text-positive" : "text-negative"
            }`}
          >
            {positive ? "+" : ""}
            {formatUSD(change)} · {positive ? "+" : ""}
            {formatPercent(changePct)}
          </span>
        )}
        {hovered && (
          <span className="text-[11px] text-text-muted">
            {formatDate(hovered.t)}
          </span>
        )}
      </div>

      {/*
        Composition-at-point: when the user hovers a past date and a
        rich snapshot covers that window, surface the household
        breakdown for that moment. Helps the user remember "this is
        when I went all-in on stocks" / "this is when I bought the
        house" without having to dig into the snapshot manager.
      */}
      {/* Round-1 (snapshot audit) HIGH: pass `filteredSnapshots`
          (not raw `snapshots`) so the composition pie matches the
          line above when a member chip is active. */}
      {hovered && (
        <CompositionAtPoint
          t={hovered.t}
          snapshots={filteredSnapshots}
          household={household}
          quotes={quotes}
        />
      )}

      <div className="mt-2">
        <HistoryChart
          series={series}
          onHover={setHovered}
          positive={positive}
        />
        {series.length > 1 && (
          <div className="mt-1 flex justify-between text-[10px] text-text-dim">
            <span>{formatDate(series[0].t)}</span>
            <span>{formatDate(series[series.length - 1].t)}</span>
          </div>
        )}
      </div>

      <div className="mt-3 -mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-hide">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
              range === r
                ? "bg-accent/15 text-accent"
                : "border border-border bg-bg-elevated text-text-muted"
            }`}
          >
            {HISTORY_RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      {range === "CUSTOM" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[11px]">
          <label className="flex items-center gap-1.5 text-text-muted">
            <span>From</span>
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-md border border-border bg-bg-surface px-2 py-1 text-[11px] text-text"
              aria-label="Custom range start date"
            />
          </label>
          <label className="flex items-center gap-1.5 text-text-muted">
            <span>To</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={todayIso}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-md border border-border bg-bg-surface px-2 py-1 text-[11px] text-text"
              aria-label="Custom range end date"
            />
          </label>
          {!customRangeBounds && (
            <span className="text-amber-300">
              Pick a valid range (start before end)
            </span>
          )}
        </div>
      )}

      {symbols.length > 0 && !hasLiveData && !hasSnapshots && loading && (
        <div className="mt-3 rounded-md border border-border bg-bg-elevated p-2.5 text-[11px] text-text-dim">
          Loading live prices…
        </div>
      )}
      {allFailed && !hasSnapshots && (
        <div className="mt-3 rounded-md border border-border bg-bg-elevated p-2.5 text-[11px] text-text-dim">
          Estimated history — back-projected from each holding&apos;s expected
          real CAGR. Daily snapshots will fill in real history as you keep
          using the app.
        </div>
      )}
      {hasSnapshots && (
        <div className="mt-3 rounded-md border border-border bg-bg-elevated p-2.5 text-[11px] text-text-dim">
          History uses your own daily net-worth snapshots where recorded;
          pre-snapshot periods are estimated from each holding&apos;s expected
          real CAGR.
        </div>
      )}
      {symbols.length === 0 && (
        <div className="mt-3 text-[11px] text-text-dim">
          All holdings are manual or cash — history is flat at the current
          value.
        </div>
      )}
      <SnapshotsManager />
    </>
  );
}

/**
 * Resolve a holding's value at a historical bucket date.
 *
 * For live-priceable kinds (equity / bond / commodity / crypto):
 *   shares × historical quote price at t. Falls back to current
 *   valueUSD if the quote is missing, clamped (t outside history
 *   window), or the holding is manually priced.
 *
 * For cash / real_estate / private_stock / other:
 *   valueUSD (those kinds don't fluctuate with quote data).
 *
 * User-reported bug: previously the composition pill ALWAYS used
 * `valueUSD` (today's value) — so hovering on 2021 showed the
 * 2026 composition, which "stays forever the same" while the NW
 * chart line moves. The fix routes live-priceable holdings
 * through the quote, so the composition pill matches the chart's
 * historical numbers.
 */
function historicalValue(
  holding: Holding,
  t: number,
  quotes: Record<string, Quote | null>,
): number {
  if (
    holding.kind === "cash" ||
    holding.kind === "real_estate" ||
    holding.kind === "private_stock" ||
    holding.kind === "other"
  ) {
    return holding.valueUSD;
  }
  // Live-priceable kinds.
  if (holding.isManualPrice) return holding.valueUSD;
  const q = quotes[holding.symbol.toUpperCase()];
  if (!q) return holding.valueUSD;
  const r = priceAtDetailed(q, t);
  if (r === null) return holding.valueUSD;
  // CRITICAL: even when `clamped` (t outside the available quote
  // history), USE the clamped price × shares — NOT today's
  // valueUSD. User-reported bug: with the previous "fallback to
  // valueUSD on clamp" semantic, the bucket just before quote
  // history's first point fell back to today's price (e.g.
  // TQQQ today ~$84 × 100 shares = $8,400) while the bucket
  // just after used the 2021 close (~$24 × 100 = $2,400), making
  // the chart drop $6,000 per 100 shares of TQQQ in one bucket.
  // Multiplied across holdings: visible $200K cliff at the
  // quote-history start. Using the clamped price (h[0] or h[N-1])
  // ensures both adjacent buckets agree at the boundary.
  return holding.shares * r.price;
}

function CompositionAtPoint({
  t,
  snapshots,
  household,
  quotes,
}: {
  t: number;
  snapshots: Snapshot[];
  /**
   * The LIVE household. Used to merge in backdated holdings whose
   * `acquiredAt` predates the latest at-or-before snapshot but that
   * are missing from EVERY past snapshot (newly added today).
   * Without this merge, NW total includes the holding (history.ts
   * does this via newlyAddedFlatUSD) but the composition pill
   * excludes it — the chart numbers wouldn't reconcile.
   */
  household: Household;
  /** Quote data — see historicalValue for how it's used. */
  quotes: Record<string, Quote | null>;
}) {
  // Find the rich snapshot at-or-before t (if any).
  const rich = snapshots
    .filter((s): s is Snapshot & { household: Household } => !!s.household)
    .sort((a, b) => a.t - b.t);
  let snap: (Snapshot & { household: Household }) | null = null;
  for (let i = rich.length - 1; i >= 0; i--) {
    if (rich[i].t <= t) {
      snap = rich[i];
      break;
    }
  }

  const totalsByKind: Record<string, number> = {
    equity: 0,
    bond: 0,
    cash: 0,
    crypto: 0,
    commodity: 0,
    real_estate: 0,
    private_stock: 0,
    other: 0,
  };
  let snapshotNetWorth = 0;
  // Track the IDs included from the base composition so the
  // backdated-merge loop below can avoid double-counting.
  const baseIds = new Set<string>();

  // Base composition = the snap's household (if a snap covers t)
  // or the LIVE household (pre-first-snap region). Without the
  // live fallback, hovering on any bucket BEFORE the first snap
  // produced an empty pill — the user saw nothing for pre-Dec 30
  // dates even though their backdated holdings claim to have
  // existed then.
  const baseHousehold = snap?.household ?? household;
  for (const account of baseHousehold.accounts) {
    for (const holding of account.holdings) {
      // For pre-snap buckets (baseHousehold = live), filter by
      // acquiredAt: don't include holdings the user hadn't
      // acquired yet at this point in time. For snap-composition
      // buckets, the snap is authoritative — every holding in it
      // is valid at the snap's t by definition.
      if (!snap) {
        const acquiredAt =
          "acquiredAt" in holding
            ? (holding.acquiredAt as number | null | undefined)
            : null;
        // Holdings without acquiredAt (cash / "other" / etc.)
        // are treated as always-held; user has no way to set an
        // acquisition date on those.
        if (acquiredAt != null && acquiredAt > t) continue;
      }
      const hv = historicalValue(holding, t, quotes);
      totalsByKind[holding.kind] = (totalsByKind[holding.kind] ?? 0) + hv;
      snapshotNetWorth += hv;
      baseIds.add(holding.id);
    }
  }

  // Merge backdated holdings from the LIVE household that are
  // missing from the base composition (e.g. snap was recorded
  // BEFORE the user added a holding with acquiredAt predating
  // the snap). Avoids the asymmetry where NW total via
  // newlyAddedFlatUSD includes the holding but the pill excludes
  // it.
  for (const acct of household.accounts) {
    for (const h of acct.holdings ?? []) {
      if (baseIds.has(h.id)) continue;
      const acquiredAt =
        "acquiredAt" in h ? (h.acquiredAt as number | null | undefined) : null;
      // The holding must claim to have existed at-or-before the
      // bucket's t. A holding added today with acquiredAt=null
      // (no historical claim) only appears at today's bucket
      // (the live-NW pin) and shouldn't pollute past compositions.
      if (acquiredAt == null || acquiredAt > t) continue;
      if (!Number.isFinite(h.valueUSD) || h.valueUSD <= 0) continue;
      const hv = historicalValue(h, t, quotes);
      totalsByKind[h.kind] = (totalsByKind[h.kind] ?? 0) + hv;
      snapshotNetWorth += hv;
    }
  }
  if (snapshotNetWorth <= 0) return null;

  const segments: Array<{ label: string; color: string; share: number }> = [
    { label: "Stocks", color: "#38bdf8", share: totalsByKind.equity / snapshotNetWorth },
    { label: "Bonds", color: "#a78bfa", share: totalsByKind.bond / snapshotNetWorth },
    { label: "Cash", color: "#64748b", share: totalsByKind.cash / snapshotNetWorth },
    { label: "Crypto", color: "#f59e0b", share: totalsByKind.crypto / snapshotNetWorth },
    { label: "Commodity", color: "#fbbf24", share: totalsByKind.commodity / snapshotNetWorth },
    { label: "Real estate", color: "#10b981", share: totalsByKind.real_estate / snapshotNetWorth },
    { label: "Private", color: "#ec4899", share: totalsByKind.private_stock / snapshotNetWorth },
    { label: "Other", color: "#94a3b8", share: totalsByKind.other / snapshotNetWorth },
  ].filter((s) => s.share > 0.005);

  return (
    <div className="mt-1.5 rounded-md border border-border bg-bg-elevated px-2.5 py-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-bg-surface">
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${s.share * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-text-dim">
        <span>
          Composition as of {new Date(t).toLocaleDateString()}
          {snap ? null : " (live)"}
        </span>
        {segments.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="text-text-muted">{s.label}</span>
            <span className="num text-text">{formatPercentTight(s.share)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryChart({
  series,
  onHover,
  positive,
}: {
  series: HistoryPoint[];
  onHover: (p: HistoryPoint | null) => void;
  positive: boolean;
}) {
  if (series.length < 2) return null;
  const width = 360;
  const height = 160;
  const padLeft = 36;
  const padTop = 8;
  const padBottom = 16;
  const innerWidth = width - padLeft - 8;
  const innerHeight = height - padTop - padBottom;

  const values = series.map((p) => p.netWorthUSD);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const ySpan = maxY - minY || 1;
  const minX = series[0].t;
  const maxX = series[series.length - 1].t;

  const xScale = (t: number) =>
    padLeft + ((t - minX) / (maxX - minX || 1)) * innerWidth;
  const yScale = (v: number) =>
    padTop + (1 - (v - minY) / ySpan) * innerHeight;

  const linePath =
    `M ${xScale(series[0].t)},${yScale(series[0].netWorthUSD)} ` +
    series
      .slice(1)
      .map((p) => `L ${xScale(p.t)},${yScale(p.netWorthUSD)}`)
      .join(" ");
  const areaPath =
    linePath +
    ` L ${xScale(maxX)},${yScale(minY)} L ${xScale(minX)},${yScale(minY)} Z`;

  const yTicks = niceTicks(minY, maxY, 3);
  const stroke = positive ? "#38bdf8" : "#f87171";

  const pointAtClientX = (clientX: number, target: SVGElement) => {
    const svg = target.closest("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const t = minX + ((x - padLeft) / innerWidth) * (maxX - minX);
    return closest(series, t);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[160px] w-full"
      role="img"
      aria-label="Net worth history"
      onMouseLeave={() => onHover(null)}
      onMouseMove={(e) => {
        const p = pointAtClientX(e.clientX, e.target as SVGElement);
        if (p) onHover(p);
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 0) return;
        const p = pointAtClientX(e.touches[0].clientX, e.target as SVGElement);
        if (p) onHover(p);
      }}
      onTouchEnd={() => onHover(null)}
    >
      <defs>
        <linearGradient id="hist-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={width - 8}
            y1={yScale(tick)}
            y2={yScale(tick)}
            stroke="#1f2730"
            strokeDasharray="2 4"
            strokeWidth={1}
          />
          <text
            x={padLeft - 4}
            y={yScale(tick) + 3}
            textAnchor="end"
            fontSize={9}
            fill="#5b6573"
          >
            {formatUSDCompact(tick)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="url(#hist-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/*
        Milestone pins. We detect every time the series CROSSES a
        round-number threshold ($50K, $100K, $250K, $500K, $1M, …)
        and drop a small marker at the crossing. Gives the user a
        sense of "when did I hit each major level" without any
        manual annotation work.
      */}
      {detectMilestones(series).map((m, i) => (
        <g key={i}>
          <circle
            cx={xScale(m.t)}
            cy={yScale(m.netWorthUSD)}
            r={3}
            fill={stroke}
            stroke="#0a0d12"
            strokeWidth={1.5}
          />
          <text
            x={xScale(m.t)}
            y={yScale(m.netWorthUSD) - 6}
            textAnchor="middle"
            fontSize={8}
            fill={stroke}
            fontWeight={600}
          >
            {formatUSDCompact(m.threshold)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Find every point where the series crosses a "round" net-worth
 * threshold for the first time within the window. Thresholds are
 * a 1/2.5/5 sweep across each decade ($10K, $25K, $50K, $100K,
 * $250K, $500K, $1M, $2.5M, $5M, $10M, …).
 *
 * Returns at most 5 markers so the chart doesn't litter with
 * pins when net worth bounces around the same number.
 */
function detectMilestones(series: HistoryPoint[]): Array<{
  t: number;
  netWorthUSD: number;
  threshold: number;
}> {
  const thresholds: number[] = [];
  for (const base of [1e4, 1e5, 1e6, 1e7]) {
    thresholds.push(base, base * 2.5, base * 5);
  }
  thresholds.sort((a, b) => a - b);
  const crossed = new Set<number>();
  const milestones: Array<{
    t: number;
    netWorthUSD: number;
    threshold: number;
  }> = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].netWorthUSD;
    const curr = series[i].netWorthUSD;
    const lo = Math.min(prev, curr);
    const hi = Math.max(prev, curr);
    for (const threshold of thresholds) {
      if (crossed.has(threshold)) continue;
      if (threshold > lo && threshold <= hi) {
        crossed.add(threshold);
        milestones.push({ t: series[i].t, netWorthUSD: curr, threshold });
      }
    }
  }
  return milestones.slice(0, 5);
}

/** Nearest point in `series` to time `t` by absolute time delta. */
function closest(series: HistoryPoint[], t: number): HistoryPoint {
  let best = series[0];
  let bestDist = Math.abs(best.t - t);
  for (const p of series) {
    const d = Math.abs(p.t - t);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** N nicely-rounded tick values between min and max. */
function niceTicks(min: number, max: number, n: number): number[] {
  const span = max - min;
  if (span <= 0) return [];
  const step = niceStep(span / n);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max; v += step) ticks.push(v);
  return ticks;
}

/** Round step up to a 1/2/5 × 10^n value for visually-pleasing ticks. */
function niceStep(rough: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const normalized = rough / magnitude;
  if (normalized < 1.5) return 1 * magnitude;
  if (normalized < 3) return 2 * magnitude;
  if (normalized < 7) return 5 * magnitude;
  return 10 * magnitude;
}

function formatDate(t: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(t));
}
