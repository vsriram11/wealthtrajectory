import { describe, expect, it } from "vitest";
import {
  aggregateAssumptions,
  effectiveHouseholdAssumptions,
  resolveAssumptionsForMember,
} from "@/lib/projection/useActiveProjection";
import type { Assumptions } from "@/lib/types";

const baseHousehold: Assumptions = {
  targetNetWorthUSD: 1_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
  retirementVariableHaircut: 0,
  retirementTaxRate: 0.2,
};

describe("aggregateAssumptions", () => {
  it("returns household unchanged when no members provided", () => {
    expect(aggregateAssumptions(baseHousehold, {}, [])).toEqual(baseHousehold);
  });

  it("sums targetNetWorthUSD across member overrides", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { targetNetWorthUSD: 2_000_000 },
        m2: { targetNetWorthUSD: 500_000 },
      },
      ["m1", "m2"],
    );
    expect(result.targetNetWorthUSD).toBe(2_500_000);
  });

  it("members without an override inherit household default in the sum", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { targetNetWorthUSD: 3_000_000 },
        // m2 inherits household = 1_000_000
      },
      ["m1", "m2"],
    );
    expect(result.targetNetWorthUSD).toBe(4_000_000);
  });

  it("sums legacyFloorUSD", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { legacyFloorUSD: 500_000 },
        m2: { legacyFloorUSD: 1_500_000 },
      },
      ["m1", "m2"],
    );
    expect(result.legacyFloorUSD).toBe(2_000_000);
  });

  it("withdrawalRate is weighted by targetNetWorthUSD", () => {
    // m1: target $4M @ 3.5%, m2: target $1M @ 5%
    // Weighted: (3.5% * 4 + 5% * 1) / 5 = 19/5 = 3.8%
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { targetNetWorthUSD: 4_000_000, withdrawalRate: 0.035 },
        m2: { targetNetWorthUSD: 1_000_000, withdrawalRate: 0.05 },
      },
      ["m1", "m2"],
    );
    expect(result.withdrawalRate).toBeCloseTo(0.038, 5);
  });

  it("withdrawalRate falls back to simple mean when total target = 0", () => {
    const empty: Assumptions = { ...baseHousehold, targetNetWorthUSD: 0 };
    // Both members inherit target=0 → fall back to simple mean of withdrawal rates
    const result = aggregateAssumptions(
      empty,
      {
        m1: { withdrawalRate: 0.03 },
        m2: { withdrawalRate: 0.05 },
      },
      ["m1", "m2"],
    );
    expect(result.withdrawalRate).toBeCloseTo(0.04, 5);
  });

  it("expectedInflationRate is simple mean", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { expectedInflationRate: 0.02 },
        m2: { expectedInflationRate: 0.04 },
      },
      ["m1", "m2"],
    );
    expect(result.expectedInflationRate).toBeCloseTo(0.03, 5);
  });

  it("retirementVariableHaircut is simple mean", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { retirementVariableHaircut: 0.0 },
        m2: { retirementVariableHaircut: 0.5 },
      },
      ["m1", "m2"],
    );
    expect(result.retirementVariableHaircut).toBeCloseTo(0.25, 5);
  });

  describe("retirementVariableHaircutOnDownYearOnly — opt-in-wins aggregation", () => {
    // The conservative-survival mode is opt-in: if any member
    // wants down-year-only behavior, the household plan respects
    // it. Mirrors how Scenarios composes opt-in flags. Avoids
    // the 1-vs-1 majority-vote ambiguity.
    it("any single member opt-in flips the household to true", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementVariableHaircutOnDownYearOnly: true },
        },
        ["m1", "m2"],
      );
      expect(result.retirementVariableHaircutOnDownYearOnly).toBe(true);
    });

    it("all members false / unset → false", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementVariableHaircutOnDownYearOnly: false },
        },
        ["m1", "m2"],
      );
      expect(result.retirementVariableHaircutOnDownYearOnly).toBe(false);
    });
  });

  describe("retirementVariableShare — mean of set values, undefined when none", () => {
    it("means across members that have it set", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementVariableShare: 0.30 },
          m2: { retirementVariableShare: 0.50 },
        },
        ["m1", "m2"],
      );
      expect(result.retirementVariableShare).toBeCloseTo(0.40, 5);
    });

    it("ignores members without an override (don't pull mean toward 0)", () => {
      // The unset member contributes NOTHING — the mean is over
      // members that explicitly opted in. Falling back to 0 here
      // would silently drag the household share down whenever
      // one member set it and another didn't.
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementVariableShare: 0.50 },
        },
        ["m1", "m2"],
      );
      expect(result.retirementVariableShare).toBe(0.50);
    });

    it("returns undefined when no member has it set (resolved to budget/default downstream)", () => {
      const result = aggregateAssumptions(baseHousehold, {}, ["m1", "m2"]);
      // Critical: NOT 0. The consumer (effectiveVariableShare)
      // treats undefined as "no opinion → derive from budget /
      // default 35%". Coercing to 0 here would silently lock the
      // household at 0% variable share.
      expect(result.retirementVariableShare).toBeUndefined();
    });
  });

  it("retirementTaxRate is simple mean (defaults to 0.20 when unset)", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { retirementTaxRate: 0.1 },
        m2: { retirementTaxRate: 0.3 },
      },
      ["m1", "m2"],
    );
    expect(result.retirementTaxRate).toBeCloseTo(0.2, 5);
  });

  it("drawdownHorizonYears is rounded mean", () => {
    const result = aggregateAssumptions(
      baseHousehold,
      {
        m1: { drawdownHorizonYears: 25 },
        m2: { drawdownHorizonYears: 30 },
      },
      ["m1", "m2"],
    );
    expect(result.drawdownHorizonYears).toBe(28); // round(27.5)
  });

  it("preserves drawdownPhases on household (not aggregated)", () => {
    const householdWithPhases: Assumptions = {
      ...baseHousehold,
      drawdownPhases: [{ startMonthsAfterIndependence: 120, withdrawalRate: 0.03 }],
    };
    const result = aggregateAssumptions(
      householdWithPhases,
      { m1: {} },
      ["m1"],
    );
    expect(result.drawdownPhases).toEqual(householdWithPhases.drawdownPhases);
  });

  describe("retirementFixedNominalYears — max aggregation (opt-in wins, opt-out preserved)", () => {
    // The SORR-mitigation freeze aggregates by MAX: if ANY member
    // opted into a freeze, the household-aggregate view shows
    // that protection. The filter accepts EXPLICIT 0 so that
    // unanimous opt-out (every member set 0) returns 0 instead
    // of silently falling back to the household template's
    // freeze setting. Regression risk: an earlier filter
    // `v > 0` (instead of `v >= 0`) dropped explicit zeros and
    // restored the household default for an opted-out member —
    // pin THAT behavior so a refactor can't undo the fix.

    it("any single member opt-in wins via MAX (5y trumps unset)", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        { m1: { retirementFixedNominalYears: 5 } },
        ["m1", "m2"],
      );
      expect(result.retirementFixedNominalYears).toBe(5);
    });

    it("mixed values pick the MAX (5 vs 10 → 10)", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementFixedNominalYears: 5 },
          m2: { retirementFixedNominalYears: 10 },
        },
        ["m1", "m2"],
      );
      expect(result.retirementFixedNominalYears).toBe(10);
    });

    it("mixed opt-in + opt-out → opt-in wins (5 vs 0 → 5)", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        {
          m1: { retirementFixedNominalYears: 5 },
          m2: { retirementFixedNominalYears: 0 },
        },
        ["m1", "m2"],
      );
      expect(result.retirementFixedNominalYears).toBe(5);
    });

    it("unanimous opt-out (every member = 0) aggregates to 0 (NOT the household default)", () => {
      // The regression fix: previously, `> 0` filter dropped
      // explicit 0s, leaving the aggregate to fall back to the
      // household's `retirementFixedNominalYears` value. Now
      // `>= 0` preserves the unanimous opt-out.
      const householdWithFreeze: Assumptions = {
        ...baseHousehold,
        retirementFixedNominalYears: 10, // template setting
      };
      const result = aggregateAssumptions(
        householdWithFreeze,
        {
          m1: { retirementFixedNominalYears: 0 },
          m2: { retirementFixedNominalYears: 0 },
        },
        ["m1", "m2"],
      );
      expect(result.retirementFixedNominalYears).toBe(0);
    });

    it("no member set anything → undefined (template falls through downstream)", () => {
      const result = aggregateAssumptions(
        baseHousehold,
        { m1: {}, m2: {} },
        ["m1", "m2"],
      );
      expect(result.retirementFixedNominalYears).toBeUndefined();
    });
  });
});

