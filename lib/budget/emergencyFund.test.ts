import { describe, expect, it } from "vitest";
import { emergencyFundAdequacy } from "@/lib/budget/emergencyFund";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

function cashAccount(
  id: string,
  category: Household["accounts"][number]["category"],
  name: string,
  valueUSD: number,
): Household["accounts"][number] {
  return {
    id,
    category,
    displayName: name,
    ownerId: "m1",
    monthlyContributionUSD: 0,
    holdings: [
      {
        id: `${id}-h`,
        kind: "cash",
        valueUSD,
        expectedRealCAGR: 0,
        geography: geographyOf({ US: 1 }),
      },
    ],
  };
}

function equityAccount(
  id: string,
  category: Household["accounts"][number]["category"],
  name: string,
  valueUSD: number,
): Household["accounts"][number] {
  return {
    id,
    category,
    displayName: name,
    ownerId: "m1",
    monthlyContributionUSD: 0,
    holdings: [
      {
        id: `${id}-h`,
        kind: "equity",
        symbol: "VTI",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        acquiredAt: null,
        valueUSD,
        expectedRealCAGR: 0.07,
        leverage: 1,
        styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
        geography: geographyOf({ US: 1 }),
      },
    ],
  };
}

function household(accounts: Household["accounts"]): Household {
  return {
    id: "hh",
    members: [{ id: "m1", displayName: "You" }],
    accounts,
    liabilities: [],
  };
}

describe("emergencyFundAdequacy", () => {
  it("returns null without monthlyBurn", () => {
    const hh = household([cashAccount("a", "SAVINGS", "HYS", 10_000)]);
    expect(emergencyFundAdequacy(hh, 0)).toBeNull();
    expect(emergencyFundAdequacy(hh, NaN)).toBeNull();
  });

  it("sums SAVINGS + CHECKING only", () => {
    const hh = household([
      cashAccount("a", "SAVINGS", "HYS", 30_000),
      cashAccount("b", "CHECKING", "BoA", 5_000),
      equityAccount("c", "BROKERAGE", "Brok", 200_000),
    ]);
    const r = emergencyFundAdequacy(hh, 5_000)!;
    expect(r.emergencyFundUSD).toBe(35_000);
    expect(r.monthsOfRunway).toBeCloseTo(7);
  });

  it("excludes BROKERAGE / CRYPTO / 401k", () => {
    const hh = household([
      equityAccount("a", "BROKERAGE", "Brok", 100_000),
      equityAccount("b", "CRYPTO", "Coinbase", 50_000),
      equityAccount("c", "401K", "401k", 200_000),
    ]);
    const r = emergencyFundAdequacy(hh, 5_000)!;
    expect(r.emergencyFundUSD).toBe(0);
    expect(r.status).toBe("under");
  });

  it("status: under / okay / ample", () => {
    const hh = (val: number) =>
      household([cashAccount("a", "SAVINGS", "HYS", val)]);
    // 6 months recommended at $5k = $30k target
    expect(emergencyFundAdequacy(hh(10_000), 5_000)!.status).toBe("under");
    expect(emergencyFundAdequacy(hh(30_000), 5_000)!.status).toBe("okay");
    expect(emergencyFundAdequacy(hh(60_000), 5_000)!.status).toBe("ample");
  });

  it("computes shortfall when under", () => {
    const hh = household([cashAccount("a", "SAVINGS", "HYS", 5_000)]);
    const r = emergencyFundAdequacy(hh, 5_000, 6)!;
    expect(r.shortfallUSD).toBe(25_000);
  });

  it("shortfall = 0 when fully funded", () => {
    const hh = household([cashAccount("a", "SAVINGS", "HYS", 50_000)]);
    const r = emergencyFundAdequacy(hh, 5_000, 6)!;
    expect(r.shortfallUSD).toBe(0);
  });

  it("respects custom recommendedMonths", () => {
    const hh = household([cashAccount("a", "SAVINGS", "HYS", 30_000)]);
    const r3 = emergencyFundAdequacy(hh, 5_000, 3)!;
    const r12 = emergencyFundAdequacy(hh, 5_000, 12)!;
    expect(r3.status).toBe("ample");
    expect(r12.status).toBe("under");
  });
});
