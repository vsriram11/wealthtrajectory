import { describe, expect, it } from "vitest";
import {
  filterIncomeStreamsForRollups,
  incomeForYear,
  incomePerYearUSD,
  lifetimeTotalReal,
  totalIncomeForYear,
  type IncomeStream,
} from "@/lib/budget/incomeStreams";

/**
 * Helper builder so each test reads as "a stream with X, Y, Z"
 * instead of being half-buried in id + ownerId boilerplate.
 */
function s(p: Partial<IncomeStream> = {}): IncomeStream {
  return {
    id: p.id ?? "inc-test",
    label: p.label ?? "Test stream",
    startYear: p.startYear ?? 2030,
    endYear: p.endYear ?? 2035,
    annualUSD: p.annualUSD ?? 50_000,
    realGrowthRate: p.realGrowthRate ?? 0,
    ownerId: p.ownerId ?? "m1",
  };
}

describe("incomeForYear — per-year math for a single stream", () => {
  // Locked-in semantic: streams pay [startYear, endYear]
  // INCLUSIVE on both ends. The boundary handling matters —
  // off-by-one would mean a "5 years of consulting" plan
  // actually pays for 4 or 6 years.
  it("pays in startYear and endYear (inclusive on both)", () => {
    const stream = s({ startYear: 2030, endYear: 2032, annualUSD: 50_000 });
    expect(incomeForYear(stream, 2029)).toBe(0);
    expect(incomeForYear(stream, 2030)).toBe(50_000);
    expect(incomeForYear(stream, 2031)).toBe(50_000);
    expect(incomeForYear(stream, 2032)).toBe(50_000);
    expect(incomeForYear(stream, 2033)).toBe(0);
  });

  it("one-year stream (startYear === endYear) pays exactly once", () => {
    const stream = s({ startYear: 2030, endYear: 2030, annualUSD: 25_000 });
    expect(incomeForYear(stream, 2029)).toBe(0);
    expect(incomeForYear(stream, 2030)).toBe(25_000);
    expect(incomeForYear(stream, 2031)).toBe(0);
  });

  it("real growth compounds from startYear (not from year 0 / 'now')", () => {
    // 2% real growth, $100k starting in 2030. By 2032 (k=2),
    // pays $100k × 1.02² = $104,040.
    const stream = s({
      startYear: 2030,
      endYear: 2040,
      annualUSD: 100_000,
      realGrowthRate: 0.02,
    });
    expect(incomeForYear(stream, 2030)).toBeCloseTo(100_000, 4);
    expect(incomeForYear(stream, 2031)).toBeCloseTo(102_000, 4);
    expect(incomeForYear(stream, 2032)).toBeCloseTo(104_040, 4);
    expect(incomeForYear(stream, 2035)).toBeCloseTo(100_000 * 1.02 ** 5, 4);
  });

  it("negative real growth shrinks the stream (un-COLA'd pension model)", () => {
    // Legacy pension: $30k starting in 2035, -2% real growth
    // because not COLA-adjusted. By 2045 (k=10), pays:
    //   30_000 × 0.98^10 ≈ $24,539.
    const stream = s({
      startYear: 2035,
      endYear: 2050,
      annualUSD: 30_000,
      realGrowthRate: -0.02,
    });
    expect(incomeForYear(stream, 2045)).toBeCloseTo(
      30_000 * 0.98 ** 10,
      2,
    );
  });

  describe("NaN / pathological-input safety", () => {
    // The engine boundary must never propagate NaN or Infinity
    // downstream — they'd poison every cash-flow accumulator that
    // sums incomeForYear into a running total.
    it("returns 0 when annualUSD is non-finite", () => {
      expect(incomeForYear(s({ annualUSD: NaN }), 2030)).toBe(0);
      expect(incomeForYear(s({ annualUSD: Infinity }), 2030)).toBe(0);
    });

    it("preserves NEGATIVE annualUSD (distribution semantics)", () => {
      // Issue #6: signed annualUSD lets one type model both
      // POSITIVE income inflows AND NEGATIVE distributions
      // (partial-coast / sabbatical pattern) without a separate
      // primitive. The boundary still strips NaN / Infinity, but
      // a finite negative number now flows through verbatim.
      expect(incomeForYear(s({ annualUSD: -1_000 }), 2030)).toBe(-1_000);
      expect(incomeForYear(s({ annualUSD: -20_000 }), 2032)).toBe(-20_000);
    });

    it("returns 0 when start/end year is non-finite", () => {
      expect(incomeForYear(s({ startYear: NaN }), 2030)).toBe(0);
      expect(incomeForYear(s({ endYear: NaN }), 2030)).toBe(0);
    });

    it("returns 0 when growth rate would make the base non-positive", () => {
      // realGrowthRate <= -1 means each year's amount is <= 0
      // (a sign-flipped pension that goes negative is meaningless
      // — guard against it).
      expect(incomeForYear(s({ realGrowthRate: -1 }), 2032)).toBe(0);
      expect(incomeForYear(s({ realGrowthRate: -2 }), 2032)).toBe(0);
    });

    it("treats non-finite growth rate as 0 (graceful degradation)", () => {
      const stream = s({
        annualUSD: 100_000,
        startYear: 2030,
        endYear: 2032,
        realGrowthRate: NaN,
      });
      // Should pay $100k flat (treating NaN growth as 0).
      expect(incomeForYear(stream, 2030)).toBe(100_000);
      expect(incomeForYear(stream, 2031)).toBe(100_000);
      expect(incomeForYear(stream, 2032)).toBe(100_000);
    });
  });
});

