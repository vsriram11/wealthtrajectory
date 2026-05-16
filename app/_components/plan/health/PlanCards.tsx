"use client";

/**
 * Card components for individual health plans, used by the per-
 * member health view. Two shapes:
 *
 *   - {@link SubscribedPlanCard} — the member owns this plan (they
 *     pay the premium). Editable, "Add to Budget"-able, and
 *     scored against the member's importance weights.
 *
 *   - {@link DependentPlanCard} — the member is covered as a
 *     dependent on someone else's plan. Read-only, with a note
 *     that the premium is attributed to the subscriber.
 */

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { formatUSD } from "@/lib/format";
import {
  scorePlan,
  type HealthImportanceWeights,
  type HealthPlan,
} from "@/lib/health/healthPlans";
import type { Household } from "@/lib/types";
import { PlanEditor } from "./PlanEditor";

const BUDGET_MSG_TIMEOUT_MS = 3500;

export function SubscribedPlanCard({
  plan,
  weights,
  household,
}: {
  plan: HealthPlan;
  weights: HealthImportanceWeights;
  household: Household;
}) {
  const updateHealthPlan = useAppStore((s) => s.updateHealthPlan);
  const removeHealthPlan = useAppStore((s) => s.removeHealthPlan);
  const addPlanToBudget = useAppStore((s) => s.addPlanToBudget);
  const [editing, setEditing] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);

  const score = useMemo(() => scorePlan(plan, weights), [plan, weights]);
  const scoreLabel = score == null ? "—" : `${score.toFixed(0)} / 100`;

  const pushToBudget = () => {
    const newItemId = addPlanToBudget(plan.id);
    setBudgetMsg(
      newItemId
        ? "Added to Budget → Healthcare → Health insurance."
        : "Couldn't add — plan missing.",
    );
    setTimeout(() => setBudgetMsg(null), BUDGET_MSG_TIMEOUT_MS);
  };

  return (
    <li className="rounded-2xl border border-border bg-bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">
            {plan.name}
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            {plan.category.replace(/_/g, " ")}
            {plan.coveredMemberIds.length > 1 && (
              <>
                {" · covers "}
                {plan.coveredMemberIds
                  .map(
                    (id) =>
                      household.members.find((m) => m.id === id)?.displayName ??
                      "—",
                  )
                  .join(", ")}
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-sm font-semibold text-text">
            {formatUSD(plan.monthlyPremiumUSD)}
          </div>
          <div className="text-[10px] text-text-dim">/mo</div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-text-dim">
        <Stat label="Score" value={scoreLabel} />
        <Stat label="Deductible" value={formatUSD(plan.annualDeductibleUSD)} />
        <Stat
          label="OOP max"
          value={formatUSD(plan.annualOutOfPocketMaxUSD)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={pushToBudget}
          className="rounded-md bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent active:opacity-70"
        >
          Add to Budget
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-[11px] text-text-muted active:opacity-70 hover:text-text"
        >
          {editing ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          onClick={() => removeHealthPlan(plan.id)}
          className="rounded-md border border-negative/30 bg-bg-elevated px-3 py-1.5 text-[11px] text-negative active:opacity-70"
        >
          Remove
        </button>
      </div>

      {budgetMsg && (
        <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[10px] text-accent">
          {budgetMsg}
        </div>
      )}

      {editing && (
        <PlanEditor
          plan={plan}
          household={household}
          onChange={(patch) => updateHealthPlan(plan.id, patch)}
        />
      )}
    </li>
  );
}

export function DependentPlanCard({
  plan,
  ownerName,
}: {
  plan: HealthPlan;
  ownerName: string;
}) {
  return (
    <li className="rounded-2xl border border-border bg-bg-elevated p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">
            {plan.name}
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Subscriber: {ownerName} · {plan.category.replace(/_/g, " ")}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-sm text-text-muted">
            {formatUSD(plan.monthlyPremiumUSD)}
          </div>
          <div className="text-[10px] text-text-dim">/mo</div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-text-dim">
        Counted under {ownerName} — not added to your total.
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="num mt-0.5 text-[11px] font-medium text-text">
        {value}
      </div>
    </div>
  );
}
