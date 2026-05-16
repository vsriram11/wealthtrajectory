import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  GOALS_SLICE_INITIAL,
  createGoalsSliceActions,
  type GoalsSliceState,
} from "./goalsSlice";

function makeFakeStore() {
  let state: GoalsSliceState = { ...GOALS_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: GoalsSliceState) => Partial<GoalsSliceState>) => {
      state = { ...state, ...fn(state) };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Goals slice", () => {
  it("addGoal returns a fresh id and stamps createdAt", () => {
    const s = makeFakeStore();
    const a = createGoalsSliceActions(s.set);
    const id = a.addGoal({
      name: "House down payment",
      targetUSD: 100_000,
      currentUSD: 5_000,
      monthlyContributionUSD: 1_000,
    } as never);
    expect(typeof id).toBe("string");
    expect(id.startsWith("goal-")).toBe(true);
    expect(s.state.goals).toHaveLength(1);
    expect(s.state.goals[0].createdAt).toBe(
      Date.parse("2026-05-15T12:00:00Z"),
    );
  });

  it("updateGoal applies a partial patch", () => {
    const s = makeFakeStore();
    const a = createGoalsSliceActions(s.set);
    const id = a.addGoal({
      name: "House",
      targetUSD: 100_000,
      currentUSD: 0,
      monthlyContributionUSD: 1_000,
    } as never);
    a.updateGoal(id, { currentUSD: 25_000 } as never);
    expect(s.state.goals[0].currentUSD).toBe(25_000);
    expect(s.state.goals[0].targetUSD).toBe(100_000); // untouched
  });

  it("removeGoal filters by id", () => {
    const s = makeFakeStore();
    const a = createGoalsSliceActions(s.set);
    const id1 = a.addGoal({ name: "A" } as never);
    const id2 = a.addGoal({ name: "B" } as never);
    a.removeGoal(id1);
    expect(s.state.goals).toHaveLength(1);
    expect(s.state.goals[0].id).toBe(id2);
  });
});
