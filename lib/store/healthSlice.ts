/**
 * Health-insurance plans + per-member importance weights.
 *
 * Each plan has an `ownerId` (the subscriber) and a
 * `coveredMemberIds` array (who's on the policy). Premium
 * dollars are attributed to the owner only — household rollups
 * must NOT double-count a family plan against every covered
 * member.
 *
 * Importance weights are sparse (only set factors appear) and
 * keyed by memberId. Each member rates a fixed set of plan
 * factors 0-1; the scoring engine computes a weighted average
 * to score plans per-member.
 *
 * Cross-slice: `addPlanToBudget` looks up the named plan and
 * either updates the matching budget item in place or creates a
 * new one. Captured here (with a typed cross-slice context)
 * rather than living in the budget slice because the
 * relationship is one-way (health → budget).
 */

import type { BudgetItem } from "@/lib/budget/budget";
import type {
  HealthImportanceWeights,
  HealthPlan,
  HealthPlanFactor,
} from "@/lib/health/healthPlans";

export type HealthSliceState = {
  healthPlans: HealthPlan[];
  healthImportanceWeights: Record<string, HealthImportanceWeights>;
};

export type HealthSliceActions = {
  /**
   * Create a health plan. Enforces the invariant that ownerId is
   * a member of coveredMemberIds (a plan whose subscriber isn't
   * covered is ill-formed).
   */
  addHealthPlan: (
    input: Omit<HealthPlan, "id" | "createdAt">,
  ) => string;
  updateHealthPlan: (id: string, patch: Partial<HealthPlan>) => void;
  removeHealthPlan: (id: string) => void;
  /**
   * Set a member's importance weight for a single plan factor.
   * Value is clamped to [0, 1]; setting 0 deletes the entry so
   * sparse maps stay sparse.
   */
  setHealthImportanceWeight: (
    memberId: string,
    factor: HealthPlanFactor,
    value: number,
  ) => void;
  /**
   * Create-or-update a budget line item from a stored plan. The
   * plan's monthly premium becomes the budget item's monthlyUSD.
   * Returns the resulting budget item id, or null if the plan
   * couldn't be resolved.
   */
  addPlanToBudget: (planId: string) => string | null;
};

export const HEALTH_SLICE_INITIAL: HealthSliceState = {
  healthPlans: [],
  healthImportanceWeights: {},
};

function makeHealthPlanId(): string {
  return `health-${crypto.randomUUID()}`;
}

/**
 * Cross-slice writable context — addPlanToBudget needs to read
 * budgetItems and emit a new one through the budget slice's
 * addBudgetItem action. Typed structurally so the slice file
 * doesn't have to import the full AppState.
 */
type HealthSliceContext = HealthSliceState & {
  budgetItems: BudgetItem[];
  addBudgetItem: (input: Omit<BudgetItem, "id" | "createdAt">) => string;
};

export function createHealthSliceActions(
  set: (
    fn: (s: HealthSliceContext) => Partial<HealthSliceContext>,
  ) => void,
  get: () => HealthSliceContext,
): HealthSliceActions {
  return {
    addHealthPlan: (input) => {
      const id = makeHealthPlanId();
      // Invariant: ownerId must be in coveredMemberIds. If the
      // caller forgot, fix it rather than failing — downstream
      // rollup assumes well-formed input.
      const coveredMemberIds = input.coveredMemberIds.includes(input.ownerId)
        ? input.coveredMemberIds
        : [input.ownerId, ...input.coveredMemberIds];
      const plan: HealthPlan = {
        ...input,
        coveredMemberIds,
        id,
        createdAt: Date.now(),
      };
      set((s) => ({ healthPlans: [...s.healthPlans, plan] }));
      return id;
    },

    updateHealthPlan: (id, patch) =>
      set((s) => ({
        healthPlans: s.healthPlans.map((p) => {
          if (p.id !== id) return p;
          const merged = { ...p, ...patch };
          // Re-enforce the ownerId-in-coverage invariant after patch.
          const coveredMemberIds = merged.coveredMemberIds.includes(
            merged.ownerId,
          )
            ? merged.coveredMemberIds
            : [merged.ownerId, ...merged.coveredMemberIds];
          return { ...merged, coveredMemberIds };
        }),
      })),

    removeHealthPlan: (id) =>
      set((s) => ({
        healthPlans: s.healthPlans.filter((p) => p.id !== id),
      })),

    setHealthImportanceWeight: (memberId, factor, value) =>
      set((s) => {
        const clamped = Number.isFinite(value)
          ? Math.max(0, Math.min(1, value))
          : 0;
        const next = { ...(s.healthImportanceWeights[memberId] ?? {}) };
        if (clamped === 0) {
          delete next[factor];
        } else {
          next[factor] = clamped;
        }
        return {
          healthImportanceWeights: {
            ...s.healthImportanceWeights,
            [memberId]: next,
          },
        };
      }),

    addPlanToBudget: (planId) => {
      const state = get();
      const plan = state.healthPlans.find((p) => p.id === planId);
      if (!plan) return null;
      // Heuristic match: same name + owner + healthcare category =
      // assume this row was already created by a prior add-to-budget
      // for the same plan, and update it in place. Otherwise create
      // a new line item. Either way the user clicks once and the
      // right thing happens.
      const existing = state.budgetItems.find(
        (b) =>
          b.ownerId === plan.ownerId &&
          b.category === "healthcare" &&
          b.subcategory === "Health insurance" &&
          b.name === plan.name,
      );
      if (existing) {
        set((s) => ({
          budgetItems: s.budgetItems.map((b) =>
            b.id === existing.id
              ? { ...b, monthlyUSD: plan.monthlyPremiumUSD }
              : b,
          ),
        }));
        return existing.id;
      }
      return state.addBudgetItem({
        name: plan.name,
        ownerId: plan.ownerId,
        category: "healthcare",
        subcategory: "Health insurance",
        monthlyUSD: plan.monthlyPremiumUSD,
        type: "fixed",
        endsAtRetirement: false,
        isSubscription: true,
        billingCycle: "monthly",
      });
    },
  };
}
