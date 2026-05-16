"use client";

/**
 * Inline form for adding a new health plan to a member, seeded
 * from a `HealthPlanTemplate` (typical employer PPO, ACA Silver,
 * Medicare, self-employed market, …).
 *
 * Two-step flow: pick a template, optionally toggle "covers
 * everyone in the household" (switches to family premium), then
 * Add — the new plan is instantiated and added to the store.
 * Dollar amounts can be edited in-place afterwards via
 * SubscribedPlanCard's Edit affordance.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { formatUSD } from "@/lib/format";
import {
  HEALTH_PLAN_TEMPLATES,
  instantiateTemplate,
  type HealthPlanTemplate,
} from "@/lib/health/healthPlanTemplates";

export function AddPlanFromTemplate({
  memberId,
  householdMemberIds,
  onClose,
}: {
  memberId: string;
  householdMemberIds: string[];
  onClose: () => void;
}) {
  const addHealthPlan = useAppStore((s) => s.addHealthPlan);
  const [picked, setPicked] = useState<HealthPlanTemplate | null>(null);
  const [coversFamily, setCoversFamily] = useState(false);

  const submit = () => {
    if (!picked) return;
    const coveredMemberIds = coversFamily ? householdMemberIds : [memberId];
    const draft = instantiateTemplate(picked, memberId, coveredMemberIds, {
      isFamily: coversFamily,
    });
    addHealthPlan(draft);
    onClose();
  };

  return (
    <div className="mt-3 rounded-2xl border border-border bg-bg-elevated p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">
        Pick a template
      </div>
      <div className="mt-0.5 text-[11px] text-text-dim">
        Templates carry typical parameters from public benchmarks. Edit
        the dollar amounts after adding to match your actual plan.
      </div>

      <div className="mt-3 space-y-1.5">
        {HEALTH_PLAN_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => setPicked(template)}
            className={`w-full rounded-lg border px-3 py-2 text-left text-[12px] active:opacity-70 ${
              picked?.id === template.id
                ? "border-accent/50 bg-accent/10 text-text"
                : "border-border-strong bg-bg-surface text-text-muted"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-text">{template.name}</span>
              <span className="num text-[10px] text-text-dim">
                {formatUSD(template.defaultMonthlyPremiumUSD)}/mo
              </span>
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-text-dim">
              {template.description}
            </div>
          </button>
        ))}
      </div>

      {picked && (
        <>
          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300">
            {picked.caveat}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
            <input
              type="checkbox"
              checked={coversFamily}
              onChange={(e) => setCoversFamily(e.target.checked)}
              className="accent-accent"
            />
            Covers everyone in my household (use family premium)
          </label>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!picked}
          onClick={submit}
          className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
        >
          Add plan
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm font-medium text-text-muted active:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
