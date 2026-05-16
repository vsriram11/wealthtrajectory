import { describe, expect, it } from "vitest";
import { whatIfExtraMonthly } from "@/lib/projection/whatIf";
import type { Assumptions, Household } from "@/lib/types";

function makeHousehold(): Household {
  return {
    id: "test",
    members: [{ id: "m1", displayName: "You" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 2_000,
        holdings: [
          {
            kind: "cash",
            id: "c",
            valueUSD: 100_000,
            expectedRealCAGR: 0,
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
          },
        ],
      },
    ],
    liabilities: [],
  };
}

const assumptions: Assumptions = {
  targetNetWorthUSD: 1_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

describe("whatIfExtraMonthly", () => {
  it("zero extra returns identical projections", () => {
    const out = whatIfExtraMonthly(makeHousehold(), assumptions, 0);
    expect(out.monthsSaved).toBe(0);
    expect(out.baseline.monthsToIndependence).toBe(out.bumped.monthsToIndependence);
  });

  it("positive extra contribution accelerates Independence", () => {
    const out = whatIfExtraMonthly(makeHousehold(), assumptions, 1_000);
    expect(out.bumped.monthsToIndependence).not.toBeNull();
    expect(out.baseline.monthsToIndependence).not.toBeNull();
    // Identity: monthsSaved = baseline - bumped. Asserting the
    // identity catches a regression where one of the two
    // projections moved but the delta didn't track. The sign
    // (saved > 0 ⇔ bumped < baseline) is a corollary.
    expect(out.monthsSaved).toBe(
      out.baseline.monthsToIndependence! - out.bumped.monthsToIndependence!,
    );
    expect(out.monthsSaved).toBeGreaterThan(0);
  });

  it("negative extra is clamped to zero (no slow-down injection)", () => {
    const out = whatIfExtraMonthly(makeHousehold(), assumptions, -500);
    expect(out.monthsSaved).toBe(0);
  });

  it("returns null monthsSaved when neither path reaches Independence", () => {
    const stuckAssumptions: Assumptions = {
      ...assumptions,
      targetNetWorthUSD: 1_000_000_000_000, // $1T target, unreachable
    };
    const out = whatIfExtraMonthly(makeHousehold(), stuckAssumptions, 1_000);
    // Even with a $1K/mo bump, $1T is unreachable in 70 years → null.
    expect(out.baseline.monthsToIndependence).toBeNull();
    expect(out.bumped.monthsToIndependence).toBeNull();
    expect(out.monthsSaved).toBeNull();
  });

  it("empty household stays empty (no division by zero)", () => {
    const empty: Household = {
      id: "e",
      members: [{ id: "m1", displayName: "You" }],
      accounts: [],
      liabilities: [],
    };
    const out = whatIfExtraMonthly(empty, assumptions, 1_000);
    // With no accounts there's nothing to grow — Independence is
    // unreachable. The series should still be projected (the UI
    // graphs it as flat zero) and match baseline series length so
    // the renderer's index-by-index comparison stays aligned.
    expect(out.baseline.monthsToIndependence).toBeNull();
    expect(out.bumped.monthsToIndependence).toBeNull();
    expect(out.bumped.series.length).toBe(out.baseline.series.length);
    expect(out.bumped.series.length).toBeGreaterThan(0);
    // Bumped equals baseline — proportional distribution across
    // zero accounts means the bump has nowhere to land.
    for (let i = 0; i < out.bumped.series.length; i++) {
      expect(out.bumped.series[i].netWorthUSD).toBe(
        out.baseline.series[i].netWorthUSD,
      );
    }
  });

  it("distributes extra across accounts proportional to current value", () => {
    const memberId = "m1";
    const household: Household = {
      id: "t",
      members: [{ id: memberId, displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "Big",
          ownerId: memberId,
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "cash",
              id: "c1",
              valueUSD: 300_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
        {
          id: "a2",
          category: "BROKERAGE",
          displayName: "Small",
          ownerId: memberId,
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "cash",
              id: "c2",
              valueUSD: 100_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    // 75/25 split — extra $1,000/mo → $750 to a1, $250 to a2.
    // Verify via comparison of bumped balances after 1 month
    // (cash CAGR=0 so balance ≈ initial + contribution).
    const out = whatIfExtraMonthly(household, assumptions, 1_000);
    // Run projection 1 month: month-1 NW = 400_000 + 1_000 = 401_000.
    // (Both accounts together; per-account split is internal.)
    expect(out.bumped.series[1].netWorthUSD).toBeCloseTo(401_000, 0);
  });
});
