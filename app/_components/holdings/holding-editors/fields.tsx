"use client";

/**
 * Shared field primitives used by the HoldingEditor modal and its
 * class-specific sub-editors. Co-located here so a contributor
 * editing one editor doesn't have to scroll through 1.5k lines of
 * unrelated commodity / composition / style-box code to find the
 * input primitive they need.
 *
 * Each primitive owns presentation only — the `onChange` lifts the
 * new value to the parent, which is responsible for the store
 * write. That keeps the primitives reusable across edit and
 * create flows.
 */

import { NumberField } from "@/app/_components/ui/NumberField";
import { parseISODate } from "@/lib/dateInput";

export function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mt-6 mb-3 px-1">
      <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-text-dim">{subtitle}</div>
    </div>
  );
}

export function ReadOnlyField({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  return (
    <div className="block rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">{label}</span>
        <span className="num text-sm font-medium text-text-muted">
          {value}
        </span>
      </div>
      {help && <div className="mt-1 text-[11px] text-text-dim">{help}</div>}
    </div>
  );
}

export function FieldNumber({
  label,
  prefix,
  suffix,
  value,
  step,
  min,
  max,
  onChange,
  help,
  precision,
  rightSlot,
}: {
  label: string;
  prefix?: string;
  suffix?: string;
  value: number;
  step: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
  help?: string;
  /**
   * Optional explicit precision. When omitted we derive from `step`:
   * step < 1 → 4 decimals, step >= 1 → integer. The derivation is
   * wrong for fields like Shares where step is 1 but fractional
   * values are legitimate (you can hold 0.123 of TQQQ). Pass
   * precision explicitly in those cases.
   */
  precision?: number;
  /**
   * Optional content rendered to the right of the label — used for
   * status chips ("Auto") and inline reset affordances ("Reset to
   * auto") that need to sit alongside the field label without
   * pushing the input out of alignment.
   */
  rightSlot?: React.ReactNode;
}) {
  const effectivePrecision = precision ?? (Math.abs(step) < 1 ? 4 : 0);
  // Clamp inbound value to [min, max] before passing upstream. The
  // type signature has always declared min/max but the prior version
  // didn't actually enforce them — a user could type 200 into a
  // withdrawalRate-style field bounded 0-15 and projectIndependence
  // would happily compute against 200% withdrawals.
  const clamp = (v: number) => {
    let next = v;
    if (Number.isFinite(min) && next < min) next = min;
    if (max != null && Number.isFinite(max) && next > max) next = max;
    return next;
  };
  return (
    <label className="block rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-text">
          <span className="truncate">{label}</span>
          {rightSlot}
        </span>
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1">
          {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
          <NumberField
            value={value}
            onChange={(v) => onChange(clamp(v))}
            precision={effectivePrecision}
            className="num w-24 bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          {suffix && <span className="text-sm text-text-muted">{suffix}</span>}
        </span>
      </div>
      {help && <div className="mt-1 text-[11px] text-text-dim">{help}</div>}
    </label>
  );
}

export function DateField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: number | null;
  onChange: (t: number | null) => void;
  help?: string;
}) {
  const display = value ? new Date(value).toISOString().slice(0, 10) : "";
  return (
    <label className="block rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={display}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                onChange(null);
                return;
              }
              // Anchor to noon UTC (matches lib/dateInput.parseISODate)
              // so the date doesn't drift by ±1 day in non-UTC
              // timezones between save and reload. Round-4 audit
              // WARN: was using `new Date(v + "T00:00:00")` which
              // parses as LOCAL midnight; display path uses UTC,
              // so a PST user editing "Acquired on" repeatedly
              // would see the date shift back a day each save.
              const t = parseISODate(v);
              if (t !== null) onChange(t);
            }}
            className="rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-sm text-text outline-none focus:border-accent"
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-[11px] text-text-muted active:opacity-70"
              aria-label="Clear date"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {help && <div className="mt-1 text-[11px] text-text-dim">{help}</div>}
    </label>
  );
}

/**
 * 0–100 percent slider with a paired numeric input. Used by every
 * sub-editor that allocates a holding across categories that must
 * sum to 100 (bond type, geography, commodity breakdown).
 */
export function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs text-text-muted">{label}</div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-accent"
      />
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (Number.isNaN(raw)) return;
          onChange(raw);
        }}
        className="num w-14 rounded-md border border-border bg-bg-surface px-2 py-1 text-right text-sm text-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-xs text-text-muted">%</span>
    </div>
  );
}

/**
 * Human-readable elapsed time ("3 min ago", "2 hr ago", "5 days ago")
 * for live-price freshness indicators. Falls back to "just now" for
 * times within the last 60 seconds.
 */
export function formatRelative(t: number): string {
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/**
 * Block-style labeled checkbox: title + description on the left,
 * checkbox on the right. Shared by the primary-residence and
 * illiquid-flag toggles.
 */
export function LabeledToggle({
  title,
  description,
  checked,
  onChange,
  ariaLabel,
}: {
  title: string;
  description: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label className="block rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-text">{title}</div>
          <div className="mt-0.5 text-[11px] text-text-dim">{description}</div>
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-accent"
          aria-label={ariaLabel}
        />
      </div>
    </label>
  );
}
