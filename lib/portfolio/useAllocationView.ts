"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { ageHousehold } from "@/lib/portfolio/futureAllocation";
import type { Assumptions, Household } from "@/lib/types";

/**
 * Shared composition hook for every card on the Allocation page.
 *
 * Wraps `useActiveProjection` (rollup → member → liquidity →
 * scenario merge) AND applies the AllocationPanel's
 * `appliedFutureYears` time-travel knob, so every card on the
 * page agrees on what "household" means.
 *
 * Pre-PR, only `AllocationPanel` and `LeveragedAllocationWarningCard`
 * honored `appliedFutureYears` — toggling "Apply +10y" on the
 * future-composition card would update those two but leave
 * ConcentrationRiskCard / FeeDragCard / AssetLocationCard /
 * TargetAllocationCard / PositionsList / TaxBuckets showing
 * today's holdings. The "future view" was inconsistent — the
 * user thought they were time-traveling the whole page but
 * only a slice moved. Lifting the aging into a single hook
 * removes the drift.
 *
 * Cards that DON'T compute against composition (e.g. the
 * static-target card that just edits a configuration, the glide-
 * path card that edits waypoints) can continue to consume
 * `useActiveProjection` directly; this hook is for cards that
 * compute against the household.
 */
export function useAllocationView(): {
  household: Household;
  assumptions: Assumptions;
  appliedFutureYears: number | null;
} {
  const { household: baseHousehold, assumptions } = useActiveProjection();
  const appliedFutureYears = useAppStore((s) => s.appliedFutureYears);

  const household = useMemo(() => {
    // NaN-safe early return. The type is `number | null` and the
    // UI setter doesn't currently produce NaN, but a corrupted
    // import or future setter bug could — and `ageHousehold(h, NaN)`
    // poisons every downstream balance via NaN propagation. Treat
    // NaN identically to null/zero: pass through today's mix.
    if (
      appliedFutureYears == null ||
      !Number.isFinite(appliedFutureYears) ||
      appliedFutureYears <= 0
    ) {
      return baseHousehold;
    }
    return ageHousehold(baseHousehold, appliedFutureYears);
  }, [baseHousehold, appliedFutureYears]);

  return { household, assumptions, appliedFutureYears };
}
