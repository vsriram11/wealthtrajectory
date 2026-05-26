"use client";

import { useState } from "react";
import { ContributionMix } from "@/app/_components/projection/ContributionMix";
import { DoublingTimeCard } from "@/app/_components/projection/DoublingTimeCard";
import { GrowthVelocityCard } from "@/app/_components/projection/GrowthVelocityCard";
import { HistoricalMonteCarloCard } from "@/app/_components/projection/HistoricalMonteCarloCard";
import { NominalEquivalentCard } from "@/app/_components/projection/NominalEquivalentCard";
import { ProGate } from "@/app/_components/ui/ProGate";
import { ScenarioComparisonChart } from "@/app/_components/projection/ScenarioComparisonChart";
import { ScenariosPanel } from "@/app/_components/projection/ScenariosPanel";
import { SectionHeader } from "@/app/_components/ui/SectionHeader";
import { SensitivityCard } from "@/app/_components/projection/SensitivityCard";
import { StressTestCard } from "@/app/_components/projection/StressTestCard";
import { WhatIfSavingsCard } from "@/app/_components/projection/WhatIfSavingsCard";

type ProjectionsSubTab =
  | "stress"
  | "scenarios"
  | "outlook"
  | "levers";

// Tab order chosen to land the user on the most decision-grade
// surface first:
//   1. Stress   — the "is my plan robust?" question (the most
//                 frequently-asked, most-impactful question on this
//                 page; deserves first read).
//   2. Scenarios — compare alternate plans side by side; the
//                  natural next step after seeing baseline stress.
//   3. Outlook   — future-dollar framing + trailing reality checks.
//   4. Levers    — interactive what-if controls (savings slider,
//                  sensitivity); used less often, lives last.
const SUB_TABS: { id: ProjectionsSubTab; label: string }[] = [
  { id: "stress", label: "Stress" },
  { id: "scenarios", label: "Scenarios" },
  { id: "outlook", label: "Outlook" },
  { id: "levers", label: "Levers" },
];

/**
 * Projections page with 4 sub-tabs, each a single mental model:
 *
 *   1. Outlook    — what does my future look like, and what got me there?
 *                   Future-dollar equivalent (the "$2M target — is that
 *                   actually enough?" question), trailing reality checks
 *                   (doubling time + growth velocity), and the
 *                   contribution-vs-growth split so users can see what
 *                   share of Independence NW comes from saving vs market returns.
 *
 *   2. Stress     — how robust is the plan?
 *                   Sequence-of-returns risk FIRST (the long-horizon
 *                   tail-risk lens — replays every historical 30-year
 *                   window), then single-shock tests (the short-horizon
 *                   "what if next year is 2008" lens). Reordering puts
 *                   the more sophisticated answer above the simpler one
 *                   so users don't anchor on the latter.
 *
 *   3. Levers     — what can I change to accelerate?
 *                   What-if savings slider, assumption sensitivity.
 *
 *   4. Scenarios  — compare alternate plans side by side.
 *
 * Future-composition (allocation drift) was moved to the Allocation
 * page — it answers "what does my portfolio look like" rather than
 * "what's my plan timeline." The Composition tab is gone; its two
 * cards now live on their respective semantic homes.
 */
