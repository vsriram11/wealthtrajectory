"use client";

import { useState } from "react";
import { AssetLocationCard } from "@/app/_components/allocation/AssetLocationCard";
import { AssumptionsPanel } from "@/app/_components/plan/AssumptionsPanel";
import { BudgetPanel } from "@/app/_components/plan/BudgetPanel";
import { ConcentrationRiskCard } from "@/app/_components/allocation/ConcentrationRiskCard";
import { DrawdownPhasesCard } from "@/app/_components/projection/DrawdownPhasesCard";
import { FeeDragCard } from "@/app/_components/allocation/FeeDragCard";
import { HealthPanel } from "@/app/_components/plan/HealthPanel";
import { IncomePanel } from "@/app/_components/plan/IncomePanel";
import { NWPercentileCard } from "@/app/_components/insights/NWPercentileCard";
import { ProGate } from "@/app/_components/ui/ProGate";
import { RothLadderCard } from "@/app/_components/plan/RothLadderCard";
import { SectionHeader } from "@/app/_components/ui/SectionHeader";
import { WithdrawalSequenceCard } from "@/app/_components/plan/WithdrawalSequenceCard";

type PlanSubTab =
  | "assumptions"
  | "budget"
  | "income"
  | "health"
  | "tax"
  | "audit";

const SUB_TABS: { id: PlanSubTab; label: string }[] = [
  { id: "assumptions", label: "Assumptions" },
  { id: "budget", label: "Budget" },
  // Sits between Budget (money out) and Health (insurance) so the
  // sub-tab order mirrors the planning workflow: targets → costs
  // → income that offsets those costs → coverage → optimization
  // → audit.
  { id: "income", label: "Income" },
  { id: "health", label: "Health" },
  { id: "tax", label: "Tax" },
  { id: "audit", label: "Audit" },
];

/**
 * Plan page with SIX sub-tabs, each backed by a single mental
 * model:
 *
 *   1. Assumptions — Independence target, withdrawal rate, drawdown
 *                    phases, variable haircut (with optional
 *                    down-year-only conditional mode).
 *                    "What does retirement look like for me?"
 *   2. Budget      — monthly expense ledger, emergency-fund runway,
 *                    suggested independence corpus, one-tap
 *                    apply-to-target.
 *                    "What will it cost?"
 *   3. Income      — future-income streams (consulting, pension,
 *                    Social Security, rental) with year-based
 *                    start/end + real-growth-rate per stream.
 *                    "What's already flowing in?"
 *   4. Health      — insurance plans + per-member importance
 *                    weights.
 *                    "What does coverage cost?"
 *   5. Tax         — fee drag, asset location, drawdown sequencer,
 *                    Roth conversion ladder.
 *                    "How do I optimize?"
 *   6. Audit       — concentration-risk + NW-percentile checks.
 *                    "Where do I stand & what could go wrong?"
 *
 * Sub-tab state is local — refreshing or navigating away resets
 * to Assumptions. No prop drilling; the per-view sub-components
 * read from the store directly.
 *
 * The four-tab decision (vs the prior two-tab Strategy/Budget):
 *   - Strategy was getting heavy (4 sub-sections, 9 cards). After
 *     emergency-fund migrated into Budget (where it's derived from
 *     the budget total), Tax + Audit each had enough cards to
 *     warrant their own surface.
 *   - Each tab now caps at 2-4 cards — manageable density, no
 *     wall-of-scroll.
 *   - Tab order follows planning workflow: set assumptions → measure
 *     cost → optimize → audit.
 */
export function PlanPage() {
  const [tab, setTab] = useState<PlanSubTab>("assumptions");

  return (
    <>
      <section className="px-5 pt-3">
        {/* Horizontally scrollable on narrow viewports: with 5 tabs
            and "Assumptions" being the longest label, the row would
            otherwise truncate or wrap on a 375px phone. overflow-x-auto
            + no-scrollbar + shrink-0 buttons let it slide cleanly
            without an ugly scrollbar visible. */}
        <div
          role="tablist"
          aria-label="Plan sub-navigation"
          className="no-scrollbar flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-surface p-1"
        >
          {SUB_TABS.map((t) => (
            <SubTab
              key={t.id}
              label={t.label}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
            />
          ))}
        </div>
      </section>

      {tab === "assumptions" && <AssumptionsView />}
      {tab === "budget" && <BudgetPanel />}
      {tab === "income" && <IncomePanel />}
      {tab === "health" && <HealthPanel />}
      {tab === "tax" && <TaxView />}
      {tab === "audit" && <AuditView />}
    </>
  );
}

function SubTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      // `shrink-0` instead of `flex-1` — tabs keep their natural width
      // so the longest label ("Assumptions") doesn't squeeze the short
      // ones to be unreadable. Overflow goes horizontal via the parent.
      className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition active:opacity-70 ${
        active
          ? "bg-accent text-bg"
          : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function AssumptionsView() {
  return (
    <>
      <SectionHeader
        label="Independence target"
        sub="What you're aiming at and how you draw down"
      />
      <AssumptionsPanel />
      <DrawdownPhasesCard />
    </>
  );
}

function TaxView() {
  return (
    <>
      <SectionHeader
        label="Drawdown & conversion strategy"
        sub="How to draw and convert in retirement"
      />
      <ProGate
        title="Drawdown sequence"
        description="Which accounts to draw from first in retirement — taxable → pre-tax → Roth → HSA. Per-bucket runway in months of planned spend."
        bullets={[
          "Bogleheads-consensus default order",
          "Per-bucket months-of-runway calc",
          "Aggregates pre-tax across 401k + Trad IRA",
        ]}
      >
        <WithdrawalSequenceCard />
      </ProGate>
      <ProGate
        title="Roth conversion ladder"
        description="Convert pre-tax dollars into Roth during the post-Independence / pre-RMD window when your marginal bracket is at its lowest. Estimates years-to-ladder, conversion tax, and lifetime savings vs straight drawdown."
        bullets={[
          "Auto-fills the 12% federal bracket",
          "Per-year conversion + other-income inputs",
          "Lifetime tax-savings estimate",
        ]}
      >
        <RothLadderCard />
      </ProGate>

      <SectionHeader
        label="Lower-effort wins"
        sub="One-time changes with permanent benefits"
      />
      <FeeDragCard />
      <AssetLocationCard />
    </>
  );
}

function AuditView() {
  return (
    <>
      <SectionHeader
        label="Risk checks"
        sub="What could go wrong"
      />
      <ConcentrationRiskCard />

      <SectionHeader
        label="Benchmarks"
        sub="Where you stand vs reference"
      />
      <NWPercentileCard />
    </>
  );
}
