"use client";

/**
 * Small UI primitives used by the HistoricalMonteCarloCard.
 * Co-located here so the main card file isn't fattened by
 * three trivial wrappers (~50 lines of pure presentation).
 */

import { formatUSDCompact } from "@/lib/format";

/** Compact percentile-value cell ("p5", "p25", "p50", …). */
export function PercentileBox({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="num mt-0.5 text-sm font-semibold text-text">
        {formatUSDCompact(value)}
      </div>
    </div>
  );
}

/**
 * Labeled numeric input with optional currency prefix. Used for
 * Starting NW / Annual spend / Horizon controls. Range-validated
 * via `min` / `max`; rejects non-finite parse results.
 */
export function NumberInput({
  label,
  prefix,
  value,
  onChange,
  step,
  min,
  max,
  compact,
}: {
  label: string;
  prefix?: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  compact?: boolean;
}) {
  return (
    <label
      className={`block rounded-md border border-border bg-bg-elevated px-3 py-2 ${
        compact ? "max-w-[160px]" : ""
      }`}
    >
      <span className="block text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="mt-1 flex items-baseline gap-1">
        {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          step={step}
          min={min}
          max={max}
          className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
        />
      </span>
    </label>
  );
}

/** Pill toggle used for the "historical vs bootstrap" mode switch. */
export function ModeChip({
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
      className={`rounded-full px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
        active ? "bg-accent text-bg" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
