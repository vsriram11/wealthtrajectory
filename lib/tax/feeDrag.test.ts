import { describe, expect, it } from "vitest";
import { feeAnalysis, lookupFee } from "@/lib/tax/feeDrag";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

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

function household(
  holdings: ReturnType<typeof equity>[],
): Household {
  return {
    id: "hh",
    members: [{ id: "m1", displayName: "You" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings,
      },
    ],
    liabilities: [],
  };
}

describe("feeAnalysis", () => {
  it("lookupFee returns null for unknown symbols", () => {
    expect(lookupFee("UNKNOWN")).toBeNull();
    expect(lookupFee("")).toBeNull();
  });

  it("lookupFee uppercases input", () => {
    expect(lookupFee("vti")?.symbol).toBe("VTI");
  });

  it("skips unknown symbols", () => {
    const hh = household([equity("h1", "WTFISTHIS", 100_000)]);
    const a = feeAnalysis(hh);
    expect(a.rows).toHaveLength(0);
    expect(a.totalAnnualFeeUSD).toBe(0);
  });

  it("computes annual fee and lifetime drag for known symbols", () => {
    const hh = household([equity("h1", "VTI", 100_000)]);
    const a = feeAnalysis(hh, 30);
    expect(a.rows).toHaveLength(1);
    const r = a.rows[0];
    // 0.03% on $100k = $30/yr.
    expect(r.annualFeeUSD).toBeCloseTo(30, 2);
    // Lifetime drag bounds: floor is the simple annuity sum ($30
    // × 30y = $900); the actual drag is higher because the fee
    // compounds out of growing principal. Ceiling at $15k (≈
    // 17× the simple sum) catches a regression where the
    // compounding factor explodes (e.g. accidentally compounding
    // the FEE not the FORGONE GROWTH).
    expect(r.lifetimeDragUSD).toBeGreaterThan(900);
    expect(r.lifetimeDragUSD).toBeLessThan(15_000);
  });

  it("aggregates same symbol across positions", () => {
    const hh = household([
      equity("h1", "VTI", 50_000),
      equity("h2", "VTI", 50_000),
    ]);
    const a = feeAnalysis(hh, 30);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].bucketUSD).toBe(100_000);
  });

  it("flags SPY → VOO cheaper alternative", () => {
    const hh = household([equity("h1", "SPY", 100_000)]);
    const a = feeAnalysis(hh, 30);
    expect(a.rows).toHaveLength(1);
    const r = a.rows[0];
    expect(r.cheaperAlternative?.symbol).toBe("VOO");
    expect(r.switchSavingsUSD).not.toBeNull();
    // Savings = SPY drag − VOO drag. SPY = 9bps, VOO = 3bps;
    // the 6bps gap on $100k compounding over 30y at ~7% real
    // produces ≈ $13-14k of saved growth. Floor ($1k) catches a
    // regression where SPY and VOO get mis-ranked; ceiling
    // ($25k) catches a compounding-formula explosion.
    expect(r.switchSavingsUSD!).toBeGreaterThan(1_000);
    expect(r.switchSavingsUSD!).toBeLessThan(25_000);
  });

  it("rows sorted by lifetime drag desc", () => {
    const hh = household([
      equity("h1", "VTI", 10_000),
      equity("h2", "SPY", 100_000),
      equity("h3", "QQQ", 50_000),
    ]);
    const a = feeAnalysis(hh, 30);
    for (let i = 1; i < a.rows.length; i++) {
      expect(a.rows[i].lifetimeDragUSD).toBeLessThanOrEqual(
        a.rows[i - 1].lifetimeDragUSD,
      );
    }
  });

  it("totals are sums of per-row values", () => {
    const hh = household([equity("h1", "VTI", 50_000), equity("h2", "SPY", 100_000)]);
    const a = feeAnalysis(hh, 30);
    const sumAnnual = a.rows.reduce((s, r) => s + r.annualFeeUSD, 0);
    const sumDrag = a.rows.reduce((s, r) => s + r.lifetimeDragUSD, 0);
    expect(a.totalAnnualFeeUSD).toBeCloseTo(sumAnnual, 2);
    expect(a.totalLifetimeDragUSD).toBeCloseTo(sumDrag, 2);
  });
});
