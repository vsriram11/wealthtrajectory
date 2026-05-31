"use client";

import { useRef } from "react";

/**
 * Shared date picker for "CUSTOM date range" UIs in the History
 * chart, Ticker Lookup, and anywhere else a date input needs to
 * resist typed input.
 *
 * Why this exists: the native `<input type="date">` allows
 * free-form typing — a half-typed ISO string parses to `null`,
 * chart bucket bounds degenerate, and the SVG path math NaNs out
 * → crash. We sidestep that by blocking ALL character input via
 * keydown / paste / cut / drop handlers; the only way to change
 * the value is the native calendar picker.
 *
 * The calendar is opened by either clicking anywhere on the
 * input row OR clicking the explicit calendar SVG button on the
 * right (accent-colored so it reads as the primary affordance).
 *
 * Important gotcha codified here: `showPicker()` throws
 * `InvalidStateError` when the input is `readOnly` (per the HTML
 * spec, the element must be "mutable"). An earlier version of
 * this picker set readOnly and silently broke the icon button
 * because the throw was caught + the focus() fallback didn't
 * open the picker. The input is therefore NOT readOnly here; we
 * rely entirely on the key/paste/cut/drop handlers to block
 * typing.
 *
 * Behavior:
 *  - Typing/paste/cut/drop: blocked at the corresponding events.
 *    Tab / Shift+Tab / Escape / Enter / Arrow keys pass through
 *    so keyboard navigation isn't trapped and the picker's
 *    spinner controls stay usable once it's open.
 *  - Click anywhere on the input row OR on the calendar button:
 *    opens the native picker via `showPicker()`. Falls back to
 *    `focus()` on browsers that don't support showPicker.
 *  - All onChange events still fire (driven by the picker), so
 *    the state stays in sync.
 */
export function CustomDatePicker({
  label,
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Fall through to focus() — most browsers open the
        // picker on focus for a date input.
      }
    }
    el.focus();
  };
  const swallowKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "Tab" ||
      e.key === "Escape" ||
      e.key === "Enter" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      return;
    }
    e.preventDefault();
  };
  return (
    <label className="flex items-center gap-1.5 text-text-muted">
      <span>{label}</span>
      <div
        className="flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-1 cursor-pointer focus-within:border-accent"
        onClick={openPicker}
      >
        <input
          ref={ref}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={swallowKeys}
          onPaste={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          className="bg-transparent text-[11px] text-text outline-none cursor-pointer"
          aria-label={ariaLabel}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            // Prevent the button's mousedown from stealing focus
            // away from the input — if focus jumps to the button,
            // showPicker() can lose the user-activation bit on
            // some browsers and silently no-op.
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
          className="flex items-center justify-center rounded p-0.5 text-accent hover:bg-accent/10 active:opacity-70"
          aria-label={`Open calendar to pick ${ariaLabel}`}
          title="Open calendar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>
    </label>
  );
}