export function ProjectionsPage() {
  // Default to "stress" since it's now first in SUB_TABS and the
  // most decision-grade landing surface (matches the array order).
  const [tab, setTab] = useState<ProjectionsSubTab>("stress");

  return (
    <>
      <section className="px-5 pt-3">
        <div
          role="tablist"
          aria-label="Projections sub-navigation"
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

      {tab === "outlook" && <OutlookView />}
      {tab === "stress" && <StressView />}
      {tab === "levers" && <LeversView />}
      {tab === "scenarios" && <ScenariosView />}
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

/**
 * Outlook — the headline projection plus "what got me there"
 * accounting. NominalEquivalentCard goes FIRST per user feedback:
 * "future dollar equivalent should be the first thing seen on
 * Projections" — it's the highest-leverage question (does my $X
 * target feel like enough in the future?), and once answered, the
 * user has a frame for everything below. ContributionMix now lives
 * here too: it splits the Independence-day NW into starting principal vs
 * contributions vs market growth, which is squarely an "outlook"
 * question ("where does my money come from") rather than a
 * "composition" question. Composition tab was removed in favor of
 * routing each card to its semantic home.
 */
function OutlookView() {
  return (
    <>
      <SectionHeader
        label="Future-dollar outlook"
        sub="What your real-dollar plan looks like in sticker-price terms"
      />
      <NominalEquivalentCard />

      <SectionHeader
        label="Trailing reality check"
        sub="What's actually happened, vs what your plan assumes"
      />
      <DoublingTimeCard />
      <GrowthVelocityCard />

      <SectionHeader
        label="Where the money came from"
        sub="Starting principal vs cumulative contributions vs market growth"
      />
      <ProGate
        title="Contribution vs growth breakdown"
        description="Split your Independence-day net worth into starting principal, cumulative contributions, and market growth — so you see what's actually doing the work."
      >
        <ContributionMix />
      </ProGate>
    </>
  );
}

/**
 * Stress — risk + downside. Both cards explore "how bad could it
 * get," but at different time scales:
 *   - Sequence-of-returns Monte Carlo replays full 30-year
 *     retirement windows against actual historical sequences. It's
 *     the long-horizon tail-risk lens and the one most aligned
 *     with retirement-survival research.
 *   - Single-shock test is a snapshot "what if next year is 2008,"
 *     useful for orienting the user but less informative for
 *     long-horizon planning.
 * MC goes FIRST so users anchor on the sophisticated answer; the
 * single-shock is a quick-glance sanity check below it.
 */
function StressView() {
  return (
    <>
      <SectionHeader
        label="Sequence-of-returns risk"
        sub="Replay actual historical 30-year retirement windows"
      />
      <ProGate
        title="Historical Monte Carlo"
        description="Replay every historical 30-year retirement window (1928–2025) against your portfolio + spend plan. Reports success rate, worst-case starting year (Great Depression / stagflation / GFC), and percentile-band trajectory. Includes a block-bootstrap mode for wider distributions."
        bullets={[
          "Tests sequence-of-returns risk, not just averages",
          "Real-terms, today's dollars",
          "Uses your current allocation, not a generic 60/40",
        ]}
      >
        <HistoricalMonteCarloCard />
      </ProGate>

      <SectionHeader
        label="Single-shock snapshot"
        sub="What if every asset class drops the same amount on the same day"
      />
      <StressTestCard />
    </>
  );
}

/**
 * Levers — what the user can pull. Both cards are "play with the
 * inputs" surfaces; grouped because the workflow is interactive
 * (try a value, see the impact).
 */
function LeversView() {
  return (
    <>
      <SectionHeader
        label="What-if your savings"
        sub="Drag the slider to see exactly how an extra $X / month accelerates Independence"
      />
      <ProGate
        title="What if you saved more?"
        description="Interactive slider — see exactly how an extra $X / month accelerates your Independence date. Honors per-member assumptions and active scenarios."
        bullets={[
          "5 quick-pick increments + baseline",
          "Reactive new-Independence-date display",
          "Per-account proportional split",
        ]}
      >
        <WhatIfSavingsCard />
      </ProGate>

      <SectionHeader
        label="Assumption sensitivity"
        sub="How much does the plan move on ±2 pts of CAGR or 0.5×–2× savings?"
      />
      <ProGate
        title="Assumption sensitivity"
        description="How robust is your Independence date to the underlying assumptions? See the impact of ±2 pts of CAGR and 0.5×–2× savings rate at a glance."
        bullets={[
          "Real-CAGR sensitivity strip",
          "Savings-rate sensitivity strip",
          "Months-saved / months-cost deltas",
        ]}
      >
        <SensitivityCard />
      </ProGate>
    </>
  );
}

/**
 * Scenarios — saved alternate plans. The scenario engine itself
 * (build/edit) lives here, plus the side-by-side comparison
 * chart.
 */
function ScenariosView() {
  return (
    <>
      <SectionHeader
        label="Saved scenarios"
        sub="Side-by-side what-ifs you can flip between"
      />
      <ProGate
        title="Scenario engine"
        description="Compare what-if plans side by side. Per-account contribution overrides and per-holding CAGR overrides; pick a scenario from the chip row on Home to view your projection through that lens."
        bullets={[
          "Per-account contribution multipliers",
          "Per-holding CAGR overrides",
          "Side-by-side time-to-Independence deltas",
        ]}
      >
        <ScenariosPanel />
        <ScenarioComparisonChart />
      </ProGate>
    </>
  );
}
