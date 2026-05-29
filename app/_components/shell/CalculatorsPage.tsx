"use client";

import { useState } from "react";

import { InvestmentGrowthCalculator } from "@/app/_components/calculators/InvestmentGrowthCalculator";

type CalculatorsSubTab = "investment-growth";

const SUB_TABS: { id: CalculatorsSubTab; label: string }[] = [
  { id: "investment-growth", label: "Investment growth" },
];

/**
 * Calculators page — static, portfolio-blind tools for back-of-
 * envelope planning math.
 *
 * IMPORTANT distinction from the rest of the app: every other page
 * (Home, Allocation, Projections, Plan) routes the user's actual
 * household composition through the engine layer (rollups → member
 * filter → scenario merge → projection). The Calculators page does
 * NOT — each tab is a self-contained widget with its own inputs
 * and its own pure math. The audience is "someone running the
 * NerdWallet investment calculator while planning a goal" rather
 * than "a user reasoning about their actual portfolio." That's
 * deliberate: they're complementary, not competing surfaces.
 *
 * Tab structure follows PlanPage's pattern (horizontally scrollable
 * pill row + conditional view rendering, local useState — no URL
 * state). Single tab today; more calculators can plug in here as
 * the surface grows.
 */
export function CalculatorsPage() {
  const [tab, setTab] = useState<CalculatorsSubTab>("investment-growth");

  return (
    <>
      <section className="px-5 pt-3">
        <div
          role="tablist"
          aria-label="Calculators sub-navigation"
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

      <div className="px-5 pt-3">
        <div
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px] leading-snug text-text-dim"
          role="note"
        >
          <span className="font-medium text-text">
            Static calculators for convenience.
          </span>{" "}
          These tools don&apos;t read your household — they&apos;re
          quick what-if math for goal planning. For personalized
          projections that use your actual portfolio, scenarios,
          and member rollups, see the Projections and Plan pages.
        </div>
      </div>

      {tab === "investment-growth" && <InvestmentGrowthCalculator />}
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
        active ? "bg-accent text-bg" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}
