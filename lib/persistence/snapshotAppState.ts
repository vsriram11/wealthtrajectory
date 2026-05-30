import type { SnapshotAppState } from "./persistence";
import type { Assumptions } from "@/lib/types";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";
import type { GlidePath } from "@/lib/portfolio/glidePath";
import type { Goal } from "@/lib/insights/goals";
import type { BudgetItem } from "@/lib/budget/budget";
import type { IncomeStream } from "@/lib/budget/incomeStreams";
import type { Scenario } from "@/lib/types";
import type {
  HealthPlan,
  HealthImportanceWeights,
} from "@/lib/health/healthPlans";

/**
 * Structural subset of `AppState` we need to build a SnapshotAppState.
 * Declared inline (rather than importing AppState) to keep this
 * module free of a circular dep on lib/store. Every store caller
 * already has these fields available on `useAppStore.getState()`.
 */
export type SnapshotAppStateInput = {
  assumptions: Assumptions;
  memberAssumptions: Record<string, Partial<Assumptions>>;
  targetAllocation: TargetAllocation | null;
  glidePath: GlidePath | null;
  householdAnnualIncomeUSD: number | null;
  goals: Goal[];
  budgetItems: BudgetItem[];
  incomeStreams: IncomeStream[];
  scenarios: Scenario[];
  healthPlans: HealthPlan[];
  healthImportanceWeights: Record<string, HealthImportanceWeights>;
};

/**
 * Captures the non-household financial-state slices into a
 * SnapshotAppState payload. Deep-clones every field so the snapshot
 * is decoupled from subsequent in-place store mutations (Zustand
 * actions are shallow-copy-on-write, but defense in depth matters
 * here: the snapshot is the historical record of truth).
 *
 * Per-member data: `memberAssumptions` is keyed by member id and
 * carries each member's per-field overrides; combined with the
 * `household.members` roster and `household.accounts[].ownerId` /
 * `household.liabilities[].ownerId` attribution that ships with
 * the sibling `household` field, the snapshot has everything
 * needed to reconstruct member-filtered historical views.
 */
export function captureSnapshotAppState(
  s: SnapshotAppStateInput,
): SnapshotAppState {
  return {
    assumptions: structuredClone(s.assumptions),
    memberAssumptions: structuredClone(s.memberAssumptions),
    targetAllocation: structuredClone(s.targetAllocation) ?? null,
    glidePath: structuredClone(s.glidePath) ?? null,
    householdAnnualIncomeUSD: s.householdAnnualIncomeUSD ?? null,
    goals: structuredClone(s.goals),
    budgetItems: structuredClone(s.budgetItems),
    incomeStreams: structuredClone(s.incomeStreams),
    scenarios: structuredClone(s.scenarios),
    healthPlans: structuredClone(s.healthPlans),
    healthImportanceWeights: structuredClone(s.healthImportanceWeights),
  };
}
