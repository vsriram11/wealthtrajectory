import { describe, expect, it } from "vitest";
import { computeHealthScore } from "@/lib/health/healthScore";
import type { Assumptions, Household } from "@/lib/types";

const assumptions: Assumptions = {
  targetNetWorthUSD: 1_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

function singleCashHousehold(valueUSD: number, category: "BROKERAGE" | "401K" | "ROTH_IRA" = "BROKERAGE"): Household {
  return {
    id: "t",
    members: [{ id: "m1", displayName: "You" }],
    accounts: [
      {
        id: "a1",
        category,
        displayName: "A",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          {
            kind: "cash",
            id: "c",
            valueUSD,
            expectedRealCAGR: 0,
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
          },
        ],
      },
    ],
    liabilities: [],
  };
}

describe("computeHealthScore", () => {
  it("returns null on empty / unreachable", () => {
    expect(
      computeHealthScore(
        { id: "e", members: [{ id: "m1", displayName: "Y" }], accounts: [], liabilities: [] },
        assumptions,
      ),
    ).toBeNull();
  });

  it("100% target reached scores high on progress", () => {
    const out = computeHealthScore(singleCashHousehold(1_000_000), assumptions)!;
    expect(out.progress).toBe(100);
  });

  it("0 leverage scores max on leverageSafety", () => {
    const out = computeHealthScore(singleCashHousehold(500_000), assumptions)!;
    expect(out.leverageSafety).toBe(100);
  });

  it("single-tax-bucket portfolio scores low on diversification", () => {
    // 100% taxable brokerage. Single bucket → low entropy.
    const out = computeHealthScore(singleCashHousehold(500_000, "BROKERAGE"), assumptions)!;
    expect(out.diversification).toBeLessThan(40);
  });

  it("multi-bucket portfolio scores higher on diversification", () => {
    const memberId = "m1";
    const household: Household = {
      id: "t",
      members: [{ id: memberId, displayName: "Y" }],
      accounts: [
        {
          id: "a1",
          category: "401K",
          displayName: "401k",
          ownerId: memberId,
          monthlyContributionUSD: 0,
          holdings: [
            { kind: "cash", id: "c1", valueUSD: 250_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
          ],
        },
        {
          id: "a2",
          category: "ROTH_IRA",
          displayName: "Roth",
          ownerId: memberId,
          monthlyContributionUSD: 0,
          holdings: [
            { kind: "cash", id: "c2", valueUSD: 250_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
          ],
        },
        {
          id: "a3",
          category: "BROKERAGE",
          displayName: "Brokerage",
          ownerId: memberId,
          monthlyContributionUSD: 0,
          holdings: [
            { kind: "cash", id: "c3", valueUSD: 250_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
          ],
        },
      ],
      liabilities: [],
    };
    const out = computeHealthScore(household, assumptions)!;
    const single = computeHealthScore(singleCashHousehold(750_000, "BROKERAGE"), assumptions)!;
    expect(out.diversification).toBeGreaterThan(single.diversification);
  });

  it("overall is the equal-weight average of the four pillars", () => {
    const out = computeHealthScore(singleCashHousehold(500_000), assumptions)!;
    const computed = Math.round(
      (out.progress + out.diversification + out.liquidity + out.leverageSafety) / 4,
    );
    expect(out.overall).toBe(computed);
  });
});
