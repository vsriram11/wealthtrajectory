"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { filterHousehold } from "@/lib/types";
import { formatPercent, formatUSD } from "@/lib/format";
import { LiabilityCreator } from "./LiabilityCreator";

/**
 * Liabilities section on the Accounts page. Always rendered (even
 * when empty) so the "Add liability" affordance is discoverable —
 * the prior implementation hid the entire section at zero, leaving
 * no way to add the first one.
 *
 * Mortgages on real estate are NOT added here; the help text
 * reminds the user that mortgage debt is captured by setting
 * `leverage` on the real-estate holding (a $400K mortgage on a
 * $500K home = 5× leverage on $100K equity), which keeps net worth
 * math consistent and prevents double-counting.
 */
export function LiabilitiesList() {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const beginEditing = useAppStore((s) => s.beginEditingLiability);
  const [creating, setCreating] = useState(false);

  const filtered = filterHousehold(household, memberId);
  const empty = filtered.liabilities.length === 0;

  return (
    <section className="px-5 pt-6">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Liabilities
        </h2>
        <button
          type="button"
          onClick={() => {
            if (household.members.length === 0) return;
            setCreating(true);
          }}
          disabled={household.members.length === 0}
          className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1 text-[11px] font-medium text-text-muted active:opacity-70 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={
            household.members.length === 0
              ? "Add liability (disabled: add a household member first)"
              : "Add liability"
          }
        >
          + Add liability
        </button>
      </div>
      {empty ? (
        <div className="rounded-2xl border border-dashed border-border bg-bg-surface px-4 py-5 text-center">
          <div className="text-sm text-text-muted">No liabilities yet.</div>
          <div className="mx-auto mt-1 max-w-md text-[11px] text-text-dim">
            Add credit cards, student loans, auto loans, personal loans,
            or any non-mortgage debt.{" "}
            <span className="text-text-muted">
              Mortgage on your home? Don&apos;t add it here — set the
              leverage on the real-estate holding instead (e.g. $100K
              equity in a $500K home = 5× leverage).
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (household.members.length === 0) return;
              setCreating(true);
            }}
            disabled={household.members.length === 0}
            className="mt-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent active:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add your first liability
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-bg-surface">
          {filtered.liabilities.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => beginEditing(l.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-bg-elevated"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">
                    {l.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
                    <span>{formatPercent(l.annualInterestRate)} APR</span>
                    <span>·</span>
                    <span>{formatUSD(l.monthlyPaymentUSD)}/mo</span>
                  </div>
                </div>
                <div className="num shrink-0 text-sm font-semibold text-negative">
                  −{formatUSD(l.balanceUSD)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && household.members.length > 0 && (
        // Resolve ownerId: explicit member filter wins; otherwise
        // pick the first household member. The button is disabled
        // when there are zero members so this never receives an
        // empty string in practice — but the gate above plus the
        // !members.length condition here is defense-in-depth
        // against corruption of the rollup math by a phantom
        // empty-string ownerId reaching the store.
        <LiabilityCreator
          onClose={() => setCreating(false)}
          ownerId={memberId ?? household.members[0].id}
        />
      )}
    </section>
  );
}
