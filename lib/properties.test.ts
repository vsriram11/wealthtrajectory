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
  type Household,
} from "@/lib/types";

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
