"use client";

/**
 * One categorized group of recurring expenses (food / housing /
 * transportation / lifestyle / healthcare / savings). Renders the
 * header with monthly subtotal, an "Add" affordance, and a list
 * of items — each item is a button that opens the editor.
 *
 * Pure presentation: the parent (`BudgetPanel`) owns the data and
 * the add/edit handlers.
 */

import { formatUSD } from "@/lib/format";
import {
  CATEGORY_LABELS,
  CATEGORY_TONES,
  type BudgetItem,
  type ExpenseCategory,
} from "@/lib/budget/budget";
import type { Member } from "@/lib/types";

export function CategorySection({
  category,
  items,
  total,
  members,
  showOwner,
  onAdd,
  onEdit,
}: {
  category: ExpenseCategory;
  items: BudgetItem[];
  total: number;
  members: Pick<Member, "id" | "displayName">[];
  showOwner: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  const memberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "—";
  const tone = CATEGORY_TONES[category];

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${tone.dot}`}
            />
            <span className="text-sm font-semibold text-text">
              {CATEGORY_LABELS[category]}
            </span>
            {items.length > 0 && (
              <span className="num text-[11px] text-text-dim">
                · {formatUSD(total)}/mo
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onAdd}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium active:opacity-70 border-transparent ${tone.tint} ${tone.text}`}
          >
            + Add
          </button>
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-3 text-[11px] text-text-dim">
            No {CATEGORY_LABELS[category].toLowerCase()} expenses yet.
          </div>
        ) : (
          <ul>
            {items.map((item, idx) => (
              <BudgetItemRow
                key={item.id}
                item={item}
                ownerName={memberName(item.ownerId)}
                showOwner={showOwner}
                divider={idx > 0}
                onClick={() => onEdit(item.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BudgetItemRow({
  item,
  ownerName,
  showOwner,
  divider,
  onClick,
}: {
  item: BudgetItem;
  ownerName: string;
  showOwner: boolean;
  divider: boolean;
  onClick: () => void;
}) {
  return (
    <li className={divider ? "border-t border-border" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className="block w-full px-4 py-2.5 text-left active:opacity-70"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">
              {item.name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10px] text-text-dim">
              {item.subcategory && <span>{item.subcategory}</span>}
              <span className="uppercase tracking-wider">{item.type}</span>
              {item.isSubscription && <span className="text-accent">Sub</span>}
              {showOwner && (
                <span className="text-text-muted">{ownerName}</span>
              )}
              {item.endsAtRetirement && (
                <span className="text-amber-400">Ends at retirement</span>
              )}
              {item.endDate && (
                <span>
                  Ends{" "}
                  {new Date(item.endDate).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                  })}
                </span>
              )}
            </div>
          </div>
          <span className="num shrink-0 text-sm font-semibold text-text">
            {formatUSD(item.monthlyUSD)}
          </span>
        </div>
      </button>
    </li>
  );
}
