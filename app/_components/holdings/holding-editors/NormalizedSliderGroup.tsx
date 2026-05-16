"use client";

/**
 * Generic "n sliders that should sum to 100%" editor. Used by every
 * sub-editor that allocates a holding across a small fixed set of
 * categories (bond type, geography, commodity metals/energy splits).
 *
 * Renders one {@link SliderRow} per entry and a sum indicator with a
 * "normalize to 100%" affordance. The component is purely
 * presentational — `onChange` is called with the next allocation
 * object whenever the user moves a slider or clicks normalize. The
 * parent decides how to persist (typically a store action).
 *
 * @typeParam K — string-literal union of the keys this group
 *   allocates across (e.g. `"government" | "corporate"`).
 */

import { SliderRow } from "./fields";

export function NormalizedSliderGroup<K extends string>({
  entries,
  allocation,
  onChange,
}: {
  /** Display order + label per category. */
  entries: ReadonlyArray<{ key: K; label: string }>;
  /** Current weights in [0, 1]. Should sum to 1, but doesn't have to. */
  allocation: Record<K, number>;
  /** Called with the next allocation on any user interaction. */
  onChange: (next: Record<K, number>) => void;
}) {
  const weightSum = entries.reduce((acc, { key }) => acc + allocation[key], 0);
  const sumPct = (weightSum * 100).toFixed(1);
  const isNormalized = Math.abs(weightSum - 1) < 0.01;

  const setKey = (key: K, valuePct: number) => {
    onChange({ ...allocation, [key]: Math.max(0, valuePct / 100) });
  };

  const normalize = () => {
    if (weightSum === 0) return;
    const next = { ...allocation };
    for (const { key } of entries) next[key] = next[key] / weightSum;
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
      <div className="space-y-2.5">
        {entries.map(({ key, label }) => (
          <SliderRow
            key={key}
            label={label}
            value={Math.round(allocation[key] * 100)}
            onChange={(v) => setKey(key, v)}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className={isNormalized ? "text-positive" : "text-amber-300"}>
          Sum: {sumPct}%
        </span>
        <button
          type="button"
          onClick={normalize}
          disabled={weightSum === 0 || isNormalized}
          className="rounded-md border border-border-strong px-2 py-1 text-[11px] text-text-muted disabled:opacity-40"
        >
          Normalize to 100%
        </button>
      </div>
    </div>
  );
}
