import { describe, it, expect } from "vitest";

import {
  applyCashBucketOverride,
  type RawAllocation,
} from "./cashBucketAllocation";

const ALLOC_60_30_5_5: RawAllocation = {
  stocksFraction: 0.6,
  stocks2xFraction: 0,
  bondsFraction: 0.3,
  cashFraction: 0.05,
  commodityFraction: 0,
  realEstateFraction: 0,
  otherFraction: 0.05,
};

function sumAllocation(a: RawAllocation): number {
  return (
    a.stocksFraction +
    a.stocks2xFraction +
    a.bondsFraction +
    a.cashFraction +
    a.commodityFraction +
    a.realEstateFraction +
    a.otherFraction
  );
}

describe("applyCashBucketOverride", () => {
  it("returns the raw allocation unchanged when requested is null", () => {
    expect(applyCashBucketOverride(ALLOC_60_30_5_5, null)).toEqual(
      ALLOC_60_30_5_5,
    );
  });

  it("scales non-cash classes proportionally when requested > today (sum stays 1)", () => {
    // today=5%, requested=30%. nonCashScale = (1-0.30)/(1-0.05) = 0.7368...
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, 0.3);
    expect(result.cashFraction).toBeCloseTo(0.3, 10);
    // Every non-cash class shrinks by the same factor.
    expect(result.stocksFraction).toBeCloseTo(0.6 * (0.7 / 0.95), 10);
    expect(result.bondsFraction).toBeCloseTo(0.3 * (0.7 / 0.95), 10);
    expect(result.otherFraction).toBeCloseTo(0.05 * (0.7 / 0.95), 10);
    // Sum-to-1 invariant.
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
  });

  it("scales non-cash classes UP when requested < today (de-risking; sum stays 1)", () => {
    // today=5%, requested=1%. nonCashScale = (1-0.01)/(1-0.05) = 1.0421...
    // Non-cash classes GROW because cash shrinks → more dollars in equity.
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, 0.01);
    expect(result.cashFraction).toBeCloseTo(0.01, 10);
    expect(result.stocksFraction).toBeCloseTo(0.6 * (0.99 / 0.95), 10);
    expect(result.bondsFraction).toBeCloseTo(0.3 * (0.99 / 0.95), 10);
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
    // The non-cash classes are LARGER than before (de-risking
    // confirmed not silently floored at today's cash share).
    expect(result.stocksFraction).toBeGreaterThan(0.6);
  });

  it("requested == today is a no-op (scale = 1)", () => {
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, 0.05);
    expect(result).toEqual(ALLOC_60_30_5_5);
  });

  it("cash 100% allocation does not divide by zero (returns raw unchanged)", () => {
    const allCash: RawAllocation = {
      stocksFraction: 0,
      stocks2xFraction: 0,
      bondsFraction: 0,
      cashFraction: 1,
      commodityFraction: 0,
      realEstateFraction: 0,
      otherFraction: 0,
    };
    // Even when the user requests less cash, we can't redistribute
    // from non-cash classes that don't exist. Caller should surface
    // this to the user (e.g. as a warning) — here we just no-op
    // rather than produce NaN.
    const result = applyCashBucketOverride(allCash, 0.3);
    expect(result).toEqual(allCash);
  });

  it("cash 0% allocation handles the requested-cash-up case correctly", () => {
    // today=0%, requested=20%. nonCashScale = (1-0.2)/(1-0) = 0.8.
    // Every non-cash class shrinks by 0.8 to make room for cash.
    const noCash: RawAllocation = {
      stocksFraction: 0.7,
      stocks2xFraction: 0,
      bondsFraction: 0.2,
      cashFraction: 0,
      commodityFraction: 0,
      realEstateFraction: 0.1,
      otherFraction: 0,
    };
    const result = applyCashBucketOverride(noCash, 0.2);
    expect(result.cashFraction).toBeCloseTo(0.2, 10);
    expect(result.stocksFraction).toBeCloseTo(0.56, 10);
    expect(result.bondsFraction).toBeCloseTo(0.16, 10);
    expect(result.realEstateFraction).toBeCloseTo(0.08, 10);
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
  });

  it("clamps requested below 0", () => {
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, -0.5);
    expect(result.cashFraction).toBe(0);
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
  });

  it("clamps requested above 1", () => {
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, 2.0);
    expect(result.cashFraction).toBe(1);
    // Every non-cash class collapses to 0 (nonCashScale = 0/0.95 = 0).
    expect(result.stocksFraction).toBe(0);
    expect(result.bondsFraction).toBe(0);
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
  });

  it("NaN-safety: NaN requested cash fraction degrades to no-op (engine contract)", () => {
    const result = applyCashBucketOverride(ALLOC_60_30_5_5, Number.NaN);
    expect(result).toEqual(ALLOC_60_30_5_5);
  });

  it("NaN-safety: NaN raw cashFraction degrades to no-op (engine contract)", () => {
    const corrupted: RawAllocation = {
      ...ALLOC_60_30_5_5,
      cashFraction: Number.NaN,
    };
    const result = applyCashBucketOverride(corrupted, 0.3);
    expect(result).toEqual(corrupted);
  });

  it("NaN-safety: Infinity requested degrades to no-op", () => {
    expect(
      applyCashBucketOverride(ALLOC_60_30_5_5, Number.POSITIVE_INFINITY),
    ).toEqual(ALLOC_60_30_5_5);
    expect(
      applyCashBucketOverride(ALLOC_60_30_5_5, Number.NEGATIVE_INFINITY),
    ).toEqual(ALLOC_60_30_5_5);
  });

  it("regression: proportional steal preserves sum-to-1 with a TQQQ-heavy portfolio (the v0 bug)", () => {
    // Earlier v0 only shrank `stocksFraction` (regular 1x). With a
    // portfolio mostly in 2x equity + RE, the 1x slice was tiny —
    // requesting 30% cash from a 5% cash baseline silently produced
    // a sum > 1, then `resolveWeights` normalized it away, giving
    // the user a smaller actual cash slice than the UI claimed.
    const tqqqHeavy: RawAllocation = {
      stocksFraction: 0.05,
      stocks2xFraction: 0.6,
      bondsFraction: 0,
      cashFraction: 0.05,
      commodityFraction: 0,
      realEstateFraction: 0.3,
      otherFraction: 0,
    };
    const result = applyCashBucketOverride(tqqqHeavy, 0.3);
    expect(result.cashFraction).toBeCloseTo(0.3, 10);
    // ALL non-cash classes shrink, not just the 1x slice.
    const scale = 0.7 / 0.95;
    expect(result.stocksFraction).toBeCloseTo(0.05 * scale, 10);
    expect(result.stocks2xFraction).toBeCloseTo(0.6 * scale, 10);
    expect(result.realEstateFraction).toBeCloseTo(0.3 * scale, 10);
    expect(sumAllocation(result)).toBeCloseTo(1, 10);
  });
});
