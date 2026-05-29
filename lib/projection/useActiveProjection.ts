"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { applyScenario } from "@/lib/insights/scenarios";
import {
  activeMembers,
  filterHousehold,
  householdForRollups,
  liquidHousehold,
  type Assumptions,
  type Household,
} from "@/lib/types";

export type ActiveProjectionInput = {
  household: Household;
  assumptions: Assumptions;
  scenarioName: string | null;
  /**
   * The currently-selected member id, surfaced here so consumers that
   * need to apply the member filter to side-data (e.g. snapshots
   * loaded from IDB) can do so against the same source of truth that
   * filtered `household`.
   */
  memberId: string | null;
};

/**
 * Resolve the effective assumptions for a member view. When viewing a
 * specific member and that member has overrides in memberAssumptions,
 * those override the household defaults field-by-field. When viewing
 * the rolled-up household (memberId=null), the household defaults
 * apply unchanged.
 *
 * Exported so non-React call sites (Drive sync, tests, projection
 * helpers) can compute the same effective assumptions consistently.
 */
export function resolveAssumptionsForMember(
  household: Assumptions,
  memberAssumptions: Record<string, Partial<Assumptions>>,
  memberId: string | null,
): Assumptions {
  if (!memberId) return household;
  const override = memberAssumptions[memberId];
  if (!override) return household;
  return { ...household, ...override };
}

/**
 * Aggregate per-member assumptions into a single household-level
 * Assumptions object. Drives the "Aggregate from members" button
 * on AssumptionsPanel — recomputes the household defaults as a
 * roll-up of each member's effective plan.
 *
 * Math:
 *   - targetNetWorthUSD : SUM  (corpus sizes add)
 *   - legacyFloorUSD    : SUM  (legacy goals add)
 *   - withdrawalRate    : weighted average by targetNetWorthUSD
 *                          (a larger member's rate dominates;
 *                          falls back to simple mean when total
 *                          target is 0)
 *   - expectedInflationRate / drawdownHorizonYears /
 *     retirementVariableHaircut / retirementTaxRate : simple mean
 *   - drawdownPhases    : left untouched on household (multi-phase
 *                          aggregation is ill-defined when members
 *                          have differing phase counts)
 *
 * Per-member overrides are NOT cleared — the caller decides
 * whether to invoke a separate sweep. Keeping overrides preserves
 * the user's per-member tuning while updating the household
 * defaults to represent the aggregated picture.
 */
/**
 * Effective assumptions for the household-roll-up view.
 *
 * Behavior (resolves the "$28.3M household vs $20M member" UX bug
 * the user surfaced — household now ALWAYS reflects the per-member
 * plan when overrides exist):
 *   - When any member has at least one explicit override field,
 *     the household view aggregates over THOSE members
 *     (`aggregateAssumptions` sums targets / legacy, weighted-avgs
 *     withdrawal rate, simple-avgs the rest).
 *   - When zero members have overrides, fall back to the legacy
 *     household defaults (`state.assumptions`). This keeps pristine
 *     users / single-member households / no-override couples
 *     unchanged.
 *
 * Why "aggregate over members WITH overrides" instead of all
 * members: a member without an override means "I haven't planned
 * separately yet — I'm just inheriting the household template".
 * Counting an inherited household-default value once per member
 * would balloon the household total (2 members × $2M default =
 * $4M aggregate), which isn't what the user means by "household
 * plan." Counting only explicit per-member values keeps the
 * aggregate a roll-up of actual per-person plans.
 */
export function effectiveHouseholdAssumptions(
  household: Assumptions,
  memberAssumptions: Record<string, Partial<Assumptions>>,
  members: Array<{ id: string }>,
): Assumptions {
  const idsWithOverrides = members
    .map((m) => m.id)
    .filter((id) => {
      const o = memberAssumptions[id];
      return o != null && Object.keys(o).length > 0;
    });
  if (idsWithOverrides.length === 0) return household;
  return aggregateAssumptions(household, memberAssumptions, idsWithOverrides);
}

