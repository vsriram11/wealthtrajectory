import { describe, expect, it } from "vitest";
import type { BudgetItem } from "@/lib/budget/budget";
import type { HealthPlan } from "@/lib/health/healthPlans";
import {
  HEALTH_SLICE_INITIAL,
  createHealthSliceActions,
  type HealthSliceState,
} from "./healthSlice";

type Combined = HealthSliceState & {
  budgetItems: BudgetItem[];
  addBudgetItem: (
    input: Omit<BudgetItem, "id" | "createdAt">,
  ) => string;
};

function makeFakeStore(seed: Partial<Combined> = {}) {
  let state: Combined = {
    ...HEALTH_SLICE_INITIAL,
    budgetItems: [],
    addBudgetItem: (input) => {
      const id = `bud-stub-${state.budgetItems.length}`;
      state = {
        ...state,
        budgetItems: [
          ...state.budgetItems,
          { ...input, id, createdAt: 0 } as BudgetItem,
        ],
      };
      return id;
    },
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: Combined) => Partial<Combined>) => {
      state = { ...state, ...fn(state) };
    },
    get: () => state,
  };
}

describe("addHealthPlan", () => {
  it("returns a fresh id + appends to the array", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    const id = a.addHealthPlan({
      name: "Employer PPO",
      ownerId: "m1",
      coveredMemberIds: ["m1"],
      monthlyPremiumUSD: 500,
      annualDeductibleUSD: 2_000,
      annualOutOfPocketMaxUSD: 8_000,
      category: "employer_ppo",
    } as never);
    expect(id.startsWith("health-")).toBe(true);
    expect(s.state.healthPlans).toHaveLength(1);
    expect(s.state.healthPlans[0].id).toBe(id);
  });

  it("enforces the ownerId-in-coveredMemberIds invariant", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    a.addHealthPlan({
      name: "Family PPO",
      ownerId: "alex",
      coveredMemberIds: ["bob", "kid"], // owner missing!
      monthlyPremiumUSD: 1_200,
      annualDeductibleUSD: 4_000,
      annualOutOfPocketMaxUSD: 10_000,
      category: "employer_ppo",
    } as never);
    // Slice should patch the owner in at the front.
    expect(s.state.healthPlans[0].coveredMemberIds).toEqual([
      "alex",
      "bob",
      "kid",
    ]);
  });
});

describe("updateHealthPlan", () => {
  it("re-enforces the ownerId-in-coverage invariant after patch", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    const id = a.addHealthPlan({
      name: "Plan",
      ownerId: "alex",
      coveredMemberIds: ["alex"],
      monthlyPremiumUSD: 500,
      annualDeductibleUSD: 1_000,
      annualOutOfPocketMaxUSD: 5_000,
      category: "employer_ppo",
    } as never);
    // Caller tries to drop the owner from coverage; slice should
    // re-add them.
    a.updateHealthPlan(id, { coveredMemberIds: ["bob"] } as never);
    expect(s.state.healthPlans[0].coveredMemberIds).toEqual(["alex", "bob"]);
  });
});

describe("removeHealthPlan", () => {
  it("filters by id", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    const id = a.addHealthPlan({
      name: "Plan",
      ownerId: "alex",
      coveredMemberIds: ["alex"],
      monthlyPremiumUSD: 0,
      annualDeductibleUSD: 0,
      annualOutOfPocketMaxUSD: 0,
      category: "employer_ppo",
    } as never);
    a.removeHealthPlan(id);
    expect(s.state.healthPlans).toHaveLength(0);
  });
});

describe("setHealthImportanceWeight", () => {
  it("clamps to [0, 1]", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    a.setHealthImportanceWeight("m1", "premium" as never, 2.5);
    expect(s.state.healthImportanceWeights.m1["premium" as never]).toBe(1);
    a.setHealthImportanceWeight("m1", "premium" as never, -0.5);
    expect("premium" in s.state.healthImportanceWeights.m1).toBe(false);
  });

  it("setting 0 deletes the factor entry (keeps sparse maps sparse)", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    a.setHealthImportanceWeight("m1", "premium" as never, 0.7);
    expect(s.state.healthImportanceWeights.m1["premium" as never]).toBe(0.7);
    a.setHealthImportanceWeight("m1", "premium" as never, 0);
    expect("premium" in s.state.healthImportanceWeights.m1).toBe(false);
  });

  it("NaN coerces to 0 (and thus deletes the entry)", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    a.setHealthImportanceWeight("m1", "premium" as never, 0.5);
    a.setHealthImportanceWeight("m1", "premium" as never, NaN);
    expect("premium" in s.state.healthImportanceWeights.m1).toBe(false);
  });
});

describe("addPlanToBudget", () => {
  it("returns null when the plan id doesn't resolve", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    expect(a.addPlanToBudget("ghost")).toBeNull();
  });

  it("creates a new budget item on first call", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    const id = a.addHealthPlan({
      name: "Employer PPO",
      ownerId: "m1",
      coveredMemberIds: ["m1"],
      monthlyPremiumUSD: 500,
      annualDeductibleUSD: 0,
      annualOutOfPocketMaxUSD: 0,
      category: "employer_ppo",
    } as never);
    const budgetId = a.addPlanToBudget(id);
    expect(budgetId).not.toBeNull();
    expect(s.state.budgetItems).toHaveLength(1);
    expect(s.state.budgetItems[0].monthlyUSD).toBe(500);
    expect(s.state.budgetItems[0].subcategory).toBe("Health insurance");
  });

  it("updates the existing matching budget item on the second call (idempotent)", () => {
    const s = makeFakeStore();
    const a = createHealthSliceActions(s.set, s.get);
    const planId = a.addHealthPlan({
      name: "Employer PPO",
      ownerId: "m1",
      coveredMemberIds: ["m1"],
      monthlyPremiumUSD: 500,
      annualDeductibleUSD: 0,
      annualOutOfPocketMaxUSD: 0,
      category: "employer_ppo",
    } as never);
    const first = a.addPlanToBudget(planId);
    a.updateHealthPlan(planId, { monthlyPremiumUSD: 650 } as never);
    const second = a.addPlanToBudget(planId);

    expect(s.state.budgetItems).toHaveLength(1); // not duplicated
    expect(first).toBe(second);
    expect(s.state.budgetItems[0].monthlyUSD).toBe(650);
  });
});
