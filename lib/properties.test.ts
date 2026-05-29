/**
 * Property-based tests for the math invariants the rest of the
 * codebase relies on. Example-based tests pin specific input →
 * output pairs; these property tests pin universal claims — laws
 * that must hold for ALL inputs in a given domain — by feeding
 * fast-check-generated samples and asserting the law.
 *
 * The contracts pinned here:
 *
 *   1. real ↔ nominal conversion is involutive (modulo float noise)
 *   2. real-to-nominal is monotonic in years for positive inflation
 *   3. allocationAtAge interpolates between waypoints — every
 *      class share at an intermediate age lies between the two
 *      bracketing waypoints' shares for that class
 *   4. allocationAtAge clamps outside the bracketed range — ages
 *      before the first waypoint return the first allocation;
 *      ages after the last return the last
 *   5. Monte Carlo yearly percentiles are ordered:
 *      p1 ≤ p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every year
 *
 * Goals: when someone refactors one of the underlying engines —
 * say, swapping `nominalToReal` from division to a logarithmic
 * form for stability — these tests catch the regression
 * regardless of which specific scalar inputs the author thought
 * to test.
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { nominalToReal, realToNominal } from "@/lib/nominal";
import { allocationAtAge } from "@/lib/portfolio/glidePath";
import type { GlidePath, GlidePathWaypoint } from "@/lib/portfolio/glidePath";
import { runHistoricalSequences } from "@/lib/projection/monteCarlo";
import {
  filterIncomeStreamsForRollups,
  incomeForYear,
  incomePerYearUSD,
  lifetimeTotalReal,
  totalIncomeForYear,
  type IncomeStream,
} from "@/lib/budget/incomeStreams";
import {
  clampHaircut,
  effectiveHaircut,
  retirementMonthlyAfterHaircut,
  variableRetirementMonthly,
  type BudgetItem,
} from "@/lib/budget/budget";
import { estimateSocialSecurityAtFRA } from "@/lib/budget/socialSecurity";
import {
  activeMemberIds,
  householdForRollups,
  householdNetWorth,
  TAX_TREATMENT_BY_CATEGORY,
  type AccountCategory,
  type Account,
  type Holding,
  type Household,
} from "@/lib/types";
import {
  planBucketFunding,
  SALE_PRIORITY_ORDER,
} from "@/lib/portfolio/bucketFunding";
import { computeLeveragedEquityBuckets } from "@/lib/portfolio/leveragedEquity";
import {
  runWithdrawalSequence,
  type BucketBalances,
} from "@/lib/tax/withdrawalSequencer";
import { withdrawalSequence } from "@/lib/tax/withdrawalSequence";

/* ============================================================== */
/* Arbitraries                                                     */
/* ============================================================== */

// Finite USD amounts in the planner's working range. Wide enough
// to exercise compounding (sub-dollar to nine-figure NW), tight
// enough that float noise stays predictable.
const usdArb = fc.double({
  min: 0.01,
  max: 1e10,
  noNaN: true,
  noDefaultInfinity: true,
});

// Inflation rates the planner realistically sees. Negative
// deflation up to -5%, positive inflation up to +15% (well past
// any historical sustained anomaly). The +1 floor on (1 + i)^n
// requires i > -1, which holds inside this range.
const inflationArb = fc.double({
  min: -0.05,
  max: 0.15,
  noNaN: true,
  noDefaultInfinity: true,
});

// Horizon in years. 0 short-circuits to the identity branch in
// nominal.ts, so test both the trivial and compounding paths.
const yearsArb = fc.integer({ min: 0, max: 60 });

/* ============================================================== */
/* nominal ↔ real involution                                       */
/* ============================================================== */

