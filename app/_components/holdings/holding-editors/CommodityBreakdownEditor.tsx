"use client";

/**
 * Commodity holding breakdown editor.
 *
 * Commodities have a two-tier classification that broad ETFs (DBC,
 * PDBC) and mixed physical positions need to express:
 *
 *   1. Top split: Metals share vs Energy/Agriculture share.
 *   2. Per-tier per-contract weights:
 *        - Metals       — gold, silver, copper, …
 *        - Energy/Ag    — crude, natural gas, wheat, corn, …
 *
 * Each tier sums to 100% independently; the tier's overall
 * contribution to the holding is scaled by the top split. The
 * breakdown is purely metadata for display in the allocation
 * panel — it doesn't affect class-level totals or leverage (a
 * commodity holding always rolls up under "Commodities").
 */

import { useAppStore } from "@/lib/store";
import {
  EMPTY_ENERGY_AG,
  EMPTY_METAL,
  ENERGY_AG_LABELS,
  ENERGY_AG_TYPES,
  METAL_LABELS,
  METAL_TYPES,
  type CommodityBreakdown,
  type CommodityHolding,
  type EnergyAgType,
  type MetalType,
} from "@/lib/types";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Default seed for a newly-enabled breakdown: 100% metals, 100%
 * gold. Matches the "physical gold jewelry" mental model that's
 * the single most common case for manual entry.
 */
function defaultBreakdown(): CommodityBreakdown {
  return {
    metalsShare: 1,
    metals: { ...EMPTY_METAL, GOLD: 1 },
    energyAg: { ...EMPTY_ENERGY_AG },
  };
}

export function CommodityBreakdownEditor({
  holding,
}: {
  holding: CommodityHolding;
}) {
  const setBreakdown = useAppStore((s) => s.setHoldingCommodityBreakdown);
  const breakdown = holding.breakdown;

  if (!breakdown) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated p-4">
        <div className="text-sm text-text">No breakdown set.</div>
        <div className="mt-1 text-[11px] text-text-dim">
          Add a per-contract sub-classification — useful for broad
          commodity funds (DBC, PDBC) or mixed physical positions where
          you hold a basket of metals.
        </div>
        <button
          type="button"
          onClick={() => setBreakdown(holding.id, defaultBreakdown())}
          className="mt-3 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent active:opacity-70"
        >
          Add commodity breakdown
        </button>
      </div>
    );
  }

  const metalsSum = METAL_TYPES.reduce(
    (acc, k) => acc + (breakdown.metals[k] ?? 0),
    0,
  );
  const energyAgSum = ENERGY_AG_TYPES.reduce(
    (acc, k) => acc + (breakdown.energyAg[k] ?? 0),
    0,
  );

  const setMetalsShare = (pct: number) => {
    const v = Math.max(0, Math.min(1, pct / 100));
    setBreakdown(holding.id, { ...breakdown, metalsShare: v });
  };

  const setMetalWeight = (cell: MetalType, pct: number) => {
    const v = Math.max(0, pct / 100);
    setBreakdown(holding.id, {
      ...breakdown,
      metals: { ...breakdown.metals, [cell]: v },
    });
  };

  const setEnergyAgWeight = (cell: EnergyAgType, pct: number) => {
    const v = Math.max(0, pct / 100);
    setBreakdown(holding.id, {
      ...breakdown,
      energyAg: { ...breakdown.energyAg, [cell]: v },
    });
  };

  const normalizeMetals = () => {
    if (metalsSum === 0) return;
    const next = { ...breakdown.metals };
    for (const k of METAL_TYPES) next[k] = (next[k] ?? 0) / metalsSum;
    setBreakdown(holding.id, { ...breakdown, metals: next });
  };

  const normalizeEnergyAg = () => {
    if (energyAgSum === 0) return;
    const next = { ...breakdown.energyAg };
    for (const k of ENERGY_AG_TYPES) next[k] = (next[k] ?? 0) / energyAgSum;
    setBreakdown(holding.id, { ...breakdown, energyAg: next });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-3">
      {/* Tier 1 — metals vs energy/ag split */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-text-muted">Tier 1 · Metals vs Energy/Ag</span>
          <span className="num text-text-muted">
            {(breakdown.metalsShare * 100).toFixed(1)}% metals ·{" "}
            {((1 - breakdown.metalsShare) * 100).toFixed(1)}% energy/ag
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(breakdown.metalsShare * 100)}
          onChange={(e) => setMetalsShare(Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      {/* Tier 2a — metals */}
      {breakdown.metalsShare > 0 && (
        <TierSection
          title="Metals"
          entries={METAL_TYPES.map((k) => ({
            key: k as MetalType,
            label: METAL_LABELS[k],
            value: (breakdown.metals[k] ?? 0) * 100,
            onChange: (pct: number) => setMetalWeight(k, pct),
          }))}
          weightSum={metalsSum}
          onNormalize={normalizeMetals}
        />
      )}

      {/* Tier 2b — energy/agriculture */}
      {breakdown.metalsShare < 1 && (
        <TierSection
          title="Energy / Agriculture"
          entries={ENERGY_AG_TYPES.map((k) => ({
            key: k as EnergyAgType,
            label: ENERGY_AG_LABELS[k],
            value: (breakdown.energyAg[k] ?? 0) * 100,
            onChange: (pct: number) => setEnergyAgWeight(k, pct),
          }))}
          weightSum={energyAgSum}
          onNormalize={normalizeEnergyAg}
        />
      )}

      <button
        type="button"
        onClick={() => setBreakdown(holding.id, null)}
        className="w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-[11px] text-text-muted active:opacity-70"
      >
        Clear breakdown
      </button>
    </div>
  );
}

function TierSection({
  title,
  entries,
  weightSum,
  onNormalize,
}: {
  title: string;
  entries: ReadonlyArray<{
    key: string;
    label: string;
    value: number;
    onChange: (pct: number) => void;
  }>;
  weightSum: number;
  onNormalize: () => void;
}) {
  const isNormalized = Math.abs(weightSum - 1) < 0.01;
  return (
    <details open className="rounded-lg border border-border bg-bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">
        {title}
      </summary>
      <div className="space-y-1.5 px-3 pb-3">
        {entries.map((entry) => (
          <BreakdownRow
            key={entry.key}
            label={entry.label}
            value={entry.value}
            onChange={entry.onChange}
          />
        ))}
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className={isNormalized ? "text-text-dim" : "text-amber-300"}>
            Σ {(weightSum * 100).toFixed(1)}%
            {isNormalized ? "" : " — should sum to 100"}
          </span>
          {!isNormalized && weightSum > 0 && (
            <button
              type="button"
              onClick={onNormalize}
              className="rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-text-muted active:opacity-70"
            >
              Normalize to 100%
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function BreakdownRow({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Value as a percent (0–100), not a fraction. */
  value: number;
  onChange: (pct: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-text">{label}</span>
      <span className="flex items-center gap-1 rounded-md border border-border bg-bg-elevated px-2 py-1">
        <NumberField
          value={+value.toFixed(2)}
          onChange={onChange}
          precision={1}
          allowNegative={false}
          className="num w-14 bg-transparent text-right text-sm font-medium text-text outline-none"
        />
        <span className="text-sm text-text-muted">%</span>
      </span>
    </div>
  );
}
