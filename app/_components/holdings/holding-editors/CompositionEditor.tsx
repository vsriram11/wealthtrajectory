"use client";

/**
 * Multi-asset composition editor for "wrapper" holdings — single
 * tickers that decompose into several asset-class exposures with
 * intrinsic leverage (sum of leg weights can exceed 100%).
 *
 * Examples the editor was designed for:
 *   - NTSX  ≈ 90% stocks / 60% bonds  (Σ = 150%, leverage 1.5×)
 *   - GDE   ≈ 90% stocks / 60% gold   (Σ = 150%)
 *   - RSST  ≈ 100% stocks / 100% alts (Σ = 200%, leverage 2.0×)
 *
 * Each leg carries its own expected real CAGR; the holding's
 * top-line `expectedRealCAGR` is the exposure-weighted blend of the
 * legs (computed in `lib/portfolio.ts`). Leg weights are fractions
 * in [0, ∞), where the user types percents and the input divides
 * by 100 on the way in.
 */

import { useAppStore } from "@/lib/store";
import { formatLeverage } from "@/lib/format";
import type {
  BondHolding,
  CommodityHolding,
  CompositionLeg,
  CompositionLegKind,
  CryptoHolding,
  EquityHolding,
} from "@/lib/types";
import { NumberField } from "@/app/_components/ui/NumberField";

type Wrapper = EquityHolding | BondHolding | CryptoHolding | CommodityHolding;

const LEG_KIND_OPTIONS: ReadonlyArray<{
  value: CompositionLegKind;
  label: string;
  defaultCAGR: number;
  hint: string;
}> = [
  { value: "equity", label: "Stocks", defaultCAGR: 0.07, hint: "Equity exposure (S&P, intl, etc.)" },
  { value: "bond", label: "Bonds", defaultCAGR: 0.015, hint: "Treasury or corporate fixed income" },
  { value: "cash", label: "Cash", defaultCAGR: 0, hint: "T-bills, money market" },
  { value: "crypto", label: "Crypto", defaultCAGR: 0.05, hint: "BTC, ETH, spot crypto ETFs" },
  { value: "commodity", label: "Gold / Commodity", defaultCAGR: 0.01, hint: "Gold, oil, broad commodities" },
  { value: "other", label: "Other", defaultCAGR: 0.03, hint: "Managed futures, alts, anything else" },
];

const COMMON_PRESETS: ReadonlyArray<{
  label: string;
  composition: CompositionLeg[];
}> = [
  {
    label: "90/60 stocks/bonds (NTSX)",
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  },
  {
    label: "90/60 stocks/gold (GDE)",
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "commodity", weight: 0.6, expectedRealCAGR: 0.01 },
    ],
  },
  {
    label: "100/100 stocks/alts (RSST)",
    composition: [
      { kind: "equity", weight: 1, expectedRealCAGR: 0.07 },
      { kind: "other", weight: 1, expectedRealCAGR: 0.03 },
    ],
  },
];

