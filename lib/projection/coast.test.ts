import { describe, expect, it } from "vitest";
import { coastAnalysis } from "@/lib/projection/coast";
import type { Assumptions, Household } from "@/lib/types";

const assumptions: Assumptions = {
  targetNetWorthUSD: 1_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

function makeHousehold(initialUSD: number, monthlyContrib: number): Household {
  return {
    id: "t",
    members: [{ id: "m1", displayName: "You" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        monthlyContributionUSD: monthlyContrib,
        holdings: [
          {
            kind: "equity",
            id: "voo",
            symbol: "VOO",
            shares: 100,
            lastPriceUSD: initialUSD / 100,
            lastPricedAt: null,
            isManualPrice: false,
            enteredAsShares: false,
            acquiredAt: null,
            valueUSD: initialUSD,
            expectedRealCAGR: 0.07,
            leverage: 1,
            styleBox: { LARGE_VALUE: 0, LARGE_BLEND: 1, LARGE_GROWTH: 0, MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0, SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0 },
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
          },
        ],
      },
    ],
    liabilities: [],
  };
}

describe("coastAnalysis", () => {
  it("flags alreadyCoasting when totalContrib === 0", () => {
    const out = coastAnalysis(makeHousehold(500_000, 0), assumptions);
    expect(out.alreadyCoasting).toBe(true);
  });

  it("coasting is slower than contributing (cost is non-negative)", () => {
    const out = coastAnalysis(makeHousehold(500_000, 2_000), assumptions);
    expect(out.monthsCoast).not.toBeNull();
    expect(out.monthsContributing).not.toBeNull();
    expect(out.monthsCostOfCoasting).not.toBeNull();
    // The cost is defined as monthsCoast − monthsContributing.
    // Contributing must always be ≤ coasting (you can stop
    // contributing or not — the no-contribute path can't reach
    // the target faster than the contribute path). Cross-check
    // the identity directly rather than just asserting the sign.
    expect(out.monthsCostOfCoasting!).toBe(
      out.monthsCoast! - out.monthsContributing!,
    );
    expect(out.monthsCoast!).toBeGreaterThanOrEqual(out.monthsContributing!);
  });

  it("returns null monthsCoast when starting NW too low to compound to target in 70y", () => {
    // $1K compounding at 7% reaches ~$118K in 70y, not $1M.
    const out = coastAnalysis(makeHousehold(1_000, 2_000), assumptions);
    expect(out.monthsCoast).toBeNull();
    // But contributing path still works (large monthly contrib).
    expect(out.monthsContributing).not.toBeNull();
    expect(out.monthsCostOfCoasting).toBeNull();
  });

  it("high starting NW: coast time approaches contributing time (small cost)", () => {
    const out = coastAnalysis(makeHousehold(900_000, 1_000), assumptions);
    expect(out.monthsCoast).not.toBeNull();
    expect(out.monthsContributing).not.toBeNull();
    // Already 90% of the way there; not much cost to stopping
    expect(out.monthsCostOfCoasting!).toBeLessThan(36);
  });
});
