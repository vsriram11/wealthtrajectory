"use client";

/**
 * Small UI primitives used by the HoldingCreator modal. Each is
 * stateless — the parent owns the data and the handlers.
 */

import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Asset-class pill button used in the "what kind of holding"
 * picker row at the top of the creator.
 */
export function KindBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium transition active:opacity-70 ${
        active ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

/** Dollar input with a leading "$" sigil. Non-negative integers/decimals. */
export function DollarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
      <span className="text-sm text-text-muted">$</span>
      <NumberField
        value={value}
        onChange={onChange}
        precision={2}
        allowNegative={false}
        className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
      />
    </span>
  );
}

/** Uppercase-label wrapper for a form field. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      {children}
    </label>
  );
}
