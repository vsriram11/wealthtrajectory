import { describe, expect, it } from "vitest";
import {
  realEstateMetrics,
  summarizeAllRealEstate,
  __testHooks,
} from "./realEstateReturns";
import type { Snapshot } from "@/lib/persistence/persistence";

const T0 = Date.UTC(2020, 0, 1, 12);
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

function reSnap(
  t: number,
  holdings: Array<{
    id: string;
    name?: string;
    equity: number;
    leverage: number;
  }>,
): Snapshot {
  return {
    t,
    netWorthUSD: holdings.reduce((s, h) => s + h.equity, 0),
    household: {
      id: "hh",
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "acct",
          ownerId: "m1",
          nickname: "Property",
          kind: "real_estate",
          taxTreatment: "taxable",
          institutionId: null,
          holdings: holdings.map((h) => ({
            id: h.id,
            kind: "real_estate" as const,
            name: h.name ?? "House",
            valueUSD: h.equity,
            expectedRealCAGR: 0.03,
            acquiredAt: null,
            leverage: h.leverage,
          })),
        } as never,
      ],
      liabilities: [],
    },
  };
}

describe("realEstateMetrics — paid-off property (leverage = 1)", () => {
  it("TWR === equityCAGR === IRR (no leverage, no paydown — degenerate case)", () => {
    // House appreciates from $500K to $750K over 5 years.
    // No mortgage, so all three metrics collapse to the same CAGR.
    const snaps: Snapshot[] = [
      reSnap(T0, [{ id: "h1", equity: 500_000, leverage: 1 }]),
      reSnap(T0 + 5 * YEAR, [{ id: "h1", equity: 750_000, leverage: 1 }]),
    ];
    const m = realEstateMetrics(snaps, "h1");
    expect(m).not.toBeNull();
    expect(m!.initialMortgage).toBe(0);
    expect(m!.finalMortgage).toBe(0);
    expect(m!.totalPaydown).toBe(0);
    expect(m!.initialGross).toBe(500_000);
    expect(m!.finalGross).toBe(750_000);
    const expectedCAGR = Math.pow(1.5, 1 / 5) - 1;
    expect(m!.twrPctAnnual!).toBeCloseTo(expectedCAGR, 6);
    expect(m!.equityCAGRPctAnnual!).toBeCloseTo(expectedCAGR, 6);
    // IRR collapses to CAGR when cashflows are just (−V_start, +V_end).
    expect(m!.irrPctAnnual!).toBeCloseTo(expectedCAGR, 4);
  });
});

describe("realEstateMetrics — leveraged property + paydown (the headline TWR vs MWR case)", () => {
  it("equityCAGR is misleadingly high; TWR is the market rate; IRR is in between", () => {
    // Buy $500K house with $100K equity (5x leverage, $400K mortgage).
    // 5 years later: house worth $625K (TWR = 4.56% annual market
    // appreciation), mortgage paid down to $350K → equity = $275K.
    //
    // Equity CAGR = (275/100)^(1/5) - 1 ≈ 22.4%/yr  ← way too high
    //   because it implicitly counts the $50K paydown as "return."
    // TWR = (625/500)^(1/5) - 1 ≈ 4.56%/yr            ← market only
    // IRR should be between these — accounts for the additional
    //   $50K capital contribution over 5 years.
    const snaps: Snapshot[] = [
      reSnap(T0, [{ id: "h1", equity: 100_000, leverage: 5 }]),
      // Midpoint snapshot @ 2.5y: house up to $560K, mortgage at $375K.
      // equity = 185K, leverage = 560/185 ≈ 3.027.
      reSnap(T0 + 2.5 * YEAR, [
        { id: "h1", equity: 185_000, leverage: 560_000 / 185_000 },
      ]),
      // End @ 5y: house at $625K, mortgage at $350K → equity $275K.
      reSnap(T0 + 5 * YEAR, [
        { id: "h1", equity: 275_000, leverage: 625_000 / 275_000 },
      ]),
    ];
    const m = realEstateMetrics(snaps, "h1");
    expect(m).not.toBeNull();
    // Gross trajectory: $500K → $625K → 4.56% TWR.
    expect(m!.twrPctAnnual!).toBeCloseTo(Math.pow(1.25, 1 / 5) - 1, 4);
    // Equity CAGR: $100K → $275K → ~22.4% (the misleading rate).
    expect(m!.equityCAGRPctAnnual!).toBeCloseTo(
      Math.pow(2.75, 1 / 5) - 1,
      4,
    );
    // IRR must be MORE than TWR (the user benefited from leverage)
    // but LESS than the naive equity CAGR (because the equity CAGR
    // ignores capital contributions). Plausible range: 9-15%.
    expect(m!.irrPctAnnual!).not.toBeNull();
    expect(m!.irrPctAnnual!).toBeGreaterThan(m!.twrPctAnnual!);
    expect(m!.irrPctAnnual!).toBeLessThan(m!.equityCAGRPctAnnual!);
    // Paydown was $25K ($400K - $375K) + $25K ($375K - $350K) = $50K.
    expect(m!.totalPaydown).toBeCloseTo(50_000, -2);
  });
});

