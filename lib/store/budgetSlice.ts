/**
 * Recurring monthly-expense ledger.
 *
 * Drives the "Independence corpus" suggestion in the Plan tab
 * (the sum of retirement-relevant items divided by the user's
 * withdrawal rate). Synced via Drive + IDB.
 *
 * The slice owns the array + the three basic CRUD actions. The
 * health-plan → budget bridge (addPlanToBudget) lives in the
 * Health slice because the relationship is one-way: health plans
 * can spawn budget items, but the budget itself doesn't know
 * about health plans.
 */

import type { BudgetItem } from "@/lib/budget/budget";

export type BudgetSliceState = {
  budgetItems: BudgetItem[];
};

export type BudgetSliceActions = {
  addBudgetItem: (input: Omit<BudgetItem, "id" | "createdAt">) => string;
  updateBudgetItem: (id: string, patch: Partial<BudgetItem>) => void;
  removeBudgetItem: (id: string) => void;
};

export const BUDGET_SLICE_INITIAL: BudgetSliceState = {
  budgetItems: [],
};

function makeBudgetItemId(): string {
  return `bud-${crypto.randomUUID()}`;
}

export function createBudgetSliceActions(
  set: (
    fn: (s: BudgetSliceState) => Partial<BudgetSliceState>,
  ) => void,
): BudgetSliceActions {
  return {
    addBudgetItem: (input) => {
      const id = makeBudgetItemId();
      const item: BudgetItem = { ...input, id, createdAt: Date.now() };
      set((s) => ({ budgetItems: [...s.budgetItems, item] }));
      return id;
    },
    updateBudgetItem: (id, patch) =>
      set((s) => ({
        budgetItems: s.budgetItems.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        ),
      })),
    removeBudgetItem: (id) =>
      set((s) => ({
        budgetItems: s.budgetItems.filter((b) => b.id !== id),
      })),
  };
}
