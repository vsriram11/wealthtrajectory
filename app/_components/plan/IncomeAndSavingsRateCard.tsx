"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  householdIncomeSum,
  totalMonthlyContributions,
} from "@/lib/types";
import { formatUSD } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Per-member annual gross income + derived household savings rate.
 *
 * Income lives on the Member ({@link Member.incomeUSD}); the card
 * rolls up via {@link householdIncomeSum}. This matters because:
 *   - Multi-earner households shouldn't be forced to track one
 *     combined number — partners often want visibility into their
 *     individual contributions.
 *   - When viewing a per-member projection (memberId filter on
 *     accounts), the income editor here automatically scopes to
 *     that member's row.
 *
 * UX:
 *   - Single-member household: inline single-field editor (zero
 *     ceremony — same UX as before).
 *   - Multi-member household: per-member rows; sum displayed as
 *     the household income.
 *   - Empty state nudges the user to add income for the first
 *     member.
 *
 * Free tier — savings rate is a foundational Independence metric.
 */
export function IncomeAndSavingsRateCard() {
  const household = useAppStore((s) => s.household);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const setMemberIncome = useAppStore((s) => s.setMemberIncome);
  const [editing, setEditing] = useState<boolean>(false);

  // Member-aware scoping: when a single member is selected globally,
  // income + contributions both restrict to that member's accounts /
  // row. Without this the rate stays stuck on the household aggregate
  // and silently disagrees with every other per-member card.
  const selectedMember = useMemo(
    () =>
      selectedMemberId
        ? household.members.find((m) => m.id === selectedMemberId) ?? null
        : null,
    [household.members, selectedMemberId],
  );
  const incomeSum = useMemo(
    () =>
      selectedMember
        ? selectedMember.incomeUSD ?? null
        : householdIncomeSum(household),
    [household, selectedMember],
  );
  const annualContrib = useMemo(
    () => totalMonthlyContributions(household, selectedMemberId) * 12,
    [household, selectedMemberId],
  );
  const rate = incomeSum && incomeSum > 0 ? annualContrib / incomeSum : null;

  if (household.accounts.length === 0) return null;

  const members = household.members;
  const isMemberView = selectedMember != null;
  const scopeLabel = isMemberView ? selectedMember!.displayName : "Household";

  // Empty state — no income in current scope.
  if (incomeSum == null && !editing) {
    return (
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Savings rate
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">
              {scopeLabel}
            </div>
          </div>
          <div className="mt-1 text-sm text-text">
            Add{" "}
            {isMemberView
              ? `${selectedMember!.displayName}'s annual income`
              : members.length === 1
                ? "your annual income"
                : "annual incomes for your household"}{" "}
            to see {isMemberView ? "their" : "your"} savings rate.
          </div>
          <div className="mt-1 text-[11px] text-text-dim">
            Independence math: at 50% savings, you retire in ~17 years regardless of
            salary. At 10% it&apos;s ~50.
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent active:opacity-70"
          >
            {isMemberView
              ? `Add ${selectedMember!.displayName}'s income`
              : members.length === 1
                ? "Add my income"
                : "Add incomes"}
          </button>
        </div>
      </section>
    );
  }

  // Editor — per-member rows.
  if (editing) {
    return (
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              {members.length > 1 ? "Annual income per member" : "Annual income"}
            </div>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[11px] text-text-dim active:opacity-70 hover:text-text-muted"
            >
              Done
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-border-strong bg-bg-elevated p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium text-text">
                    {m.displayName}
                  </span>
                  <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-1.5">
                    <span className="text-sm text-text-muted">$</span>
                    <NumberField
                      value={m.incomeUSD ?? 0}
                      onChange={(v) => setMemberIncome(m.id, v > 0 ? v : null)}
                      precision={0}
                      allowNegative={false}
                      className="num w-24 bg-transparent text-right text-sm font-medium text-text outline-none"
                    />
                    <span className="text-sm text-text-muted">/yr</span>
                  </span>
                  {m.incomeUSD != null && m.incomeUSD > 0 && (
                    <button
                      type="button"
                      onClick={() => setMemberIncome(m.id, null)}
                      aria-label="Clear income"
                      className="rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-[11px] text-text-dim active:opacity-70 hover:text-negative"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {members.length > 1 && incomeSum != null && (
            <div className="mt-3 flex items-baseline justify-between rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px]">
              <span className="text-text-muted">Household total</span>
              <span className="num font-semibold text-text">
                {formatUSD(incomeSum)}/yr
              </span>
            </div>
          )}
          <div className="mt-2 text-[10px] text-text-dim">
            Use gross (pre-tax) income per member. Stored on this device +
            your encrypted Drive backup. Never shared.
          </div>
        </div>
      </section>
    );
  }

  // Display.
  const ratePct = rate != null ? rate * 100 : 0;
  const tier =
    ratePct >= 50
      ? {
          label: "Extreme Independence",
          color: "text-positive",
          note: "On track for retirement in ~17 years from $0 net worth.",
        }
      : ratePct >= 25
        ? {
            label: "Strong saver",
            color: "text-accent",
            note: "On track for retirement in ~25-30 years from $0 net worth.",
          }
        : ratePct >= 15
          ? {
              label: "Steady saver",
              color: "text-text",
              note: "Typical US savings rate. Pushing toward 25%+ accelerates Independence meaningfully.",
            }
          : ratePct > 0
            ? {
                label: "Under Independence pace",
                color: "text-amber-300",
                note: "Below the financial-independence-community sweet spot. Even +5 pts compounds substantially.",
              }
            : {
                label: "No contributions",
                color: "text-text-dim",
                note: "Add monthly contributions on your accounts to start tracking your rate.",
              };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Savings rate
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">
              {scopeLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] text-text-muted active:opacity-70 hover:text-text"
          >
            Edit income
          </button>
        </div>
        <div className={`num mt-1 text-3xl font-semibold ${tier.color}`}>
          {ratePct.toFixed(1)}%
        </div>
        <div className={`mt-0.5 text-sm font-medium ${tier.color}`}>
          {tier.label}
        </div>
        <div className="mt-1 text-[11px] text-text-muted">{tier.note}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-dim">
          <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider">Savings</div>
            <div className="num mt-0.5 text-text">
              {formatUSD(annualContrib)}/yr
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider">Income</div>
            <div className="num mt-0.5 text-text">
              {formatUSD(incomeSum ?? 0)}/yr
            </div>
            {!isMemberView && members.length > 1 && incomeSum != null && (
              <div className="num text-[10px] text-text-dim">
                {members
                  .filter((m) => m.incomeUSD != null && m.incomeUSD > 0)
                  .map((m) => `${m.displayName}: ${formatUSD(m.incomeUSD ?? 0)}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
