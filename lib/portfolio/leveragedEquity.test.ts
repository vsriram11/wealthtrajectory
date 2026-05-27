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

  it("ignores capital-efficient multi-asset wrapper tickers even WITHOUT composition (manual-entry safety)", () => {
    // Defense-in-depth: a user who types NTSX into the form without
    // setting a composition spec should NOT have the holding flagged
    // for deleveraging or taxed. These wrappers are designed to be
    // held long-term — the ticker-based skip catches the manual-
    // entry edge case the composition check would miss.
    for (const ticker of [
      "NTSX",
      "NTSI",
      "NTSE",
      "NTSG",
      "GDE",
      "RSST",
      "RSSY",
      "RSSB",
    ]) {
      const hh = householdWith([
        equityHolding({
          id: "h1",
          symbol: ticker,
          leverage: 1.5,
          valueUSD: 100_000,
          // no composition — simulating manual entry
        }),
      ]);
      const buckets = computeLeveragedEquityBuckets(hh, 0.2);
      expect(buckets.stocks2xUSD, ticker).toBe(0);
      expect(buckets.nonRecognizedLeveragedUSD, ticker).toBe(0);
      expect(buckets.nonRecognizedHoldings, ticker).toEqual([]);
      expect(buckets.deleveragingTaxHitUSD, ticker).toBe(0);
    }
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

  it("REAL ESTATE is structurally excluded — a 5x-levered home is NOT deleveraged at retirement", () => {
    // User concern (audit round 7+): make sure mortgaged real
    // estate isn't swept into the leveraged-equity restructure
    // path. The engine filters on `holding.kind !== "equity"`
    // upfront — RE can never get into the deleveraging buckets
    // regardless of its `leverage` field value. Pin that
    // structural protection so a future refactor (e.g. unifying
    // "leveraged equity" with "leveraged anything") doesn't
    // silently start charging a deleveraging tax on a home.
    const hh: Household = {
      id: "hh-re",
      members: [member()],
      accounts: [
        {
          id: "acc-re",
          ownerId: "mem-1",
          category: "REAL_ESTATE",
          displayName: "Primary residence",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "real_estate",
              id: "hld-home",
              name: "Primary residence",
              valueUSD: 100_000, // equity stake (net of mortgage)
              expectedRealCAGR: 0.03,
              leverage: 5.0, // $500k home / $100k equity
              acquiredAt: null,
            },
          ],
        },
        {
          // Add a real leveraged-equity position so we can confirm
          // the function isn't just returning empty.
          id: "acc-eq",
          ownerId: "mem-1",
          category: "BROKERAGE",
          displayName: "Brokerage",
          monthlyContributionUSD: 0,
          holdings: [
            equityHolding({
              id: "hld-tqqq",
              symbol: "TQQQ",
              leverage: 3.0,
              valueUSD: 50_000,
            }),
          ],
        },
      ],
      liabilities: [],
    };
    const buckets = computeLeveragedEquityBuckets(hh);
    // Only TQQQ should be in the deleveraging path — NOT the RE.
    expect(buckets.nonRecognizedHoldings).toHaveLength(1);
    expect(buckets.nonRecognizedHoldings[0].holdingId).toBe("hld-tqqq");
    // No RE entry by id or by kind.
    for (const h of buckets.nonRecognizedHoldings) {
      expect(h.holdingId).not.toBe("hld-home");
    }
  });
});

describe("computeLeveragedEquityBuckets — deleveraging strategy", () => {
  it("classifies UPRO as deleverage-to-2x-spy", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "UPRO", leverage: 3.0, valueUSD: 50_000 }),
    ]);
    const b = computeLeveragedEquityBuckets(hh, 0); // 0 tax for cleaner math
    expect(b.nonRecognizedHoldings[0].deleverageStrategy).toBe("to-2x-spy");
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(50_000);
    expect(b.postTaxDiversifyToStocks1xUSD).toBe(0);
  });

  it("classifies SPXL as deleverage-to-2x-spy", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "SPXL", leverage: 3.0, valueUSD: 30_000 }),
    ]);
    const b = computeLeveragedEquityBuckets(hh, 0);
    expect(b.nonRecognizedHoldings[0].deleverageStrategy).toBe("to-2x-spy");
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(30_000);
  });

  it("classifies TQQQ as deleverage-to-2x-nasdaq", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "TQQQ", leverage: 3.0, valueUSD: 40_000 }),
    ]);
    const b = computeLeveragedEquityBuckets(hh, 0);
    expect(b.nonRecognizedHoldings[0].deleverageStrategy).toBe("to-2x-nasdaq");
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(40_000);
    expect(b.postTaxDiversifyToStocks1xUSD).toBe(0);
  });

  it("classifies SOXL / FAS / NAIL / TMF as diversify-to-1x", () => {
    for (const ticker of ["SOXL", "FAS", "NAIL", "TMF", "TNA", "TECL"]) {
      const hh = householdWith([
        equityHolding({ id: "h1", symbol: ticker, leverage: 3.0, valueUSD: 10_000 }),
      ]);
      const b = computeLeveragedEquityBuckets(hh, 0);
      expect(b.nonRecognizedHoldings[0].deleverageStrategy, ticker).toBe(
        "diversify-to-1x",
      );
      expect(b.postTaxDeleverageToStocks2xUSD).toBe(0);
      expect(b.postTaxDiversifyToStocks1xUSD).toBe(10_000);
    }
  });
});