describe("realEstateMetrics — null cases (gate semantics)", () => {
  it("returns null when the holding is missing from the FIRST snapshot", () => {
    const snaps: Snapshot[] = [
      reSnap(T0, []),
      reSnap(T0 + YEAR, [{ id: "h1", equity: 100_000, leverage: 2 }]),
    ];
    expect(realEstateMetrics(snaps, "h1")).toBeNull();
  });

  it("returns null when the holding is missing from the LAST snapshot", () => {
    const snaps: Snapshot[] = [
      reSnap(T0, [{ id: "h1", equity: 100_000, leverage: 2 }]),
      reSnap(T0 + YEAR, []),
    ];
    expect(realEstateMetrics(snaps, "h1")).toBeNull();
  });

  it("returns null with fewer than 2 composition-bearing snapshots", () => {
    const snaps: Snapshot[] = [
      reSnap(T0, [{ id: "h1", equity: 100_000, leverage: 2 }]),
    ];
    expect(realEstateMetrics(snaps, "h1")).toBeNull();
  });
});

describe("Newton-Raphson IRR solver — edge cases", () => {
  const { newtonRaphsonIRR } = __testHooks;

  it("solves a simple 5-year doubling: -100 at t0, +200 at t0+5y → IRR ≈ 14.87%", () => {
    const cashflows = [
      { t: 0, amount: -100 },
      { t: 5 * YEAR, amount: 200 },
    ];
    const r = newtonRaphsonIRR(cashflows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(Math.pow(2, 0.2) - 1, 4);
  });

  it("returns null when all cashflows have the same sign (no NPV root)", () => {
    expect(
      newtonRaphsonIRR([
        { t: 0, amount: -100 },
        { t: YEAR, amount: -200 },
      ]),
    ).toBeNull();
    expect(
      newtonRaphsonIRR([
        { t: 0, amount: 100 },
        { t: YEAR, amount: 200 },
      ]),
    ).toBeNull();
  });

  it("returns null on fewer than 2 cashflows", () => {
    expect(newtonRaphsonIRR([])).toBeNull();
    expect(newtonRaphsonIRR([{ t: 0, amount: 100 }])).toBeNull();
  });

  it("handles multi-cashflow streams (initial + 2 paydowns + exit)", () => {
    // Mortgage-like cashflow: down payment $20K, two $5K paydowns
    // at years 1 and 2, exit at $40K equity in year 3.
    // Total invested: $30K → terminal $40K over 3 years.
    const cashflows = [
      { t: 0, amount: -20_000 },
      { t: YEAR, amount: -5_000 },
      { t: 2 * YEAR, amount: -5_000 },
      { t: 3 * YEAR, amount: 40_000 },
    ];
    const r = newtonRaphsonIRR(cashflows);
    expect(r).not.toBeNull();
    // Expect ~12-14% IRR for this shape.
    expect(r!).toBeGreaterThan(0.1);
    expect(r!).toBeLessThan(0.2);
  });
});

describe("summarizeAllRealEstate — multi-property listing", () => {
  it("returns metrics for every real-estate holding in the latest snapshot", () => {
    const snaps: Snapshot[] = [
      reSnap(T0, [
        { id: "primary", name: "Primary residence", equity: 100_000, leverage: 5 },
        { id: "rental", name: "Rental", equity: 50_000, leverage: 3 },
      ]),
      reSnap(T0 + 3 * YEAR, [
        { id: "primary", name: "Primary residence", equity: 200_000, leverage: 3 },
        { id: "rental", name: "Rental", equity: 75_000, leverage: 2 },
      ]),
    ];
    const rows = summarizeAllRealEstate(snaps);
    expect(rows).toHaveLength(2);
    // Sorted by finalGross desc; primary = 200K * 3 = 600K vs rental = 75K * 2 = 150K.
    expect(rows[0].name).toBe("Primary residence");
    expect(rows[1].name).toBe("Rental");
  });

  it("returns empty array when there are no real-estate holdings", () => {
    const snaps: Snapshot[] = [
      reSnap(T0, []),
      reSnap(T0 + YEAR, []),
    ];
    expect(summarizeAllRealEstate(snaps)).toEqual([]);
  });
});
