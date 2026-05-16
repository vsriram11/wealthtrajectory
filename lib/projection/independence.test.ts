import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { projectIndependence } from "@/lib/projection/independence";

describe("projectIndependence (demo household)", () => {
  // Demo assumptions now include phased withdrawal (10y/3.5%,
  // 20y/3.0%) to model the realistic go-go/slow-go/no-go
  // pattern. The tests in THIS block pin the single-rate
  // behavior (4% throughout) so they can't drift if the demo
  // phase config changes — override drawdownPhases to [] so the
  // projection holds the headline rate flat for the full
  // horizon.
  const SINGLE_RATE = { ...DEMO_ASSUMPTIONS, drawdownPhases: [] };
  const r = projectIndependence(DEMO_HOUSEHOLD, SINGLE_RATE);

  it("hits Independence within 30 years", () => {
    expect(r.monthsToIndependence).not.toBeNull();
    expect(r.monthsToIndependence!).toBeLessThan(30 * 12);
  });

  it("series starts at current net worth and includes drawdown phase", () => {
    // Phase convention: `independenceSeriesIndex` marks the LAST
    // accumulation month — the moment Independence is reached.
    // Drawdown starts the very next month (idx + 1). The chart
    // legend, the legacy-at-horizon math, and the withdrawal
    // calculation all rely on this transition; a regression that
    // moved the boundary by one index would silently shift the
    // headline "years to Independence" number.
    expect(r.series[0].phase).toBe("accumulation");
    expect(r.independenceSeriesIndex).not.toBeNull();
    const idx = r.independenceSeriesIndex!;
    expect(r.series[idx].phase).toBe("accumulation");
    expect(r.series[idx + 1].phase).toBe("drawdown");
    // No interleaving: once drawdown starts, all subsequent points
    // must stay drawdown.
    for (let i = idx + 1; i < r.series.length; i++) {
      expect(r.series[i].phase).toBe("drawdown");
    }
  });

  it("legacy at horizon is computed when Independence reached", () => {
    expect(r.legacyAtHorizonUSD).not.toBeNull();
    // Legacy is the final-year ending net worth in the drawdown
    // tail. It must agree (within float slack) with the last
    // series point — otherwise the headline metric on the
    // Independence card would diverge from the chart.
    const last = r.series[r.series.length - 1].netWorthUSD;
    expect(r.legacyAtHorizonUSD!).toBeCloseTo(last, 2);
  });

  it("monthly withdrawal is 4% of Independence-day net worth / 12", () => {
    const independenceNW = r.series[r.independenceSeriesIndex!].netWorthUSD;
    expect(r.monthlyWithdrawalUSD).toBeCloseTo(
      (independenceNW * SINGLE_RATE.withdrawalRate) / 12,
      2,
    );
  });

  it("sustained: portfolio stays above zero legacy floor", () => {
    expect(r.sustained).toBe(true);
  });
});

describe("projectIndependence contribution tracking", () => {
  const r = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);

  it("starting principal is recorded on every point", () => {
    const p0 = r.series[0].startingPrincipalUSD;
    expect(p0).toBeGreaterThan(0);
    for (const point of r.series) {
      expect(point.startingPrincipalUSD).toBe(p0);
    }
  });

  it("cumulative contributions monotonically rise during accumulation", () => {
    let last = 0;
    for (const p of r.series) {
      if (p.phase !== "accumulation") break;
      expect(p.cumulativeContributionsUSD).toBeGreaterThanOrEqual(last);
      last = p.cumulativeContributionsUSD;
    }
    expect(last).toBeGreaterThan(0);
  });

  it("growth + contributions + principal ≈ Independence-day net worth", () => {
    // Demo household MUST reach Independence — that's a fixture
    // invariant the rest of the suite relies on. A silent early
    // return here would mask a regression that broke the demo's
    // reachability.
    if (r.independenceSeriesIndex == null) {
      throw new Error(
        "expected demo household to reach Independence (independenceSeriesIndex was null)",
      );
    }
    const fire = r.series[r.independenceSeriesIndex];
    const principal = fire.startingPrincipalUSD;
    const contrib = fire.cumulativeContributionsUSD;
    const growth = fire.netWorthUSD - principal - contrib;
    // The decomposition NW = principal + contributions + growth
    // is the contract the Independence card displays as "your
    // money came from" pie. If a refactor breaks this identity,
    // the pie slices sum to ≠ NW and the chart goes off.
    expect(growth).toBeGreaterThan(-1);
    expect(principal + contrib + growth).toBeCloseTo(fire.netWorthUSD, 2);
  });
});

