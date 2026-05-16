"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { formatPercent, formatUSD } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

export function LiabilityEditor() {
  const id = useAppStore((s) => s.editingLiabilityId);
  const close = useAppStore((s) => s.closeLiabilityEditor);
  const liabilities = useAppStore((s) => s.household.liabilities);
  const update = useAppStore((s) => s.updateLiability);
  const remove = useAppStore((s) => s.removeLiability);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const liab = useMemo(
    () => (id ? liabilities.find((l) => l.id === id) : null),
    [id, liabilities],
  );

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, close]);

  if (!id || !liab) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                Liability
              </div>
              <div className="text-xl font-semibold text-text">
                {liab.name}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Done
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <Field
              label="Balance"
              prefix="$"
              value={liab.balanceUSD}
              step={500}
              min={0}
              onChange={(v) => update(liab.id, { balanceUSD: v })}
              help={formatUSD(liab.balanceUSD)}
            />
            <Field
              label="Interest rate (APR)"
              suffix="%"
              value={+(liab.annualInterestRate * 100).toFixed(3)}
              step={0.1}
              min={0}
              max={50}
              onChange={(v) => update(liab.id, { annualInterestRate: v / 100 })}
              help={formatPercent(liab.annualInterestRate)}
            />
            <Field
              label="Monthly payment"
              prefix="$"
              value={liab.monthlyPaymentUSD}
              step={50}
              min={0}
              onChange={(v) => update(liab.id, { monthlyPaymentUSD: v })}
              help={formatUSD(liab.monthlyPaymentUSD)}
            />
          </div>

          <div className="mt-6 rounded-xl border border-negative/30 bg-negative/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-negative">
              Danger zone
            </div>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mt-2 w-full rounded-md border border-negative/40 bg-bg-surface px-3 py-2 text-sm font-medium text-negative active:opacity-70"
              >
                Delete liability
              </button>
            ) : (
              <div>
                <div className="mt-2 text-sm text-text">
                  Delete{" "}
                  <span className="font-semibold">{liab.name}</span> (
                  {formatUSD(liab.balanceUSD)})?
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-muted active:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      remove(liab.id);
                      close();
                    }}
                    className="flex-1 rounded-md bg-negative px-3 py-2 text-sm font-semibold text-bg active:opacity-80"
                  >
                    Delete forever
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  prefix,
  suffix,
  value,
  step,
  min,
  max,
  onChange,
  help,
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
}) {
  return (
    <label className="block rounded-xl border border-border bg-bg-elevated px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text">{label}</span>
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1">
          {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
          <NumberField
            value={value}
            onChange={onChange}
            precision={Math.abs(step) < 1 ? 3 : 0}
            allowNegative={false}
            className="num w-24 bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          {suffix && <span className="text-sm text-text-muted">{suffix}</span>}
        </span>
      </div>
      {help && <div className="mt-1 text-[11px] text-text-dim">{help}</div>}
    </label>
  );
}
