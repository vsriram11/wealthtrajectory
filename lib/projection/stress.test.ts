import { describe, expect, it } from "vitest";
import { computeStress } from "@/lib/projection/stress";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import {
  geographyOf,
  styleBoxOf,
  type EquityHolding,
  type Household,
} from "@/lib/types";

function makeHousehold(holdings: EquityHolding[]): Household {
  return {
    id: "test",
    members: [{ id: "m1", displayName: "T" }],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "B",
        ownerId: "m1",
        holdings,
        monthlyContributionUSD: 0,
      },
    ],
    liabilities: [],
  };
}

function makeEquity(opts: {
  id: string;
  symbol: string;
  valueUSD: number;
  leverage?: number;
  composition?: EquityHolding["composition"];
}): EquityHolding {
  return {
    kind: "equity",
    id: opts.id,
    symbol: opts.symbol,
    shares: opts.valueUSD,
    lastPriceUSD: 1,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: opts.valueUSD,
    expectedRealCAGR: 0.07,
    leverage: opts.leverage ?? 1,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    ...(opts.composition ? { composition: opts.composition } : {}),
  };
}

describe("computeStress — market-drop snapshot math", () => {
  it("1× equity: 10% shock → 10% NW drop", () => {
    const hh = makeHousehold([
      makeEquity({ id: "voo", symbol: "VOO", valueUSD: 100_000 }),
    ]);
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 0.1);
    expect(s.deltaUSD).toBeCloseTo(-10_000, 0);
    expect(s.newNW).toBeCloseTo(90_000, 0);
    expect(s.pctDrop).toBeCloseTo(-0.1, 3);
  });

  it("3× leverage: 10% shock → 30% NW drop (regression: was +170%)", () => {
    // Pre-fix bug: sensitiveValue = face × leverage = $300K. Then
    // newNW = $300K × (1 - 0.1) = $270K, claiming the user *gained*
    // $170K from a -10% market drop. Fixed by applying the shock
    // to the *loss* (face × leverage × shock) rather than scaling the
    // gross exposure.
    const hh = makeHousehold([
      makeEquity({
        id: "tqqq",
        symbol: "TQQQ",
        valueUSD: 100_000,
        leverage: 3,
      }),
    ]);
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 0.1);
    expect(s.deltaUSD).toBeCloseTo(-30_000, 0);
    expect(s.newNW).toBeCloseTo(70_000, 0);
    expect(s.pctDrop).toBeCloseTo(-0.3, 3);
  });

  it("NTSX (1.5× composition): 10% shock → 15% NW drop", () => {
    const ntsx = makeEquity({
      id: "ntsx",
      symbol: "NTSX",
      valueUSD: 100_000,
      composition: [
        { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
        { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
      ],
    });
    const hh = makeHousehold([ntsx]);
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 0.1);
    // Equity bucket: face $60K × eff lev 1.5 × 10% = $9K
    // Bond bucket:   face $40K × eff lev 1.5 × 10% = $6K
    // Total drop = $15K = 1.5 × $100K × 10%
    expect(s.deltaUSD).toBeCloseTo(-15_000, 0);
    expect(s.breakdown.equityDropUSD).toBeCloseTo(9_000, 0);
    expect(s.breakdown.bondDropUSD).toBeCloseTo(6_000, 0);
    expect(s.pctDrop).toBeCloseTo(-0.15, 3);
  });

  it("cash and 'other' are untouched by market shocks", () => {
    const cashHH: Household = {
      id: "t",
      members: [{ id: "m1", displayName: "T" }],
      accounts: [
        {
          id: "a1",
          category: "CHECKING",
          displayName: "Cash",
          ownerId: "m1",
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 100_000,
              expectedRealCAGR: 0,
              geography: geographyOf({ US: 1 }),
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const p = computePortfolio(cashHH);
    const s = computeStress(cashHH, p, 0.5);
    expect(s.deltaUSD).toBeCloseTo(0, 0);
    expect(s.newNW).toBeCloseTo(100_000, 0);
  });

  it("mortgaged real estate hits at mortgage leverage", () => {
    // $100K equity in a $500K home → 5× leverage. 10% housing drop
    // wipes $50K of NW (property loses $50K; mortgage stays put).
    const hh: Household = {
      id: "t",
      members: [{ id: "m1", displayName: "T" }],
      accounts: [
        {
          id: "a1",
          category: "REAL_ESTATE",
          displayName: "Home",
          ownerId: "m1",
          holdings: [
            {
              kind: "real_estate",
              id: "h1",
              name: "Primary",
              valueUSD: 100_000,
              expectedRealCAGR: 0.03,
              acquiredAt: null,
              leverage: 5,
              isPrimaryResidence: true,
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 0.1);
    expect(s.deltaUSD).toBeCloseTo(-50_000, 0);
    expect(s.breakdown.realEstateDropUSD).toBeCloseTo(50_000, 0);
  });

  it("delta is always non-positive for a positive shock (no phantom gains)", () => {
    const mixes: EquityHolding[][] = [
      [makeEquity({ id: "1", symbol: "VOO", valueUSD: 50_000 })],
      [makeEquity({ id: "2", symbol: "TQQQ", valueUSD: 50_000, leverage: 3 })],
      [
        makeEquity({ id: "3", symbol: "UPRO", valueUSD: 30_000, leverage: 3 }),
        makeEquity({ id: "4", symbol: "TMF", valueUSD: 20_000, leverage: 3 }),
      ],
      [
        makeEquity({
          id: "5",
          symbol: "NTSX",
          valueUSD: 100_000,
          composition: [
            { kind: "equity", weight: 0.9 },
            { kind: "bond", weight: 0.6 },
          ],
        }),
      ],
    ];
    for (const m of mixes) {
      const hh = makeHousehold(m);
      const p = computePortfolio(hh);
      for (const shock of [0.05, 0.1, 0.2, 0.5]) {
        const s = computeStress(hh, p, shock);
        expect(s.deltaUSD).toBeLessThanOrEqual(0);
        expect(s.newNW).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("zero shock produces no change", () => {
    const hh = makeHousehold([
      makeEquity({
        id: "tqqq",
        symbol: "TQQQ",
        valueUSD: 100_000,
        leverage: 3,
      }),
    ]);
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 0);
    expect(s.deltaUSD).toBe(0);
    expect(s.newNW).toBe(p.netWorthUSD);
    expect(s.pctDrop).toBe(0);
  });

  it("100% shock approaches NW=0 (capped, never negative)", () => {
    // 100% shock on a 3× position arithmetically wipes 300% — but UI
    // floors at $0 so the card stays sensible.
    const hh = makeHousehold([
      makeEquity({
        id: "tqqq",
        symbol: "TQQQ",
        valueUSD: 100_000,
        leverage: 3,
      }),
    ]);
    const p = computePortfolio(hh);
    const s = computeStress(hh, p, 1.0);
    expect(s.newNW).toBe(0);
    expect(s.deltaUSD).toBeCloseTo(-100_000, 0);
  });
});
