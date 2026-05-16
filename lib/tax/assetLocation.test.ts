import { describe, expect, it } from "vitest";
import { assetLocationFindings } from "@/lib/tax/assetLocation";
import {
  bondTypeOf,
  geographyOf,
  styleBoxOf,
  type Household,
} from "@/lib/types";

function equity(
  id: string,
  symbol: string,
  valueUSD: number,
  cagr = 0.07,
): Household["accounts"][number]["holdings"][number] {
  return {
    id,
    kind: "equity",
    symbol,
    shares: 1,
    lastPriceUSD: valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: cagr,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  };
}

function bond(
  id: string,
  symbol: string,
  valueUSD: number,
  cagr = 0.015,
): Household["accounts"][number]["holdings"][number] {
  return {
    id,
    kind: "bond",
    symbol,
    shares: 1,
    lastPriceUSD: valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: cagr,
    leverage: 1,
    bondType: bondTypeOf({ GOVT: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 7,
  };
}

function account(
  id: string,
  category: Household["accounts"][number]["category"],
  name: string,
  holdings: Household["accounts"][number]["holdings"],
): Household["accounts"][number] {
  return {
    id,
    category,
    displayName: name,
    ownerId: "m1",
    monthlyContributionUSD: 0,
    holdings,
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

describe("assetLocationFindings", () => {
  it("flags bonds in taxable brokerage", () => {
    const hh = household([
      account("a1", "BROKERAGE", "Brokerage", [bond("b1", "BND", 50_000)]),
    ]);
    const f = assetLocationFindings(hh);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("tax-inefficient-in-taxable");
    expect(f[0].label).toBe("BND");
  });

  it("does not flag bonds in 401k", () => {
    const hh = household([
      account("a1", "401K", "401k", [bond("b1", "BND", 50_000)]),
    ]);
    expect(assetLocationFindings(hh)).toHaveLength(0);
  });

  it("flags bonds in Roth IRA (low-growth wasted)", () => {
    const hh = household([
      account("a1", "ROTH_IRA", "Roth IRA", [bond("b1", "BND", 30_000)]),
    ]);
    const f = assetLocationFindings(hh);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("low-growth-in-roth");
  });

  it("does not flag equities in any bucket", () => {
    const hh = household([
      account("a1", "BROKERAGE", "Brokerage", [equity("e1", "VTI", 100_000)]),
      account("a2", "ROTH_IRA", "Roth", [equity("e2", "VTI", 50_000)]),
      account("a3", "401K", "401k", [equity("e3", "VTI", 100_000)]),
    ]);
    expect(assetLocationFindings(hh)).toHaveLength(0);
  });

  it("sorts findings by value desc", () => {
    const hh = household([
      account("a1", "BROKERAGE", "Brok", [
        bond("b1", "BND", 20_000),
        bond("b2", "TLT", 80_000),
      ]),
    ]);
    const f = assetLocationFindings(hh);
    expect(f[0].label).toBe("TLT");
    expect(f[1].label).toBe("BND");
  });

  it("flags both tax-inefficient + low-growth simultaneously", () => {
    const hh = household([
      account("a1", "BROKERAGE", "Brok", [bond("b1", "BND", 50_000)]),
      account("a2", "ROTH_IRA", "Roth", [bond("b2", "BND", 30_000)]),
    ]);
    const f = assetLocationFindings(hh);
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.kind).sort()).toEqual([
      "low-growth-in-roth",
      "tax-inefficient-in-taxable",
    ]);
  });
});