describe("projectIndependence stress: lost-decade", () => {
  const base = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
  const stress = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, undefined, {
    stress: "lost-decade",
  });

  it("Independence date is identical (accumulation unaffected)", () => {
    expect(stress.monthsToIndependence).toBe(base.monthsToIndependence);
  });

  it("legacy at horizon is materially lower in the stress case", () => {
    if (base.legacyAtHorizonUSD == null || stress.legacyAtHorizonUSD == null) {
      throw new Error("expected both projections to reach Independence");
    }
    expect(stress.legacyAtHorizonUSD).toBeLessThan(base.legacyAtHorizonUSD);
  });

  it("base and stress series have the same length", () => {
    expect(stress.series.length).toBe(base.series.length);
  });
});

describe("projectIndependence (already at target)", () => {
  it("starts in drawdown phase if current NW >= target", () => {
    const r = projectIndependence(
      { ...DEMO_HOUSEHOLD, liabilities: [] },
      { ...DEMO_ASSUMPTIONS, targetNetWorthUSD: 0 },
    );
    expect(r.monthsToIndependence).toBe(0);
    expect(r.series[0].phase).toBe("drawdown");
  });
});

describe("projectIndependence multi-phase drawdown", () => {
  // Build a single-rate baseline assumption that doesn't carry
  // the demo's default phases — the tests in this block pin the
  // ABSENCE of phases as a no-op vs an empty array, so we can't
  // start from a phased baseline.
  const noPhases = { ...DEMO_ASSUMPTIONS, drawdownPhases: undefined };

  it("ignores empty / undefined drawdownPhases (no behavior change)", () => {
    const base = projectIndependence(DEMO_HOUSEHOLD, noPhases);
    const withEmpty = projectIndependence(DEMO_HOUSEHOLD, {
      ...noPhases,
      drawdownPhases: [],
    });
    expect(withEmpty.monthsToIndependence).toBe(base.monthsToIndependence);
    expect(withEmpty.legacyAtHorizonUSD).toBe(base.legacyAtHorizonUSD);
  });

  it("a lower-rate later phase leaves a larger legacy", () => {
    const base = projectIndependence(DEMO_HOUSEHOLD, noPhases);
    const phased = projectIndependence(DEMO_HOUSEHOLD, {
      ...noPhases,
      drawdownPhases: [{ startMonthsAfterIndependence: 60, withdrawalRate: 0.02 }],
    });
    if (base.legacyAtHorizonUSD == null || phased.legacyAtHorizonUSD == null) {
      throw new Error("expected both projections to reach Independence");
    }
    expect(phased.legacyAtHorizonUSD).toBeGreaterThan(base.legacyAtHorizonUSD);
  });

  it("a higher-rate later phase leaves a smaller legacy (or depletes)", () => {
    const base = projectIndependence(DEMO_HOUSEHOLD, noPhases);
    const phased = projectIndependence(DEMO_HOUSEHOLD, {
      ...noPhases,
      drawdownPhases: [{ startMonthsAfterIndependence: 36, withdrawalRate: 0.1 }],
    });
    if (base.legacyAtHorizonUSD == null) {
      throw new Error("expected base projection to reach Independence");
    }
    if (phased.legacyAtHorizonUSD != null) {
      expect(phased.legacyAtHorizonUSD).toBeLessThan(base.legacyAtHorizonUSD);
    } else {
      expect(phased.ruinMonthIndex).not.toBeNull();
    }
  });

  it("Independence date itself is unchanged by post-Independence phases", () => {
    const base = projectIndependence(DEMO_HOUSEHOLD, noPhases);
    const phased = projectIndependence(DEMO_HOUSEHOLD, {
      ...noPhases,
      drawdownPhases: [{ startMonthsAfterIndependence: 120, withdrawalRate: 0.03 }],
    });
    expect(phased.monthsToIndependence).toBe(base.monthsToIndependence);
  });
});

