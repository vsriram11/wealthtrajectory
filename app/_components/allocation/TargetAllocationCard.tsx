"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  TARGET_PRESETS,
  computeDrift,
  type TargetAllocation,
} from "@/lib/portfolio/targetAllocation";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import type { AssetClass } from "@/lib/types";
import { pluralLabel } from "@/lib/portfolio/holdingKinds";
import { formatPercentTight, formatUSD } from "@/lib/format";

/**
 * Target-allocation drift card. Lets the user pin a target mix and
 * see where they've drifted from it.
 *
 * UX model:
 *   - No target set: surface "Choose a target" with 5 preset chips
 *     (All Equity / 80-20 / 60-40 / Permanent / All Weather).
 *   - Target set: show drift table — current vs target % per class,
 *     dollars to move to rebalance to target.
 *   - "Total imbalance" headline = the minimum dollar amount that
 *     needs to move (half the sum of absolute drifts).
 *
 * Read-only display; the app doesn't trade. The number tells the
 * user how much rebalancing they have to do; they execute in their
 * brokerage.
 */
export function TargetAllocationCard() {
  const target = useAppStore((s) => s.targetAllocation);
  const setTarget = useAppStore((s) => s.setTargetAllocation);
  const { household } = useActiveProjection();
  const [picking, setPicking] = useState(false);
  // Collapsed by default — the card is most useful for users who
  // care about rebalancing, but takes up significant space for
  // everyone else. Tap the header chevron to expand.
  const [expanded, setExpanded] = useState(false);

  const analysis = useMemo(() => {
    if (!target) return null;
    return computeDrift(household, target);
  }, [household, target]);

  if (household.accounts.length === 0) return null;

  // Collapsed header — only thing visible by default. Deliberately
  // doesn't reveal the actual target percentages or the current
  // imbalance dollar amount; users need to tap to expand. Keeps the
  // Allocation page lean for users who haven't set a target.
  const subtitle = target
    ? "Tap to view drift"
    : "Choose a target to track drift";

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:opacity-70"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Target allocation
            </div>
            <div className="mt-0.5 truncate text-[12px] text-text">
              {subtitle}
            </div>
          </div>
          <Chevron expanded={expanded} />
        </button>

        {expanded && (
          <div className="border-t border-border px-4 pb-4 pt-3">
            {!target || picking ? (
              <PresetPicker
                showCancel={picking}
                onPick={(t) => {
                  setTarget(t);
                  setPicking(false);
                }}
                onCancel={() => setPicking(false)}
                pickingLabel={picking ? "Pick a target mix" : null}
              />
            ) : analysis ? (
              <DriftView
                analysis={analysis}
                onChange={() => setPicking(true)}
                onClear={() => setTarget(null)}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 text-text-muted transition-transform ${
        expanded ? "rotate-180" : ""
      }`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PresetPicker({
  showCancel,
  onPick,
  onCancel,
  pickingLabel,
}: {
  showCancel: boolean;
  onPick: (t: TargetAllocation) => void;
  onCancel: () => void;
  pickingLabel: string | null;
}) {
  return (
    <div className="space-y-2">
      {pickingLabel && (
        <div className="px-0.5 text-[11px] text-text-muted">{pickingLabel}</div>
      )}
      {TARGET_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.target)}
          className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-left active:opacity-70 hover:border-accent/40"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">{p.label}</div>
              <div className="mt-0.5 text-[11px] text-text-dim">
                {p.description}
              </div>
            </div>
            <div className="shrink-0 text-[10px] text-text-muted">
              {targetSummary(p.target)}
            </div>
          </div>
        </button>
      ))}
      {showCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-[11px] text-text-muted active:opacity-70"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function DriftView({
  analysis,
  onChange,
  onClear,
}: {
  analysis: ReturnType<typeof computeDrift>;
  onChange: () => void;
  onClear: () => void;
}) {
  const rows = analysis.drifts.filter(
    (d) => d.currentShare > 0.001 || d.targetShare > 0.001,
  );
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <div className="num text-2xl font-semibold text-text">
          {formatUSD(analysis.totalImbalanceUSD)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onChange}
            className="text-[11px] font-medium text-text-muted active:opacity-70 hover:text-text"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-text-dim active:opacity-70 hover:text-text-muted"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="mt-0.5 text-[11px] text-text-muted">
        to move between asset classes to hit your target. Read-only —
        execute the trades in your brokerage.
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((d) => (
          <DriftRow key={d.klass} drift={d} />
        ))}
      </ul>
    </>
  );
}

function DriftRow({
  drift,
}: {
  drift: {
    klass: AssetClass;
    currentShare: number;
    targetShare: number;
    driftUSD: number;
    driftPct: number;
  };
}) {
  const over = drift.driftPct > 0.005;
  const under = drift.driftPct < -0.005;
  return (
    <li className="rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text">{pluralLabel(drift.klass)}</span>
        <span className="num shrink-0 text-text-muted">
          {formatPercentTight(drift.currentShare)}% →{" "}
          {formatPercentTight(drift.targetShare)}%
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
        <DriftBar driftPct={drift.driftPct} />
        <span
          className={`num shrink-0 font-medium ${
            over ? "text-amber-300" : under ? "text-accent" : "text-text-dim"
          }`}
        >
          {over
            ? `Sell ${formatUSD(Math.abs(drift.driftUSD))}`
            : under
              ? `Buy ${formatUSD(Math.abs(drift.driftUSD))}`
              : "On target"}
        </span>
      </div>
    </li>
  );
}

function DriftBar({ driftPct }: { driftPct: number }) {
  // Centered horizontal bar showing drift direction. Cap at ±20%
  // for visual scale; anything bigger pegs.
  const cap = 0.2;
  const clamped = Math.max(-cap, Math.min(cap, driftPct));
  const widthPct = (Math.abs(clamped) / cap) * 50; // 0-50 (half the bar)
  return (
    <div className="relative h-1.5 flex-1 rounded-full bg-bg-surface">
      <div className="absolute left-1/2 top-0 h-full w-px bg-border-strong" />
      {driftPct > 0 ? (
        <div
          className="absolute left-1/2 top-0 h-full rounded-full bg-amber-300/60"
          style={{ width: `${widthPct}%` }}
        />
      ) : driftPct < 0 ? (
        <div
          className="absolute top-0 h-full rounded-full bg-accent/60"
          style={{ width: `${widthPct}%`, right: "50%" }}
        />
      ) : null}
    </div>
  );
}

function targetSummary(target: TargetAllocation): string {
  const parts: string[] = [];
  for (const [klass, weight] of Object.entries(target)) {
    if (!weight || weight <= 0) continue;
    parts.push(`${Math.round(weight * 100)}% ${shortLabel(klass as AssetClass)}`);
  }
  return parts.join(" · ");
}

function shortLabel(k: AssetClass): string {
  switch (k) {
    case "equity":
      return "stk";
    case "bond":
      return "bnd";
    case "cash":
      return "csh";
    case "crypto":
      return "crp";
    case "commodity":
      return "gld";
    case "real_estate":
      return "re";
    case "private_stock":
      return "pvt";
    case "other":
      return "oth";
  }
}
