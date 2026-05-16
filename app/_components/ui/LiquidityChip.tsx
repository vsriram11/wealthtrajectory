"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { filterHousehold, isLiquid } from "@/lib/types";

/**
 * Compact, low-visual-weight filter chip for the Total↔Liquid toggle.
 *
 * Lives inline alongside the caption row on Home and the title row on
 * Allocation. Deliberately quieter than a full segmented control so it
 * doesn't compete with primary navigation (tabs, basis toggle).
 *
 * Always renders so the toggle is discoverable — when the household
 * has no illiquid holdings the chip flips its tooltip to "Nothing
 * illiquid to filter — currently your liquid view equals total."
 */
export function LiquidityChip({ className = "" }: { className?: string }) {
  const liquidityView = useAppStore((s) => s.liquidityView);
  const setLiquidityView = useAppStore((s) => s.setLiquidityView);
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);

  // Member-filter aware: when looking at "Member A only", we should
  // only consider that member's holdings when deciding whether the
  // liquidity toggle has any effect. Otherwise switching to a member
  // with no illiquid assets still shows the chip as "meaningful".
  const hasIlliquid = useMemo(() => {
    const filtered = filterHousehold(household, memberId);
    for (const a of filtered.accounts)
      for (const h of a.holdings) if (!isLiquid(h)) return true;
    return false;
  }, [household, memberId]);

  const active = liquidityView === "liquid";
  const toggle = () => setLiquidityView(active ? "total" : "liquid");

  const title = !hasIlliquid
    ? "Nothing illiquid to filter — flag a primary residence, private stock, or any holding as illiquid to make this meaningful."
    : active
      ? "Liquid only — excludes primary residence, private company stock, and any holding flagged illiquid. Click to show total."
      : "Total net worth (all assets). Click to show liquid only.";

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition active:opacity-70 ${
        active
          ? "text-accent hover:bg-accent/10"
          : "text-text-muted hover:text-text"
      } ${className}`}
      aria-label={active ? "Switch to total view" : "Switch to liquid-only view"}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : "bg-text-dim"}`}
      />
      {active ? "Liquid" : "Total"}
    </button>
  );
}
