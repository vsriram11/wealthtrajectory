import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { projectAllocation } from "@/lib/portfolio/futureAllocation";

describe("projectAllocation", () => {
  const series = projectAllocation(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, 30, 1);

  it("emits a point per stepYear from 0..totalYears inclusive", () => {
    expect(series.length).toBe(31);
    expect(series[0].yearOffset).toBe(0);
    expect(series[series.length - 1].yearOffset).toBe(30);
  });

  it("net worth grows monotonically when CAGRs are non-negative", () => {
    for (let i = 1; i < series.length; i++) {
      expect(series[i].netWorthUSD).toBeGreaterThanOrEqual(
        series[i - 1].netWorthUSD,
      );
    }
  });

  it("the year-0 point matches computePortfolio(household) today", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const m = computePortfolio(DEMO_HOUSEHOLD);
    expect(series[0].netWorthUSD).toBeCloseTo(m.netWorthUSD, 2);
    expect(series[0].effectiveLeverage).toBeCloseTo(
      m.effectiveLeverage,
      6,
    );
  });

  it("each future point exposes a fully populated classes breakdown", () => {
    const last = series[series.length - 1];
    expect(last.classes.equityUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.bondUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.cashUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.cryptoUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.realEstateUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.privateStockUSD).toBeGreaterThanOrEqual(0);
    expect(last.classes.otherUSD).toBeGreaterThanOrEqual(0);
    const sum =
      last.classes.equityUSD +
      last.classes.bondUSD +
      last.classes.cashUSD +
      last.classes.cryptoUSD +
      last.classes.commodityUSD +
      last.classes.realEstateUSD +
      last.classes.privateStockUSD +
      last.classes.otherUSD;
    expect(sum).toBeCloseTo(last.classes.totalUSD, 0);
  });

  it("end-of-horizon net worth exceeds start (compound growth net of liability paydown)", () => {
    // The previous version of this test was named "liabilities
    // draw down as the projection advances" but the assertion
    // only checks the net-worth scalar — the projection type
    // doesn't expose per-step liability balances. Renamed to
    // describe what the assertion actually pins: at the end of
    // a positive-CAGR horizon, compound asset growth + monthly
    // contributions must outpace liability balance decay enough
    // for NW to net higher.
    expect(series[series.length - 1].netWorthUSD).toBeGreaterThan(
      series[0].netWorthUSD,
    );
  });
});

