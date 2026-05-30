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

  it("constant-composition fix: holdings ONLY in last snapshot are excluded from CAGR series (user-reported bug)", () => {
    // User-reported: "added position with acquiredAt 2021 — shows
    // in CAGR between yesterday and today, which is wrong."
    // Root cause: a holding present only in the LAST snapshot
    // inflated the latest bucket value while leaving earlier
    // buckets unchanged, producing huge spurious CAGR.
    // Fix: bucket sums only include holdings whose ID appears in
    // BOTH first and last composition-bearing snapshots.
    const snaps: Snapshot[] = [
      // Yesterday: only h1 in stocks.
      snap(T0, [{ id: "h1", cls: "equity", v: 100_000 }]),
      // Today: user added h2 (with acquiredAt long ago, but it's
      // only NOW in the snapshot system).
      snap(T0 + YEAR, [
        { id: "h1", cls: "equity", v: 110_000 },
        { id: "h2", cls: "equity", v: 50_000 },
      ]),
    ];
    const buckets = buildAssetClassSeries(snaps);
    // The equity series should reflect ONLY h1 (the common
    // holding), so the CAGR is computed on $100K → $110K (10%)
    // not on $100K → $160K (60% — wildly wrong).
    expect(buckets.equity).toEqual([
      { t: T0, valueUSD: 100_000 },
      { t: T0 + YEAR, valueUSD: 110_000 },
    ]);
  });

  it("constant-composition fix: holdings ONLY in first snapshot are excluded too (sold mid-window)", () => {
    // Symmetric case: a holding sold between snapshots should
    // also be excluded from the constant-composition series.
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 100_000 },
        { id: "h_sold", cls: "equity", v: 50_000 },
      ]),
      // h_sold is gone — user sold the position.
      snap(T0 + YEAR, [{ id: "h1", cls: "equity", v: 110_000 }]),
    ];
    const buckets = buildAssetClassSeries(snaps);
    // Series uses only h1 (the common holding).
    expect(buckets.equity).toEqual([
      { t: T0, valueUSD: 100_000 },
      { t: T0 + YEAR, valueUSD: 110_000 },
    ]);
  });

  it("constant-composition fix: single snapshot returns full composition (no intersection to compute)", () => {
    // Edge case: with only one snapshot, the "intersection" is
    // the snapshot's own holdings. Bucket sums include everything.
    const snaps: Snapshot[] = [
      snap(T0, [
        { id: "h1", cls: "equity", v: 100_000 },
        { id: "h2", cls: "equity", v: 50_000 },
      ]),
    ];
    expect(buildAssetClassSeries(snaps).equity).toEqual([
      { t: T0, valueUSD: 150_000 },
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

  it("returns -1 when V_end is exactly 0 (total loss — audit BLOCK fix)", () => {
    // The honest CAGR for a position that went to zero is -100%.
    // Returning null would hide this in the UI as "—" which is
    // worse than the correct -1.
    expect(
      cagr([
        { t: T0, valueUSD: 100_000 },
        { t: T0 + 5 * YEAR, valueUSD: 0 },
      ]),
    ).toBe(-1);
    expect(
      cagr([
        { t: T0, valueUSD: 100 },
        { t: T0 + 2 * YEAR, valueUSD: 0 },
      ]),
    ).toBe(-1);
  });

  it("returns null for negative V_end (pathological — not a real-world case)", () => {
    // Negative end value would imply net-negative wealth in the
    // bucket, which the current engine doesn't model. Reject
    // rather than produce a fictional CAGR via complex-number
    // gymnastics on the fractional power.
    expect(
      cagr([
        { t: T0, valueUSD: 100 },
        { t: T0 + YEAR, valueUSD: -50 },
      ]),
    ).toBeNull();
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

  it("handles series starting at 0 — peak resets at first positive value", () => {
    // Round-3 audit gap: the `peakV <= 0` skip branch on line ~175
    // is the load-bearing defense against early-zero series.
    // A series [0, -5] has no positive peak ever → null.
    expect(
      maxDrawdown([
        { t: T0, valueUSD: 0 },
        { t: T0 + YEAR, valueUSD: -5 },
      ]),
    ).toBeNull();
    // A series [0, 100, 50] — peak resets to 100 at year 1, then
    // drops 50% → drawdown=0.5.
    const d = maxDrawdown([
      { t: T0, valueUSD: 0 },
      { t: T0 + YEAR, valueUSD: 100 },
      { t: T0 + 2 * YEAR, valueUSD: 50 },
    ]);
    expect(d).not.toBeNull();
    expect(d!.lossPct).toBeCloseTo(0.5, 6);
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

  it("perHoldingCAGR returns null when holding is MISSING from the FIRST snapshot (audit-fix regression pin)", () => {
    // Critical audit finding: prior implementation silently
    // computed a partial-window CAGR when the holding appeared
    // mid-window. UI labeled the result as full-window performance
    // — misleading. Now must be null.
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h_other", cls: "equity", v: 10_000 }]),
      snap(T0 + YEAR, [
        { id: "h_other", cls: "equity", v: 10_000 },
        { id: "h_late", cls: "equity", v: 5_000 },
      ]),
      snap(T0 + 5 * YEAR, [
        { id: "h_other", cls: "equity", v: 10_000 },
        { id: "h_late", cls: "equity", v: 10_000 },
      ]),
    ];
    // h_late exists only at snapshots 1 and 2, not at snapshot 0
    // → must return null (was previously computing a 100% CAGR).
    expect(perHoldingCAGR(snaps, "h_late")).toBeNull();
  });

  it("perHoldingCAGR returns null when holding is MISSING from the LAST snapshot (sell-and-exit)", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h_sold", cls: "equity", v: 10_000 }]),
      snap(T0 + YEAR, [{ id: "h_sold", cls: "equity", v: 11_000 }]),
      // Sold by year 2 — holding absent from final snapshot.
      snap(T0 + 5 * YEAR, []),
    ];
    expect(perHoldingCAGR(snaps, "h_sold")).toBeNull();
  });

  it("perAccountCAGR returns null when account missing from FIRST snapshot (audit-fix regression pin)", () => {
    // Audit engine#8 consistency fix: perAccountCAGR previously
    // diverged from perHoldingCAGR by allowing partial-window
    // data through. Now matches the first-AND-last gate.
    function accountSnap(t: number, accts: string[]): Snapshot {
      return {
        t,
        netWorthUSD: 0,
        household: {
          id: "hh",
          members: [{ id: "m1", displayName: "Tester" } as never],
          accounts: accts.map((id) => ({
            id,
            ownerId: "m1",
            nickname: id,
            kind: "brokerage",
            taxTreatment: "taxable",
            institutionId: null,
            holdings: [
              { id: `h-${id}`, kind: "equity", valueUSD: 1000 } as never,
            ],
          })) as never,
          liabilities: [],
        },
      };
    }
    const snaps = [
      accountSnap(T0, ["a1"]),
      accountSnap(T0 + YEAR, ["a1", "a2"]),
      accountSnap(T0 + 5 * YEAR, ["a1", "a2"]),
    ];
    // a2 only appears at snapshots 1 and 2 — must be null.
    expect(perAccountCAGR(snaps, "a2")).toBeNull();
    // a1 exists across all snapshots — should compute (== 0 here
    // since values are flat, but non-null).
    expect(perAccountCAGR(snaps, "a1")).not.toBeNull();
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

  it("perHoldingCAGR + perAccountCAGR return null on empty input (defensive)", () => {
    // Round-3 audit gap: zero-snapshot and no-household-anywhere
    // paths weren't tested. Both must return null cleanly.
    expect(perHoldingCAGR([], "h1")).toBeNull();
    expect(perAccountCAGR([], "a1")).toBeNull();
    // Snapshots that are all lightweight (no household field):
    const lightOnly: Snapshot[] = [
      { t: T0, netWorthUSD: 100 },
      { t: T0 + YEAR, netWorthUSD: 110 },
    ];
    expect(perHoldingCAGR(lightOnly, "h1")).toBeNull();
    expect(perAccountCAGR(lightOnly, "a1")).toBeNull();
  });

  it("perHoldingTotalReturn matches V_end/V_start - 1 (no annualization)", () => {
    const snaps: Snapshot[] = [
      snap(T0, [{ id: "h1", cls: "equity", v: 10_000 }]),
      snap(T0 + 2 * YEAR, [{ id: "h1", cls: "equity", v: 15_000 }]),
    ];
    expect(perHoldingTotalReturn(snaps, "h1")).toBeCloseTo(0.5, 6);
  });
});
