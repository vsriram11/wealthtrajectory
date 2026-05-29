import { describe, expect, it } from "vitest";
import {
  buildAssetClassSeries,
  cagr,
  maxDrawdown,
  perAccountCAGR,
  perHoldingCAGR,
  perHoldingTotalReturn,
  summarizeClassReturns,
  totalReturn,
  type ClassSeries,
} from "./historicalReturns";
import type { Snapshot } from "@/lib/persistence/persistence";

const T0 = Date.UTC(2020, 0, 1, 12);
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

function snap(t: number, holdings: Array<{ id: string; cls: string; v: number }>): Snapshot {
  return {
    t,
    netWorthUSD: holdings.reduce((s, h) => s + h.v, 0),
    household: {
      id: "hh",
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "a1",
          ownerId: "m1",
          nickname: "Brokerage",
          kind: "brokerage",
          taxTreatment: "taxable",
          institutionId: null,
          holdings: holdings.map((h) => ({
            id: h.id,
            kind: h.cls as never,
            valueUSD: h.v,
          })) as never,
        } as never,
      ],
      liabilities: [],
    },
  };
}

describe("buildAssetClassSeries", () => {
  it("groups holdings by asset class and produces a time series per class", () => {
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 50_000 },
        { id: "h2", cls: "bond", v: 20_000 },
      ]),
      snap(T0 + YEAR, [
        { id: "h1", cls: "equity", v: 60_000 },
        { id: "h2", cls: "bond", v: 22_000 },
      ]),
    ];
    const buckets = buildAssetClassSeries(snaps);
    expect(buckets.equity).toEqual([
      { t: T0, valueUSD: 50_000 },
      { t: T0 + YEAR, valueUSD: 60_000 },
    ]);
    expect(buckets.bond).toEqual([
      { t: T0, valueUSD: 20_000 },
      { t: T0 + YEAR, valueUSD: 22_000 },
    ]);
  });

  it("skips snapshots without household (lightweight legacy rows)", () => {
    const snaps: Snapshot[] = [
      { t: T0, netWorthUSD: 100_000 }, // no household
      snap(T0 + YEAR, [{ id: "h1", cls: "equity", v: 110_000 }]),
    ];
    const buckets = buildAssetClassSeries(snaps);
    // Only the row with household contributes.
    expect(buckets.equity).toHaveLength(1);
  });

  it("aggregates multiple holdings within the same class at a single snapshot", () => {
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 30_000 },
        { id: "h2", cls: "equity", v: 20_000 },
      ]),
    ];
    expect(buildAssetClassSeries(snaps).equity).toEqual([
      { t: T0, valueUSD: 50_000 },
    ]);
  });

  it("sorts snapshots ascending by t before bucketing", () => {
    const snaps: Snapshot[] = [
      snap(T0 + YEAR, [{ id: "h1", cls: "equity", v: 60_000 }]),
      snap(T0, [{ id: "h1", cls: "equity", v: 50_000 }]),
    ];
    expect(buildAssetClassSeries(snaps).equity).toEqual([
      { t: T0, valueUSD: 50_000 },
      { t: T0 + YEAR, valueUSD: 60_000 },
    ]);
  });
});

describe("cagr", () => {
  it("computes the standard formula (end/start)^(1/years) - 1", () => {
    // Double in 5 years → 2^(1/5) - 1 ≈ 14.87%
    const series: ClassSeries = [
      { t: T0, valueUSD: 100_000 },
      { t: T0 + 5 * YEAR, valueUSD: 200_000 },
    ];
    const r = cagr(series);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(Math.pow(2, 0.2) - 1, 6);
  });

  it("returns null when fewer than 2 points", () => {
    expect(cagr([])).toBeNull();
    expect(cagr([{ t: T0, valueUSD: 100 }])).toBeNull();
  });

  it("returns null when V_start is zero or negative", () => {
    expect(
      cagr([
        { t: T0, valueUSD: 0 },
        { t: T0 + YEAR, valueUSD: 100 },
      ]),
    ).toBeNull();
    expect(
      cagr([
        { t: T0, valueUSD: -100 },
        { t: T0 + YEAR, valueUSD: 100 },
      ]),
    ).toBeNull();
  });

  it("returns null when elapsed time is less than a day (annualization is nonsense at sub-day horizons)", () => {
    expect(
      cagr([
        { t: T0, valueUSD: 100 },
        { t: T0 + 1_000, valueUSD: 110 },
      ]),
    ).toBeNull();
  });

  it("collapses to total CAGR over the FULL window (telescoping product invariant)", () => {
    // Intermediate snapshots have arbitrary noise but the
    // first→last ratio is what matters. This pins the documented
    // 'chained TWR = simple CAGR without explicit cashflows'
    // property.
    const series: ClassSeries = [
      { t: T0, valueUSD: 100_000 },
      { t: T0 + YEAR, valueUSD: 80_000 },
      { t: T0 + 2 * YEAR, valueUSD: 150_000 },
      { t: T0 + 3 * YEAR, valueUSD: 130_000 },
      { t: T0 + 5 * YEAR, valueUSD: 200_000 },
    ];
    const r = cagr(series);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(Math.pow(2, 0.2) - 1, 6);
  });
});

