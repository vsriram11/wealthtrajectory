import { describe, expect, it } from "vitest";
import { rothLadder } from "@/lib/tax/rothLadder";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

function account(
  id: string,
  category: Household["accounts"][number]["category"],
  valueUSD: number,
): Household["accounts"][number] {
  return {
    id,
    category,
    displayName: id,
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

describe("rothLadder", () => {
  it("sums pre-tax balance across 401k + Trad IRA", () => {
    const hh = household([
      account("401k", "401K", 200_000),
      account("ira", "TRAD_IRA", 50_000),
      account("brok", "BROKERAGE", 100_000),
    ]);
    const r = rothLadder({ household: hh });
    expect(r.preTaxBalanceUSD).toBe(250_000);
  });

  it("zero pre-tax → no ladder", () => {
    const hh = household([account("brok", "BROKERAGE", 100_000)]);
    const r = rothLadder({ household: hh });
    expect(r.preTaxBalanceUSD).toBe(0);
    expect(r.yearsToConvert).toBeNull();
  });

  it("years-to-convert rounds up", () => {
    const hh = household([account("401k", "401K", 500_000)]);
    // Default conversion ~123.5k → 5 years to clear 500k
    const r = rothLadder({ household: hh });
    expect(r.yearsToConvert).toBe(5);
  });

  it("conversion at $0 other income stays in low brackets", () => {
    const hh = household([account("401k", "401K", 500_000)]);
    const r = rothLadder({ household: hh, otherIncomeUSD: 0 });
    expect(r.effectiveConversionRate).toBeLessThan(0.13);
  });

  it("custom annualConversion is respected", () => {
    const hh = household([account("401k", "401K", 500_000)]);
    const r = rothLadder({ household: hh, annualConversionUSD: 50_000 });
    expect(r.annualConversionUSD).toBe(50_000);
    expect(r.yearsToConvert).toBe(10);
  });

  it("lifetime savings positive when conversion rate < retiree rate", () => {
    const hh = household([account("401k", "401K", 500_000)]);
    const r = rothLadder({ household: hh, retireeOrdinaryRate: 0.24 });
    // Savings = (retireeRate - conversionRate) × convertedAmount.
    // The conversion rate at $0 other income on $500k pre-tax
    // assets sits well below 24% (≤ ~13% — see the previous test),
    // so savings should be roughly:
    //   (0.24 − ~0.13) × 500_000 ≈ $55_000
    // Asserting a meaningful floor (>$25k) catches a sign flip,
    // a missed multiplication, or accidentally returning the
    // conversion tax instead of the savings.
    expect(r.lifetimeSavingsUSD).toBeGreaterThan(25_000);
    expect(r.lifetimeSavingsUSD).toBeLessThan(100_000);
  });

  it("conversion tax positive and below the full marginal liability", () => {
    const hh = household([account("401k", "401K", 100_000)]);
    const r = rothLadder({ household: hh, otherIncomeUSD: 50_000 });
    // $100k pre-tax at $50k other income converts incrementally
    // through the brackets. Tax must be > 0 (we're definitely in
    // a positive-rate bracket) AND must be < 100% of the
    // converted amount (it's a tax, not the full sum). The lower
    // bound here also asserts the conversion happened at all —
    // a regression that bypassed the tax calc would zero this.
    expect(r.conversionTaxUSD).toBeGreaterThan(5_000);
    expect(r.conversionTaxUSD).toBeLessThan(100_000);
  });
});