describe("computeLeveragedEquityBuckets — deleveraging tax model", () => {
  it("applies retirement tax rate to leveraged positions in BROKERAGE (taxable) accounts", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "UPRO", leverage: 3.0, valueUSD: 100_000 }),
    ]);
    // 20% retirement tax rate, 100% gain assumption (default)
    const b = computeLeveragedEquityBuckets(hh, 0.2);
    // BROKERAGE is the default account category in householdWith()
    expect(b.nonRecognizedHoldings[0].inTaxableAccount).toBe(true);
    expect(b.nonRecognizedHoldings[0].taxHitUSD).toBe(20_000);
    expect(b.deleveragingTaxHitUSD).toBe(20_000);
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(80_000);
  });

  it("does NOT apply tax to leveraged positions in tax-advantaged accounts", () => {
    // Build a household where the leveraged holding lives in a ROTH_IRA.
    const hh: Household = {
      id: "hh-1",
      members: [
        {
          id: "mem-1",
          displayName: "Tester",
          age: 40,
          incomeUSD: 100_000,
          includeInRollup: true,
        },
      ],
      accounts: [
        {
          id: "acc-roth",
          ownerId: "mem-1",
          category: "ROTH_IRA",
          displayName: "Roth IRA",
          holdings: [
            equityHolding({
              id: "h1",
              symbol: "TQQQ",
              leverage: 3.0,
              valueUSD: 100_000,
            }),
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const b = computeLeveragedEquityBuckets(hh, 0.2);
    expect(b.nonRecognizedHoldings[0].inTaxableAccount).toBe(false);
    expect(b.nonRecognizedHoldings[0].taxHitUSD).toBe(0);
    expect(b.deleveragingTaxHitUSD).toBe(0);
    // Full value routes to stocks2x (no tax drag)
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(100_000);
  });

  it("combines tax hits across multiple taxable holdings with different strategies", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "TQQQ", leverage: 3.0, valueUSD: 50_000 }), // to-2x-nasdaq
      equityHolding({ id: "h2", symbol: "UPRO", leverage: 3.0, valueUSD: 80_000 }), // to-2x-spy
      equityHolding({ id: "h3", symbol: "SOXL", leverage: 3.0, valueUSD: 20_000 }), // diversify-to-1x
    ]);
    const b = computeLeveragedEquityBuckets(hh, 0.25);
    // All 150K of leveraged, all taxable, 25% rate → 37.5K total tax
    expect(b.deleveragingTaxHitUSD).toBeCloseTo(37_500, 0);
    // 130K (TQQQ + UPRO) → 2x post-tax
    expect(b.postTaxDeleverageToStocks2xUSD).toBeCloseTo(97_500, 0);
    // 20K SOXL → 1x post-tax
    expect(b.postTaxDiversifyToStocks1xUSD).toBeCloseTo(15_000, 0);
  });

  it("clamps retirement tax rate to [0, 0.99]", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "UPRO", leverage: 3.0, valueUSD: 100_000 }),
    ]);
    const negative = computeLeveragedEquityBuckets(hh, -0.5);
    expect(negative.deleveragingTaxHitUSD).toBe(0);
    const tooHigh = computeLeveragedEquityBuckets(hh, 1.5);
    expect(tooHigh.deleveragingTaxHitUSD).toBe(99_000); // 100K * 0.99
  });

  it("uses default retirement tax rate (20%) when no rate is passed", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "UPRO", leverage: 3.0, valueUSD: 100_000 }),
    ]);
    const b = computeLeveragedEquityBuckets(hh); // no rate arg
    expect(b.deleveragingTaxHitUSD).toBe(20_000);
  });

  it("gainFraction param scales the tax hit proportionally", () => {
    const hh = householdWith([
      equityHolding({ id: "h1", symbol: "UPRO", leverage: 3.0, valueUSD: 100_000 }),
    ]);
    // 50% gain assumption (vs the default 100%)
    const b = computeLeveragedEquityBuckets(hh, 0.2, 0.5);
    expect(b.deleveragingTaxHitUSD).toBe(10_000); // 100K × 0.5 × 0.2
    expect(b.postTaxDeleverageToStocks2xUSD).toBe(90_000);
  });
});
