/**
 * Non-independence financial goals (house down payment, kid's
 * college, sabbatical, wedding, etc.). Tracked alongside the
 * Independence plan but doesn't affect projectIndependence —
 * goals are independent milestones with their own target /
 * contribution rate / on-pace check.
 *
 * Synced via Drive + IDB through the household payload.
 */

import type { Goal } from "@/lib/insights/goals";

export type GoalsSliceState = {
  goals: Goal[];
};

export type GoalsSliceActions = {
  /** Create a goal. `id` and `createdAt` are generated here. */
  addGoal: (input: Omit<Goal, "id" | "createdAt">) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
};

export const GOALS_SLICE_INITIAL: GoalsSliceState = {
  goals: [],
};

function makeGoalId(): string {
  return `goal-${crypto.randomUUID()}`;
}

export function createGoalsSliceActions(
  set: (
    fn: (s: GoalsSliceState) => Partial<GoalsSliceState>,
  ) => void,
): GoalsSliceActions {
  return {
    addGoal: (input) => {
      const id = makeGoalId();
      const goal: Goal = { ...input, id, createdAt: Date.now() };
      set((s) => ({ goals: [...s.goals, goal] }));
      return id;
    },
    updateGoal: (id, patch) =>
      set((s) => ({
        goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      })),
    removeGoal: (id) =>
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
  };
}
