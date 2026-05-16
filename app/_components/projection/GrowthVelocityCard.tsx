"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSnapshots, type Snapshot } from "@/lib/persistence/persistence";
import {
  GROWTH_WINDOW_LABELS,
  growthVelocity,
} from "@/lib/projection/growthVelocity";
import { useAppStore } from "@/lib/store";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { memberFilteredSnapshots } from "@/lib/data/history";
import { householdNetWorth } from "@/lib/types";
import { formatPercent, formatUSDCompact } from "@/lib/format";

/**
 * Trailing growth-velocity card. Shows the user how their net worth
 * has *actually* moved over 30 / 90 / 365 days and lifetime — and
 * what annualized rate that maps to.
 *
 * DEFAULTS TO REAL (inflation-adjusted) view. Snapshots are stored
 * in nominal dollars (the pricing snapshot at the time), but the
 * rest of the app — projection engine, SWR, target NW — runs in
 * real-CAGR / today's-dollars terms. Surfacing the trailing rate
 * as nominal forces the user to mentally subtract inflation before
 * comparing to their assumed CAGR; defaulting to real removes
 * that paper-cut.
 *
 * Real annualization formula:
 *   real = (1 + nominal) / (1 + inflation) − 1
 * Where `inflation` is `assumptions.expectedInflationRate` (the
 * single source of truth — same number the rest of the app uses
 * for any nominal/real conversion). When inflation is 0, real and
 * nominal are mathematically identical; the card surfaces this
 * explicitly so users don't think the toggle is broken.
 *
 * Toggle exposed for users who want the nominal headline anyway
 * (e.g. comparing to a brokerage's reported nominal returns).
 *
 * "Now" snapshot is synthesized from the LIVE household NW so the
 * trailing deltas always reflect the user's current state, not the
 * latest *saved* snapshot. Without this, the card silently lags
 * after the user edits a holding — they'd add $10k to a position
 * and the velocity card would keep showing the old delta until a
 * snapshot was manually saved. Snapshots in this app are explicit
 * user actions (no auto-capture); the synthetic-now pattern makes
 * the card honest about right-now state.
 *
 * Renders nothing when there's not enough history to derive any
 * window.
 */
