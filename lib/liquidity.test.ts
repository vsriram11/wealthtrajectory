import { describe, expect, it } from "vitest";
import { DEMO_HOUSEHOLD } from "@/lib/demo";
import {
  isLiquid,
  liquidHousehold,
  liquidNetWorth,
  illiquidNetWorth,
  householdNetWorth,
  type Household,
  type Holding,
} from "@/lib/types";

function withHolding(base: Household, h: Holding, accountIndex = 0): Household {
  const accounts = base.accounts.map((a, i) =>
    i === accountIndex ? { ...a, holdings: [...a.holdings, h] } : a,
  );
  return { ...base, accounts };
}

describe("isLiquid", () => {
  it("classifies stock/bond/cash/crypto as liquid by default", () => {
    const equity: Holding = {
      kind: "equity",
      id: "e",
      symbol: "VOO",
      shares: 1,
      lastPriceUSD: 100,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: 100,
      expectedRealCAGR: 0.07,
      leverage: 1,
      styleBox: {
        LARGE_VALUE: 0, LARGE_BLEND: 1, LARGE_GROWTH: 0,
        MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0,
        SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0,
      },
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    };
    expect(isLiquid(equity)).toBe(true);
  });

  it("classifies private_stock as illiquid always", () => {
    const ps: Holding = {
      kind: "private_stock",
      id: "p",
      symbol: "Acme",
      shares: 100,
      lastPriceUSD: 1,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: 100,
      expectedRealCAGR: 0,
      leverage: 1,
      preferredRoundPricePerShareUSD: null,
    };
    expect(isLiquid(ps)).toBe(false);
  });

  it("classifies real_estate as liquid by default, illiquid when isPrimaryResidence", () => {
    const re: Holding = {
      kind: "real_estate",
      id: "r1",
      name: "Rental",
      valueUSD: 100_000,
      expectedRealCAGR: 0.02,
      acquiredAt: null,
      leverage: 1,
    };
    expect(isLiquid(re)).toBe(true);
    expect(isLiquid({ ...re, isPrimaryResidence: true })).toBe(false);
  });

  it("respects the user-set isIlliquid override on regular kinds", () => {
    const cash: Holding = {
      kind: "cash",
      id: "c",
      valueUSD: 50_000,
      expectedRealCAGR: 0,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    };
    expect(isLiquid(cash)).toBe(true);
    expect(isLiquid({ ...cash, isIlliquid: true })).toBe(false);
  });
});

describe("liquidHousehold", () => {
  // Demo baseline: liquid filter is idempotent — running it on an
  // already-filtered household yields the same NW. (The demo itself
  // ships with some illiquid holdings — a primary residence — so
  // this is "filter applies cleanly", not "filter is a no-op".)
  it("liquid filter is idempotent on the demo", () => {
    const once = liquidNetWorth(DEMO_HOUSEHOLD);
    const twice = householdNetWorth(liquidHousehold(liquidHousehold(DEMO_HOUSEHOLD)));
    expect(twice).toBeCloseTo(once);
  });

  it("adding an illiquid private-stock raises illiquid NW by its value", () => {
    const ps: Holding = {
      kind: "private_stock",
      id: "ps1",
      symbol: "Acme",
      shares: 100_000,
      lastPriceUSD: 1,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: 100_000,
      expectedRealCAGR: 0,
      leverage: 1,
      preferredRoundPricePerShareUSD: null,
    };
    const withPS = withHolding(DEMO_HOUSEHOLD, ps);
    // Total NW grows by exactly the PS value.
    expect(householdNetWorth(withPS)).toBeCloseTo(
      householdNetWorth(DEMO_HOUSEHOLD) + 100_000,
    );
    // Liquid NW unchanged because PS is illiquid.
    expect(liquidNetWorth(withPS)).toBeCloseTo(
      liquidNetWorth(DEMO_HOUSEHOLD),
    );
    // Illiquid NW grows by the PS value.
    expect(illiquidNetWorth(withPS)).toBeCloseTo(
      illiquidNetWorth(DEMO_HOUSEHOLD) + 100_000,
    );
  });

  it("keeps liabilities even when the matching asset is illiquid", () => {
    // A primary residence with $300K equity plus a $200K mortgage:
    // liquid NW should subtract the mortgage from $0 (because the
    // residence is filtered out), making liquid NW lower than total
    // by the full property equity.
    const re: Holding = {
      kind: "real_estate",
      id: "re-home",
      name: "Home",
      valueUSD: 300_000,
      expectedRealCAGR: 0.02,
      acquiredAt: null,
      leverage: 1,
      isPrimaryResidence: true,
    };
    const baseLiabilities = DEMO_HOUSEHOLD.liabilities;
    const ownerId = DEMO_HOUSEHOLD.members[0].id;
    const withHome: Household = withHolding(DEMO_HOUSEHOLD, re);
    const withHomeAndMortgage: Household = {
      ...withHome,
      liabilities: [
        ...baseLiabilities,
        {
          id: "l-mort",
          name: "Mortgage",
          balanceUSD: 200_000,
          annualInterestRate: 0.06,
          monthlyPaymentUSD: 1500,
          ownerId,
        },
      ],
    };
    const total = householdNetWorth(withHomeAndMortgage);
    const liquid = liquidNetWorth(withHomeAndMortgage);
    // Compare against the demo baseline: adding a $300k illiquid
    // residence should widen (total - liquid) by exactly $300k.
    const baseGap =
      householdNetWorth(DEMO_HOUSEHOLD) - liquidNetWorth(DEMO_HOUSEHOLD);
    expect(total - liquid - baseGap).toBeCloseTo(300_000);
  });
});

describe("liquid view drives Independence projection (composability check)", () => {
  it("liquidHousehold composes with projectIndependence transparently", async () => {
    const { projectIndependence } = await import("@/lib/projection/independence");
    const { DEMO_ASSUMPTIONS } = await import("@/lib/demo");

    const ps: Holding = {
      kind: "private_stock",
      id: "ps-fire",
      symbol: "Acme",
      shares: 1_000_000,
      lastPriceUSD: 0.5,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: 500_000,
      expectedRealCAGR: 0,
      leverage: 1,
      preferredRoundPricePerShareUSD: null,
    };
    const withPS = withHolding(DEMO_HOUSEHOLD, ps);
    const total = projectIndependence(withPS, DEMO_ASSUMPTIONS);
    const liquidOnly = projectIndependence(liquidHousehold(withPS), DEMO_ASSUMPTIONS);
    // Including a half-million in private stock should reach Independence
    // no later than the liquid-only view that excludes it.
    if (total.monthsToIndependence == null || liquidOnly.monthsToIndependence == null) {
      throw new Error("expected both projections to reach Independence");
    }
    expect(total.monthsToIndependence).toBeLessThanOrEqual(liquidOnly.monthsToIndependence);
  });
});

describe("isDemoHousehold fingerprint guard", () => {
  it("flags the actual DEMO_HOUSEHOLD as demo", async () => {
    const { isDemoHousehold } = await import("@/lib/types");
    expect(isDemoHousehold(DEMO_HOUSEHOLD)).toBe(true);
  });

  it("does not flag a fresh real household", async () => {
    const { isDemoHousehold } = await import("@/lib/types");
    const real: Household = {
      id: "real-household",
      members: [{ id: "mem-real-1", displayName: "You" }],
      accounts: [],
      liabilities: [],
    };
    expect(isDemoHousehold(real)).toBe(false);
  });
});
