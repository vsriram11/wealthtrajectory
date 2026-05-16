"use client";

/**
 * Subscription-tagged budget items rendered as a dedicated list
 * (Netflix, AWS, Adobe, gym, …). The user tags an expense as a
 * subscription in the BudgetItemCreator; this view surfaces them
 * separately so monthly-vs-annual cost + next-billing dates are
 * scannable in one place.
 *
 * The subscriptions still roll up into the budget normally — this
 * is a presentation slice, not a separate budget category.
 */

import { formatUSD } from "@/lib/format";
import {
  BILLING_CYCLE_LABELS,
  CATEGORY_TONES,
  nextBillingDate,
  perCycleAmountUSD,
  type BudgetItem,
} from "@/lib/budget/budget";
import type { Member } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function SubscriptionsList({
  items,
  monthlyTotal,
  members,
  showOwner,
  now,
  onAdd,
  onEdit,
}: {
  items: BudgetItem[];
  monthlyTotal: number;
  members: Pick<Member, "id" | "displayName">[];
  showOwner: boolean;
  /** Captured "now" timestamp from the parent, so the relative
      labels ("in 3 days") and current-year comparisons stay
      stable across re-renders. */
  now: number;
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  const memberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "—";
  const annualTotal = monthlyTotal * 12;

  return (
    <>
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-dim">
                Active subscriptions
              </div>
              <div className="num mt-1 text-2xl font-semibold text-text">
                {formatUSD(monthlyTotal)}
                <span className="text-sm font-normal text-text-muted">
                  {" "}
                  / month
                </span>
              </div>
              <div className="num mt-0.5 text-[11px] text-text-dim">
                = {formatUSD(annualTotal)} / year across {items.length}{" "}
                subscription{items.length === 1 ? "" : "s"}
              </div>
            </div>
            <button
              type="button"
              onClick={onAdd}
              className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent active:opacity-70"
            >
              + Add
            </button>
          </div>
        </div>
      </section>

      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[11px] text-text-dim">
              No subscriptions yet. Tap an expense and check &quot;This is a
              subscription&quot; to track next-billing dates here.
            </div>
          ) : (
            <ul>
              {items.map((item, idx) => (
                <SubscriptionRow
                  key={item.id}
                  item={item}
                  ownerName={memberName(item.ownerId)}
                  showOwner={showOwner}
                  divider={idx > 0}
                  now={now}
                  onClick={() => onEdit(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function SubscriptionRow({
  item,
  ownerName,
  showOwner,
  divider,
  now,
  onClick,
}: {
  item: BudgetItem;
  ownerName: string;
  showOwner: boolean;
  divider: boolean;
  now: number;
  onClick: () => void;
}) {
  const tone = CATEGORY_TONES[item.category];
  const cycle = item.billingCycle ?? "monthly";
  const nextBilling = nextBillingDate(item, now);
  const currentYear = new Date(now).getFullYear();
  const nextLabel = nextBilling
    ? nextBilling.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year:
          nextBilling.getFullYear() !== currentYear ? "numeric" : undefined,
      })
    : "—";
  const daysUntilNext = nextBilling
    ? Math.ceil((nextBilling.getTime() - now) / MS_PER_DAY)
    : null;
  const relativeLabel = formatRelativeDays(daysUntilNext);
  const cycleAmount = perCycleAmountUSD(item);

  return (
    <li className={divider ? "border-t border-border" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className="block w-full px-4 py-3 text-left active:opacity-70"
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-text">
              {item.name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10px] text-text-dim">
              <span>{nextLabel}</span>
              {relativeLabel && (
                <span className="text-amber-400">{relativeLabel}</span>
              )}
              {showOwner && (
                <span className="text-text-muted">{ownerName}</span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-sm font-semibold text-text">
              {formatUSD(cycleAmount)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">
              {BILLING_CYCLE_LABELS[cycle]}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * "today" / "tomorrow" / "in N days" for the next-billing
 * indicator. Returns null when the billing is more than 30 days
 * away — at that point the absolute date is the better cue.
 */
function formatRelativeDays(daysUntil: number | null): string | null {
  if (daysUntil == null) return null;
  if (daysUntil <= 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil <= 30) return `in ${daysUntil} days`;
  return null;
}
