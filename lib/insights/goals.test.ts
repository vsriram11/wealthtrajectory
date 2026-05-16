import { describe, expect, it } from "vitest";
import { computeGoalProgress, type Goal } from "@/lib/insights/goals";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    name: "Test",
    targetUSD: 10_000,
    currentUSD: 2_500,
    monthlyContributionUSD: 500,
    targetDate: null,
    category: "house",
    createdAt: 0,
    ...overrides,
  };
}

describe("computeGoalProgress", () => {
  it("computes fractionComplete and remaining", () => {
    const p = computeGoalProgress(makeGoal());
    expect(p.fractionComplete).toBeCloseTo(0.25, 5);
    expect(p.remainingUSD).toBe(7_500);
  });

  it("computes months-to-target at current pace", () => {
    const p = computeGoalProgress(makeGoal());
    // 7500 / 500 = 15
    expect(p.monthsToTarget).toBe(15);
  });

  it("returns null months when no contribution and not complete", () => {
    const p = computeGoalProgress(
      makeGoal({ monthlyContributionUSD: 0 }),
    );
    expect(p.monthsToTarget).toBeNull();
    expect(p.onPace).toBe(false);
  });

  it("returns 0 months when already at/over target", () => {
    const p = computeGoalProgress(
      makeGoal({ currentUSD: 12_000 }),
    );
    expect(p.fractionComplete).toBe(1);
    expect(p.remainingUSD).toBe(0);
    expect(p.monthsToTarget).toBe(0);
  });

  it("flags on-pace when months <= time-remaining", () => {
    const now = Date.UTC(2025, 0, 1);
    // Need 15 months at 500/mo — target date 24 mo out → on pace.
    const farDate = now + 24 * 30.44 * 24 * 60 * 60 * 1000;
    const p = computeGoalProgress(makeGoal({ targetDate: farDate }), now);
    expect(p.onPace).toBe(true);
  });

  it("flags off-pace when months > time-remaining", () => {
    const now = Date.UTC(2025, 0, 1);
    // 15 months needed, only 6 months out → behind.
    const closeDate = now + 6 * 30.44 * 24 * 60 * 60 * 1000;
    const p = computeGoalProgress(makeGoal({ targetDate: closeDate }), now);
    expect(p.onPace).toBe(false);
  });

  it("clamps negative currentUSD to 0", () => {
    const p = computeGoalProgress(makeGoal({ currentUSD: -100 }));
    expect(p.fractionComplete).toBe(0);
    expect(p.remainingUSD).toBe(10_000);
  });
});