describe("effectiveHouseholdAssumptions", () => {
  const members = [{ id: "m1" }, { id: "m2" }];

  it("returns household unchanged when no member has any override", () => {
    expect(
      effectiveHouseholdAssumptions(baseHousehold, {}, members),
    ).toEqual(baseHousehold);
  });

  it("returns household unchanged when memberAssumptions has empty entries (no fields)", () => {
    // An empty override object shouldn't count as "this member has
    // a plan" — they still inherit the household defaults.
    expect(
      effectiveHouseholdAssumptions(
        baseHousehold,
        { m1: {} },
        members,
      ),
    ).toEqual(baseHousehold);
  });

  it("aggregates over only the member(s) with explicit overrides", () => {
    // m1 has $5M target, m2 inherits ($1M from baseHousehold)
    // Aggregate counts ONLY m1 → $5M (not $5M + $1M = $6M)
    const r = effectiveHouseholdAssumptions(
      baseHousehold,
      { m1: { targetNetWorthUSD: 5_000_000 } },
      members,
    );
    expect(r.targetNetWorthUSD).toBe(5_000_000);
  });

  it("aggregates over all members when all have explicit overrides", () => {
    const r = effectiveHouseholdAssumptions(
      baseHousehold,
      {
        m1: { targetNetWorthUSD: 5_000_000 },
        m2: { targetNetWorthUSD: 3_000_000 },
      },
      members,
    );
    expect(r.targetNetWorthUSD).toBe(8_000_000);
  });

  it("single-member case: aggregate of 1 = that 1 (matches user-reported scenario)", () => {
    // User had a single member with $20M override; household view
    // should show $20M, not the $28.3M legacy household default.
    const r = effectiveHouseholdAssumptions(
      baseHousehold,
      { only: { targetNetWorthUSD: 20_000_000 } },
      [{ id: "only" }],
    );
    expect(r.targetNetWorthUSD).toBe(20_000_000);
  });

  it("skips overrides for member IDs that no longer exist in the household", () => {
    // Stale memberAssumptions entry (member was deleted but override
    // wasn't cleaned up) shouldn't count toward the aggregate.
    const r = effectiveHouseholdAssumptions(
      baseHousehold,
      { stale_id_no_longer_in_household: { targetNetWorthUSD: 99_000_000 } },
      members,
    );
    expect(r).toEqual(baseHousehold);
  });
});

describe("resolveAssumptionsForMember (existing — sanity)", () => {
  it("falls back to household when no override exists", () => {
    expect(
      resolveAssumptionsForMember(baseHousehold, {}, "m1"),
    ).toEqual(baseHousehold);
  });
  it("merges override fields onto household defaults", () => {
    const r = resolveAssumptionsForMember(
      baseHousehold,
      { m1: { targetNetWorthUSD: 5_000_000 } },
      "m1",
    );
    expect(r.targetNetWorthUSD).toBe(5_000_000);
    // Other fields inherit
    expect(r.withdrawalRate).toBe(baseHousehold.withdrawalRate);
  });
});
