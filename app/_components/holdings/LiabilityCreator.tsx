"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Add-liability bottom sheet. Captures the minimum fields a Liability
 * needs: name + balance + APR + monthly payment + owner. Includes
 * an inline reminder that mortgages on real estate should NOT be
 * added here — they belong on the corresponding real-estate
 * holding's leverage field, so net worth math doesn't double-count
 * the debt.
 *
 * Quick-pick name chips ("Credit card", "Student loan", …) reduce
 * friction for the common cases.
 */
export function LiabilityCreator({
  onClose,
  ownerId,
}: {
  onClose: () => void;
  ownerId: string;
}) {
  const addLiability = useAppStore((s) => s.addLiability);
  const members = useAppStore((s) => s.household.members);

  const [name, setName] = useState("");
  const [balance, setBalance] = useState<number>(0);
  const [aprPct, setAprPct] = useState<number>(0);
  const [monthlyPayment, setMonthlyPayment] = useState<number>(0);
  const [owner, setOwner] = useState(ownerId || members[0]?.id || "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const QUICK_NAMES = [
    "Credit card",
    "Student loan",
    "Auto loan",
    "Personal loan",
    "HELOC",
    "Other",
  ] as const;

  const canSave = name.trim().length > 0 && balance > 0 && owner;

  const submit = () => {
    if (!canSave) return;
    addLiability({
      name: name.trim(),
      balanceUSD: balance,
      annualInterestRate: aprPct / 100,
      monthlyPaymentUSD: monthlyPayment,
      ownerId: owner,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                New liability
              </div>
              <div className="text-xl font-semibold text-text">Add a debt</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Cancel
            </button>
          </div>

          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-3 py-2 text-[11px] text-amber-300">
            <span className="font-medium">Don&apos;t add a mortgage here.</span>{" "}
            <span className="text-amber-300/80">
              Mortgages are captured by the leverage on the corresponding
              real-estate holding (e.g. $100K equity in a $500K home = 5×
              leverage). Adding it here too would double-count the debt.
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chase Sapphire, Sallie Mae, Honda loan"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {QUICK_NAMES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setName(q)}
                    className="rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text-muted active:opacity-70 hover:text-text"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Balance">
              <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
                <span className="text-sm text-text-muted">$</span>
                <NumberField
                  value={balance}
                  onChange={setBalance}
                  precision={2}
                  allowNegative={false}
                  className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
                />
              </span>
            </Field>
            <Field label="Interest rate (APR)">
              <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
                <NumberField
                  value={aprPct}
                  onChange={setAprPct}
                  precision={2}
                  allowNegative={false}
                  className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
                />
                <span className="text-sm text-text-muted">%</span>
              </span>
            </Field>
            <Field label="Monthly payment">
              <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
                <span className="text-sm text-text-muted">$</span>
                <NumberField
                  value={monthlyPayment}
                  onChange={setMonthlyPayment}
                  precision={2}
                  allowNegative={false}
                  className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
                />
              </span>
            </Field>
            {members.length > 1 && (
              <Field label="Owner">
                <select
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none focus:border-accent"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="mt-5 w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
          >
            Add liability
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      {children}
    </label>
  );
}
