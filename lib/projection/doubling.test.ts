import { describe, expect, it } from "vitest";
import { doublingAnalysis } from "@/lib/projection/doubling";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

function household(opts: {
  balanceUSD: number;
  cagr: number;
  monthlyContributionUSD?: number;
  liability?: { balanceUSD: number; rate: number; payment: number };
}): Household {
  const accounts: Household["accounts"] = [
    {
      id: "a1",
      displayName: "Brokerage",
      category: "BROKERAGE",
      ownerId: "m1",
      monthlyContributionUSD: opts.monthlyContributionUSD ?? 0,
      holdings: [
        {
          id: "h1",
          kind: "equity",
          symbol: "VTI",
          shares: 1,
          lastPriceUSD: opts.balanceUSD,
          lastPricedAt: null,
          isManualPrice: true,
          enteredAsShares: false,
          acquiredAt: null,
          valueUSD: opts.balanceUSD,
          expectedRealCAGR: opts.cagr,
          leverage: 1,
          styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
          geography: geographyOf({ US: 1 }),
        },
      ],
    },
  ];
  const liabilities: Household["liabilities"] = opts.liability
    ? [
        {
          id: "l1",
          name: "Loan",
          balanceUSD: opts.liability.balanceUSD,
          annualInterestRate: opts.liability.rate,
          monthlyPaymentUSD: opts.liability.payment,
          ownerId: "m1",
        },
      ]
    : [];
  return {
    id: "hh1",
    members: [{ id: "m1", displayName: "You" }],
    accounts,
    liabilities,
  };
}

describe("doublingAnalysis", () => {
  it("returns nulls for non-positive net worth", () => {
    const a = doublingAnalysis(household({ balanceUSD: 0, cagr: 0.07 }));
    expect(a.startingUSD).toBeNull();
    expect(a.baseMonths).toBeNull();
    expect(a.withContributionsMonths).toBeNull();
    expect(a.roadmap).toEqual([]);
  });

  it("rule-of-72: 7% real CAGR doubles in ~10.2 years", () => {
    const a = doublingAnalysis(household({ balanceUSD: 100_000, cagr: 0.07 }));
    expect(a.baseMonths).not.toBeNull();
    // ln(2)/ln(1.07) ≈ 10.245 yr → 123 months
    expect(a.baseMonths!).toBeGreaterThanOrEqual(121);
    expect(a.baseMonths!).toBeLessThanOrEqual(124);
  });

  it("contributions shorten doubling time", () => {
    const noContrib = doublingAnalysis(
      household({ balanceUSD: 100_000, cagr: 0.07 }),
    );
    const withContrib = doublingAnalysis(
      household({
        balanceUSD: 100_000,
        cagr: 0.07,
        monthlyContributionUSD: 1_000,
      }),
    );
    expect(withContrib.withContributionsMonths).not.toBeNull();
    expect(withContrib.withContributionsMonths!).toBeLessThan(
      noContrib.withContributionsMonths!,
    );
  });

  it("roadmap is monotonically increasing in months", () => {
    const a = doublingAnalysis(
      household({
        balanceUSD: 100_000,
        cagr: 0.07,
        monthlyContributionUSD: 500,
      }),
    );
    for (let i = 1; i < a.roadmap.length; i++) {
      expect(a.roadmap[i].monthsFromNow).toBeGreaterThan(
        a.roadmap[i - 1].monthsFromNow,
      );
    }
  });

  it("zero CAGR with contributions still doubles via contributions alone", () => {
    const a = doublingAnalysis(
      household({
        balanceUSD: 12_000,
        cagr: 0,
        monthlyContributionUSD: 1_000,
      }),
    );
    // baseMonths null (no compounding), but contribution-mode reaches 2× in ~12 mo
    expect(a.baseMonths).toBeNull();
    expect(a.withContributionsMonths).toBeGreaterThanOrEqual(11);
    expect(a.withContributionsMonths).toBeLessThanOrEqual(13);
  });
});