/** Seed legs for a freshly-enabled composition, keyed on wrapper class. */
function seedFor(kind: Wrapper["kind"]): CompositionLeg[] {
  switch (kind) {
    case "equity":
      return [
        { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
        { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
      ];
    case "bond":
      return [{ kind: "bond", weight: 1, expectedRealCAGR: 0.015 }];
    case "crypto":
      return [{ kind: "crypto", weight: 1, expectedRealCAGR: 0.05 }];
    case "commodity":
      return [{ kind: "commodity", weight: 1, expectedRealCAGR: 0.01 }];
  }
}

/** Sanity warning copy keyed on leg-weight sum. */
function weightWarning(sum: number): string | null {
  if (sum < 0.05) {
    return "Sum of weights is near zero — this holding will have almost no market exposure.";
  }
  if (sum > 5) {
    return "Sum of weights exceeds 500% — double-check this isn't a typo.";
  }
  return null;
}

export function CompositionEditor({ holding }: { holding: Wrapper }) {
  const setComposition = useAppStore((s) => s.setHoldingComposition);
  const legs = holding.composition ?? [];
  const enabled = legs.length > 0;
  const weightSum = legs.reduce((s, l) => s + l.weight, 0);

  const enable = () => {
    if (enabled) return;
    setComposition(holding.id, seedFor(holding.kind));
  };

  const disable = () => setComposition(holding.id, null);

  const updateLeg = (idx: number, patch: Partial<CompositionLeg>) => {
    const next = legs.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    setComposition(holding.id, next);
  };

  const addLeg = () => {
    setComposition(holding.id, [
      ...legs,
      { kind: "other", weight: 0.25, expectedRealCAGR: 0.03 },
    ]);
  };

  const removeLeg = (idx: number) => {
    const next = legs.filter((_, i) => i !== idx);
    setComposition(holding.id, next.length ? next : null);
  };

  if (!enabled) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-4">
        <div className="text-sm text-text">
          This holding is a single-class equity.
        </div>
        <div className="mt-1 text-[11px] text-text-dim">
          Enable composition to model funds like NTSX, GDE, RSST — a single
          ticker that decomposes into multiple asset-class exposures with
          intrinsic leverage (sum of weights &gt; 100%).
        </div>
        <button
          type="button"
          onClick={enable}
          className="mt-3 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent active:opacity-70"
        >
          Enable multi-asset composition
        </button>
      </div>
    );
  }

  const warn = weightWarning(weightSum);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
      <div className="space-y-2">
        {legs.map((leg, i) => (
          <CompositionLegRow
            key={i}
            leg={leg}
            onChange={(patch) => updateLeg(i, patch)}
            onRemove={legs.length > 1 ? () => removeLeg(i) : undefined}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={addLeg}
          className="rounded-md border border-border-strong bg-bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted active:opacity-70"
        >
          + Add leg
        </button>
        <div className="text-[11px] text-text-muted">
          Σ ={" "}
          <span
            className={`num font-medium ${warn ? "text-amber-300" : "text-text"}`}
          >
            {(weightSum * 100).toFixed(1)}%
          </span>{" "}
          · leverage {formatLeverage(weightSum)}
        </div>
      </div>

      {warn && <div className="mt-2 text-[11px] text-amber-300">{warn}</div>}

      <div className="mt-3 border-t border-border pt-3">
        <div className="text-[10px] uppercase tracking-wider text-text-dim">
          Quick presets
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {COMMON_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setComposition(holding.id, p.composition)}
              className="rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-[11px] text-text-muted active:opacity-70 hover:text-text"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={disable}
        className="mt-3 w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-[11px] text-text-muted active:opacity-70"
      >
        Disable composition (treat as plain equity)
      </button>
    </div>
  );
}

function CompositionLegRow({
  leg,
  onChange,
  onRemove,
}: {
  leg: CompositionLeg;
  onChange: (patch: Partial<CompositionLeg>) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={leg.kind}
          onChange={(e) => {
            const nextKind = e.target.value as CompositionLegKind;
            const newDef = LEG_KIND_OPTIONS.find((o) => o.value === nextKind);
            const oldDef = LEG_KIND_OPTIONS.find((o) => o.value === leg.kind);
            // When the user changes leg class, also reset CAGR to the
            // new class's default IF the previous CAGR was just the old
            // class's default. This keeps the auto-blend correct without
            // clobbering user-customized values.
            const cagrIsDefault =
              oldDef != null &&
              Math.abs(
                (leg.expectedRealCAGR ?? oldDef.defaultCAGR) -
                  oldDef.defaultCAGR,
              ) < 1e-9;
            onChange({
              kind: nextKind,
              expectedRealCAGR: cagrIsDefault
                ? newDef?.defaultCAGR
                : leg.expectedRealCAGR,
            });
          }}
          className="min-w-[110px] rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-sm text-text outline-none focus:border-accent"
        >
          {LEG_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
          <NumberField
            value={+(leg.weight * 100).toFixed(2)}
            onChange={(v) => onChange({ weight: Math.max(0, v / 100) })}
            precision={1}
            className="num w-14 bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          <span className="text-sm text-text-muted">%</span>
        </label>

        <label className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
          <span className="text-[10px] uppercase tracking-wider text-text-dim">
            CAGR
          </span>
          <NumberField
            value={+((leg.expectedRealCAGR ?? 0) * 100).toFixed(2)}
            onChange={(v) => onChange({ expectedRealCAGR: v / 100 })}
            precision={2}
            className="num w-12 bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          <span className="text-sm text-text-muted">%</span>
        </label>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text-dim active:opacity-70 hover:text-negative"
            aria-label="Remove leg"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