describe("totalReturn", () => {
  it("V_end / V_start - 1, independent of elapsed time", () => {
    const series: ClassSeries = [
      { t: T0, valueUSD: 100 },
      { t: T0 + YEAR, valueUSD: 150 },
    ];
    expect(totalReturn(series)).toBeCloseTo(0.5, 6);
  });

  it("returns null on degenerate inputs", () => {
    expect(totalReturn([])).toBeNull();
    expect(totalReturn([{ t: T0, valueUSD: 100 }])).toBeNull();
    expect(
      totalReturn([
        { t: T0, valueUSD: 0 },
        { t: T0 + YEAR, valueUSD: 100 },
      ]),
    ).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("finds the deepest peak-to-trough loss in a series", () => {
    // peak at 200 (year 1), trough at 80 (year 2) → 60% loss
    const series: ClassSeries = [
      { t: T0, valueUSD: 100 },
      { t: T0 + YEAR, valueUSD: 200 },
      { t: T0 + 2 * YEAR, valueUSD: 80 },
      { t: T0 + 3 * YEAR, valueUSD: 150 },
    ];
    const d = maxDrawdown(series);
    expect(d).not.toBeNull();
    expect(d!.lossPct).toBeCloseTo(0.6, 6);
    expect(d!.peakT).toBe(T0 + YEAR);
    expect(d!.troughT).toBe(T0 + 2 * YEAR);
    expect(d!.peakValueUSD).toBe(200);
    expect(d!.troughValueUSD).toBe(80);
  });

  it("returns null for monotone-increasing series", () => {
    const series: ClassSeries = [
      { t: T0, valueUSD: 100 },
      { t: T0 + YEAR, valueUSD: 150 },
      { t: T0 + 2 * YEAR, valueUSD: 200 },
    ];
    expect(maxDrawdown(series)).toBeNull();
  });

  it("returns null on < 2 points", () => {
    expect(maxDrawdown([])).toBeNull();
    expect(maxDrawdown([{ t: T0, valueUSD: 100 }])).toBeNull();
  });

  it("picks the DEEPER of two competing drawdowns", () => {
    // First drawdown 30%, second 50% — second wins.
    const series: ClassSeries = [
      { t: T0, valueUSD: 100 },
      { t: T0 + YEAR, valueUSD: 70 }, // -30%
      { t: T0 + 2 * YEAR, valueUSD: 120 }, // recovery to new peak
      { t: T0 + 3 * YEAR, valueUSD: 60 }, // -50% from 120
    ];
    const d = maxDrawdown(series);
    expect(d!.lossPct).toBeCloseTo(0.5, 6);
    expect(d!.peakValueUSD).toBe(120);
  });
});

describe("summarizeClassReturns", () => {
  it("returns one row per class sorted by current value descending", () => {
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 50_000 },
        { id: "h2", cls: "bond", v: 100_000 },
      ]),
      snap(T0 + YEAR, [
        { id: "h1", cls: "equity", v: 60_000 }, // equity is now smaller
        { id: "h2", cls: "bond", v: 120_000 }, // bond is largest
      ]),
    ];
    const rows = summarizeClassReturns(buildAssetClassSeries(snaps));
    expect(rows.map((r) => r.assetClass)).toEqual(["bond", "equity"]);
    expect(rows[0].lastValueUSD).toBe(120_000);
  });

  it("skips classes with < 2 data points", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h1", cls: "equity", v: 100 }]),
    ];
    expect(summarizeClassReturns(buildAssetClassSeries(snaps))).toEqual([]);
  });
});

describe("perHoldingCAGR / perAccountCAGR / perHoldingTotalReturn", () => {
  it("perHoldingCAGR tracks a holding across snapshots by id", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h1", cls: "equity", v: 10_000 }]),
      snap(T0 + 5 * YEAR, [{ id: "h1", cls: "equity", v: 20_000 }]),
    ];
    const r = perHoldingCAGR(snaps, "h1");
    expect(r).toBeCloseTo(Math.pow(2, 0.2) - 1, 6);
  });

  it("perHoldingCAGR returns null when the holding doesn't exist across the window", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h1", cls: "equity", v: 10_000 }]),
      snap(T0 + YEAR, [{ id: "h1", cls: "equity", v: 11_000 }]),
    ];
    // Asking about a holding that's never in the snapshots → null.
    expect(perHoldingCAGR(snaps, "never-existed")).toBeNull();
  });

  it("perAccountCAGR sums the account's holdings at each snapshot", () => {
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 50_000 },
        { id: "h2", cls: "bond", v: 50_000 },
      ]),
      snap(T0 + YEAR, [
        { id: "h1", cls: "equity", v: 55_000 },
        { id: "h2", cls: "bond", v: 55_000 },
      ]),
    ];
    const r = perAccountCAGR(snaps, "a1");
    expect(r).toBeCloseTo(0.1, 4);
  });

  it("perHoldingTotalReturn matches V_end/V_start - 1 (no annualization)", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h1", cls: "equity", v: 10_000 }]),
      snap(T0 + 2 * YEAR, [{ id: "h1", cls: "equity", v: 15_000 }]),
    ];
    expect(perHoldingTotalReturn(snaps, "h1")).toBeCloseTo(0.5, 6);
  });
});
