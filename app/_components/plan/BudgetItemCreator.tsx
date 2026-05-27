"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  BILLING_CYCLE_LABELS,
  CATEGORY_DEFAULT_EXCESS_INFLATION,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_TONES,
  MONTHS_PER_CYCLE,
  SUBCATEGORY_PRESETS,
  defaultEndsAtRetirement,
  type BillingCycle,
  type ExpenseCategory,
  type ExpenseType,
} from "@/lib/budget/budget";
import { formatUSD } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Add / edit a budget line. Modal sheet (mirrors LiabilityCreator's
 * pattern). Inspired by the user's reference app — amount up top,
 * category picker, optional subcategory preset chips, type
 * (fixed/variable), optional end date, "ends at retirement" toggle.
 *
 * Editing reuses the same sheet — if `editingId` is set, the form
 * preloads from the matching budgetItem and Save calls updateBudgetItem
 * instead of addBudgetItem.
 */
export function BudgetItemCreator({
  onClose,
  initialCategory,
  editingId,
}: {
  onClose: () => void;
  initialCategory?: ExpenseCategory;
  editingId?: string | null;
}) {
  const addBudgetItem = useAppStore((s) => s.addBudgetItem);
  const updateBudgetItem = useAppStore((s) => s.updateBudgetItem);
  const removeBudgetItem = useAppStore((s) => s.removeBudgetItem);
  const members = useAppStore((s) => s.household.members);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const existing = useAppStore((s) =>
    editingId ? s.budgetItems.find((b) => b.id === editingId) ?? null : null,
  );

  // Default owner for a NEW item: currently-selected member if any,
  // else the first household member. Matches the AccountEditor /
  // LiabilityCreator pattern so users in per-member view don't have
  // to repick the owner on every add.
  const defaultOwnerId =
    existing?.ownerId ??
    selectedMemberId ??
    members[0]?.id ??
    "";

  const [category, setCategory] = useState<ExpenseCategory>(
    existing?.category ?? initialCategory ?? "housing",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [ownerId, setOwnerId] = useState<string>(defaultOwnerId);
  const [subcategory, setSubcategory] = useState<string>(
    existing?.subcategory ?? "",
  );
  const [isSubscription, setIsSubscription] = useState<boolean>(
    existing?.isSubscription ?? false,
  );
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    existing?.billingCycle ?? "monthly",
  );
  const [startDate, setStartDate] = useState<string>(
    existing?.startDate
      ? new Date(existing.startDate).toISOString().slice(0, 10)
      : "",
  );
  // The displayed amount is per-cycle for subscriptions, per-month
  // otherwise. We translate to/from canonical monthlyUSD at save /
  // load time so the budget rollup math stays cycle-agnostic.
  const monthsPerCycle = MONTHS_PER_CYCLE[billingCycle];
  const initialDisplayAmount = existing
    ? existing.isSubscription
      ? existing.monthlyUSD * MONTHS_PER_CYCLE[existing.billingCycle ?? "monthly"]
      : existing.monthlyUSD
    : 0;
  const [amount, setAmount] = useState<number>(initialDisplayAmount);
  const monthlyEquivalent = amount / monthsPerCycle;
  const [type, setType] = useState<ExpenseType>(existing?.type ?? "variable");
  const [endsAtRetirement, setEndsAtRetirement] = useState<boolean>(
    existing?.endsAtRetirement ?? defaultEndsAtRetirement(category),
  );
  const [endDate, setEndDate] = useState<string>(
    existing?.endDate
      ? new Date(existing.endDate).toISOString().slice(0, 10)
      : "",
  );
  // Per-expense REAL-EXCESS inflation override (annual real-terms
  // rate ABOVE CPI). 0 = "tracks CPI, flat in real terms" — the
  // default for everyday expenses. Healthcare defaults to 0.02
  // (2% real above CPI long-run BLS). null = use category default.
  const [excessInflationOverride, setExcessInflationOverride] = useState<
    number | null
  >(existing?.excessInflationOverride ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When switching category for a NEW item, refresh the
  // endsAtRetirement default (savings → true; others → false). Don't
  // override when editing an existing item — respect the user's prior
  // choice. In-render adjustment so we don't bounce through useEffect.
  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    if (!existing) {
      setEndsAtRetirement(defaultEndsAtRetirement(category));
    }
  }

  const tone = CATEGORY_TONES[category];
  const presets = useMemo(() => SUBCATEGORY_PRESETS[category], [category]);

  const canSave = name.trim().length > 0 && amount > 0 && ownerId.length > 0;

  const submit = () => {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      ownerId,
      category,
      subcategory: subcategory.trim() || undefined,
      // Always store the per-month equivalent so rollups stay simple.
      monthlyUSD: amount / monthsPerCycle,
      type,
      endsAtRetirement,
      endDate: endDate ? new Date(endDate).getTime() : null,
      isSubscription,
      billingCycle: isSubscription ? billingCycle : undefined,
      startDate:
        isSubscription && startDate
          ? new Date(startDate).getTime()
          : null,
      excessInflationOverride,
    } as const;
    if (editingId) updateBudgetItem(editingId, payload);
    else addBudgetItem(payload);
    onClose();
  };

  const onDelete = () => {
    if (!editingId) return;
    if (!confirm(`Delete "${name.trim() || "this expense"}"?`)) return;
    removeBudgetItem(editingId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Add budget item"
    >
      {/* Decorative backdrop — no click-to-close to prevent
          accidental data loss on in-progress edits. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                {editingId ? "Edit expense" : "New expense"}
              </div>
              <div className="text-xl font-semibold text-text">
                {editingId ? name || "Expense" : "Add an expense"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4 rounded-md border border-border-strong bg-bg-elevated p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-text-dim">
                {isSubscription
                  ? `${BILLING_CYCLE_LABELS[billingCycle]} amount`
                  : "Monthly amount"}
              </div>
              {isSubscription && (
                <select
                  value={billingCycle}
                  onChange={(e) =>
                    setBillingCycle(e.target.value as BillingCycle)
                  }
                  className="rounded-md border border-border-strong bg-bg-surface px-2 py-0.5 text-[10px] text-text-muted outline-none focus:border-accent"
                  aria-label="Billing cycle"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl text-text-muted">$</span>
              <NumberField
                value={amount}
                onChange={setAmount}
                precision={2}
                allowNegative={false}
                className="num w-full bg-transparent text-3xl font-semibold text-text outline-none"
              />
              <span className="text-sm text-text-muted">
                /
                {billingCycle === "monthly"
                  ? "mo"
                  : billingCycle === "quarterly"
                    ? "qtr"
                    : "yr"}
              </span>
            </div>
            {isSubscription && billingCycle !== "monthly" && (
              <div className="num mt-1 text-[10px] text-text-dim">
                = {formatUSD(monthlyEquivalent)} / month equivalent for budget
                math
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rent, Internet, Groceries"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
            </Field>

            <Field label="Category">
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_ORDER.map((c) => {
                  const t = CATEGORY_TONES[c];
                  const active = category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium ${
                        active
                          ? `border-text-muted ${t.tint} ${t.text}`
                          : "border-border bg-bg-elevated text-text-muted hover:text-text"
                      }`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${t.dot}`}
                      />
                      <span className="truncate">{CATEGORY_LABELS[c]}</span>
                    </button>
                  );
                })}
              </div>
            </Field>

            {members.length > 1 && (
              <Field label="Attributed to">
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
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

            <Field label="Subcategory (optional)">
              <input
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="Custom or pick a preset below"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setSubcategory(p);
                      if (!name.trim()) setName(p);
                    }}
                    className={`rounded-md border px-2 py-1 text-[10px] active:opacity-70 ${
                      subcategory === p
                        ? `border-text-muted ${tone.tint} ${tone.text}`
                        : "border-border bg-bg-elevated text-text-muted hover:text-text"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Lifestyle flex">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      type: "variable" as ExpenseType,
                      label: "Variable",
                      hint: "Can cut back if needed",
                    },
                    {
                      type: "fixed" as ExpenseType,
                      label: "Fixed",
                      hint: "Essential to lifestyle",
                    },
                  ]
                ).map((opt) => {
                  const active = type === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setType(opt.type)}
                      className={`rounded-md border px-3 py-2 text-left ${
                        active
                          ? "border-accent/40 bg-accent/10"
                          : "border-border bg-bg-elevated"
                      }`}
                    >
                      <div
                        className={`text-[12px] font-semibold uppercase tracking-wider ${
                          active ? "text-accent" : "text-text"
                        }`}
                      >
                        {opt.label}
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] leading-snug ${
                          active ? "text-accent/80" : "text-text-dim"
                        }`}
                      >
                        {opt.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 px-0.5 text-[10px] leading-snug text-text-dim">
                Variable expenses can be cut back in a downturn or in
                retirement (used by the Independence-corpus haircut on the budget
                summary). Fixed expenses keep their full weight either way.
              </div>
            </Field>

            <label className="flex items-center justify-between rounded-md border border-border-strong bg-bg-elevated px-3 py-2.5 text-sm">
              <span className="flex-1 pr-3">
                <span className="block text-text">This is a subscription</span>
                <span className="block text-[10px] text-text-dim">
                  Surfaces in the Subscriptions view with next billing date
                  and per-cycle amount.
                </span>
              </span>
              <input
                type="checkbox"
                checked={isSubscription}
                onChange={(e) => setIsSubscription(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
            </label>

            {isSubscription && (
              <Field label="First billing date">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
                />
                <div className="mt-1 text-[10px] text-text-dim">
                  Anchors the next-billing date. Defaults to today when
                  empty.
                </div>
              </Field>
            )}

            <Field label="End date (optional)">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
              <div className="mt-1 text-[10px] text-text-dim">
                When this expense stops — e.g. car loan payoff, daycare end,
                subscription canceled.
              </div>
            </Field>

            <label className="flex items-center justify-between rounded-md border border-border-strong bg-bg-elevated px-3 py-2.5 text-sm">
              <span className="flex-1 pr-3">
                <span className="block text-text">Ends at retirement</span>
                <span className="block text-[10px] text-text-dim">
                  Excludes this item from the retirement-spend rollup that
                  drives your independence corpus suggestion.
                </span>
              </span>
              <input
                type="checkbox"
                checked={endsAtRetirement}
                onChange={(e) => setEndsAtRetirement(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
            </label>

            <ExcessInflationField
              category={category}
              value={excessInflationOverride}
              onChange={setExcessInflationOverride}
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="mt-5 w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
          >
            {editingId ? "Save changes" : "Add expense"}
          </button>

          {editingId && (
            <button
              type="button"
              onClick={onDelete}
              className="mt-2 w-full rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-[11px] font-medium text-negative active:opacity-70"
            >
              Delete expense
            </button>
          )}
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
      <span className="mb-1 block px-0.5 text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Per-expense REAL-EXCESS inflation override. UX:
 *
 *   - Slider runs −2% to +8% real, 0.25% steps. 0% sits prominently
 *     in the middle as the labeled "tracks CPI" anchor.
 *   - "Auto" chip when on category default; "Reset" pill clears
 *     an explicit override.
 *   - Help copy explains: 0% = flat in real terms (everyday
 *     expenses); +2% = healthcare's long-run real excess; positive
 *     drags the independence corpus larger; negative slightly relieves it.
 *
 * The whole app runs in real terms, so this field is in real terms
 * too — no nominal/CPI translation for the user to do in their
 * head. Math:
 *   contribution_to_corpus = annual_spend / (swr - real_excess)
 */
function ExcessInflationField({
  category,
  value,
  onChange,
}: {
  category: ExpenseCategory;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const categoryDefault = CATEGORY_DEFAULT_EXCESS_INFLATION[category];
  const effective = value ?? categoryDefault;
  const isOverridden = value != null;
  // Slider works in 0.25%-per-step integer space (×400). Range
  // covers -2% to +8% real excess.
  const sliderInt = Math.round(effective * 400);

  const fmt = (v: number) => {
    const pct = (v * 100).toFixed(1);
    if (v === 0) return "0% (tracks CPI)";
    return `${v > 0 ? "+" : ""}${pct}% real`;
  };

  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2.5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-text">Real-excess inflation</span>
        <span className="flex items-center gap-2">
          <span className="num text-sm font-semibold text-text">
            {fmt(effective)}
          </span>
          {!isOverridden ? (
            <span className="rounded-full border border-border-strong bg-bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
              Auto
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-full border border-border-strong bg-bg-surface px-2 py-0.5 text-[10px] font-medium text-text-muted active:opacity-70 hover:text-text"
            >
              Reset
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={-8}
        max={32}
        step={1}
        value={sliderInt}
        onChange={(e) => onChange(Number(e.target.value) / 400)}
        className="mt-2 w-full accent-accent"
        aria-label="Real-excess inflation rate"
      />
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-text-dim">
        <span>-2%</span>
        <span>0% (CPI)</span>
        <span>+8%</span>
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-text-dim">
        {isOverridden
          ? `Custom. Default for ${category} is ${fmt(categoryDefault)}.`
          : effective === 0
            ? `Default for ${category}. Flat in real terms — the Trinity/SWR math handles this line as-is.`
            : effective > 0
              ? `Default for ${category}. Outpaces CPI by ${(effective * 100).toFixed(1)}%/yr in real terms — drags the independence corpus larger.`
              : `Default for ${category}. Trails CPI by ${Math.abs(effective * 100).toFixed(1)}%/yr in real terms — slightly relieves the independence corpus.`}
      </div>
    </div>
  );
}
