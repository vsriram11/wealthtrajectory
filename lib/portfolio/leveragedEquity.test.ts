import { describe, expect, it } from "vitest";
import { computeLeveragedEquityBuckets } from "./leveragedEquity";
import {
  EMPTY_GEOGRAPHY,
  EMPTY_STYLE_BOX,
  type CompositionLeg,
  type EquityHolding,
  type Household,
  type Member,
} from "@/lib/types";

function member(): Member {
  return {
    id: "mem-1",
    displayName: "Tester",
    age: 40,
    incomeUSD: 100_000,
    includeInRollup: true,
  };
}

function equityHolding(
  overrides: Partial<EquityHolding> & Pick<EquityHolding, "id">,
): EquityHolding {
  return {
    kind: "equity",
    symbol: "VOO",
    shares: 100,
    lastPriceUSD: 1000,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: 100_000,
    leverage: 1.0,
    expectedRealCAGR: 0.07,
    styleBox: { ...EMPTY_STYLE_BOX, LARGE_BLEND: 1 },
    geography: { ...EMPTY_GEOGRAPHY, US: 1 },
    ...overrides,
  };
}

function householdWith(holdings: EquityHolding[]): Household {
  return {
    id: "hh-1",
    members: [member()],
    accounts: [
      {
        id: "acc-1",
        ownerId: "mem-1",
        category: "BROKERAGE",
        displayName: "Test brokerage",
        holdings,
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
}

describe("computeLeveragedEquityBuckets", () => {
  it("returns zero when household has no leveraged equity", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "VOO", leverage: 1.0, valueUSD: 100_000 }),
      equityHolding({ id: "h2", symbol: "VTI", leverage: 1.0, valueUSD: 50_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(0);
    expect(buckets.nonRecognizedLeveragedUSD).toBe(0);
    expect(buckets.nonRecognizedHoldings).toEqual([]);
  });

  it("routes SSO to stocks2x bucket", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "SSO", leverage: 2.0, valueUSD: 100_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(100_000);
    expect(buckets.nonRecognizedLeveragedUSD).toBe(0);
    expect(buckets.nonRecognizedHoldings).toEqual([]);
  });

  it("routes SPUU to stocks2x bucket", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "SPUU", leverage: 2.0, valueUSD: 75_000 }),
    ]);
    expect(computeLeveragedEquityBuckets(hh).stocks2xUSD).toBe(75_000);
  });

  it("routes QLD to stocks2x bucket", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "QLD", leverage: 2.0, valueUSD: 60_000 }),
    ]);
    expect(computeLeveragedEquityBuckets(hh).stocks2xUSD).toBe(60_000);
  });

  it("routes TQQQ to non-recognized bucket with warning entry", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "TQQQ", leverage: 3.0, valueUSD: 40_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(0);
    expect(buckets.nonRecognizedLeveragedUSD).toBe(40_000);
    expect(buckets.nonRecognizedHoldings).toHaveLength(1);
    expect(buckets.nonRecognizedHoldings[0].symbol).toBe("TQQQ");
    expect(buckets.nonRecognizedHoldings[0].leverage).toBe(3.0);
    expect(buckets.nonRecognizedHoldings[0].valueUSD).toBe(40_000);
  });

  it("handles a mixed portfolio (recognized + non-recognized + plain 1x)", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "VOO", leverage: 1.0, valueUSD: 200_000 }),
      equityHolding({ id: "h2", symbol: "SSO", leverage: 2.0, valueUSD: 80_000 }),
      equityHolding({ id: "h3", symbol: "QLD", leverage: 2.0, valueUSD: 40_000 }),
      equityHolding({ id: "h4", symbol: "TQQQ", leverage: 3.0, valueUSD: 25_000 }),
      equityHolding({ id: "h5", symbol: "UPRO", leverage: 3.0, valueUSD: 30_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(120_000); // SSO + QLD
    expect(buckets.nonRecognizedLeveragedUSD).toBe(55_000); // TQQQ + UPRO
    expect(buckets.nonRecognizedHoldings).toHaveLength(2);
    const symbols = buckets.nonRecognizedHoldings.map((h) => h.symbol).sort();
    expect(symbols).toEqual(["TQQQ", "UPRO"]);
  });

  it("ignores composition-wrapped holdings (NTSX et al)", () => {
    // NTSX-style holding: leverage > 1 but has a composition spec.
    // Composition system decomposes these upstream; we shouldn't
    // double-count them here.
    const composition: CompositionLeg[] = [
      { kind: "equity", weight: 0.9 },
      { kind: "bond", weight: 0.6 },
    ];
    const hh = householdWith([
      equityHolding({
        id: "h1",
        symbol: "NTSX",
        leverage: 1.5,
        valueUSD: 100_000,
        composition,
      }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(0);
    expect(buckets.nonRecognizedLeveragedUSD).toBe(0);
    expect(buckets.nonRecognizedHoldings).toEqual([]);
  });

  it("ignores holdings with leverage == 1.0 even if ticker is in recognized set", () => {
    // Defensive: if a user happens to mark SSO as leverage=1.0 (bug or
    // manual override), don't claim 2x exposure they don't have.
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "SSO", leverage: 1.0, valueUSD: 100_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.stocks2xUSD).toBe(0);
    expect(buckets.nonRecognizedLeveragedUSD).toBe(0);
  });

  it("includes accountId and holdingId for warning UI navigation", () => {
    const hh = householdWith([
      equityHolding({ id: "hld-9", symbol: "TQQQ", leverage: 3.0, valueUSD: 50_000 }),
    ]);
    const buckets = computeLeveragedEquityBuckets(hh);
    expect(buckets.nonRecognizedHoldings[0].accountId).toBe("acc-1");
    expect(buckets.nonRecognizedHoldings[0].holdingId).toBe("hld-9");
  });
});