export function GrowthVelocityCard() {
  const memberId = useAppStore((s) => s.selectedMemberId);
  const { assumptions, household } = useActiveProjection();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  // Default REAL — aligns with the rest of the app's real-terms model.
  const [view, setView] = useState<"real" | "nominal">("real");

  useEffect(() => {
    void loadSnapshots().then((s) => setSnapshots(s));
  }, []);

  const filtered = useMemo(
    () => memberFilteredSnapshots(snapshots, memberId),
    [snapshots, memberId],
  );

  // Live NW from the active (member-scoped, scenario-applied)
  // household. This is the same source the headline NW displays
  // elsewhere read from, so the velocity-card "end" always matches
  // the rest of the app rather than drifting to a stale snapshot.
  const liveNW = useMemo(
    () => householdNetWorth(household),
    [household],
  );

  // Inject the live state as a synthetic "now" snapshot so
  // growthVelocity's last-snapshot-wins logic uses the user's
  // actual current NW. We carry through the household so member-
  // filtering downstream stays consistent (memberFilteredSnapshots
  // skips legacy NW-only snapshots in a per-member view).
  // `nowAtMount` is captured once: the card's velocity reading is
  // a snapshot at first render, not a continuous live clock.
  const [nowAtMount] = useState<number>(() => Date.now());
  const snapshotsWithLive = useMemo<Snapshot[]>(() => {
    const live: Snapshot = {
      t: nowAtMount,
      netWorthUSD: liveNW,
      household,
    };
    // If a saved snapshot happens to be timestamped in the future
    // (shouldn't happen in practice but defensive), nudge the
    // synthetic-now strictly later so it wins the latest-snapshot
    // tie-break inside growthVelocity.
    const latestT = filtered.length
      ? Math.max(...filtered.map((s) => s.t))
      : 0;
    if (live.t <= latestT) live.t = latestT + 1;
    return [...filtered, live];
  }, [filtered, liveNW, household, nowAtMount]);

  const velocity = useMemo(
    () => growthVelocity(snapshotsWithLive),
    [snapshotsWithLive],
  );

  // Inflation rate to use for the real conversion. Falls back to a
  // 3% baseline if the user hasn't configured one (matches the rest
  // of the app's CPI-default convention). Note: we treat exactly 0
  // as "user-set" and respect it, but surface the consequence in
  // the UI so users don't think real==nominal is a bug.
  const inflation = Number.isFinite(assumptions.expectedInflationRate)
    ? assumptions.expectedInflationRate
    : 0.03;
  const inflationIsZero = Math.abs(inflation) < 1e-6;

  if (!velocity) return null;

  const adjustReturn = (nominal: number | null): number | null => {
    if (nominal == null) return null;
    if (view === "nominal") return nominal;
    // (1 + nominal) / (1 + inflation) − 1; well-behaved across
    // negative nominals (retirement-era drawdowns) too.
    return (1 + nominal) / (1 + inflation) - 1;
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">
              Trailing growth velocity
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              How fast your net worth has actually moved.{" "}
              {view === "real"
                ? "Inflation-adjusted (real %, today's purchasing power) — directly comparable to your assumed real CAGR."
                : "Nominal % — sticker-price returns including inflation."}
            </div>
          </div>
          {/* Real / Nominal toggle. Default real, but nominal stays
              one tap away for users comparing to brokerage-reported
              numbers (which are always nominal). */}
          <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-border bg-bg-elevated p-0.5">
            <ViewChip
              label="Real"
              active={view === "real"}
              onClick={() => setView("real")}
            />
            <ViewChip
              label="Nominal"
              active={view === "nominal"}
              onClick={() => setView("nominal")}
            />
          </div>
        </div>

        {/* When inflation is 0, the toggle is mathematically a
            no-op. Surface this explicitly so users don't read
            identical real & nominal values and think the toggle
            is broken. */}
        {view === "real" && inflationIsZero && (
          <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
            Your inflation assumption is{" "}
            <span className="num">0%</span>, so real ≡ nominal. Set
            a non-zero rate in <span className="font-medium">Plan
            → Assumptions → Expected inflation</span> to see the
            real/nominal difference.
          </div>
        )}

        <ul className="mt-3 space-y-1.5">
          {velocity.windows.map((w) => {
            const isPos = w.deltaUSD >= 0;
            const annualized = adjustReturn(w.annualizedReturn);
            const isReturnPos = annualized != null && annualized >= 0;
            return (
              <li
                key={w.window}
                className="flex items-center justify-between rounded-md border border-border-strong bg-bg-elevated px-3 py-2"
              >
                <div className="flex-1">
                  <div className="text-[12px] text-text-muted">
                    {GROWTH_WINDOW_LABELS[w.window]}
                  </div>
                  <div className="num text-[10px] text-text-dim">
                    {formatUSDCompact(w.startUSD)} →{" "}
                    {formatUSDCompact(w.endUSD)}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`num text-sm font-semibold ${isPos ? "text-positive" : "text-negative"}`}
                  >
                    {isPos ? "+" : ""}
                    {formatUSDCompact(w.deltaUSD)}
                  </div>
                  {annualized != null && (
                    <div
                      className={`num text-[10px] ${isReturnPos ? "text-positive/80" : "text-negative/80"}`}
                    >
                      {isReturnPos ? "+" : ""}
                      {formatPercent(annualized)} {view === "real" ? "real" : "nom"}.
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 text-[10px] leading-snug text-text-dim">
          {view === "real" ? (
            <>
              Real % computed as{" "}
              <span className="num">(1 + nominal) ÷ (1 + inflation) − 1</span>{" "}
              using your assumed inflation of{" "}
              <span className="num">{(inflation * 100).toFixed(2)}%</span>.
              Dollar deltas are nominal — they&apos;re the actual
              snapshot pair — while the real % is the
              apples-to-apples comparison to your assumed real CAGR.
              The &ldquo;now&rdquo; endpoint is your live net worth,
              so deltas always reflect right-now state (not the
              latest saved snapshot).
            </>
          ) : (
            <>
              Nominal % includes inflation. Switch to Real to compare
              directly against the rest of the app&apos;s real-CAGR
              assumptions (current setting:{" "}
              <span className="num">{(inflation * 100).toFixed(2)}%</span>{" "}
              inflation).
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ViewChip({
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
      className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition active:opacity-70 ${
        active
          ? "bg-accent text-bg"
          : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
