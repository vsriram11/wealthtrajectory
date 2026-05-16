"use client";

import { useState } from "react";
import { AllocationFutureCard } from "@/app/_components/allocation/AllocationFutureCard";
import { AllocationPanel } from "@/app/_components/allocation/AllocationPanel";
import { GlidePathCard } from "@/app/_components/allocation/GlidePathCard";
import { PositionsList } from "@/app/_components/allocation/PositionsList";
import { SectionHeader } from "@/app/_components/ui/SectionHeader";
import { TargetAllocationCard } from "@/app/_components/allocation/TargetAllocationCard";

type AllocationSubTab = "summary" | "positions";

const SUB_TABS: { id: AllocationSubTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "positions", label: "Positions" },
];

/**
 * Allocation page with 2 sub-tabs:
 *
 *   1. Summary    — how the portfolio is structured today and how
 *                   it evolves to Independence day. AllocationPanel
 *                   (today's class/style/geo breakdown), then
 *                   AllocationFutureCard (drift to Independence day —
 *                   moved here from the Projections Composition
 *                   tab because it's structurally an "allocation"
 *                   question), then the Pro-gated planning tools:
 *                   target-allocation tracker + lifecycle
 *                   glide-path.
 *
 *   2. Positions  — per-holding list. Moved out of the Summary
 *                   tab because once Summary picked up the
 *                   future-composition card it grew long, and
 *                   per-holding browsing is a different mental
 *                   mode (drill-into-detail vs portfolio-view).
 *
 * Tab pattern mirrors ProjectionsPage/PlanPage exactly. Local
 * tab state — refresh resets to Summary.
 */
export function AllocationPage() {
  const [tab, setTab] = useState<AllocationSubTab>("summary");

  return (
    <>
      <section className="px-5 pt-3">
        <div
          role="tablist"
          aria-label="Allocation sub-navigation"
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

      {tab === "summary" && <SummaryView />}
      {tab === "positions" && <PositionsView />}
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

function SummaryView() {
  return (
    <>
      <AllocationPanel />

      <SectionHeader
        label="Future composition"
        sub="How your stocks/bonds/cash mix evolves to Independence day"
      />
      <AllocationFutureCard />

      {/* Target allocation + glide path are now free — they're
          read-only allocation-planning tools and don't really fit
          the "advanced analytics" framing the rest of Pro carries.
          Keeping them gated meant casual users couldn't pin a 60/40
          target or sketch a Vanguard-style glide path, which are
          table-stakes portfolio features. */}
      <TargetAllocationCard />
      <GlidePathCard />
    </>
  );
}

function PositionsView() {
  return <PositionsList />;
}
