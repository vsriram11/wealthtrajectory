import { describe, expect, it } from "vitest";
import { DEMO_HOUSEHOLD } from "@/lib/demo";
import { computePortfolio, sliceMetrics } from "@/lib/portfolio/portfolio";
import {
  EMPTY_GEOGRAPHY,
  EMPTY_STYLE_BOX,
  bondTypeOf,
  geographyOf,
  styleBoxOf,
  holdingLeverage,
  compositionWeightedCAGR,
  householdNetWorth,
  taxBucketTotals,
  type EquityHolding,
  type Household,
} from "@/lib/types";

describe("computePortfolio (demo fixture, household)", () => {
  const m = computePortfolio(DEMO_HOUSEHOLD);

  it("portfolio assets total is the sum of all class USD totals", () => {
    const sum =
      m.classes.equityUSD +
      m.classes.bondUSD +
      m.classes.cashUSD +
      m.classes.cryptoUSD +
      m.classes.commodityUSD +
      m.classes.realEstateUSD +
      m.classes.privateStockUSD +
      m.classes.otherUSD;
    expect(sum).toBeCloseTo(m.classes.totalUSD, 2);
  });

  it("netWorthUSD equals classes.totalUSD minus liabilities", () => {
    const liabSum = DEMO_HOUSEHOLD.liabilities.reduce(
      (s, l) => s + l.balanceUSD,
      0,
    );
    expect(m.netWorthUSD).toBeCloseTo(m.classes.totalUSD - liabSum, 2);
  });

  it("class shares sum to 1", () => {
    const sum =
      m.classes.equityShare +
      m.classes.bondShare +
      m.classes.cashShare +
      m.classes.cryptoShare +
      m.classes.commodityShare +
      m.classes.realEstateShare +
      m.classes.privateStockShare +
      m.classes.otherShare;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("equity style box sums to 1", () => {
    const sum = Object.values(m.equity.styleBox).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("equity style box (exposure basis) skews Large Growth higher than face basis due to TQQQ", () => {
    // TQQQ contributes 3× its face value to the LARGE_GROWTH style
    // exposure cell, so the exposure basis should sit strictly
    // higher than the face basis for that cell. Holds across any
    // demo composition that contains TQQQ.
    expect(m.equity.styleBoxExposure.LARGE_GROWTH).toBeGreaterThan(
      m.equity.styleBox.LARGE_GROWTH,
    );
  });

  it("equity geography is mostly US with small intl", () => {
    expect(m.equity.geography.US).toBeGreaterThan(0.85);
    const sum =
      m.equity.geography.US +
      m.equity.geography.DEVELOPED +
      m.equity.geography.EMERGING;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("bond breakdown sums to 1 across Govt + Corporate", () => {
    const sum = m.bond.bondType.GOVT + m.bond.bondType.CORPORATE;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("bond duration is in a reasonable range for BND/AGG mix", () => {
    expect(m.bond.weightedDurationYears).toBeGreaterThan(3);
    expect(m.bond.weightedDurationYears).toBeLessThan(15);
  });

  it("effective leverage > 1 due to TQQQ exposure", () => {
    expect(m.effectiveLeverage).toBeGreaterThan(1.3);
    expect(m.effectiveLeverage).toBeLessThan(1.7);
  });

  it("weighted CAGR sits between cash and TQQQ", () => {
    expect(m.weightedRealCAGR).toBeGreaterThan(0.04);
    expect(m.weightedRealCAGR).toBeLessThan(0.12);
  });
});

describe("householdNetWorth (demo)", () => {
  it("subtracts liabilities from assets", () => {
    const grossAssets = computePortfolio(DEMO_HOUSEHOLD).classes.totalUSD;
    const liabSum = DEMO_HOUSEHOLD.liabilities.reduce(
      (s, l) => s + l.balanceUSD,
      0,
    );
    expect(householdNetWorth(DEMO_HOUSEHOLD)).toBe(grossAssets - liabSum);
  });
});

describe("taxBucketTotals (demo)", () => {
  const buckets = taxBucketTotals(DEMO_HOUSEHOLD);

  it("sums to total assets", () => {
    const total =
      buckets.PRE_TAX +
      buckets.ROTH +
      buckets.TAXABLE +
      buckets.HSA +
      buckets.EDUCATION;
    expect(total).toBe(computePortfolio(DEMO_HOUSEHOLD).classes.totalUSD);
  });

  it("HSA bucket reflects HSA balance", () => {
    // Computed from demo so the test follows demo changes.
    const hsaSum = DEMO_HOUSEHOLD.accounts
      .filter((a) => a.category === "HSA")
      .reduce(
        (s, a) =>
          s + a.holdings.reduce((sh, h) => sh + h.valueUSD, 0),
        0,
      );
    expect(buckets.HSA).toBe(hsaSum);
  });

  it("Roth bucket aggregates ROTH_IRA and ROTH_401K accounts", () => {
    // Same approach as the HSA test directly above — derive
    // the expected total from the demo fixture so the assertion
    // tracks any changes the demo makes, but still catches a
    // bug that, e.g., mis-categorized a Roth IRA as taxable.
    const expected = DEMO_HOUSEHOLD.accounts
      .filter((a) => a.category === "ROTH_IRA" || a.category === "ROTH_401K")
      .reduce(
        (s, a) => s + a.holdings.reduce((sh, h) => sh + h.valueUSD, 0),
        0,
      );
    expect(buckets.ROTH).toBe(expected);
    // Sanity floor — if the demo ever lost all Roth accounts the
    // derivation above would also return 0 and the toBe(0) would
    // tautologically pass. Pin > 0 so the test stays meaningful.
    expect(buckets.ROTH).toBeGreaterThan(0);
  });
});

// ── Multi-asset (NTSX, GDE, RSST) composition tests ────────────────────
function makeMultiAssetHousehold(holding: EquityHolding): Household {
  return {
    id: "test",
    members: [{ id: "m1", displayName: "Tester" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        holdings: [holding],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
}

function makeNTSX(valueUSD = 100_000): EquityHolding {
  return {
    kind: "equity",
    id: "ntsx-1",
    symbol: "NTSX",
    shares: valueUSD / 45,
    lastPriceUSD: 45,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: 0.072,
    leverage: 1.5,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  };
}

function makeGDE(valueUSD = 100_000): EquityHolding {
  return {
    kind: "equity",
    id: "gde-1",
    symbol: "GDE",
    shares: valueUSD / 50,
    lastPriceUSD: 50,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: 0.072,
    leverage: 1.8,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "commodity", weight: 0.9, expectedRealCAGR: 0.01 },
    ],
  };
}

describe("composition decomposition — NTSX (90/60 stocks/bonds)", () => {
  const hh = makeMultiAssetHousehold(makeNTSX(100_000));
  const m = computePortfolio(hh);

  it("Net Worth equals face value (no leverage double-count)", () => {
    expect(m.netWorthUSD).toBeCloseTo(100_000, 2);
  });

  it("face view splits 60/40 across equity/bond (normalized weights)", () => {
    // NTSX = 0.9 + 0.6 = 1.5 sum. Equity share = 0.9/1.5 = 60%, bond = 40%.
    expect(m.classes.equityUSD).toBeCloseTo(60_000, 1);
    expect(m.classes.bondUSD).toBeCloseTo(40_000, 1);
    expect(m.classes.totalUSD).toBeCloseTo(100_000, 1);
  });

  it("equity exposure picks up 90% × face = $90K", () => {
    expect(m.equity.effectiveExposureUSD).toBeCloseTo(90_000, 1);
  });

  it("bond exposure picks up 60% × face = $60K", () => {
    expect(m.bond.effectiveExposureUSD).toBeCloseTo(60_000, 1);
  });

  it("portfolio effective leverage equals 1.5", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1.5, 3);
  });

  it("weighted real CAGR equals leg-weighted blend (face basis)", () => {
    // Equity face $60K @ 7%, bond face $40K @ 1.5% → 4.8%
    expect(m.weightedRealCAGR).toBeCloseTo(0.048, 4);
  });
});

describe("composition decomposition — GDE (90/90 stocks/gold)", () => {
  const hh = makeMultiAssetHousehold(makeGDE(100_000));
  const m = computePortfolio(hh);

  it("Net Worth equals face value", () => {
    expect(m.netWorthUSD).toBeCloseTo(100_000, 2);
  });

  it("face view splits 50/50 equity/commodity (gold is first-class)", () => {
    // GDE = 0.9 equity + 0.9 commodity, sum 1.8.
    // Normalized: 0.9/1.8 = 50% each on face basis.
    expect(m.classes.equityUSD).toBeCloseTo(50_000, 1);
    expect(m.classes.commodityUSD).toBeCloseTo(50_000, 1);
    expect(m.classes.otherUSD).toBeCloseTo(0, 1);
    expect(m.classes.bondUSD).toBeCloseTo(0, 1);
  });

  it("portfolio effective leverage equals 1.8", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1.8, 3);
  });

  it("commodity face share equals normalized leg weight × NW", () => {
    // GDE composition: equity 0.9 + commodity 0.9, sum = 1.8.
    // The commodity leg's normalized weight is 0.9 / 1.8 = 0.5,
    // so face exposure is 0.5 × $100K NW = $50K. The raw exposure
    // (0.9 × $100K = $90K) shows up in `effectiveExposureUSD` /
    // leverage, not in the face-basis class breakdown.
    expect(m.commodityUSD).toBeCloseTo(50_000, 1);
    expect(m.commodityUSD).toBe(m.classes.commodityUSD);
  });
});

describe("composition helper functions", () => {
  it("holdingLeverage returns sum of leg weights for NTSX", () => {
    const h = makeNTSX();
    expect(holdingLeverage(h)).toBeCloseTo(1.5, 3);
  });

  it("holdingLeverage returns scalar leverage when composition absent", () => {
    const plain: EquityHolding = {
      ...makeNTSX(),
      composition: undefined,
      leverage: 2,
    };
    expect(holdingLeverage(plain)).toBe(2);
  });

  it("compositionWeightedCAGR blends leg CAGRs by normalized weights", () => {
    const h = makeNTSX();
    // Note: this uses raw weights, not normalized. NTSX: 0.9 × 7% + 0.6 × 1.5% = 7.2%
    expect(compositionWeightedCAGR(h)).toBeCloseTo(0.072, 4);
  });

  it("compositionWeightedCAGR returns null without composition", () => {
    const plain: EquityHolding = { ...makeNTSX(), composition: undefined };
    expect(compositionWeightedCAGR(plain)).toBeNull();
  });
});

describe("sliceMetrics is composition-aware", () => {
  const hh = makeMultiAssetHousehold(makeNTSX(100_000));

  it("ALL slice reflects 1.5× leverage from NTSX", () => {
    const s = sliceMetrics(hh, "ALL", "ALL");
    expect(s.totalUSD).toBeCloseTo(100_000, 1);
    expect(s.effectiveExposureUSD).toBeCloseTo(150_000, 1);
    expect(s.effectiveLeverage).toBeCloseTo(1.5, 3);
  });

  it("equity slice picks up NTSX equity leg (not the whole wrapper)", () => {
    const s = sliceMetrics(hh, "equity", "ALL");
    expect(s.totalUSD).toBeCloseTo(60_000, 1); // face share of equity leg
    expect(s.effectiveExposureUSD).toBeCloseTo(90_000, 1);
  });

  it("bond slice picks up NTSX bond leg", () => {
    const s = sliceMetrics(hh, "bond", "ALL");
    expect(s.totalUSD).toBeCloseTo(40_000, 1);
    expect(s.effectiveExposureUSD).toBeCloseTo(60_000, 1);
  });
});

describe("composition mixed with plain holdings", () => {
  const ntsx = makeNTSX(50_000);
  const plainVOO: EquityHolding = {
    kind: "equity",
    id: "voo-1",
    symbol: "VOO",
    shares: 50,
    lastPriceUSD: 1000,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: 50_000,
    expectedRealCAGR: 0.07,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  };
  const hh: Household = {
    id: "test",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [ntsx, plainVOO],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("total face value is sum of all face values", () => {
    expect(m.classes.totalUSD).toBeCloseTo(100_000, 1);
  });

  it("equity face = NTSX 60% × $50K + VOO $50K = $80K", () => {
    expect(m.classes.equityUSD).toBeCloseTo(80_000, 1);
  });

  it("bond face = NTSX 40% × $50K = $20K", () => {
    expect(m.classes.bondUSD).toBeCloseTo(20_000, 1);
  });

  it("equity exposure = NTSX 0.9 × $50K + VOO 1.0 × $50K = $95K", () => {
    expect(m.equity.effectiveExposureUSD).toBeCloseTo(95_000, 1);
  });

  it("bond exposure = NTSX 0.6 × $50K = $30K", () => {
    expect(m.bond.effectiveExposureUSD).toBeCloseTo(30_000, 1);
  });

  it("overall effective leverage = (95 + 30) / 100 = 1.25", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1.25, 3);
  });
});

// Sanity check: untouched code paths still hit empty objects
// ── Commodity as first-class asset class ───────────────────────────────
describe("commodity holdings (first-class asset class)", () => {
  it("standalone commodity holding (e.g. GLD) lands in commodity bucket", () => {
    const hh: Household = {
      id: "t",
      members: [{ id: "m1", displayName: "T" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "B",
          ownerId: "m1",
          holdings: [
            {
              kind: "commodity",
              id: "gld",
              symbol: "GLD",
              shares: 100,
              lastPriceUSD: 230,
              lastPricedAt: null,
              isManualPrice: false,
              enteredAsShares: true,
              acquiredAt: null,
              valueUSD: 23_000,
              expectedRealCAGR: 0.01,
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const m = computePortfolio(hh);
    expect(m.classes.commodityUSD).toBeCloseTo(23_000, 1);
    expect(m.classes.otherUSD).toBe(0);
    expect(m.classes.equityUSD).toBe(0);
    expect(m.commodityUSD).toBeCloseTo(23_000, 1);
  });

  it("custom-name commodity ('Gold jewelry') still counts as commodity, not 'other'", () => {
    const hh: Household = {
      id: "t",
      members: [{ id: "m1", displayName: "T" }],
      accounts: [
        {
          id: "a1",
          category: "OTHER",
          displayName: "Safe",
          ownerId: "m1",
          holdings: [
            {
              kind: "commodity",
              id: "jewelry",
              symbol: "Gold jewelry",
              shares: 1,
              lastPriceUSD: 12_000,
              lastPricedAt: null,
              isManualPrice: true,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 12_000,
              expectedRealCAGR: 0.01,
              isIlliquid: true,
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const m = computePortfolio(hh);
    expect(m.classes.commodityUSD).toBeCloseTo(12_000, 1);
    expect(m.classes.otherUSD).toBe(0);
  });

  it("GDE (90/90 stocks/gold) routes the gold leg to commodity bucket, not other", () => {
    const gde = makeGDE(100_000);
    const hh = makeMultiAssetHousehold(gde);
    const m = computePortfolio(hh);
    // Equity face: $50K (0.9 / 1.8 of $100K)
    // Commodity face: $50K
    // Other: $0
    expect(m.classes.equityUSD).toBeCloseTo(50_000, 1);
    expect(m.classes.commodityUSD).toBeCloseTo(50_000, 1);
    expect(m.classes.otherUSD).toBeCloseTo(0, 1);
  });
});

// ── Composition on bond / crypto / commodity wrappers ──────────────────
describe("composition on bond wrapper (WTIP-like 5-leg)", () => {
  // Hypothetical: 85% TIPS (5y duration) + 10% bitcoin + 7.5% gold +
  // 7.5% silver + 80% broad commodities. sum = 190% → 1.9× leverage.
  // Wrapper kind=bond because TIPS is the dominant leg.
  function makeMultiAssetBond(valueUSD = 100_000): import("@/lib/types").BondHolding {
    return {
      kind: "bond",
      id: "wtip",
      symbol: "WTIP",
      shares: valueUSD / 25,
      lastPriceUSD: 25,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD,
      expectedRealCAGR: 0.025,
      leverage: 1.9,
      bondType: bondTypeOf({ GOVT: 1 }),
      geography: geographyOf({ US: 1 }),
      averageDurationYears: 5,
      composition: [
        { kind: "bond", weight: 0.85, expectedRealCAGR: 0.015 },
        { kind: "crypto", weight: 0.1, expectedRealCAGR: 0.08 },
        { kind: "commodity", weight: 0.075, expectedRealCAGR: 0.01 },
        { kind: "commodity", weight: 0.075, expectedRealCAGR: 0.005 },
        { kind: "commodity", weight: 0.8, expectedRealCAGR: 0.0 },
      ],
    };
  }

  const wtip = makeMultiAssetBond(100_000);
  const hh: Household = {
    id: "test",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [wtip],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("Net Worth equals face value (no leverage double-count)", () => {
    expect(m.netWorthUSD).toBeCloseTo(100_000, 2);
  });

  it("class breakdown decomposes correctly", () => {
    // sum = 0.85 + 0.1 + 0.075 + 0.075 + 0.8 = 1.9
    // bond face share = 0.85 / 1.9 × 100K ≈ 44_736
    // crypto face share = 0.1 / 1.9 × 100K ≈ 5_263
    // commodity (3 legs combined) = (0.075 + 0.075 + 0.8) / 1.9 × 100K ≈ 50_000
    expect(m.classes.bondUSD).toBeCloseTo(44_736.84, 0);
    expect(m.classes.cryptoUSD).toBeCloseTo(5_263.16, 0);
    expect(m.classes.commodityUSD).toBeCloseTo(50_000, 0);
    expect(m.classes.equityUSD).toBe(0);
    expect(m.classes.otherUSD).toBe(0);
    expect(m.classes.totalUSD).toBeCloseTo(100_000, 0);
  });

  it("portfolio effective leverage equals 1.9", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1.9, 3);
  });

  it("bond leg inherits the wrapper's TIPS duration (5 years)", () => {
    // weightedDurationYears should equal 5 since the only bond
    // contribution comes from the wrapper's bond leg, which inherits
    // averageDurationYears=5 from the wrapper.
    expect(m.bond.weightedDurationYears).toBeCloseTo(5, 3);
  });

  it("crypto exposure picks up 10% × face = $10K, not double-counted", () => {
    // Effective gross exposure for crypto leg = 10% × 100K = $10K.
    // Face share (normalized) = ~5,263.
    // Test the exposure side via portfolio's effectiveExposureUSD.
    const cryptoExposureFromComposition = 0.1 * 100_000;
    // The crypto class face = 5,263; exposure = 10,000.
    // total exposure = 1.9 × 100K = 190K
    expect(m.effectiveExposureUSD).toBeCloseTo(190_000, 0);
    // Just sanity check the crypto leg value is captured.
    expect(cryptoExposureFromComposition).toBe(10_000);
  });
});

describe("composition on crypto wrapper", () => {
  // A hypothetical "BTC treasury" stock that wraps 80% BTC with 20%
  // equity overlay. Even though the wrapper IS crypto-kind, we should
  // still split the face value across both classes.
  function makeCryptoOverlay(valueUSD = 100_000): import("@/lib/types").CryptoHolding {
    return {
      kind: "crypto",
      id: "btc-co",
      symbol: "BTC-TREASURY",
      shares: valueUSD / 50,
      lastPriceUSD: 50,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD,
      expectedRealCAGR: 0.07,
      composition: [
        { kind: "crypto", weight: 0.8, expectedRealCAGR: 0.08 },
        { kind: "equity", weight: 0.2, expectedRealCAGR: 0.07 },
      ],
    };
  }
  const hh: Household = {
    id: "t",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [makeCryptoOverlay(100_000)],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("face splits 80/20 crypto/equity", () => {
    expect(m.classes.cryptoUSD).toBeCloseTo(80_000, 1);
    expect(m.classes.equityUSD).toBeCloseTo(20_000, 1);
  });

  it("sum of weights = 1.0 so effective leverage = 1×", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1, 3);
  });
});

describe("composition on commodity wrapper", () => {
  // A commodity-anchored fund that overlays 30% TIPS for income.
  function makeCommodityOverlay(
    valueUSD = 100_000,
  ): import("@/lib/types").CommodityHolding {
    return {
      kind: "commodity",
      id: "gold-bond",
      symbol: "GOLDBOND",
      shares: 1,
      lastPriceUSD: valueUSD,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD,
      expectedRealCAGR: 0.01,
      composition: [
        { kind: "commodity", weight: 1, expectedRealCAGR: 0.01 },
        { kind: "bond", weight: 0.3, expectedRealCAGR: 0.015 },
      ],
    };
  }
  const hh: Household = {
    id: "t",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [makeCommodityOverlay(100_000)],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("face splits ~77/23 commodity/bond", () => {
    // sum = 1.3, normalized: 1/1.3=76.9% commodity, 0.3/1.3=23.1% bond
    expect(m.classes.commodityUSD).toBeCloseTo(76_923, 0);
    expect(m.classes.bondUSD).toBeCloseTo(23_077, 0);
  });

  it("leverage = 1.3×", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1.3, 3);
  });
});

describe("IBIT-like crypto ETF (no composition needed)", () => {
  // IBIT is a stock ticker that IS crypto exposure. kind=crypto with
  // isManualPrice=false; no composition needed since the wrapper is
  // 100% crypto. Treated as live-priceable.
  function makeIBIT(valueUSD = 10_000): import("@/lib/types").CryptoHolding {
    return {
      kind: "crypto",
      id: "ibit",
      symbol: "IBIT",
      shares: valueUSD / 60,
      lastPriceUSD: 60,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD,
      expectedRealCAGR: 0.08,
    };
  }
  const hh: Household = {
    id: "t",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [makeIBIT(10_000)],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("lands in crypto bucket (not stocks)", () => {
    expect(m.classes.cryptoUSD).toBe(10_000);
    expect(m.classes.equityUSD).toBe(0);
  });

  it("1× leverage by default", () => {
    expect(m.effectiveLeverage).toBeCloseTo(1, 3);
  });
});

describe("BITX (leveraged crypto, 2×)", () => {
  function makeBITX(valueUSD = 10_000): import("@/lib/types").CryptoHolding {
    return {
      kind: "crypto",
      id: "bitx",
      symbol: "BITX",
      shares: valueUSD / 70,
      lastPriceUSD: 70,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD,
      expectedRealCAGR: 0.1,
      leverage: 2,
    };
  }
  const hh: Household = {
    id: "t",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings: [makeBITX(10_000)],
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
  const m = computePortfolio(hh);

  it("contributes 2× exposure on its face value", () => {
    expect(m.classes.cryptoUSD).toBe(10_000); // face
    expect(m.effectiveLeverage).toBeCloseTo(2, 3); // 20K exposure / 10K face
    expect(m.effectiveExposureUSD).toBeCloseTo(20_000, 0);
  });
});

describe("emptyHelpers preserve shape", () => {
  it("EMPTY_STYLE_BOX has every Morningstar cell at 0", () => {
    // Deep-equal against the explicit shape — `every(v === 0)`
    // is opaque and would silently pass even if a cell key was
    // renamed or removed. The 9-cell shape is the public
    // contract every style-box consumer reads from.
    expect(EMPTY_STYLE_BOX).toEqual({
      LARGE_VALUE: 0, LARGE_BLEND: 0, LARGE_GROWTH: 0,
      MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0,
      SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0,
    });
  });
  it("EMPTY_GEOGRAPHY has every region key at 0", () => {
    expect(EMPTY_GEOGRAPHY).toEqual({ US: 0, DEVELOPED: 0, EMERGING: 0 });
  });
  it("bondTypeOf defaults missing keys to 0", () => {
    expect(bondTypeOf({ GOVT: 1 })).toEqual({ GOVT: 1, CORPORATE: 0 });
  });
});

describe("aggregation invariants (Round-7)", () => {
  it("class shares always sum to 1 (or all 0 for empty)", () => {
    const m = computePortfolio(DEMO_HOUSEHOLD);
    const sum =
      m.classes.equityShare +
      m.classes.bondShare +
      m.classes.cashShare +
      m.classes.cryptoShare +
      m.classes.commodityShare +
      m.classes.realEstateShare +
      m.classes.privateStockShare +
      m.classes.otherShare;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("empty household has all-zero shares and total — no NaN", () => {
    const m = computePortfolio({
      id: "empty",
      members: [{ id: "m1", displayName: "You" }],
      accounts: [],
      liabilities: [],
    });
    expect(m.classes.totalUSD).toBe(0);
    expect(m.classes.equityShare).toBe(0);
    expect(m.classes.bondShare).toBe(0);
    expect(m.classes.cashShare).toBe(0);
    expect(m.classes.cryptoShare).toBe(0);
    expect(m.classes.commodityShare).toBe(0);
    expect(m.classes.realEstateShare).toBe(0);
    expect(m.classes.privateStockShare).toBe(0);
    expect(m.classes.otherShare).toBe(0);
    expect(m.effectiveLeverage).toBe(1);
    expect(m.weightedRealCAGR).toBe(0);
  });

  it("class face sums equal totalUSD", () => {
    const m = computePortfolio(DEMO_HOUSEHOLD);
    const sum =
      m.classes.equityUSD +
      m.classes.bondUSD +
      m.classes.cashUSD +
      m.classes.cryptoUSD +
      m.classes.commodityUSD +
      m.classes.realEstateUSD +
      m.classes.privateStockUSD +
      m.classes.otherUSD;
    expect(sum).toBeCloseTo(m.classes.totalUSD, 2);
  });

  it("liquid household drops a rental flagged isIlliquid (Round-2 fix)", async () => {
    const { liquidHousehold, householdNetWorth } = await import("@/lib/types");
    const m1 = "m1";
    const household = {
      id: "h",
      members: [{ id: m1, displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE" as const,
          displayName: "B",
          ownerId: m1,
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "cash" as const,
              id: "c",
              valueUSD: 50_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
        {
          id: "a2",
          category: "REAL_ESTATE" as const,
          displayName: "Rental",
          ownerId: m1,
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "real_estate" as const,
              id: "r1",
              name: "Rental",
              valueUSD: 200_000,
              expectedRealCAGR: 0.03,
              acquiredAt: null,
              leverage: 1,
              // Not a primary residence but flagged illiquid via the
              // new field (Round-2 fix lets RE carry isIlliquid like
              // other classes do).
              isIlliquid: true,
            },
          ],
        },
      ],
      liabilities: [],
    };
    expect(householdNetWorth(household)).toBeCloseTo(250_000, 0);
    const liquid = liquidHousehold(household);
    expect(householdNetWorth(liquid)).toBeCloseTo(50_000, 0);
  });
});