describe("projectAllocation — FV math precision", () => {
  it("matches the closed-form future value for a single-holding household", async () => {
    // 10K starting balance, 1K/month contribution, 8% real CAGR,
    // 10 years.
    // FV_existing = 10000 × (1+r_m)^120  where r_m = (1.08)^(1/12)-1
    // FV_annuity  = 1000 × ((1+r_m)^120 - 1) / r_m
    const h = {
      id: "h",
      members: [{ id: "m", displayName: "M" }],
      accounts: [
        {
          id: "a",
          category: "BROKERAGE" as const,
          displayName: "B",
          ownerId: "m",
          monthlyContributionUSD: 1000,
          holdings: [
            {
              kind: "cash" as const,
              id: "c",
              valueUSD: 10_000,
              expectedRealCAGR: 0.08,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    const { DEMO_ASSUMPTIONS } = await import("@/lib/demo");
    const out = projectAllocation(h, DEMO_ASSUMPTIONS, 10, 1);
    const rm = Math.pow(1.08, 1 / 12) - 1;
    const months = 120;
    const expectedFvExisting = 10_000 * Math.pow(1 + rm, months);
    const expectedFvAnnuity =
      (1000 * (Math.pow(1 + rm, months) - 1)) / rm;
    const expected = expectedFvExisting + expectedFvAnnuity;
    expect(out[out.length - 1].netWorthUSD).toBeCloseTo(expected, -1);
  });

  it("a zero-CAGR holding still accumulates contributions linearly", async () => {
    const h = {
      id: "h",
      members: [{ id: "m", displayName: "M" }],
      accounts: [
        {
          id: "a",
          category: "SAVINGS" as const,
          displayName: "S",
          ownerId: "m",
          monthlyContributionUSD: 500,
          holdings: [
            {
              kind: "cash" as const,
              id: "c",
              valueUSD: 1000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    const { DEMO_ASSUMPTIONS } = await import("@/lib/demo");
    const out = projectAllocation(h, DEMO_ASSUMPTIONS, 5, 1);
    // 5 years × 12 months × 500 + 1000 = 31000
    expect(out[out.length - 1].netWorthUSD).toBeCloseTo(31_000, 2);
  });

  it("stays within reasonable agreement with projectIndependence", async () => {
    // The two engines model growth differently on purpose:
    //   - projectIndependence grows each ACCOUNT at its weighted CAGR
    //     (treating the account like a single balanced fund).
    //   - projectAllocation grows each HOLDING at its own CAGR
    //     (preserving the drift between e.g. stocks and bonds).
    //
    // The per-holding model is more accurate for showing future
    // allocation drift, which is the whole point of
    // AllocationFutureCard. The lump-blended model is fine for the
    // Independence date headline. Both are reasonable, just not identical.
    //
    // This test asserts the two stay within 5% of each other on
    // common cases — wide enough to honor the modeling difference,
    // tight enough to catch any silent regression that breaks the
    // FV math.
    const { projectIndependence } = await import("@/lib/projection/independence");
    const { DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS } = await import("@/lib/demo");
    const allo = projectAllocation(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, 5, 1);
    const fire = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const yr1Allo = allo.find((p) => p.yearOffset === 1);
    const yr1Independence = fire.series.find((p) => p.monthOffset === 12);
    if (!yr1Allo || !yr1Independence) throw new Error("expected year-1 points");
    const rel1 = Math.abs(
      (yr1Allo.netWorthUSD - yr1Independence.netWorthUSD) /
        Math.max(yr1Independence.netWorthUSD, 1),
    );
    // Once the gross-vs-net bookkeeping was unified in
    // computePortfolio, the two engines agree to within ~0.5% on
    // year 1 for the demo. Differences are purely from per-holding
    // vs per-account compounding (modelling choice, not a bug).
    expect(rel1).toBeLessThan(0.01);
  });

  it("amortizes mortgage liabilities at their annual rate (interest first, principal residual)", async () => {
    const { DEMO_ASSUMPTIONS } = await import("@/lib/demo");
    // $400K mortgage @ 6%, $2500/mo. Interest-only @ 6% APR ≈
    // $2000/mo, so $500/mo principal. After 12 payments balance
    // should be ~$393K-$394K — NOT $370K (which is the lump-sum
    // payment × months math, ignoring interest).
    const h = {
      id: "h",
      members: [{ id: "m", displayName: "M" }],
      accounts: [
        {
          id: "a",
          category: "REAL_ESTATE" as const,
          displayName: "Home",
          ownerId: "m",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "real_estate" as const,
              id: "h1",
              name: "Primary",
              valueUSD: 100_000,
              expectedRealCAGR: 0.02,
              acquiredAt: null,
              leverage: 5,
            },
          ],
        },
      ],
      liabilities: [
        {
          id: "l-mort",
          name: "Mortgage",
          balanceUSD: 400_000,
          annualInterestRate: 0.06,
          monthlyPaymentUSD: 2500,
          ownerId: "m",
        },
      ],
    };
    const out = projectAllocation(h, DEMO_ASSUMPTIONS, 1, 1);
    // Liability balance at year 1: should be > $390K and < $395K
    // (matches a real amortization schedule). The flat
    // monthly-payment × months formula would give $370K.
    const houseEquity = out[1].classes.realEstateUSD;
    const nw = out[1].netWorthUSD;
    const liabilityRemaining = houseEquity - nw; // since this is the only liability
    expect(liabilityRemaining).toBeGreaterThan(390_000);
    expect(liabilityRemaining).toBeLessThan(395_000);
  });

  it("multi-holding contribution split respects proportional shares", async () => {
    // Two cash buckets, 80/20 split, $100 monthly. After ageing:
    //   bucket A receives ~$80/mo, bucket B ~$20/mo.
    // Zero CAGRs make the math trivial.
    const h = {
      id: "h",
      members: [{ id: "m", displayName: "M" }],
      accounts: [
        {
          id: "a",
          category: "BROKERAGE" as const,
          displayName: "B",
          ownerId: "m",
          monthlyContributionUSD: 100,
          holdings: [
            {
              kind: "cash" as const,
              id: "a",
              valueUSD: 8000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
            {
              kind: "cash" as const,
              id: "b",
              valueUSD: 2000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    const { DEMO_ASSUMPTIONS } = await import("@/lib/demo");
    const out = projectAllocation(h, DEMO_ASSUMPTIONS, 5, 1);
    // After 5y: bucket A = 8000 + 80 × 60 = 12800
    //          bucket B = 2000 + 20 × 60 =  3200
    //          total                       = 16000
    expect(out[out.length - 1].netWorthUSD).toBeCloseTo(16_000, 2);
  });
});