export function aggregateAssumptions(
  household: Assumptions,
  memberAssumptions: Record<string, Partial<Assumptions>>,
  memberIds: string[],
): Assumptions {
  if (memberIds.length === 0) return household;
  const effective = memberIds.map((id) =>
    resolveAssumptionsForMember(household, memberAssumptions, id),
  );
  const n = effective.length;

  const totalTarget = effective.reduce(
    (s, a) => s + (a.targetNetWorthUSD ?? 0),
    0,
  );
  const totalLegacy = effective.reduce(
    (s, a) => s + (a.legacyFloorUSD ?? 0),
    0,
  );
  // Withdrawal rate weighted by target. If total target is 0,
  // fall back to a simple mean so the field doesn't go to 0/0.
  const weightedWithdraw =
    totalTarget > 0
      ? effective.reduce(
          (s, a) => s + a.withdrawalRate * a.targetNetWorthUSD,
          0,
        ) / totalTarget
      : effective.reduce((s, a) => s + a.withdrawalRate, 0) / n;
  const meanInflation =
    effective.reduce((s, a) => s + a.expectedInflationRate, 0) / n;
  const meanHorizon =
    effective.reduce((s, a) => s + a.drawdownHorizonYears, 0) / n;
  const meanHaircut =
    effective.reduce((s, a) => s + (a.retirementVariableHaircut ?? 0), 0) /
    n;
  const meanTax =
    effective.reduce((s, a) => s + (a.retirementTaxRate ?? 0.2), 0) / n;
  // Variable share blends as a simple mean (same logic as the
  // haircut). When some members have it set and others don't,
  // the unset members contribute the household default —
  // matched at the resolver layer, NOT here, so this aggregator
  // sees the resolved per-member value either way. We coerce
  // unset → undefined → 0 so a fully-undefined household stays
  // null (falls through to budget-derived / 35% default at the
  // consumption site, not silently locked at 0%).
  const varShareValues = effective
    .map((a) => a.retirementVariableShare)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const meanVariableShare =
    varShareValues.length > 0
      ? varShareValues.reduce((s, v) => s + v, 0) / varShareValues.length
      : undefined;
  // Down-year-only mode aggregates with "any-true wins" — if even
  // one member opted into the conservative-survival mode, the
  // blended household plan respects that. Mirrors how the
  // Scenarios layer composes opt-in flags. (Could alternatively
  // be majority-vote, but that fails on the 1-vs-1 case; opt-in-
  // wins is unambiguous + safer.)
  const anyDownYearOnly = effective.some(
    (a) => a.retirementVariableHaircutOnDownYearOnly === true,
  );
  // Fixed-nominal years (SORR mitigation, drawdown-phase) aggregates
  // by MAX rather than mean — if any member opted into a freeze,
  // the household view should at least show that freeze worth of
  // protection. A mean would dilute one member's 10-year freeze
  // with another's 0 into 5y, which is neither what either member
  // configured nor a meaningful blend. Max preserves opt-in.
  //
  // Include EXPLICIT 0 in the candidate set so a unanimous opt-out
  // (every member set 0) returns 0 instead of undefined. Without
  // this, two members each opting out would fall through to the
  // household default — silently restoring whatever the household
  // template said. With 0 included: max([0, 0]) = 0 (correct
  // unanimous opt-out); max([0, 5]) = 5 (opt-in wins).
  const fixedNominalValues = effective
    .map((a) => a.retirementFixedNominalYears)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const maxFixedNominalYears =
    fixedNominalValues.length > 0
      ? Math.max(...fixedNominalValues)
      : undefined;

  return {
    ...household,
    targetNetWorthUSD: totalTarget,
    legacyFloorUSD: totalLegacy,
    withdrawalRate: weightedWithdraw,
    expectedInflationRate: meanInflation,
    drawdownHorizonYears: Math.round(meanHorizon),
    retirementVariableHaircut: meanHaircut,
    retirementVariableHaircutOnDownYearOnly: anyDownYearOnly,
    retirementVariableShare: meanVariableShare,
    retirementTaxRate: meanTax,
    retirementFixedNominalYears: maxFixedNominalYears,
  };
}

/**
 * Returns the household + assumptions to use for projections on the
 * current page, applying the active scenario's overrides if one is
 * selected. Member filter is applied first. When a specific member
 * is selected, their per-member assumption overrides (if any) merge
 * on top of the household defaults before the scenario overrides.
 */
/**
 * Pure resolver — engine-side equivalent of `useActiveProjection`,
 * extracted so we can unit-test the filter-application invariants
 * without spinning up React. The hook below is a thin memoized
 * wrapper that subscribes to the store and calls this.
 *
 * Order of operations:
 *   1. Filter by selectedMemberId (slice to one person, or pass
 *      through if null).
 *   2. Strip illiquid holdings when liquidityView === "liquid".
 *   3. Resolve effective assumptions (per-member override merge or
 *      household aggregate).
 *   4. Apply active scenario overrides if any.
 *
 * Both global filters land here, so any consumer of the hook
 * inherits both — no per-card re-application needed.
 */