describe("totalIncomeForYear — sums across streams", () => {
  // Real households have multiple streams active concurrently.
  // The sum is the simulator's per-year income offset.
  it("sums concurrent streams, ignores non-active ones", () => {
    const streams = [
      // Active in 2032
      s({ id: "1", startYear: 2030, endYear: 2035, annualUSD: 50_000 }),
      // Active in 2032
      s({ id: "2", startYear: 2032, endYear: 2032, annualUSD: 10_000 }),
      // NOT active in 2032 (ends in 2031)
      s({ id: "3", startYear: 2030, endYear: 2031, annualUSD: 99_000 }),
      // NOT active in 2032 (starts in 2033)
      s({ id: "4", startYear: 2033, endYear: 2040, annualUSD: 20_000 }),
    ];
    expect(totalIncomeForYear(streams, 2032)).toBe(60_000);
  });

  it("empty streams array returns 0", () => {
    expect(totalIncomeForYear([], 2030)).toBe(0);
  });
});

describe("incomePerYearUSD — pre-computed per-year array", () => {
  it("produces the per-year sum for [baseYear, baseYear + numYears)", () => {
    // 3 streams:
    //  - $50k in 2030-2032
    //  - $20k in 2031-2033 (overlaps)
    //  - $100k only in 2032 (one-year)
    const streams = [
      s({ id: "1", startYear: 2030, endYear: 2032, annualUSD: 50_000 }),
      s({ id: "2", startYear: 2031, endYear: 2033, annualUSD: 20_000 }),
      s({ id: "3", startYear: 2032, endYear: 2032, annualUSD: 100_000 }),
    ];
    // baseYear 2029, 6 years → 2029..2034
    expect(incomePerYearUSD(streams, 2029, 6)).toEqual([
      0,            // 2029
      50_000,       // 2030 (only stream 1)
      70_000,       // 2031 (1 + 2)
      170_000,      // 2032 (1 + 2 + 3)
      20_000,       // 2033 (only 2)
      0,            // 2034
    ]);
  });

  it("returns empty array for numYears <= 0 (defensive)", () => {
    const streams = [s()];
    expect(incomePerYearUSD(streams, 2030, 0)).toEqual([]);
    expect(incomePerYearUSD(streams, 2030, -3)).toEqual([]);
    expect(incomePerYearUSD(streams, 2030, NaN)).toEqual([]);
  });
});

describe("lifetimeTotalReal — sum over a stream's life", () => {
  it("flat stream (no growth) = annualUSD × duration", () => {
    const stream = s({
      startYear: 2030,
      endYear: 2034, // 5 years
      annualUSD: 40_000,
      realGrowthRate: 0,
    });
    expect(lifetimeTotalReal(stream)).toBe(200_000);
  });

  it("growing stream sums the geometric series", () => {
    // 3 years, $100k base, 10% real growth.
    // Sum: 100k + 110k + 121k = 331k.
    const stream = s({
      startYear: 2030,
      endYear: 2032,
      annualUSD: 100_000,
      realGrowthRate: 0.10,
    });
    expect(lifetimeTotalReal(stream)).toBeCloseTo(331_000, 2);
  });

  it("returns 0 when endYear < startYear (defensive)", () => {
    const stream = s({ startYear: 2032, endYear: 2030 });
    expect(lifetimeTotalReal(stream)).toBe(0);
  });
});

describe("filterIncomeStreamsForRollups — per-member + rollup-flag composition", () => {
  const streams = [
    s({ id: "a", ownerId: "m1" }),
    s({ id: "b", ownerId: "m2" }),
    s({ id: "c", ownerId: "m3" }),
  ];

  it("explicit memberId pick wins regardless of rollup-active set", () => {
    // m2 is NOT in the active set, but the user explicitly
    // picked m2 — show their streams. Mirrors the
    // householdForRollups vs filterHousehold semantic boundary.
    const active = new Set(["m1", "m3"]);
    const result = filterIncomeStreamsForRollups(streams, "m2", active);
    expect(result.map((s) => s.id)).toEqual(["b"]);
  });

  it("no member picked → returns streams owned by active members only", () => {
    const active = new Set(["m1", "m3"]);
    const result = filterIncomeStreamsForRollups(streams, null, active);
    expect(result.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("empty active set returns no streams (defensive — shouldn't be reachable via UI)", () => {
    // The setMemberIncludeInRollup action enforces ≥1 active
    // member, so this state can't be reached through normal UI
    // flow. Imported/synced data could theoretically arrive in
    // this shape — degrade gracefully.
    expect(filterIncomeStreamsForRollups(streams, null, new Set())).toEqual([]);
  });
});
