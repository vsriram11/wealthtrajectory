"use client";

/**
 * Inline editor for a single HealthPlan. Lets the user override
 * the templated defaults (premium, deductible, OOP max, name,
 * notes, dependent coverage). Rendered beneath
 * {@link SubscribedPlanCard} when the user taps "Edit".
 */

import type { HealthPlan } from "@/lib/health/healthPlans";
import type { Household } from "@/lib/types";

export function PlanEditor({
  plan,
  household,
  onChange,
}: {
  plan: HealthPlan;
  household: Household;
  onChange: (patch: Partial<HealthPlan>) => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-bg-elevated p-3">
      <LabeledField label="Plan name">
        <input
          type="text"
          value={plan.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
        />
      </LabeledField>

      <div className="grid grid-cols-3 gap-2">
        <DollarField
          label="Premium / mo"
          value={plan.monthlyPremiumUSD}
          onChange={(v) => onChange({ monthlyPremiumUSD: v })}
        />
        <DollarField
          label="Deductible"
          value={plan.annualDeductibleUSD}
          onChange={(v) => onChange({ annualDeductibleUSD: v })}
        />
        <DollarField
          label="OOP max"
          value={plan.annualOutOfPocketMaxUSD}
          onChange={(v) => onChange({ annualOutOfPocketMaxUSD: v })}
        />
      </div>

      <CoverageSelector
        household={household}
        ownerId={plan.ownerId}
        coveredMemberIds={plan.coveredMemberIds}
        onChange={(ids) => onChange({ coveredMemberIds: ids })}
      />

      <LabeledField label="Notes">
        <textarea
          value={plan.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          placeholder="Renewal date, broker, in-network providers…"
          className="w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent"
        />
      </LabeledField>
    </div>
  );
}

function CoverageSelector({
  household,
  ownerId,
  coveredMemberIds,
  onChange,
}: {
  household: Household;
  ownerId: string;
  coveredMemberIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggleMember = (id: string) => {
    if (coveredMemberIds.includes(id)) {
      onChange(coveredMemberIds.filter((covered) => covered !== id));
    } else {
      onChange([...coveredMemberIds, id]);
    }
  };

  return (
    <LabeledField label="Covers">
      <div className="flex flex-wrap gap-1.5">
        {household.members.map((m) => {
          const isOwner = m.id === ownerId;
          const isCovered = coveredMemberIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              disabled={isOwner}
              onClick={() => {
                if (!isOwner) toggleMember(m.id);
              }}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                isCovered
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border-strong bg-bg-surface text-text-muted"
              } ${isOwner ? "opacity-80" : "active:opacity-70"}`}
            >
              {m.displayName}
              {isOwner && " (subscriber)"}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-text-dim">
        Dependents see this plan in their member view as read-only, and
        the household rollup counts the premium once.
      </div>
    </LabeledField>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function DollarField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <LabeledField label={label}>
      <div className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1.5">
        <span className="text-[11px] text-text-muted">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
          className="num w-full bg-transparent text-right text-[12px] font-medium text-text outline-none"
        />
      </div>
    </LabeledField>
  );
}