export function resolveActiveProjection(args: {
  household: Household;
  memberId: string | null;
  liquidityView: "total" | "liquid";
  assumptions: Assumptions;
  memberAssumptions: Record<string, Partial<Assumptions>>;
  scenarios: import("@/lib/types").Scenario[];
  activeId: string | null;
}): ActiveProjectionInput {
  const {
    household,
    memberId,
    liquidityView,
    assumptions,
    memberAssumptions,
    scenarios,
    activeId,
  } = args;
  // Composition order: rollup-include → per-member → liquidity.
  //
  // When the user has picked a specific member (memberId != null),
  // SHOW that member's view regardless of their rollup-include
  // flag — the explicit pick is the source of truth, even for
  // someone the user has set aside from household totals.
  //
  // When no member is picked (the household-aggregate view),
  // apply `householdForRollups` so excluded members' members,
  // accounts, AND liabilities all drop out of every downstream
  // computation (NW, projection, Monte Carlo, portfolio, etc.).
  // This is the single composition point that cascades the
  // include flag into every dashboard rollup — adding the filter
  // here means consumers don't re-implement it per-card.
  const scoped = memberId
    ? filterHousehold(household, memberId)
    : householdForRollups(household);
  const filtered =
    liquidityView === "liquid" ? liquidHousehold(scoped) : scoped;
  const effectiveAssumptions = memberId
    ? resolveAssumptionsForMember(assumptions, memberAssumptions, memberId)
    : effectiveHouseholdAssumptions(
        assumptions,
        memberAssumptions,
        // Pass active members only — same active-set the rollup
        // view uses, so blended assumptions are consistent with
        // the household view's accounts/liabilities. Previously
        // passed `household.members` (raw), which silently
        // included excluded members' assumption overrides in the
        // blend — fixed.
        activeMembers(household),
      );
  const active = activeId ? scenarios.find((s) => s.id === activeId) : null;
  if (!active) {
    return {
      household: filtered,
      assumptions: effectiveAssumptions,
      scenarioName: null,
      memberId,
    };
  }
  const { household: h, assumptions: a } = applyScenario(
    filtered,
    effectiveAssumptions,
    active.overrides,
  );
  return {
    household: h,
    assumptions: a,
    scenarioName: active.name,
    memberId,
  };
}

export function useActiveProjection(): ActiveProjectionInput {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const liquidityView = useAppStore((s) => s.liquidityView);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const scenarios = useAppStore((s) => s.scenarios);
  const activeId = useAppStore((s) => s.activeScenarioId);

  return useMemo(
    () =>
      resolveActiveProjection({
        household,
        memberId,
        liquidityView,
        assumptions,
        memberAssumptions,
        scenarios,
        activeId,
      }),
    [
      household,
      memberId,
      liquidityView,
      assumptions,
      memberAssumptions,
      scenarios,
      activeId,
    ],
  );
}

/**
 * Scenario-neutral sibling of `useActiveProjection`. Honors member
 * filter + liquidity view + per-member assumption overrides, but
 * does NOT apply the active scenario's overrides — returns the
 * "baseline" the user's current state would project to.
 *
 * Use for surfaces that ITERATE every scenario on their own (e.g.
 * the Scenario Comparison Chart, which overlays all defined
 * scenarios as separate curves on top of an explicit baseline).
 * Using `useActiveProjection` for those surfaces would double-
 * apply the active scenario's overrides to the chart's "active"
 * curve AND mislabel the active scenario's data as "Baseline"
 * (regression user reported on the Scenarios tab).
 */
export function useScenarioNeutralProjection(): ActiveProjectionInput {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const liquidityView = useAppStore((s) => s.liquidityView);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const scenarios = useAppStore((s) => s.scenarios);

  return useMemo(
    () =>
      resolveActiveProjection({
        household,
        memberId,
        liquidityView,
        assumptions,
        memberAssumptions,
        scenarios,
        activeId: null,
      }),
    [
      household,
      memberId,
      liquidityView,
      assumptions,
      memberAssumptions,
      scenarios,
    ],
  );
}
