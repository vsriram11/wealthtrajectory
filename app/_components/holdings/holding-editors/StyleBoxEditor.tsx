"use client";

/**
 * 3 × 3 Morningstar-style box editor for equity holdings. Rows are
 * size tiers (Large/Mid/Small); columns are style tiers (Value/Blend/
 * Growth). Cell values are fractions in [0, 1] that ideally sum to 1.
 *
 * UX:
 *   - Tap a cell to type a percent directly.
 *   - Double-tap (touch) / double-click (desktop) sets that cell to
 *     100% and zeros the rest — fast "all into one bucket" path.
 *   - "Normalize to 100%" re-scales when the user enters partial
 *     weights (e.g. 60/30/30 → 50/25/25).
 *
 * Background tint scales with the cell value so the user gets a
 * heatmap of where their allocation actually lives.
 */

import {
  STYLE_BOX_GRID,
  STYLE_BOX_SIZE_LABELS,
  STYLE_BOX_STYLE_LABELS,
  type StyleBoxAllocation,
  type StyleBoxCell,
} from "@/lib/types";

export function StyleBoxEditor({
  allocation,
  onChange,
}: {
  allocation: StyleBoxAllocation;
  onChange: (next: StyleBoxAllocation) => void;
}) {
  const weightSum = Object.values(allocation).reduce((a, b) => a + b, 0);
  const sumPct = (weightSum * 100).toFixed(1);

  const setCellPct = (cell: StyleBoxCell, valuePct: number) => {
    onChange({ ...allocation, [cell]: Math.max(0, valuePct / 100) });
  };

  const setCellToFull = (cell: StyleBoxCell) => {
    const next = { ...allocation };
    for (const k of Object.keys(next) as StyleBoxCell[]) next[k] = 0;
    next[cell] = 1;
    onChange(next);
  };

  const normalize = () => {
    if (weightSum === 0) return;
    const next = { ...allocation };
    for (const k of Object.keys(next) as StyleBoxCell[]) {
      next[k] = next[k] / weightSum;
    }
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: "auto repeat(3, minmax(0, 1fr))",
          gridTemplateRows: "auto repeat(3, minmax(0, 1fr))",
        }}
      >
        <div />
        {STYLE_BOX_STYLE_LABELS.map((s) => (
          <div
            key={s}
            className="text-center text-[10px] uppercase tracking-wider text-text-dim"
          >
            {s}
          </div>
        ))}
        {STYLE_BOX_GRID.map((row, ri) => (
          <StyleBoxRow
            key={ri}
            label={STYLE_BOX_SIZE_LABELS[ri]}
            row={row}
            allocation={allocation}
            onCellChange={setCellPct}
            onCellFill={setCellToFull}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span
          className={
            Math.abs(weightSum - 1) < 0.01 ? "text-positive" : "text-amber-300"
          }
        >
          Sum: {sumPct}%
        </span>
        <button
          type="button"
          onClick={normalize}
          disabled={weightSum === 0 || Math.abs(weightSum - 1) < 0.01}
          className="rounded-md border border-border-strong px-2 py-1 text-[11px] text-text-muted disabled:opacity-40"
        >
          Normalize to 100%
        </button>
      </div>
      <div className="mt-1 text-[11px] text-text-dim">
        Tap a cell to enter %. Double-tap sets that cell to 100%.
      </div>
    </div>
  );
}

function StyleBoxRow({
  label,
  row,
  allocation,
  onCellChange,
  onCellFill,
}: {
  label: string;
  row: StyleBoxCell[];
  allocation: StyleBoxAllocation;
  onCellChange: (cell: StyleBoxCell, valuePct: number) => void;
  onCellFill: (cell: StyleBoxCell) => void;
}) {
  return (
    <>
      <div className="flex items-center pr-2 text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      {row.map((cell) => (
        <StyleBoxCellInput
          key={cell}
          value={Math.round(allocation[cell] * 100)}
          onChange={(v) => onCellChange(cell, v)}
          onFill={() => onCellFill(cell)}
        />
      ))}
    </>
  );
}

function StyleBoxCellInput({
  value,
  onChange,
  onFill,
}: {
  value: number;
  onChange: (v: number) => void;
  onFill: () => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      step={5}
      value={value}
      onDoubleClick={onFill}
      onChange={(e) => {
        const raw = parseFloat(e.target.value);
        if (Number.isNaN(raw)) return;
        onChange(raw);
      }}
      className="num h-12 w-full rounded-md border border-border bg-bg-surface text-center text-sm font-medium text-text outline-none focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      style={{
        backgroundColor:
          value > 0
            ? `rgba(56, 189, 248, ${0.08 + (value / 100) * 0.45})`
            : undefined,
      }}
    />
  );
}