describe("nominal.ts — real ↔ nominal involution", () => {
  it("nominalToReal(realToNominal(x)) ≈ x", () => {
    fc.assert(
      fc.property(usdArb, inflationArb, yearsArb, (x, i, y) => {
        const round = nominalToReal(realToNominal(x, i, y), i, y);
        // Relative tolerance — 60yr compounding can amplify the
        // last bits of x by ~1e-12. Allow 1e-9 of relative error.
        const tol = Math.max(1e-6, Math.abs(x) * 1e-9);
        expect(Math.abs(round - x)).toBeLessThan(tol);
      }),
      { numRuns: 200 },
    );
  });

  it("realToNominal is monotonic non-decreasing in years for non-negative inflation", () => {
    const nonNegInflationArb = fc.double({
      min: 0,
      max: 0.15,
      noNaN: true,
      noDefaultInfinity: true,
    });
    fc.assert(
      fc.property(
        usdArb,
        nonNegInflationArb,
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        (x, i, y1, y2) => {
          const [lo, hi] = y1 <= y2 ? [y1, y2] : [y2, y1];
          const nLo = realToNominal(x, i, lo);
          const nHi = realToNominal(x, i, hi);
          // Allow exact equality at i = 0 or x = 0 (no compounding).
          expect(nHi).toBeGreaterThanOrEqual(nLo - 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("years ≤ 0 short-circuits to the identity", () => {
    fc.assert(
      fc.property(usdArb, inflationArb, (x, i) => {
        expect(realToNominal(x, i, 0)).toBe(x);
        expect(realToNominal(x, i, -5)).toBe(x);
        expect(nominalToReal(x, i, 0)).toBe(x);
      }),
      { numRuns: 50 },
    );
  });
});

/* ============================================================== */
/* glide-path interpolation                                        */
/* ============================================================== */

/**
 * Generates a pair of distinct ages + an allocation for each,
 * forming a two-waypoint glide-path. Allocations use a single
 * "equity" class so the test focuses on the interpolation law
 * itself rather than asset-class plumbing.
 */
function twoWaypointGlidePath(): fc.Arbitrary<{
  earlyAge: number;
  lateAge: number;
  earlyEquity: number;
  lateEquity: number;
  gp: GlidePath;
}> {
  return fc
    .tuple(
      fc.integer({ min: 18, max: 50 }),
      fc.integer({ min: 51, max: 95 }),
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    )
    .map(([earlyAge, lateAge, earlyEquity, lateEquity]) => {
      const early: GlidePathWaypoint = {
        age: earlyAge,
        allocation: { equity: earlyEquity, bond: 1 - earlyEquity },
      };
      const late: GlidePathWaypoint = {
        age: lateAge,
        allocation: { equity: lateEquity, bond: 1 - lateEquity },
      };
      return {
        earlyAge,
        lateAge,
        earlyEquity,
        lateEquity,
        gp: { waypoints: [early, late] },
      };
    });
}

describe("glidePath.ts — allocationAtAge", () => {
  it("interpolates within the bracket: equity share at any intermediate age lies between the two waypoints", () => {
    fc.assert(
      fc.property(twoWaypointGlidePath(), (sample) => {
        const { gp, earlyAge, lateAge, earlyEquity, lateEquity } = sample;
        // Sample an age strictly inside the bracket.
        const midAge = Math.floor((earlyAge + lateAge) / 2);
        const alloc = allocationAtAge(gp, midAge);
        expect(alloc).not.toBeNull();
        const equity = alloc!.equity ?? 0;
        const [lo, hi] =
          earlyEquity <= lateEquity
            ? [earlyEquity, lateEquity]
            : [lateEquity, earlyEquity];
        // Tiny float slack — exact endpoints can drift by ~1e-16
        // through the lerp.
        expect(equity).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(equity).toBeLessThanOrEqual(hi + 1e-12);
      }),
      { numRuns: 200 },
    );
  });

  it("clamps below the bracket: age < first waypoint returns the first allocation", () => {
    fc.assert(
      fc.property(twoWaypointGlidePath(), (sample) => {
        const { gp, earlyAge, earlyEquity } = sample;
        const alloc = allocationAtAge(gp, earlyAge - 5);
        expect(alloc).not.toBeNull();
        expect(alloc!.equity).toBeCloseTo(earlyEquity, 12);
      }),
      { numRuns: 100 },
    );
  });

  it("clamps above the bracket: age > last waypoint returns the last allocation", () => {
    fc.assert(
      fc.property(twoWaypointGlidePath(), (sample) => {
        const { gp, lateAge, lateEquity } = sample;
        const alloc = allocationAtAge(gp, lateAge + 5);
        expect(alloc).not.toBeNull();
        expect(alloc!.equity).toBeCloseTo(lateEquity, 12);
      }),
      { numRuns: 100 },
    );
  });

  it("class shares at any age stay non-negative", () => {
    fc.assert(
      fc.property(
        twoWaypointGlidePath(),
        fc.integer({ min: 18, max: 100 }),
        (sample, age) => {
          const alloc = allocationAtAge(sample.gp, age);
          expect(alloc).not.toBeNull();
          for (const share of Object.values(alloc!)) {
            expect(share).toBeGreaterThanOrEqual(-1e-12);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ============================================================== */
/* Monte Carlo percentile ordering                                 */
/* ============================================================== */

describe("monteCarlo.ts — yearly + ending percentile ordering", () => {
  /**
   * Allocations restricted to a stocks/bonds/cash split that sums
   * to 1.0. Picked deterministically here so the test focuses on
   * the post-simulation percentile-sort invariant, not on the
   * input-coverage axis (which the other monteCarlo tests handle).
   */
  const allocationArb = fc
    .tuple(
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    )
    .map(([s, b]) => {
      const total = s + b + 1; // +1 for the implicit cash
      return {
        stocksFraction: s / total,
        bondsFraction: b / total,
        cashFraction: 1 / total,
      };
    });

  // Restricted ranges keep each run fast (~50ms). The invariant
  // we're testing is structural — it should hold regardless of
  // exact magnitudes — so a few representative samples suffice.
  const startingNWArb = fc.double({
    min: 100_000,
    max: 5_000_000,
    noNaN: true,
    noDefaultInfinity: true,
  });
  const annualSpendArb = fc.double({
    min: 10_000,
    max: 200_000,
    noNaN: true,
    noDefaultInfinity: true,
  });
  const horizonArb = fc.integer({ min: 5, max: 40 });

  /**
   * Percentile-ordering check that tolerates float noise. In
   * degenerate cases (all-cash portfolio + tiny spend → all
   * historical sequences produce near-identical paths), adjacent
   * percentiles can wobble by 1–3 ULPs from interpolation in the
   * percentile sort. The structural invariant (lower-rank ≤
   * higher-rank) still holds modulo the float slack.
   */
  /**
   * Relative-tolerance close-enough check. Vitest's toBeCloseTo
   * uses ABSOLUTE precision, which fails on the scale of NW
   * percentiles ($100k-$10M). expectRelClose accepts a 1-part-in-
   * 10^N tolerance and floors at an epsilon for near-zero values.
   */
  function expectRelClose(actual: number, expected: number, relTol: number) {
    const slack = Math.max(1e-6, Math.abs(expected) * relTol);
    if (Math.abs(actual - expected) > slack) {
      throw new Error(
        `expectRelClose failed: ${actual} != ${expected} (slack ${slack})`,
      );
    }
  }

  function expectOrdered(label: string, values: number[]) {
    for (let i = 0; i < values.length - 1; i++) {
      const lo = values[i];
      const hi = values[i + 1];
      const slack = Math.max(1e-6, Math.abs(hi) * 1e-9);
      if (lo - slack > hi) {
        throw new Error(
          `${label}[${i}]=${lo} exceeded ${label}[${i + 1}]=${hi} beyond float slack ${slack}`,
        );
      }
    }
  }

  it("yearlyPercentiles satisfy p1 ≤ p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every year", () => {
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        (startingNW, annualSpend, horizonYears, allocation) => {
          const result = runHistoricalSequences({
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            otherTreatedAsStocks: true,
          });
          const { p1, p5, p25, p50, p75, p95 } = result.yearlyPercentiles;
          for (let i = 0; i < p50.length; i++) {
            expectOrdered(`year ${i}`, [
              p1[i],
              p5[i],
              p25[i],
              p50[i],
              p75[i],
              p95[i],
            ]);
          }
        },
      ),
      // 8 runs — each spins up the full 1928-anchored sequence
      // set, which is the slowest single test in the suite. The
      // invariant is structural, so a handful of samples covers it.
      { numRuns: 8 },
    );
  });

  it("endingNetWorthPercentiles satisfy p1 ≤ p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95", () => {
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        (startingNW, annualSpend, horizonYears, allocation) => {
          const result = runHistoricalSequences({
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            otherTreatedAsStocks: true,
          });
          const e = result.endingNetWorthPercentiles;
          expectOrdered("ending", [e.p1, e.p5, e.p25, e.p50, e.p75, e.p95]);
        },
      ),
      { numRuns: 8 },
    );
  });

  it("successRate is in [0, 1]", () => {
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        (startingNW, annualSpend, horizonYears, allocation) => {
          const result = runHistoricalSequences({
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            otherTreatedAsStocks: true,
          });
          expect(result.successRate).toBeGreaterThanOrEqual(0);
          expect(result.successRate).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 8 },
    );
  });

  // Income streams reduce drawdown stress; the contract is:
  // adding more positive cash flow can never reduce survival.
  // This is the "property" version of the qualitative
  // assertion in monteCarlo.test.ts — fast-check feeds many
  // shapes (starting NW, horizon, allocation), and survival
  // must be monotonically non-decreasing in the income offset.
  it("income strictly does not reduce successRate (monotonic in incomePerYearUSD)", () => {
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        // Per-year income amount, applied uniformly across the
        // first half of retirement. The structural property
        // doesn't care about the per-year SHAPE; what matters
        // is whether adding a positive offset helps or hurts.
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        (startingNW, annualSpend, horizonYears, allocation, perYearIncome) => {
          const baseInputs = {
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            otherTreatedAsStocks: true,
          };
          const noIncome = runHistoricalSequences(baseInputs);
          const withIncome = runHistoricalSequences({
            ...baseInputs,
            incomePerYearUSD: Array(Math.floor(horizonYears / 2)).fill(
              perYearIncome,
            ),
          });
          expect(withIncome.successRate).toBeGreaterThanOrEqual(
            noIncome.successRate,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  it("fixedNominalFreeze.years=0 produces identical output to today's engine", () => {
    // Back-compat invariant for the SORR-mitigation feature.
    // When the freeze duration is 0, the engine must behave
    // exactly as it did pre-feature — same successRate, same
    // percentile bands. Without this property pinned, a future
    // refactor of the freeze branch could subtly shift baseline
    // results (e.g. divide-by-1 floating-point reordering) and
    // every historical projection in the wild would drift.
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        (startingNW, annualSpend, horizonYears, allocation) => {
          const baseline = runHistoricalSequences({
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
          });
          const withZeroFreeze = runHistoricalSequences({
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            spending: {
              variableUSD: 0,
              haircut: { rate: 0, onlyAfterDownYear: false },
              fixedNominalFreeze: {
                years: 0,
                assumedInflationRate: 0.03,
              },
            },
          });
          // toBeCloseTo's precision arg is ABSOLUTE (±10^-precision),
          // which is far too tight for NW percentiles in the
          // $100k-$10M range. Use RELATIVE tolerance via
          // Math.abs(a - b) <= max(epsilon, |b| * relTol). With
          // relTol = 1e-9, two paths must agree to 9 significant
          // digits — tight enough that any real divergence (a bug
          // re-introducing the freeze decay when years=0) breaks the
          // test, loose enough that FP-reordering refactors don't.
          const RELTOL = 1e-9;
          expect(
            Math.abs(withZeroFreeze.successRate - baseline.successRate),
          ).toBeLessThanOrEqual(1e-12);
          expectRelClose(
            withZeroFreeze.endingNetWorthPercentiles.p50,
            baseline.endingNetWorthPercentiles.p50,
            RELTOL,
          );
          expectRelClose(
            withZeroFreeze.endingNetWorthPercentiles.p5,
            baseline.endingNetWorthPercentiles.p5,
            RELTOL,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  it("bucket policy with 0% cash ≡ annual policy (silent degrade)", () => {
    // Invariant: the bucket strategy needs a cash slice to do
    // anything. With cashFraction = 0, the policy must produce
    // results indistinguishable from annual rebalance — bucket
    // mode must NEVER make a zero-cash portfolio WORSE through
    // its skip-the-snap branch (which could happen if a refactor
    // mishandled the no-cash case). Pinning this catches that
    // class of regression even with all-stocks portfolios.
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        (startingNW, annualSpend, horizonYears) => {
          // 100% stocks: no cash → bucket has nothing to do.
          const allStocks = {
            stocksFraction: 1,
            bondsFraction: 0,
            cashFraction: 0,
          };
          // Hold rebalance constant on both arms so the only thing
          // varying is the bucket flag. (Earlier version passed
          // default `annual` on one arm and `none` on the other,
          // confounding two axes — only worked here because 100%
          // stocks makes BOTH no-ops. A future refactor that
          // broke the bucket flag specifically with 0% cash could
          // pass this test if `rebalance: "none"` also changed.)
          const annual = runHistoricalSequences(
            {
              startingNetWorthUSD: startingNW,
              allocation: allStocks,
              annualSpendUSD: annualSpend,
              retirementHorizonYears: horizonYears,
            },
            { rebalance: "none" },
          );
          const bucket = runHistoricalSequences(
            {
              startingNetWorthUSD: startingNW,
              allocation: allStocks,
              annualSpendUSD: annualSpend,
              retirementHorizonYears: horizonYears,
              spending: {
                variableUSD: 0,
                haircut: { rate: 0, onlyAfterDownYear: false },
                cashBucketPriority: true,
              },
            },
            { rebalance: "none" },
          );
          // Single-class portfolio with 0% cash: the bucket flag
          // has nothing to drain → silent no-op. Even with the
          // depleting-bucket interpretation (none + bucketPriority),
          // trajectories should match within float tolerance.
          expectRelClose(
            bucket.successRate,
            annual.successRate,
            1e-9,
          );
          expectRelClose(
            bucket.endingNetWorthPercentiles.p50,
            annual.endingNetWorthPercentiles.p50,
            1e-9,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  // Engine gate is `y >= yearsPre`. With default `yearsPre = 0`
  // (no `yearsUntilRetirement`), the bucket DOES fire from y=0
  // onward. Coverage for that path lives in the point-tests in
  // monteCarlo.test.ts (per-year boundary assertions) and the
  // bucket-vs-income monotonicity property below.

  it("bucket flag + positive income: income still strictly does not reduce successRate", () => {
    // Compose two contracts the engine claims to honor: (a)
    // positive income is monotonic in successRate (already pinned
    // by the non-bucket version above) AND (b) the cash-bucket
    // priority correctly routes income back into the portfolio
    // when the bucket withdrawal drained it. The Round-1 audit
    // caught a path-dependent bug where positive income vanished
    // into a zero-total portfolio under the bucket flag — that
    // bug would surface here as a `withIncome.successRate <
    // noIncome.successRate` violation on random inputs.
    fc.assert(
      fc.property(
        startingNWArb,
        annualSpendArb,
        horizonArb,
        allocationArb,
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        (startingNW, annualSpend, horizonYears, allocation, perYearIncome) => {
          const baseInputs = {
            startingNetWorthUSD: startingNW,
            allocation,
            annualSpendUSD: annualSpend,
            retirementHorizonYears: horizonYears,
            otherTreatedAsStocks: true,
            spending: {
              variableUSD: 0,
              haircut: { rate: 0, onlyAfterDownYear: false },
              cashBucketPriority: true,
            },
          };
          const noIncome = runHistoricalSequences(baseInputs, {
            rebalance: "none",
          });
          const withIncome = runHistoricalSequences(
            {
              ...baseInputs,
              incomePerYearUSD: Array(Math.floor(horizonYears / 2)).fill(
                perYearIncome,
              ),
            },
            { rebalance: "none" },
          );
          expect(withIncome.successRate).toBeGreaterThanOrEqual(
            noIncome.successRate,
          );
        },
      ),
      { numRuns: 8 },
    );
  });
});

/* ============================================================ */
/* Income-stream math                                            */
/* ============================================================ */

const streamArb: fc.Arbitrary<IncomeStream> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    label: fc.string({ minLength: 1, maxLength: 16 }),
    startYear: fc.integer({ min: 2000, max: 2080 }),
    duration: fc.integer({ min: 0, max: 50 }),
    annualUSD: fc.double({
      min: 0,
      max: 1_000_000,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    realGrowthRate: fc.double({
      min: -0.05,
      max: 0.10,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    ownerId: fc.constantFrom("m1", "m2", "m3"),
  })
  .map(({ startYear, duration, ...rest }) => ({
    ...rest,
    startYear,
    endYear: startYear + duration,
  }));

describe("income-stream math invariants", () => {
  // Each per-year value in the pre-computed array MUST match
  // the value computed by summing across streams for that
  // year. If these diverge, the simulator + projection are
  // consuming inconsistent inputs.
  it("incomePerYearUSD[i] === totalIncomeForYear(streams, baseYear + i)", () => {
    fc.assert(
      fc.property(
        fc.array(streamArb, { minLength: 0, maxLength: 5 }),
        fc.integer({ min: 2020, max: 2080 }),
        fc.integer({ min: 1, max: 60 }),
        (streams, baseYear, numYears) => {
          const arr = incomePerYearUSD(streams, baseYear, numYears);
          expect(arr).toHaveLength(numYears);
          for (let i = 0; i < numYears; i++) {
            expect(arr[i]).toBeCloseTo(
              totalIncomeForYear(streams, baseYear + i),
              6,
            );
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  // Lifetime total in real $ is, by construction, the sum of
  // per-year amounts over the stream's life. The two helpers
  // are independent code paths — this property checks they
  // agree, so future refactors that change one without the
  // other are caught.
  it("lifetimeTotalReal(s) === Σ incomeForYear(s, y) for y in [startYear, endYear]", () => {
    fc.assert(
      fc.property(streamArb, (s) => {
        let sum = 0;
        for (let y = s.startYear; y <= s.endYear; y++) {
          sum += incomeForYear(s, y);
        }
        expect(lifetimeTotalReal(s)).toBeCloseTo(sum, 4);
      }),
      { numRuns: 50 },
    );
  });

  // Adding a stream to an existing set can never DECREASE the
  // total in any year — income is strictly additive. Catches
  // a bug where a stream's contribution accidentally
  // subtracted (e.g. sign flip on a refactor).
  it("totalIncomeForYear is monotonic in stream count", () => {
    fc.assert(
      fc.property(
        fc.array(streamArb, { minLength: 0, maxLength: 4 }),
        streamArb,
        fc.integer({ min: 2020, max: 2080 }),
        (existing, extra, year) => {
          const before = totalIncomeForYear(existing, year);
          const after = totalIncomeForYear([...existing, extra], year);
          // Tolerance for float noise on the extra contribution.
          expect(after).toBeGreaterThanOrEqual(before - 1e-6);
        },
      ),
      { numRuns: 30 },
    );
  });

  // filterIncomeStreamsForRollups must be a SUBSET filter — it
  // never invents streams. Result length ≤ input length.
  it("filterIncomeStreamsForRollups returns a subset of input", () => {
    fc.assert(
      fc.property(
        fc.array(streamArb, { minLength: 0, maxLength: 8 }),
        fc.option(fc.constantFrom("m1", "m2", "m3"), { nil: null }),
        fc.array(fc.constantFrom("m1", "m2", "m3"), { maxLength: 3 }),
        (streams, memberId, activeArr) => {
          const active = new Set(activeArr);
          const result = filterIncomeStreamsForRollups(
            streams,
            memberId,
            active,
          );
          // Every result element is from the input.
          for (const r of result) {
            expect(streams.some((s) => s.id === r.id)).toBe(true);
          }
          // Length cannot grow.
          expect(result.length).toBeLessThanOrEqual(streams.length);
        },
      ),
      { numRuns: 30 },
    );
  });

  // Per-member view: every result has ownerId === the picked
  // member. The "explicit pick wins regardless of rollup-active"
  // semantic boundary lives or dies on this property — if it
  // ever breaks, excluded members' picks would silently return
  // empty results.
  it("filterIncomeStreamsForRollups: per-member view yields only that owner's streams", () => {
    fc.assert(
      fc.property(
        fc.array(streamArb, { minLength: 0, maxLength: 8 }),
        fc.constantFrom("m1", "m2", "m3"),
        fc.array(fc.constantFrom("m1", "m2", "m3"), { maxLength: 3 }),
        (streams, memberId, activeArr) => {
          const result = filterIncomeStreamsForRollups(
            streams,
            memberId,
            new Set(activeArr),
          );
          for (const r of result) {
            expect(r.ownerId).toBe(memberId);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

/* ============================================================ */
/* Haircut sizing                                                */
/* ============================================================ */

describe("haircut sizing invariants", () => {
  // The corpus-sizing helper for the conditional-haircut mode
  // MUST produce a value strictly between 0 and the always-
  // apply rate. Anything else means the corpus suggestion is
  // sized for the wrong scenario.
  it("effectiveHaircut(rate, true) <= effectiveHaircut(rate, false) for all rates", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (rate) => {
          const conditional = effectiveHaircut(rate, true);
          const alwaysApply = effectiveHaircut(rate, false);
          expect(conditional).toBeLessThanOrEqual(alwaysApply);
          // Both clamped to [0, 1].
          expect(conditional).toBeGreaterThanOrEqual(0);
          expect(alwaysApply).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 50 },
    );
  });

  // After-haircut retirement spend is MONOTONICALLY DECREASING
  // in the haircut rate. Higher haircut → lower spend. If this
  // ever broke (e.g. someone accidentally multiplied by the
  // haircut instead of (1 - haircut)), the corpus suggestion
  // would be wildly wrong.
  it("retirementMonthlyAfterHaircut is monotonically decreasing in haircut", () => {
    const itemsArb: fc.Arbitrary<BudgetItem[]> = fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        name: fc.string({ minLength: 1, maxLength: 16 }),
        ownerId: fc.constantFrom("m1", "m2", "m3"),
        category: fc.constantFrom("food", "housing", "lifestyle", "healthcare"),
        subcategory: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
        type: fc.constantFrom("fixed", "variable"),
        monthlyUSD: fc.double({
          min: 0,
          max: 20_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        billingCycle: fc.constantFrom("monthly", "quarterly", "yearly"),
        notes: fc.option(fc.string({ maxLength: 16 }), { nil: undefined }),
        excessInflationRate: fc.option(
          fc.double({ min: -0.05, max: 0.10, noNaN: true, noDefaultInfinity: true }),
          { nil: undefined },
        ),
        endsAtRetirement: fc.boolean(),
        createdAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
      }),
      { minLength: 0, maxLength: 6 },
    ) as unknown as fc.Arbitrary<BudgetItem[]>;

    fc.assert(
      fc.property(
        itemsArb,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (items, hLow, hHigh) => {
          if (hLow > hHigh) return; // discard — we want hLow <= hHigh
          const low = retirementMonthlyAfterHaircut(items, clampHaircut(hLow));
          const high = retirementMonthlyAfterHaircut(items, clampHaircut(hHigh));
          // Lower haircut should produce >= higher haircut's result.
          // Float tolerance for sum-of-products with up to 6 items.
          expect(low).toBeGreaterThanOrEqual(high - 1e-6);
        },
      ),
      { numRuns: 40 },
    );

    // Sister invariant: (variableRetirementMonthly + after-haircut@0)
    // does NOT equal sum of fixed + variable (because the items
    // are split by type). But the haircut(0) call MUST give
    // fixed + variable totals. Pin that decomposition.
    fc.assert(
      fc.property(itemsArb, (items) => {
        const noHaircutTotal = retirementMonthlyAfterHaircut(items, 0);
        const variable = variableRetirementMonthly(items);
        // Fixed portion = total - variable. Must be >= 0.
        expect(noHaircutTotal - variable).toBeGreaterThanOrEqual(-1e-6);
      }),
      { numRuns: 30 },
    );
  });
});

/* ============================================================ */
/* Social Security estimator                                     */
/* ============================================================ */

describe("Social Security estimator invariants", () => {
  // Higher income → higher PIA. The bend-point formula is
  // monotonic everywhere (90% > 32% > 15% slopes don't flip);
  // a wider input range should produce a non-decreasing output.
  it("PIA is monotonically non-decreasing in income (below the cap)", () => {
    fc.assert(
      fc.property(
        // Sample below the SS taxable max so neither input
        // hits the cap and the comparison stays meaningful.
        fc.double({ min: 30_000, max: 170_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 30_000, max: 170_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 25, max: 55 }),
        fc.integer({ min: 56, max: 67 }),
        (incA, incB, currentAge, retirementAge) => {
          if (incA > incB) return; // discard
          const a = estimateSocialSecurityAtFRA(incA, currentAge, retirementAge);
          const b = estimateSocialSecurityAtFRA(incB, currentAge, retirementAge);
          expect(b.annualUSDAtFRA).toBeGreaterThanOrEqual(a.annualUSDAtFRA);
        },
      ),
      { numRuns: 30 },
    );
  });

  // More working years → more (or equal) PIA, up to the 35y
  // AIME window. Past the window, the formula saturates —
  // someone with 40 working years gets the same as someone
  // with 35 (we approximate with cap-adjusted income).
  it("PIA is monotonically non-decreasing in working years (up to the cap)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50_000, max: 150_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 22, max: 30 }),
        fc.integer({ min: 35, max: 55 }),
        fc.integer({ min: 55, max: 67 }),
        (income, currentAge, retireEarly, retireLate) => {
          if (retireEarly > retireLate) return; // discard
          if (retireEarly <= currentAge) return; // estimator guards
          const early = estimateSocialSecurityAtFRA(income, currentAge, retireEarly);
          const late = estimateSocialSecurityAtFRA(income, currentAge, retireLate);
          // More years contributing → at least as much benefit.
          expect(late.annualUSDAtFRA).toBeGreaterThanOrEqual(
            early.annualUSDAtFRA - 1e-6,
          );
        },
      ),
      { numRuns: 30 },
    );
  });

  // PIA is bounded — even a max-cap earner can't exceed the
  // formula's theoretical ceiling. ~$4,043/mo PIA × 12 = ~$48k.
  // Loose bound here ($60k) so a future bend-point update
  // doesn't break the test, but a runaway computation (e.g.
  // missing cap) would fail loudly.
  it("PIA is always bounded below $60k/yr for any single-earner input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1_000, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 22, max: 55 }),
        fc.integer({ min: 56, max: 67 }),
        (income, currentAge, retirementAge) => {
          if (retirementAge <= currentAge) return;
          const r = estimateSocialSecurityAtFRA(income, currentAge, retirementAge);
          expect(r.annualUSDAtFRA).toBeLessThan(60_000);
        },
      ),
      { numRuns: 30 },
    );
  });
});

/* ============================================================ */
/* householdForRollups composition                               */
/* ============================================================ */

describe("householdForRollups invariants", () => {
  // Active member set is a subset of all members. After the
  // filter, no excluded member's accounts can be in the
  // rollup view. Catches a regression where the filter logic
  // got swapped (active set → excluded set).
  it("accounts in rollup view are owned by active members only", () => {
    fc.assert(
      fc.property(
        // Generate a household with 2-4 members, some flagged
        // out of rollups, with 0-6 accounts each.
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 6 }),
            includeInRollup: fc.option(fc.boolean(), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 6 }),
            ownerIdx: fc.integer({ min: 0, max: 3 }),
            valueUSD: fc.double({
              min: 0,
              max: 1e8,
              noNaN: true,
              noDefaultInfinity: true,
            }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (members, accountSpecs) => {
          // De-dup member ids — the fc.string generator can
          // collide.
          const uniqueMembers: typeof members = [];
          const seen = new Set<string>();
          for (const m of members) {
            if (!seen.has(m.id)) {
              uniqueMembers.push(m);
              seen.add(m.id);
            }
          }
          if (uniqueMembers.length === 0) return;
          const h: Household = {
            id: "h",
            members: uniqueMembers.map((m) => ({
              id: m.id,
              displayName: m.id,
              includeInRollup: m.includeInRollup,
            })),
            accounts: accountSpecs.map((a, i) => ({
              id: `${a.id}-${i}`,
              displayName: a.id,
              category: "BROKERAGE",
              ownerId: uniqueMembers[a.ownerIdx % uniqueMembers.length].id,
              monthlyContributionUSD: 0,
              holdings: [
                {
                  kind: "cash",
                  id: `${a.id}-${i}-h`,
                  valueUSD: a.valueUSD,
                  expectedRealCAGR: 0,
                  geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
                },
              ],
            })),
            liabilities: [],
          };
          const active = activeMemberIds(h);
          const filtered = householdForRollups(h);
          // EVERY account in the filtered view is owned by an
          // active member. No leak.
          for (const a of filtered.accounts) {
            expect(active.has(a.ownerId)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  // Net worth after the rollup filter is bounded above by
  // net worth before. Excluding members can only REMOVE
  // accounts (never add). This is the foundation of the
  // user's mental model: "excluding a member can never raise
  // my reported NW" — wait, that's not quite right because
  // excluding a member with only LIABILITIES would raise NW.
  // The correct invariant is on assets-only: sum of account
  // values after ≤ before. Liabilities are a separate
  // collection.
  it("sum of account values after filter <= sum before", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 6 }),
            includeInRollup: fc.option(fc.boolean(), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.array(
          fc.record({
            ownerIdx: fc.integer({ min: 0, max: 2 }),
            valueUSD: fc.double({
              min: 0,
              max: 1e8,
              noNaN: true,
              noDefaultInfinity: true,
            }),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        (members, accountSpecs) => {
          const uniqueMembers: typeof members = [];
          const seen = new Set<string>();
          for (const m of members) {
            if (!seen.has(m.id)) {
              uniqueMembers.push(m);
              seen.add(m.id);
            }
          }
          if (uniqueMembers.length === 0) return;
          const h: Household = {
            id: "h",
            members: uniqueMembers.map((m) => ({
              id: m.id,
              displayName: m.id,
              includeInRollup: m.includeInRollup,
            })),
            accounts: accountSpecs.map((a, i) => ({
              id: `a-${i}`,
              displayName: `a${i}`,
              category: "BROKERAGE",
              ownerId: uniqueMembers[a.ownerIdx % uniqueMembers.length].id,
              monthlyContributionUSD: 0,
              holdings: [
                {
                  kind: "cash",
                  id: `a-${i}-h`,
                  valueUSD: a.valueUSD,
                  expectedRealCAGR: 0,
                  geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
                },
              ],
            })),
            liabilities: [],
          };
          // No liabilities → NW = sum of account values, and
          // filter can only remove → after ≤ before.
          const before = householdNetWorth(h);
          const after = householdNetWorth(householdForRollups(h));
          expect(after).toBeLessThanOrEqual(before + 1e-6);
        },
      ),
      { numRuns: 30 },
    );
  });
});

/* ============================================================== */
/* Tax model: bucket funding + leveraged-equity + withdrawal      */
/* sequencer composition invariants.                              */
/*                                                                */
/* Point tests cover specific scenarios in:                       */
/*   - lib/portfolio/bucketFunding.test.ts                        */
/*   - lib/portfolio/leveragedEquity.test.ts                      */
/*   - lib/tax/withdrawalSequencer.test.ts                        */
/*                                                                */
/* The properties below pin universal claims (monotonicity,       */
/* conservation, composition) so a future refactor of any of the  */
/* three engines can't silently violate cross-engine contracts.   */
/* ============================================================== */

/* ---- Helpers / arbitraries for the tax model ---- */

// Account-category restricted to the categories the bucket-funding
// + sequencer engines care about. We exclude REAL_ESTATE / CRYPTO /
// OTHER from the random sample to keep the arbitrary tightly focused
// on the tax-treatment dimension we want to vary; point tests cover
// the other categories.
const accountCategoryArb: fc.Arbitrary<AccountCategory> = fc.constantFrom(
  "BROKERAGE",
  "SAVINGS",
  "401K",
  "TRAD_IRA",
  "ROTH_IRA",
  "ROTH_401K",
  "HSA",
  "FIVE_29",
);

// Random equity holding spec. `leverage` spans 1x..3x so the test
// covers both the regularEquity AND leveragedEquity sale buckets.
// `valueUSD` is non-zero so the holding contributes something to NW.
type EquitySpec = {
  id: string;
  valueUSD: number;
  leverage: number;
  symbol: string;
};
const equitySpecArb: fc.Arbitrary<EquitySpec> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  valueUSD: fc.double({
    min: 100,
    max: 500_000,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  // Mix of 1x (regular), 2x (recognized 2x like SSO via "SSO"
  // symbol), 3x (non-recognized like TQQQ via "TQQQ"), and a few
  // generic 3x for the diversify branch.
  leverage: fc.constantFrom(1, 2, 3),
  symbol: fc.constantFrom("VOO", "VTI", "SSO", "QLD", "TQQQ", "SOXL", "UPRO"),
});

const cashSpecArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  valueUSD: fc.double({
    min: 0,
    max: 200_000,
    noNaN: true,
    noDefaultInfinity: true,
  }),
});

// Build an equity Holding from a spec. Picks a sensible style box +
// geography (the bucket-funding + leveragedEquity engines don't read
// these, but the type system demands them).
function makeEquity(spec: EquitySpec, idx: number): Holding {
  return {
    kind: "equity",
    id: `eq-${idx}-${spec.id}`,
    symbol: spec.symbol,
    shares: 1,
    lastPriceUSD: spec.valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: spec.valueUSD,
    expectedRealCAGR: 0.05,
    leverage: spec.leverage,
    styleBox: {
      LARGE_VALUE: 0,
      LARGE_BLEND: 1,
      LARGE_GROWTH: 0,
      MID_VALUE: 0,
      MID_BLEND: 0,
      MID_GROWTH: 0,
      SMALL_VALUE: 0,
      SMALL_BLEND: 0,
      SMALL_GROWTH: 0,
    },
    geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
  };
}

function makeCash(spec: { id: string; valueUSD: number }, idx: number): Holding {
  return {
    kind: "cash",
    id: `cash-${idx}-${spec.id}`,
    valueUSD: spec.valueUSD,
    expectedRealCAGR: 0,
    geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
  };
}

type AccountSpec = {
  category: AccountCategory;
  equities: EquitySpec[];
  cash: { id: string; valueUSD: number }[];
};

const accountSpecArb: fc.Arbitrary<AccountSpec> = fc.record({
  category: accountCategoryArb,
  equities: fc.array(equitySpecArb, { minLength: 0, maxLength: 3 }),
  cash: fc.array(cashSpecArb, { minLength: 0, maxLength: 2 }),
});

const householdArb: fc.Arbitrary<Household> = fc
  .array(accountSpecArb, { minLength: 1, maxLength: 4 })
  .map((accountSpecs): Household => {
    const accounts: Account[] = accountSpecs.map((aSpec, ai) => {
      const holdings: Holding[] = [
        ...aSpec.equities.map((e, ei) => makeEquity(e, ai * 10 + ei)),
        ...aSpec.cash.map((c, ci) => makeCash(c, ai * 10 + ci + 100)),
      ];
      return {
        id: `acc-${ai}`,
        category: aSpec.category,
        displayName: `acc-${ai}`,
        ownerId: "m1",
        holdings,
        monthlyContributionUSD: 0,
      };
    });
    return {
      id: "hh",
      members: [{ id: "m1", displayName: "Tester" }],
      accounts,
      liabilities: [],
    };
  });

/** Sum total face value across all holdings in the household. */
function totalAssetUSD(h: Household): number {
  let total = 0;
  for (const a of h.accounts) {
    for (const hh of a.holdings) {
      total += hh.valueUSD;
    }
  }
  return total;
}

/** Sum face value of equity holdings sitting in TAXABLE accounts. */
function taxableEquityFaceUSD(h: Household): number {
  let total = 0;
  for (const a of h.accounts) {
    if (TAX_TREATMENT_BY_CATEGORY[a.category] !== "TAXABLE") continue;
    for (const hh of a.holdings) {
      if (hh.kind === "equity") total += hh.valueUSD;
    }
  }
  return total;
}

const taxRateArb = fc.double({
  min: 0,
  max: 0.5,
  noNaN: true,
  noDefaultInfinity: true,
});

const cashFractionArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("tax model — property-based invariants", () => {
  /* ---------------------------------------------------------- */
  /* 1. Bucket funding monotone in cash request                 */
  /* ---------------------------------------------------------- */
  // More cash requested → at least as much tax. Catches a refactor
  // that accidentally caps the sale loop early, or skips taxable
  // holdings under load.
  it("planBucketFunding.totalTaxOwedUSD is monotonic non-decreasing in requested cash fraction", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        cashFractionArb,
        taxRateArb,
        (hh, r1, r2, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return; // degenerate, skip
          const [lo, hi] = r1 <= r2 ? [r1, r2] : [r2, r1];
          const planLo = planBucketFunding(hh, nw, lo, rate);
          const planHi = planBucketFunding(hh, nw, hi, rate);
          // Tiny slack for float noise in the multiply-and-sum.
          expect(planHi.totalTaxOwedUSD).toBeGreaterThanOrEqual(
            planLo.totalTaxOwedUSD - 1e-6,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 2. Tax conservation: bounded by taxable equity × rate      */
  /* ---------------------------------------------------------- */
  // You can't owe more cap-gains tax than is theoretically
  // computable as (taxable holding face × gainFraction × rate).
  // gainFraction defaults to 1.0, so the bound simplifies to
  // (taxableFace × rate). The bound is loose-ish because the plan
  // can pull from non-equity TAXABLE holdings too (cash in taxable
  // accounts — but cash is excluded from sales, so no tax), but
  // never tighter than taxable equity face. We use the broader
  // bound: total taxable asset value × rate.
  it("planBucketFunding.totalTaxOwedUSD <= taxable assets × rate (conservation)", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        taxRateArb,
        (hh, req, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return;
          const plan = planBucketFunding(hh, nw, req, rate);
          // Upper bound on possible cap-gains tax: every TAXABLE-
          // account holding sold at face, multiplied by gainFraction
          // (default 1.0) × rate. Holding count in cash holdings is
          // ignored at sale time but contributes 0 tax either way,
          // so summing all TAXABLE-account face is a valid upper
          // bound.
          let taxableFace = 0;
          for (const a of hh.accounts) {
            if (TAX_TREATMENT_BY_CATEGORY[a.category] !== "TAXABLE") continue;
            for (const hd of a.holdings) {
              taxableFace += hd.valueUSD;
            }
          }
          const bound = taxableFace * 1.0 * plan.effectiveTaxRate;
          expect(plan.totalTaxOwedUSD).toBeLessThanOrEqual(bound + 1e-6);
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 3. Sales sum equals amountRaisedUSD                        */
  /* ---------------------------------------------------------- */
  // The sum of per-sale face-value must equal the plan's headline
  // amountRaisedUSD. If a refactor double-counted a holding, or
  // missed one, this catches it.
  it("Σ plan.sales[i].faceValueSoldUSD === plan.amountRaisedUSD", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        taxRateArb,
        (hh, req, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return;
          const plan = planBucketFunding(hh, nw, req, rate);
          const sumOfSales = plan.sales.reduce(
            (acc, s) => acc + s.faceValueSoldUSD,
            0,
          );
          // Allow tiny float slack — the sum is N floating-point
          // adds on values up to ~$500k each.
          const slack = Math.max(1e-6, Math.abs(plan.amountRaisedUSD) * 1e-9);
          expect(Math.abs(sumOfSales - plan.amountRaisedUSD)).toBeLessThan(
            slack,
          );
          // Same check at the per-bucket level: Σ perBucket.face
          // also equals amountRaisedUSD.
          const sumOfBuckets = plan.perBucket.reduce(
            (acc, b) => acc + b.faceValueSoldUSD,
            0,
          );
          expect(Math.abs(sumOfBuckets - plan.amountRaisedUSD)).toBeLessThan(
            slack,
          );
          // perBucket count matches the priority order length —
          // every bucket appears exactly once.
          expect(plan.perBucket.length).toBe(SALE_PRIORITY_ORDER.length);
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 4. effectiveCashEquivalentShare bounded [0, 1]             */
  /* ---------------------------------------------------------- */
  it("plan.effectiveCashEquivalentShare ∈ [0, 1]", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        taxRateArb,
        (hh, req, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return;
          const plan = planBucketFunding(hh, nw, req, rate);
          expect(plan.effectiveCashEquivalentShare).toBeGreaterThanOrEqual(0);
          expect(plan.effectiveCashEquivalentShare).toBeLessThanOrEqual(
            1 + 1e-9,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 5. effectiveCashFractionPostTax bounded [0, 1]             */
  /* ---------------------------------------------------------- */
  it("plan.effectiveCashFractionPostTax ∈ [0, 1]", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        taxRateArb,
        (hh, req, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return;
          const plan = planBucketFunding(hh, nw, req, rate);
          expect(plan.effectiveCashFractionPostTax).toBeGreaterThanOrEqual(0);
          expect(plan.effectiveCashFractionPostTax).toBeLessThanOrEqual(
            1 + 1e-9,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 6. Plan ↔ leveraging composition: total tax doesn't        */
  /*    double-count when both engines see the same household.  */
  /* ---------------------------------------------------------- */
  // If both bucket-funding AND deleveraging want to sell the same
  // TQQQ, the consumedByBucketFunding handoff means the deleveraging
  // engine sees the REMAINING (post-bucket-sale) face, not the full
  // face. Property: combining the two via the handoff must give a
  // total tax ≤ computing them independently (which double-counts).
  it("bucketFunding.tax + leveragedBuckets(consumed=plan.sales).tax ≤ planAlone.tax + leveragedAlone.tax (no double-count)", () => {
    fc.assert(
      fc.property(
        householdArb,
        cashFractionArb,
        taxRateArb,
        (hh, req, rate) => {
          const nw = totalAssetUSD(hh);
          if (nw <= 0) return;
          // (a) Bucket funding alone.
          const planAlone = planBucketFunding(hh, nw, req, rate);
          // (b) Leveraged-equity restructure alone (sees full face).
          const leveragedAlone = computeLeveragedEquityBuckets(
            hh,
            rate,
            1.0,
          );
          // (c) Composition: leveraged sees the bucket-sale handoff.
          const consumedMap = new Map<string, number>();
          for (const sale of planAlone.sales) {
            consumedMap.set(
              sale.holdingId,
              (consumedMap.get(sale.holdingId) ?? 0) + sale.faceValueSoldUSD,
            );
          }
          const leveragedAfter = computeLeveragedEquityBuckets(
            hh,
            rate,
            1.0,
            consumedMap,
          );
          const composed =
            planAlone.totalTaxOwedUSD + leveragedAfter.deleveragingTaxHitUSD;
          const independent =
            planAlone.totalTaxOwedUSD + leveragedAlone.deleveragingTaxHitUSD;
          // Composed should never EXCEED independent (handoff can
          // only REDUCE the leveraged engine's remaining face).
          // Allow tiny float slack — both sums involve N multiplies.
          expect(composed).toBeLessThanOrEqual(independent + 1e-6);
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 7. Withdrawal sequence: monotone in tax rate               */
  /* ---------------------------------------------------------- */
  // Higher ordinary tax rate → at least as much lifetime tax paid
  // (across the simulation window). The drawdown engine grosses up
  // pretax withdrawals at `1/(1-rate)`; LTCG-bucket draws gross up
  // at `1/(1-rate/2)`; both monotone in `rate`.
  it("runWithdrawalSequence.totalTaxesPaidUSD is monotone non-decreasing in retirementTaxRate", () => {
    const startingBalancesArb: fc.Arbitrary<BucketBalances> = fc.record({
      taxable: fc.double({
        min: 0,
        max: 1_000_000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      pretax: fc.double({
        min: 0,
        max: 1_000_000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      roth: fc.double({
        min: 0,
        max: 500_000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      hsa: fc.double({
        min: 0,
        max: 200_000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
    });
    const cagrArb = fc.double({
      min: 0,
      max: 0.08,
      noNaN: true,
      noDefaultInfinity: true,
    });
    fc.assert(
      fc.property(
        startingBalancesArb,
        cagrArb,
        fc.double({
          min: 10_000,
          max: 150_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        fc.integer({ min: 5, max: 25 }),
        fc.double({
          min: 0.0,
          max: 0.40,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        fc.double({
          min: 0.0,
          max: 0.40,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (startingBalances, cagr, spend, years, t1, t2) => {
          // Ensure positive balance somewhere — otherwise both runs
          // produce trivially-zero tax (no withdrawals possible) and
          // the invariant holds vacuously.
          const total =
            startingBalances.taxable +
            startingBalances.pretax +
            startingBalances.roth +
            startingBalances.hsa;
          if (total <= 0) return;
          const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const cagrByBucket: BucketBalances = {
            taxable: cagr,
            pretax: cagr,
            roth: cagr,
            hsa: cagr,
          };
          const baseInputs = {
            startingBalances,
            annualRealSpendUSD: spend,
            realCAGRByBucket: cagrByBucket,
            startingAge: 60,
            years,
          };
          const low = runWithdrawalSequence({
            ...baseInputs,
            retirementTaxRate: lo,
          });
          const high = runWithdrawalSequence({
            ...baseInputs,
            retirementTaxRate: hi,
          });
          // Float slack for the multi-year accumulator (years ×
          // bucket-rate products).
          expect(high.totalTaxesPaidUSD).toBeGreaterThanOrEqual(
            low.totalTaxesPaidUSD - 1e-6,
          );
        },
      ),
      { numRuns: 8 },
    );
  });

  /* ---------------------------------------------------------- */
  /* 8. Education bucket excluded from withdrawal sequence      */
  /* ---------------------------------------------------------- */
  // A household with $X in a 529 / TRUMP_ACCOUNT must produce a
  // `withdrawalSequence` whose `education` row carries the $X but
  // when those bucket totals are forwarded into `runWithdrawalSequence`
  // (which only accepts taxable/pretax/roth/hsa), the 529 dollars
  // are NEITHER added to the spendable pool NOR generate tax.
  //
  // Concretely: take the same household twice — once with a 529,
  // once without — and verify the sequencer output is identical
  // (taxes paid, net spend, ending balance) because the 529 never
  // reaches the engine.
  it("EDUCATION (529/Trump) account is excluded from the drawdown engine — its $ neither funds spend nor incurs tax", () => {
    fc.assert(
      fc.property(
        // 529 balance
        fc.double({
          min: 1_000,
          max: 500_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        // Some regular retirement balance
        fc.double({
          min: 100_000,
          max: 2_000_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        // Annual spend
        fc.double({
          min: 10_000,
          max: 150_000,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        // Years
        fc.integer({ min: 5, max: 25 }),
        // Tax rate
        fc.double({
          min: 0.0,
          max: 0.40,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (edBalance, retireBalance, spend, years, rate) => {
          // Build two households: one with a 529, one without.
          // Both have an identical 401k with retireBalance.
          const sharedEquityHolding = (
            id: string,
            valueUSD: number,
          ): Holding => makeEquity(
            { id, valueUSD, leverage: 1, symbol: "VOO" },
            0,
          );
          const baseAccount: Account = {
            id: "acc-401k",
            category: "401K",
            displayName: "401k",
            ownerId: "m1",
            holdings: [sharedEquityHolding("retire", retireBalance)],
            monthlyContributionUSD: 0,
          };
          const eduAccount: Account = {
            id: "acc-529",
            category: "FIVE_29",
            displayName: "529",
            ownerId: "m1",
            holdings: [sharedEquityHolding("edu", edBalance)],
            monthlyContributionUSD: 0,
          };
          const hhWithout: Household = {
            id: "hh-w",
            members: [{ id: "m1", displayName: "Tester" }],
            accounts: [baseAccount],
            liabilities: [],
          };
          const hhWith: Household = {
            id: "hh-e",
            members: [{ id: "m1", displayName: "Tester" }],
            accounts: [baseAccount, eduAccount],
            liabilities: [],
          };

          // (a) withdrawalSequence: the 529 must appear in its own
          // `education` row with the full $X — proving the bucket
          // exists and is tracked separately.
          const seqWith = withdrawalSequence(hhWith, spend);
          const eduRow = seqWith.rows.find((r) => r.bucket === "education");
          expect(eduRow).toBeDefined();
          expect(eduRow!.totalUSD).toBeCloseTo(edBalance, 2);

          // (b) Extract bucket totals exactly the way the UI does:
          // map the 4 retirement buckets and DROP education.
          function extractBuckets(seq: typeof seqWith): BucketBalances {
            const out: BucketBalances = {
              taxable: 0,
              pretax: 0,
              roth: 0,
              hsa: 0,
            };
            for (const row of seq.rows) {
              if (row.bucket === "taxable") out.taxable = row.totalUSD;
              else if (row.bucket === "pre_tax") out.pretax = row.totalUSD;
              else if (row.bucket === "roth") out.roth = row.totalUSD;
              else if (row.bucket === "hsa") out.hsa = row.totalUSD;
              // education explicitly NOT propagated
            }
            return out;
          }

          const bucketsWithout = extractBuckets(
            withdrawalSequence(hhWithout, spend),
          );
          const bucketsWith = extractBuckets(seqWith);

          // The 4-bucket totals must be IDENTICAL whether or not the
          // 529 exists. If a refactor accidentally collapsed
          // education into roth/taxable/etc, this check would fail.
          expect(bucketsWith.taxable).toBeCloseTo(bucketsWithout.taxable, 2);
          expect(bucketsWith.pretax).toBeCloseTo(bucketsWithout.pretax, 2);
          expect(bucketsWith.roth).toBeCloseTo(bucketsWithout.roth, 2);
          expect(bucketsWith.hsa).toBeCloseTo(bucketsWithout.hsa, 2);

          // (c) Sequencer outputs must also be identical → 529 is
          // structurally invisible to the drawdown engine.
          const cagrZero: BucketBalances = {
            taxable: 0,
            pretax: 0,
            roth: 0,
            hsa: 0,
          };
          const seqInputs = {
            annualRealSpendUSD: spend,
            realCAGRByBucket: cagrZero,
            startingAge: 60,
            retirementTaxRate: rate,
            years,
          };
          const runWithout = runWithdrawalSequence({
            ...seqInputs,
            startingBalances: bucketsWithout,
          });
          const runWith = runWithdrawalSequence({
            ...seqInputs,
            startingBalances: bucketsWith,
          });
          expect(runWith.totalTaxesPaidUSD).toBeCloseTo(
            runWithout.totalTaxesPaidUSD,
            2,
          );
          expect(runWith.totalNetSpendUSD).toBeCloseTo(
            runWithout.totalNetSpendUSD,
            2,
          );
          expect(runWith.endingTotalUSD).toBeCloseTo(
            runWithout.endingTotalUSD,
            2,
          );
        },
      ),
      { numRuns: 8 },
    );
  });
});

/* =============================================================
 * historicalReturns + demoSnapshots invariants — round-2 audit
 * property-test set. Pins consistency between cagr / totalReturn,
 * bounds on drawdown, demo-timeline shape.
 * =========================================================== */

describe("historicalReturns — algebraic invariants", () => {
  const lazyImports = async () => {
    const hr = await import("@/lib/portfolio/historicalReturns");
    const ds = await import("@/lib/demoSnapshots");
    return { ...hr, ...ds };
  };

  const MS_PER_YEAR_LOCAL = 365.25 * 24 * 60 * 60 * 1000;
  const t0 = 1_700_000_000_000;

  function twoPointSeries(
    vStart: number,
    vEnd: number,
    years: number,
  ): Array<{ t: number; valueUSD: number }> {
    return [
      { t: t0, valueUSD: vStart },
      { t: t0 + years * MS_PER_YEAR_LOCAL, valueUSD: vEnd },
    ];
  }

  it("cagr is monotone in V_end (V_start fixed)", async () => {
    const { cagr } = await lazyImports();
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true, noDefaultInfinity: true }),
        (vStart, vEndA, vEndB, years) => {
          const [lo, hi] = vEndA <= vEndB ? [vEndA, vEndB] : [vEndB, vEndA];
          const cLo = cagr(twoPointSeries(vStart, lo, years));
          const cHi = cagr(twoPointSeries(vStart, hi, years));
          expect(cLo).not.toBeNull();
          expect(cHi).not.toBeNull();
          expect(cHi!).toBeGreaterThanOrEqual(cLo! - 1e-12);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("cagr === 0 when V_end === V_start (no return)", async () => {
    const { cagr } = await lazyImports();
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true, noDefaultInfinity: true }),
        (v, years) => {
          const c = cagr(twoPointSeries(v, v, years));
          expect(c).not.toBeNull();
          expect(Math.abs(c!)).toBeLessThan(1e-12);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("cagr === -1 when V_end is exactly 0 (audit BLOCK fix for total loss)", async () => {
    const { cagr } = await lazyImports();
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true, noDefaultInfinity: true }),
        (vStart, years) => {
          const c = cagr(twoPointSeries(vStart, 0, years));
          expect(c).toBe(-1);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("1 + totalReturn === (1 + cagr)^years (algebraic consistency)", async () => {
    const { cagr, totalReturn } = await lazyImports();
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true, noDefaultInfinity: true }),
        (vStart, vEnd, years) => {
          const s = twoPointSeries(vStart, vEnd, years);
          const tr = totalReturn(s);
          const cg = cagr(s);
          expect(tr).not.toBeNull();
          expect(cg).not.toBeNull();
          const lhs = 1 + tr!;
          const rhs = Math.pow(1 + cg!, years);
          expect(Math.abs(lhs - rhs)).toBeLessThan(
            Math.max(1e-6, Math.abs(lhs) * 1e-8),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("maxDrawdown.lossPct ∈ [0, 1] for any non-negative series", async () => {
    const { maxDrawdown } = await lazyImports();
    const seriesArb = fc
      .array(
        fc.double({
          min: 0.01,
          max: 1e9,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        { minLength: 2, maxLength: 80 },
      )
      .map((vals) =>
        vals.map((v, i) => ({ t: i * (MS_PER_YEAR_LOCAL / 12), valueUSD: v })),
      );
    fc.assert(
      fc.property(seriesArb, (s) => {
        const dd = maxDrawdown(s);
        if (dd === null) return;
        expect(dd.lossPct).toBeGreaterThanOrEqual(0);
        expect(dd.lossPct).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("demoSnapshots: class series span the full window with monotone-ascending t", async () => {
    const { buildDemoSnapshots, buildAssetClassSeries } = await lazyImports();
    const now = Date.UTC(2026, 4, 15, 12);
    const snaps = buildDemoSnapshots(now, 60);
    const series = buildAssetClassSeries(snaps);
    for (const [, ser] of Object.entries(series)) {
      expect(ser!.length).toBe(60);
      for (let i = 1; i < ser!.length; i++) {
        expect(ser![i].t).toBeGreaterThan(ser![i - 1].t);
      }
      // Historical points (all but newest) at first-of-month
      // noon UTC. The newest = `now` itself per the audit fix.
      for (let i = 0; i < ser!.length - 1; i++) {
        const d = new Date(ser![i].t);
        expect(d.getUTCDate()).toBe(1);
        expect(d.getUTCHours()).toBe(12);
      }
    }
    expect(Object.keys(series).length).toBeGreaterThan(0);
  });
});
