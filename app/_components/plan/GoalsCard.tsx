"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  GOAL_CATEGORY_LABELS,
  computeGoalProgress,
  type Goal,
} from "@/lib/insights/goals";
import { NumberField } from "@/app/_components/ui/NumberField";
import { formatUSD } from "@/lib/format";
import { parseISODate } from "@/lib/dateInput";

/**
 * Multi-goal tracker for non-Independence goals — house down payment, kid's
 * college, sabbatical, wedding, etc. The Independence projection is the
 * headline; this is the second-order layer ("besides retiring, what
 * else am I saving for?") that most users have in their heads but
 * never write down. Each goal carries a target, optional target date,
 * current allocation, and optional monthly contribution.
 *
 * Editing is inline (tap a goal to expand). New goals come in via a
 * compact form at the bottom — kept on-page rather than a sheet
 * because users typically batch-add multiple goals on first use.
 */
export function GoalsCard() {
  const goals = useAppStore((s) => s.goals);
  const addGoal = useAppStore((s) => s.addGoal);

  const [showForm, setShowForm] = useState(false);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">Goals</div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Track non-Independence goals separately — house down payment, education,
              wedding, sabbatical.
            </div>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="shrink-0 rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              + Add
            </button>
          )}
        </div>

        {goals.length > 0 && (
          <ul className="mt-3 space-y-2">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </ul>
        )}

        {goals.length === 0 && !showForm && (
          <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-3 text-[11px] text-text-dim">
            No goals yet. Add your first below.
          </div>
        )}

        {showForm && (
          <NewGoalForm
            onCancel={() => setShowForm(false)}
            onSave={(input) => {
              addGoal(input);
              setShowForm(false);
            }}
          />
        )}
      </div>
    </section>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  const updateGoal = useAppStore((s) => s.updateGoal);
  const removeGoal = useAppStore((s) => s.removeGoal);
  const [expanded, setExpanded] = useState(false);

  const progress = computeGoalProgress(goal);
  const pct = Math.round(progress.fractionComplete * 100);

  const targetDateStr =
    goal.targetDate != null
      ? new Date(goal.targetDate).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
        })
      : null;

  return (
    <li className="rounded-md border border-border-strong bg-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="block w-full px-3 py-2 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium text-text">
                {goal.name}
              </span>
              <span className="shrink-0 rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-dim">
                {GOAL_CATEGORY_LABELS[goal.category]}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              <span className="num text-text-muted">
                {formatUSD(goal.currentUSD)}
              </span>
              <span> of </span>
              <span className="num text-text-muted">
                {formatUSD(goal.targetUSD)}
              </span>
              {targetDateStr && <span> · by {targetDateStr}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-sm font-semibold text-text">{pct}%</div>
            {progress.monthsToTarget != null &&
              progress.monthsToTarget > 0 &&
              goal.targetDate != null && (
                <div
                  className={`text-[10px] ${progress.onPace ? "text-positive" : "text-negative"}`}
                >
                  {progress.onPace ? "On pace" : "Behind"}
                </div>
              )}
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-surface">
          <div
            className={`h-full ${progress.fractionComplete >= 1 ? "bg-positive" : "bg-accent"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        {progress.monthsToTarget != null && progress.monthsToTarget > 0 && (
          <div className="mt-1 text-[10px] text-text-dim">
            {progress.monthsToTarget < 12
              ? `${progress.monthsToTarget} mo at current pace`
              : `${(progress.monthsToTarget / 12).toFixed(1)} yr at current pace`}
            {goal.monthlyContributionUSD > 0 && (
              <>
                {" · "}
                <span className="num">
                  {formatUSD(goal.monthlyContributionUSD)}
                </span>
                /mo
              </>
            )}
          </div>
        )}
        {progress.monthsToTarget == null &&
          goal.monthlyContributionUSD === 0 &&
          progress.remainingUSD > 0 && (
            <div className="mt-1 text-[10px] text-text-dim">
              Add a monthly contribution to project completion.
            </div>
          )}
      </button>

      {expanded && (
        <GoalEditPanel
          goal={goal}
          onChange={(patch) => updateGoal(goal.id, patch)}
          onDelete={() => {
            if (confirm(`Delete goal "${goal.name}"?`)) {
              removeGoal(goal.id);
            }
          }}
        />
      )}
    </li>
  );
}

function GoalEditPanel({
  goal,
  onChange,
  onDelete,
}: {
  goal: Goal;
  onChange: (patch: Partial<Goal>) => void;
  onDelete: () => void;
}) {
  const dateStr =
    goal.targetDate != null
      ? new Date(goal.targetDate).toISOString().slice(0, 10)
      : "";

  return (
    <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
      <Field label="Name">
        <input
          type="text"
          value={goal.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </Field>
      <Field label="Category">
        <select
          value={goal.category}
          onChange={(e) =>
            onChange({ category: e.target.value as Goal["category"] })
          }
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        >
          {(
            Object.keys(GOAL_CATEGORY_LABELS) as Array<Goal["category"]>
          ).map((c) => (
            <option key={c} value={c}>
              {GOAL_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={goal.targetUSD}
            onChange={(v) => onChange({ targetUSD: v })}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Saved so far">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={goal.currentUSD}
            onChange={(v) => onChange({ currentUSD: v })}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Monthly contribution (optional)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={goal.monthlyContributionUSD}
            onChange={(v) => onChange({ monthlyContributionUSD: v })}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Target date (optional)">
        <input
          type="date"
          value={dateStr}
          onChange={(e) =>
            onChange({
              // Use parseISODate (noon-UTC anchor + round-trip
              // validation) — protects against silent
              // normalization of invalid dates (2024-02-31 → Mar 2)
              // and TZ drift on save→reload round-trips. Audit
              // round-4 WARN.
              targetDate: e.target.value
                ? (parseISODate(e.target.value) ?? null)
                : null,
            })
          }
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </Field>
      <button
        type="button"
        onClick={onDelete}
        className="w-full rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-[11px] font-medium text-negative active:opacity-70"
      >
        Delete goal
      </button>
    </div>
  );
}

function NewGoalForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (g: Omit<Goal, "id" | "createdAt">) => void;
}) {
  const [name, setName] = useState("");
  const [targetUSD, setTargetUSD] = useState<number>(0);
  const [currentUSD, setCurrentUSD] = useState<number>(0);
  const [monthly, setMonthly] = useState<number>(0);
  const [category, setCategory] = useState<Goal["category"]>("house");
  const [dateStr, setDateStr] = useState<string>("");

  const canSave = name.trim().length > 0 && targetUSD > 0;

  const QUICK_NAMES: Array<{ name: string; category: Goal["category"] }> = [
    { name: "House down payment", category: "house" },
    { name: "Kid's college", category: "education" },
    { name: "Wedding", category: "wedding" },
    { name: "Sabbatical", category: "travel" },
    { name: "New car", category: "vehicle" },
    { name: "Emergency fund", category: "emergency_fund" },
  ];

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border-strong bg-bg-elevated p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-text-dim">
          New goal
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-text-dim active:opacity-70"
        >
          Cancel
        </button>
      </div>
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. House down payment"
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {QUICK_NAMES.map((q) => (
            <button
              key={q.name}
              type="button"
              onClick={() => {
                setName(q.name);
                setCategory(q.category);
              }}
              className="rounded-md border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-muted active:opacity-70 hover:text-text"
            >
              {q.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Goal["category"])}
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        >
          {(
            Object.keys(GOAL_CATEGORY_LABELS) as Array<Goal["category"]>
          ).map((c) => (
            <option key={c} value={c}>
              {GOAL_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={targetUSD}
            onChange={setTargetUSD}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Saved so far (optional)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={currentUSD}
            onChange={setCurrentUSD}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Monthly contribution (optional)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={monthly}
            onChange={setMonthly}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </Field>
      <Field label="Target date (optional)">
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </Field>
      <button
        type="button"
        disabled={!canSave}
        onClick={() =>
          onSave({
            name: name.trim(),
            targetUSD,
            currentUSD,
            monthlyContributionUSD: monthly,
            category,
            targetDate: dateStr ? (parseISODate(dateStr) ?? null) : null,
          })
        }
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
      >
        Add goal
      </button>
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