describe("projectIndependence — incomePerYearUSD (future-income streams)", () => {
  // Locked-in semantic: income streams flow into BOTH phases.
  // During accumulation: pulls Independence Day sooner. During
  // drawdown: offsets withdrawal so corpus lasts longer.
  it("income during accumulation pulls Independence sooner", () => {
    // Same household, same target. With +$20k/yr income for the
    // first 10 years, the user reaches target faster.
    const memberId = DEMO_HOUSEHOLD.members[0].id;
    const household: import("@/lib/types").Household = {
      id: "h",
      members: DEMO_HOUSEHOLD.members,
      accounts: [
        {
          id: "a",
          displayName: "A",
          category: "BROKERAGE",
          ownerId: memberId,
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 500_000,
              // 6% real CAGR so the projection converges in a
              // reasonable number of years (purely for test
              // run-time).
              expectedRealCAGR: 0.06,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
          monthlyContributionUSD: 2_000,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_500_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const base = projectIndependence(household, assumptions);
    const withIncome = projectIndependence(household, assumptions, undefined, {
      // $20k/yr for the first 10 years — a meaningful side gig.
      incomePerYearUSD: [
        20_000, 20_000, 20_000, 20_000, 20_000,
        20_000, 20_000, 20_000, 20_000, 20_000,
      ],
    });
    expect(base.monthsToIndependence).not.toBeNull();
    expect(withIncome.monthsToIndependence).not.toBeNull();
    expect(withIncome.monthsToIndependence!).toBeLessThan(
      base.monthsToIndependence!,
    );
  });

  it("income during drawdown reduces ruin risk (more of corpus survives)", () => {
    // Already-at-target household stresses through a lost decade.
    // With supplemental income, less of the corpus erodes during
    // the bad years → end-of-horizon NW is higher.
    const memberId = DEMO_HOUSEHOLD.members[0].id;
    const household: import("@/lib/types").Household = {
      id: "h",
      members: DEMO_HOUSEHOLD.members,
      accounts: [
        {
          id: "a",
          displayName: "A",
          category: "BROKERAGE",
          ownerId: memberId,
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 1_500_000,
              expectedRealCAGR: 0.04,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_500_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const baseStress = projectIndependence(
      household,
      assumptions,
      undefined,
      { stress: "lost-decade" },
    );
    const withIncomeStress = projectIndependence(
      household,
      assumptions,
      undefined,
      {
        stress: "lost-decade",
        incomePerYearUSD: Array(30).fill(24_000), // SS-style $24k/yr
      },
    );
    const baseEnding = baseStress.series[baseStress.series.length - 1].netWorthUSD;
    const incomeEnding =
      withIncomeStress.series[withIncomeStress.series.length - 1].netWorthUSD;
    expect(incomeEnding).toBeGreaterThan(baseEnding);
  });

  it("no incomePerYearUSD = baseline behavior preserved (back-compat)", () => {
    // Critical: the 1090+ tests written before this feature must
    // not see any behavior change when they call
    // projectIndependence without the new option.
    const a = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const b = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, undefined, {});
    expect(a.monthsToIndependence).toBe(b.monthsToIndependence);
    expect(a.series.length).toBe(b.series.length);
    expect(a.series[a.series.length - 1].netWorthUSD).toBeCloseTo(
      b.series[b.series.length - 1].netWorthUSD,
      2,
    );
  });

  it("array shorter than projection horizon: missing years read as 0 (defensive)", () => {
    // The projection iterates up to ~70 years; we only supply
    // income for the first 5 (a typical consulting gig). Years
    // 6+ must read as 0 (no income) — not NaN, not throw.
    const memberId = DEMO_HOUSEHOLD.members[0].id;
    const household: import("@/lib/types").Household = {
      id: "h",
      members: DEMO_HOUSEHOLD.members,
      accounts: [
        {
          id: "a",
          displayName: "A",
          category: "BROKERAGE",
          ownerId: memberId,
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 1_000_000,
              expectedRealCAGR: 0.05,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_000_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const result = projectIndependence(household, assumptions, undefined, {
      incomePerYearUSD: [50_000, 50_000, 50_000, 50_000, 50_000],
    });
    // Should complete normally without NaN propagation.
    expect(result.series.every((p) => Number.isFinite(p.netWorthUSD))).toBe(
      true,
    );
  });
});

describe("projectIndependence startup-already-Independence'd withdrawal (Round-1 fix)", () => {
  it("uses actual NW × rate when user starts above target (was: target × rate)", async () => {
    // User has $2M, target was $1M. Withdrawal should be 4% of $2M = $80K/yr,
    // not 4% of $1M = $40K/yr. Before the fix, this case used target.
    const { projectIndependence } = await import("@/lib/projection/independence");
    const memberId = "m1";
    const household: import("@/lib/types").Household = {
      id: "t",
      members: [{ id: memberId, displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "B",
          ownerId: memberId,
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 2_000_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_000_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const out = projectIndependence(household, assumptions);
    expect(out.monthsToIndependence).toBe(0);
    // 4% of $2M / 12 = ~$6,666.67/mo
    expect(out.monthlyWithdrawalUSD).toBeCloseTo(2_000_000 * 0.04 / 12, 2);
  });
});
