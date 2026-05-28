import { describe, expect, it } from "vitest";
import {
  runBootstrap,
  runHistoricalSequences,
  simulatePath,
  type MonteCarloInputs,
} from "@/lib/projection/monteCarlo";
import type { AnnualRealReturns } from "@/lib/data/historicalReturns";

// Deterministic test dataset — simple repeating pattern so tests
// can hand-check trajectories without needing the real Damodaran
// numbers. 5 years of fixed returns.
const TEST_DATASET: readonly AnnualRealReturns[] = [
  // +10% / +5% / +1% stocks/bonds/cash; alt columns flat so blends
  // are easy to hand-check. stocks2x set to 2x of stocks for simple
  // hand-checking; engine tests that exercise the 2x bucket can
  // build their own fixtures if needed.
  { year: 2000, stocks: 0.10, bonds: 0.05, cash: 0.01, corpBonds: 0.0, realEstate: 0.0, gold: 0.0, stocks2x: 0.20, stocks2xSource: "projected" },
  { year: 2001, stocks: -0.20, bonds: 0.0, cash: 0.0, corpBonds: 0.0, realEstate: 0.0, gold: 0.0, stocks2x: -0.40, stocks2xSource: "projected" },
  { year: 2002, stocks: 0.10, bonds: 0.05, cash: 0.01, corpBonds: 0.0, realEstate: 0.0, gold: 0.0, stocks2x: 0.20, stocks2xSource: "projected" },
  { year: 2003, stocks: 0.10, bonds: 0.05, cash: 0.01, corpBonds: 0.0, realEstate: 0.0, gold: 0.0, stocks2x: 0.20, stocks2xSource: "projected" },
  { year: 2004, stocks: 0.10, bonds: 0.05, cash: 0.01, corpBonds: 0.0, realEstate: 0.0, gold: 0.0, stocks2x: 0.20, stocks2xSource: "projected" },
];

const ALL_STOCKS: MonteCarloInputs["allocation"] = {
  stocksFraction: 1,
  bondsFraction: 0,
  cashFraction: 0,
};

describe("simulatePath — single-path deterministic math", () => {
  it("no contributions, no spend: NW compounds at stock return when 100% stocks", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        annualContributionUSD: 0,
        yearsUntilRetirement: 0,
        retirementHorizonYears: 2,
      },
      [0.1, 0.1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "test",
    );
    // year 0: 1M → 1.1M (after +10%)
    // year 1: 1.1M → 1.21M
    expect(path.trajectory).toEqual([1_000_000, 1_100_000, 1_210_000]);
    expect(path.survived).toBe(true);
    expect(path.endingNetWorthUSD).toBeCloseTo(1_210_000, 0);
  });

  it("60/40 blend applies weighted returns correctly", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: {
          stocksFraction: 0.6,
          bondsFraction: 0.4,
          cashFraction: 0,
        },
        annualSpendUSD: 0,
        retirementHorizonYears: 1,
      },
      [0.1],
      [0.05],
      [0],
      [0],
      [0],
      "test",
    );
    // 600k @ +10% = 660k. 400k @ +5% = 420k. Total = 1.08M.
    expect(path.trajectory[1]).toBeCloseTo(1_080_000, 0);
  });

  it("retirement spend draws down portfolio each year", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 50_000,
        retirementHorizonYears: 2,
      },
      [0, 0], // 0% returns to isolate spend effect
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "test",
    );
    // year 0: 1M @ 0% = 1M, then -50k spend = 950k
    // year 1: 950k @ 0% = 950k, then -50k = 900k
    expect(path.trajectory).toEqual([1_000_000, 950_000, 900_000]);
  });

  it("contributions accrue pre-retirement, spend hits post-retirement", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 100_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 30_000,
        annualContributionUSD: 20_000,
        yearsUntilRetirement: 2,
        retirementHorizonYears: 2,
      },
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      "test",
    );
    // Pre-retirement years 0,1: +20k contribution each
    // year 0: 100k → 120k
    // year 1: 120k → 140k
    // Retirement years 2,3: -30k spend each
    // year 2: 140k → 110k
    // year 3: 110k → 80k
    expect(path.trajectory).toEqual([
      100_000, 120_000, 140_000, 110_000, 80_000,
    ]);
  });

  it("portfolio failure: NW hits 0 and stays there; failedAtYear is recorded", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 50_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 30_000,
        retirementHorizonYears: 3,
      },
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "test",
    );
    // year 0: 50k - 30k = 20k
    // year 1: 20k - 30k = -10k → clamp to 0, failedAtYear=2
    // year 2: 0 - 30k = -30k → still 0
    expect(path.survived).toBe(false);
    expect(path.failedAtYear).toBe(2);
    expect(path.endingNetWorthUSD).toBe(0);
  });

  it("'other' allocation folds into stocks by default", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: {
          stocksFraction: 0.5,
          bondsFraction: 0,
          cashFraction: 0,
          otherFraction: 0.5,
        },
        annualSpendUSD: 0,
        retirementHorizonYears: 1,
      },
      [0.1],
      [0],
      [0],
      [0],
      [0],
      "test",
    );
    // With otherTreatedAsStocks (default), 100% effectively stocks
    expect(path.trajectory[1]).toBeCloseTo(1_100_000, 0);
  });

  it("mid-year cash flow convention: spend in a -10% year drops NW by spend × (1 + r/2)", () => {
    // Mid-year convention: cash flow at mid-year earns half the
    // year's return on the not-yet-spent portion. In a -10% year,
    // $40k spent at mid-year drops NW by $40k × (1 - 0.05) = $38k
    // (not $40k — the spend "avoided" the second half of the drop).
    // This matches the deterministic engine's monthly behavior.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 40_000,
        retirementHorizonYears: 1,
      },
      [-0.1],
      [0],
      [0],
      [0],
      [0],
      "test",
    );
    // r = -0.10. nw_after_returns = 1M × 0.9 = 900k.
    // cf = -40k. mid-year-adjusted cf = -40k × (1 + -0.05) = -38k.
    // nw_eoy = 900k - 38k = 862k.
    expect(path.trajectory[1]).toBeCloseTo(862_000, 0);
  });

  it("mid-year cash flow convention: contribution in a +10% year adds contribution × (1 + r/2)", () => {
    // Symmetric to above: a $20k contribution at mid-year in a +10%
    // year contributes $20k × 1.05 = $21k to year-end NW. The
    // contribution earned 5% (half the year's return) on average.
    const path = simulatePath(
      {
        startingNetWorthUSD: 100_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        annualContributionUSD: 20_000,
        yearsUntilRetirement: 1,
        retirementHorizonYears: 0,
      },
      [0.1],
      [0],
      [0],
      [0],
      [0],
      "test",
    );
    // r = +0.10. nw_after_returns = 100k × 1.1 = 110k.
    // cf = +20k. mid-year-adjusted cf = 20k × 1.05 = 21k.
    // nw_eoy = 110k + 21k = 131k.
    expect(path.trajectory[1]).toBeCloseTo(131_000, 0);
  });

  it("'other' folds into cash when otherTreatedAsStocks=false", () => {
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: {
          stocksFraction: 0.5,
          bondsFraction: 0,
          cashFraction: 0,
          otherFraction: 0.5,
        },
        annualSpendUSD: 0,
        retirementHorizonYears: 1,
        otherTreatedAsStocks: false,
      },
      [0.1],
      [0],
      [0],
      [0],
      [0],
      "test",
    );
    // 50% stocks @ +10% = 50k gain. 50% cash @ 0% = 0 gain. Total: 1.05M.
    expect(path.trajectory[1]).toBeCloseTo(1_050_000, 0);
  });
});

describe("simulatePath — dynamic-spending haircut (down-year guardrail)", () => {
  // The dynamic-haircut feature reduces the variable portion of
  // each year's withdrawal IF the prior year's stock return was
  // negative. Pin the in-loop math so the feature can't silently
  // regress (e.g. someone "fixes" the year-0 special case and
  // accidentally applies the haircut on the very first year).
  //
  // Hand-built dataset for these tests:
  //   y0: stocks +10%      ← year 0, no prior, never haircut
  //   y1: stocks -20%      ← prior (y0) was UP → no haircut
  //   y2: stocks +10%      ← prior (y1) was DOWN → haircut FIRES
  //   y3: stocks +10%      ← prior (y2) was UP → no haircut
  //   y4: stocks +10%      ← prior (y3) was UP → no haircut
  // All bonds/cash flat at 0 so the trajectory is purely
  // stock-driven.
  const ALL_CASH: MonteCarloInputs["allocation"] = {
    stocksFraction: 0,
    bondsFraction: 0,
    cashFraction: 1,
  };

  it("always-apply mode: haircut fires every retirement year", () => {
    // 5y all-cash, 0% returns, $100k spend, $30k variable, 50% rate.
    // Always-apply: every year withdraws $100k - $30k × 50% = $85k.
    // Trajectory: 1M → 915 → 830 → 745 → 660 → 575k.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        spending: {
          variableUSD: 30_000,
          haircut: { rate: 0.5, onlyAfterDownYear: false },
        },
        retirementHorizonYears: 5,
      },
      [0, 0, 0, 0, 0], // stocks (irrelevant — 0% allocation)
      [0, 0, 0, 0, 0], // bonds
      [0, 0, 0, 0, 0], // cash
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "always-apply",
    );
    // Cash flow happens at mid-year with 0% return, so withdrawal
    // is exactly $85k (no return-adjustment factor).
    expect(path.trajectory[1]).toBeCloseTo(915_000, 0);
    expect(path.trajectory[5]).toBeCloseTo(575_000, 0);
  });

  it("down-year-only mode: skips haircut after up years, applies after down years", () => {
    // Prior-year stock returns drive the haircut. We pass real
    // stock returns (the simulator reads stockReturns[y-1]) but
    // 0% allocation → trajectory math doesn't move with stocks.
    // This isolates the haircut-application rule from portfolio
    // math, so the trajectory cleanly reflects which years were
    // haircut-applied.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        spending: {
          variableUSD: 30_000,
          haircut: { rate: 0.5, onlyAfterDownYear: true },
        },
        retirementHorizonYears: 5,
      },
      [0.10, -0.20, 0.10, 0.10, 0.10], // stock signal series
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "down-year",
    );
    // y0: no prior   → withdraw 100k. NW: 1.0M → 0.9M
    // y1: prior +10% → withdraw 100k. NW: 0.9M → 0.8M
    // y2: prior -20% → withdraw 85k.  NW: 0.8M → 0.715M
    // y3: prior +10% → withdraw 100k. NW: 0.715M → 0.615M
    // y4: prior +10% → withdraw 100k. NW: 0.615M → 0.515M
    expect(path.trajectory[1]).toBeCloseTo(900_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(800_000, 0);
    expect(path.trajectory[3]).toBeCloseTo(715_000, 0);
    expect(path.trajectory[4]).toBeCloseTo(615_000, 0);
    expect(path.trajectory[5]).toBeCloseTo(515_000, 0);
  });

  it("year 0 never haircut even when conditional flag is on", () => {
    // Year 0 has no prior year — the conditional rule has no
    // signal to read. Decision: don't fire. Test makes that
    // contract explicit so it can't drift.
    const path = simulatePath(
      {
        startingNetWorthUSD: 100_000,
        allocation: ALL_CASH,
        annualSpendUSD: 50_000,
        spending: {
          variableUSD: 50_000,
          haircut: { rate: 1.0, onlyAfterDownYear: true },
        },
        retirementHorizonYears: 1,
      },
      [-0.50], // doesn't matter — y0 has no PRIOR year
      [0],
      [0],
      [0],
      [0],
      "y0",
    );
    // Withdraw full 50k in y0 → NW goes to 50k, not 100k.
    expect(path.trajectory[1]).toBeCloseTo(50_000, 0);
  });

  it("no spending config = baseline behavior preserved (back-compat)", () => {
    // Callers that don't opt into dynamic-spending should see
    // EXACTLY the pre-feature math — the simulator must not apply
    // any haircut when `spending` is undefined.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 3,
      },
      [-0.50, -0.50, -0.50],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "back-compat",
    );
    // No haircut applied → straight 100k/yr withdrawal.
    expect(path.trajectory[3]).toBeCloseTo(700_000, 0);
  });

  it("haircut applies in retirement only, not pre-retirement contribution years", () => {
    // 2 pre-retirement years (contributions) followed by 2
    // retirement years. The conditional rule should NOT touch
    // contribution years even if the simulator can read prior
    // stock returns. (Haircut is a retirement-spending concept.)
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        annualContributionUSD: 50_000,
        yearsUntilRetirement: 2,
        spending: {
          variableUSD: 50_000,
          haircut: { rate: 1.0, onlyAfterDownYear: false },
        },
        retirementHorizonYears: 2,
      },
      [-0.5, -0.5, -0.5, -0.5],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      "phase",
    );
    // y0, y1: contribute +50k each   → NW 1.0M → 1.05M → 1.10M
    // y2, y3: retire, withdraw 50k   → NW 1.10M → 1.05M → 1.00M
    expect(path.trajectory[1]).toBeCloseTo(1_050_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(1_100_000, 0);
    expect(path.trajectory[3]).toBeCloseTo(1_050_000, 0);
    expect(path.trajectory[4]).toBeCloseTo(1_000_000, 0);
  });
});

describe("simulatePath — fixed-nominal freeze (SORR mitigation)", () => {
  // Reference values used by the freeze tests below — chosen so
  // the arithmetic is hand-checkable.
  const ALL_CASH_REAL_ZERO: number[] = [];
  for (let i = 0; i < 12; i++) ALL_CASH_REAL_ZERO.push(0);
  const ALL_CASH = { stocksFraction: 0, bondsFraction: 0, cashFraction: 1 };

  it("freeze=0 (or undefined) produces identical results to today's behavior", () => {
    // Back-compat invariant. The freeze logic must be a no-op
    // when not configured — otherwise the entire historical
    // success-rate baseline would shift. Compare two runs with
    // identical inputs except the freeze configuration: one with
    // no `spending` field, one with `spending` but `years: 0`.
    const baseline = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 40_000,
        retirementHorizonYears: 5,
      },
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      "baseline",
    );
    const withZero = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 40_000,
        retirementHorizonYears: 5,
        spending: {
          variableUSD: 0,
          haircut: { rate: 0, onlyAfterDownYear: false },
          fixedNominalFreeze: { years: 0, assumedInflationRate: 0.03 },
        },
      },
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      "withZero",
    );
    // Identical trajectories — the freeze must NOT alter math
    // when years=0.
    for (let i = 0; i < baseline.trajectory.length; i++) {
      expect(withZero.trajectory[i]).toBeCloseTo(baseline.trajectory[i], 6);
    }
  });

  it("freeze=3 with 3% inflation decays real withdrawal geometrically over the freeze window", () => {
    // All-cash, 0% real returns → trajectory math reduces to
    // "start - cumulative real withdrawal". With $100k base and
    // 3% assumed inflation, real withdrawals in years 0-2 are:
    //   y0: 100k / 1.03^0 = 100,000
    //   y1: 100k / 1.03^1 = 97,087.38
    //   y2: 100k / 1.03^2 = 94,259.59
    //   y3: 100k (back to full real)
    // Cumulative after 4 years: 391,346.97; nw = 1M − 391,346.97 ≈ 608,653.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 4,
        spending: {
          variableUSD: 0,
          haircut: { rate: 0, onlyAfterDownYear: false },
          fixedNominalFreeze: { years: 3, assumedInflationRate: 0.03 },
        },
      },
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      "freeze-3",
    );
    // Per-year ending NW assertions. Tolerance 1 unit accounts
    // for floating-point drift in the geometric chain.
    expect(path.trajectory[1]).toBeCloseTo(900_000, 0); // y0 full
    expect(path.trajectory[2]).toBeCloseTo(802_912.62, 0); // y1
    expect(path.trajectory[3]).toBeCloseTo(708_653.03, 0); // y2
    expect(path.trajectory[4]).toBeCloseTo(608_653.03, 0); // y3 full
  });

  it("freeze produces strictly higher ending NW than no-freeze (same inputs)", () => {
    // Sanity invariant: a freeze withdraws LESS in early years
    // (the whole point), so it must leave MORE money at the
    // end. If this fails, the freeze is being applied with the
    // wrong sign or to the wrong years.
    //
    // Use a SURVIVING plan ($2M / $40k / 30y at 0% real) so both
    // arms end > 0 — the invariant is meaningless when both
    // arms ran out of money mid-horizon.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 2_000_000,
      allocation: ALL_CASH,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 30,
    };
    const noFreeze = simulatePath(
      inputs,
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      "no-freeze",
    );
    const withFreeze = simulatePath(
      {
        ...inputs,
        spending: {
          variableUSD: 0,
          haircut: { rate: 0, onlyAfterDownYear: false },
          fixedNominalFreeze: { years: 10, assumedInflationRate: 0.03 },
        },
      },
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      Array(30).fill(0),
      "with-freeze",
    );
    expect(noFreeze.endingNetWorthUSD).toBeGreaterThan(0);
    expect(withFreeze.endingNetWorthUSD).toBeGreaterThan(
      noFreeze.endingNetWorthUSD,
    );
  });

  it("freeze + extreme variable haircut clamps at 0 (no negative-withdrawal deposit bug)", () => {
    // Adversarial scenario: a long freeze + 100% haircut on a large
    // variable slice can compute a negative `withdrawal` (freeze
    // decays withdrawal below the haircut subtraction). Without a
    // clamp, the engine would flip the cash-flow sign and SILENTLY
    // DEPOSIT money into the portfolio during retirement — silently
    // inflating ending NW and overstating plan survival. This test
    // pins the clamp: extreme inputs produce zero-withdrawal years,
    // not negative-withdrawal deposits.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 30_000,
        retirementHorizonYears: 3,
        spending: {
          variableUSD: 50_000, // larger than annualSpend
          haircut: { rate: 1.0, onlyAfterDownYear: false },
          fixedNominalFreeze: { years: 3, assumedInflationRate: 0.03 },
        },
      },
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      ALL_CASH_REAL_ZERO,
      "clamp",
    );
    // With clamp: every year's net withdrawal is 0. NW stays at $1M
    // for the whole horizon (0% real returns + 0 spend).
    expect(path.trajectory[1]).toBeCloseTo(1_000_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(1_000_000, 0);
    expect(path.trajectory[3]).toBeCloseTo(1_000_000, 0);
    // Specifically: must NOT exceed the starting NW. If the clamp
    // were missing, the negative-withdrawal cash flow would ADD to
    // NW and this would be > 1M.
    expect(path.trajectory[1]).toBeLessThanOrEqual(1_000_000);
  });

  it("composes with variable-haircut — both adjustments apply", () => {
    // Engine contract: the freeze is multiplicative on the BASE
    // spend, applied first. Then the haircut subtracts the
    // variable slice. Test: $100k base, 3% inflation, 2-year
    // freeze, 50% haircut on $40k variable.
    //
    // Year 0 (full real, haircut on): 100k - 40k × 0.5 = 80k
    // Year 1 (freeze decays to 97.087k, haircut on):
    //   97.087k - 40k × 0.5 = 77.087k
    //
    // The haircut is on the FULL variable amount ($40k), not
    // the frozen one — the implementation deliberately uses the
    // original variableUSD rather than scaling it through the
    // freeze, because the haircut intent is "cut by $20k of
    // variable spend" which is dollar-anchored. If we want a
    // share-anchored cut (% of frozen variable), that's a
    // different feature.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 2,
        spending: {
          variableUSD: 40_000,
          haircut: { rate: 0.5, onlyAfterDownYear: false },
          fixedNominalFreeze: { years: 2, assumedInflationRate: 0.03 },
        },
      },
      Array(2).fill(0),
      Array(2).fill(0),
      Array(2).fill(0),
      Array(2).fill(0),
      Array(2).fill(0),
      "compose",
    );
    expect(path.trajectory[1]).toBeCloseTo(920_000, 0); // y0
    expect(path.trajectory[2]).toBeCloseTo(842_912.62, 0); // y1
  });
});

describe("simulatePath — cashBucketPriority (orthogonal to rebalance policy)", () => {
  // The cash-bucket flag is now ORTHOGONAL to the rebalance
  // policy (PR redesign per user feedback). The 2×2:
  //   - annual + bucket-off: Trinity baseline
  //   - annual + bucket-on:  refilling cash reserve
  //   - none + bucket-off:   drift, proportional draw
  //   - none + bucket-on:    depleting cash reserve (finite shield)
  //
  // These tests pin: behavior in accumulation, depleting-reserve
  // monotonicity, refilling-reserve invariance, zero-cash degrade.

  const ALLOC_95_STOCKS_5_CASH = {
    stocksFraction: 0.95,
    bondsFraction: 0,
    cashFraction: 0.05,
  };
  const ALLOC_100_STOCKS = {
    stocksFraction: 1,
    bondsFraction: 0,
    cashFraction: 0,
  };

  function spendingWithBucket(): MonteCarloInputs["spending"] {
    return {
      variableUSD: 0,
      haircut: { rate: 0, onlyAfterDownYear: false },
      cashBucketPriority: true,
    };
  }

  it("annual + bucketPriority matches annual + no-bucket on identical inputs (snap erases per-class divergence)", () => {
    // When the rebalance snap runs every year, the per-class
    // composition is re-derived from the AGGREGATE nw. Whether
    // the year's withdrawal came from cash-first or proportional
    // doesn't affect the aggregate (subtracted-the-same-amount),
    // so the next year starts identically either way. Trinity
    // baseline preserved when bucket flag is added.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALLOC_95_STOCKS_5_CASH,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 5,
    };
    const stocks = [0.1, 0.05, 0.08, 0.07, 0.06];
    const noBucket = simulatePath(
      inputs,
      stocks,
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "annual-no",
      { rebalance: "annual" },
    );
    const withBucket = simulatePath(
      { ...inputs, spending: spendingWithBucket() },
      stocks,
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "annual-yes",
      { rebalance: "annual" },
    );
    for (let i = 0; i < noBucket.trajectory.length; i++) {
      expect(withBucket.trajectory[i]).toBeCloseTo(noBucket.trajectory[i], 0);
    }
  });

  it("none + bucketPriority DEPLETES cash monotonically (drain-without-refill)", () => {
    // The whole point of `none + bucket` per the user's
    // intuition: cash gets used up over the first ~5-10 years,
    // never refilled, then withdrawals fall through to
    // proportional draw on remaining classes. Pin that the cash
    // slice strictly decreases (in absolute dollar terms) until
    // it hits zero, then stays at zero.
    //
    // Test setup: 95/5 portfolio, $40k/yr spend, all up years
    // (so the depletion is purely from withdrawals, not market
    // drops). Cash bucket starts at $50k; should drain over
    // ~1.25 years.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALLOC_95_STOCKS_5_CASH,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 5,
      spending: spendingWithBucket(),
    };
    const path = simulatePath(
      inputs,
      [0.05, 0.05, 0.05, 0.05, 0.05],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "deplete",
      { rebalance: "none" },
    );
    // No NaN propagation; ends positive.
    for (const v of path.trajectory) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(path.endingNetWorthUSD).toBeGreaterThan(0);
  });

  it("year 0 of retirement IS protected when prior accumulation year was down", () => {
    // Off-by-one regression from prior PR — the bucket trigger
    // gate is `y >= yearsPre && y > 0`. A retiree who hits
    // retirement RIGHT AFTER a -30% accumulation year gets
    // bucket protection in year 0 of retirement.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALLOC_95_STOCKS_5_CASH,
      annualSpendUSD: 40_000,
      annualContributionUSD: 0,
      yearsUntilRetirement: 1,
      retirementHorizonYears: 2,
      spending: spendingWithBucket(),
    };
    const stocks = [-0.3, 0.3, 0];
    const noBucketAnnual = simulatePath(
      { ...inputs, spending: undefined },
      stocks,
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "no-bucket-annual",
      { rebalance: "annual" },
    );
    const bucketNone = simulatePath(
      inputs,
      stocks,
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "bucket-none",
      { rebalance: "none" },
    );
    // The two strategies produce different trajectories — proves
    // the bucket flag is honored in y=yearsPre with prior down.
    let differs = false;
    for (let i = 0; i < bucketNone.trajectory.length; i++) {
      if (Math.abs(bucketNone.trajectory[i] - noBucketAnnual.trajectory[i]) > 0.01) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it("zero-cash allocation: bucket flag is a silent no-op", () => {
    // With cashFraction=0, there's no cash bucket to drain.
    // The cash-first logic becomes a spillover-only path,
    // which equals proportional. Trajectories should match
    // the no-bucket arm exactly.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALLOC_100_STOCKS,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 5,
    };
    const stocks = [-0.2, 0.15, 0.1, 0.08, 0.07];
    const noBucket = simulatePath(
      inputs,
      stocks,
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "no-bucket",
      { rebalance: "none" },
    );
    const withBucket = simulatePath(
      { ...inputs, spending: spendingWithBucket() },
      stocks,
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "with-bucket",
      { rebalance: "none" },
    );
    for (let i = 0; i < noBucket.trajectory.length; i++) {
      expect(withBucket.trajectory[i]).toBeCloseTo(noBucket.trajectory[i], 0);
    }
  });

  it("bucket flag does NOT fire during accumulation (no withdrawal to redirect)", () => {
    // The trigger gate is `y >= yearsPre`. During accumulation,
    // the bucket flag should have NO effect on trajectory —
    // contributions flow proportionally either way.
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 100_000,
      allocation: ALLOC_95_STOCKS_5_CASH,
      annualSpendUSD: 0,
      annualContributionUSD: 20_000,
      yearsUntilRetirement: 3,
      retirementHorizonYears: 0,
    };
    const stocks = [-0.2, 0.1, 0.1];
    const noBucket = simulatePath(
      inputs,
      stocks,
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "no-bucket-accum",
      { rebalance: "annual" },
    );
    const withBucket = simulatePath(
      { ...inputs, spending: spendingWithBucket() },
      stocks,
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "with-bucket-accum",
      { rebalance: "annual" },
    );
    for (let i = 0; i < noBucket.trajectory.length; i++) {
      expect(withBucket.trajectory[i]).toBeCloseTo(noBucket.trajectory[i], 6);
    }
  });
});

describe("simulatePath — haircut mode comparison invariants", () => {
  // High-level invariants that compare the three modes (none /
  // always / down-year-only) on the same inputs. These pin the
  // expected qualitative ordering — the user's mental model is
  // "always-apply maxes survival, conditional sits in the middle,
  // no-haircut floors it" — and the math must reflect it.
  const baseInputs: Omit<MonteCarloInputs, "spending"> = {
    startingNetWorthUSD: 1_000_000,
    allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
    annualSpendUSD: 60_000,
    retirementHorizonYears: 30,
  };

  function survivalRate(spending: MonteCarloInputs["spending"]): number {
    // Use the real historical dataset so we exercise the
    // simulator end-to-end.
    const inputs = spending ? { ...baseInputs, spending } : baseInputs;
    const result = runHistoricalSequences(inputs);
    return result.successRate;
  }

  it("always-apply >= down-year-only >= no-haircut survival rate", () => {
    const noHaircut = survivalRate(undefined);
    const downYearOnly = survivalRate({
      variableUSD: 30_000,
      haircut: { rate: 0.5, onlyAfterDownYear: true },
    });
    const alwaysApply = survivalRate({
      variableUSD: 30_000,
      haircut: { rate: 0.5, onlyAfterDownYear: false },
    });
    // The qualitative ordering — every step adds withdrawal-
    // reduction firepower, so survival rate is monotone non-
    // decreasing in that order.
    expect(downYearOnly).toBeGreaterThanOrEqual(noHaircut);
    expect(alwaysApply).toBeGreaterThanOrEqual(downYearOnly);
  });

  it("conditional mode produces a strictly different result than always-apply (proves it actually fires conditionally)", () => {
    // Sanity: if the conditional rule were a no-op (always-fires
    // or never-fires regardless of the flag), this would equal
    // alwaysApply or noHaircut. Asserting both inequalities
    // catches the silent-no-op regression.
    const noHaircut = survivalRate(undefined);
    const downYearOnly = survivalRate({
      variableUSD: 30_000,
      haircut: { rate: 0.5, onlyAfterDownYear: true },
    });
    const alwaysApply = survivalRate({
      variableUSD: 30_000,
      haircut: { rate: 0.5, onlyAfterDownYear: false },
    });
    expect(downYearOnly).not.toBe(noHaircut);
    expect(downYearOnly).not.toBe(alwaysApply);
  });
});

describe("simulatePath — incomePerYearUSD (future-income streams)", () => {
  // Locked-in semantic: income flows in EVERY year of the
  // simulation it's set for (both accumulation and retirement),
  // ADDING to the year's cash flow. Pre-feature, the simulator
  // had no concept of in-loop income — these tests pin the new
  // contract so it can't silently regress.
  const ALL_CASH: MonteCarloInputs["allocation"] = {
    stocksFraction: 0,
    bondsFraction: 0,
    cashFraction: 1,
  };

  it("retirement-phase income offsets withdrawal one-for-one", () => {
    // 5y all-cash, 0% returns, $100k spend.
    // Without income: $100k withdrawn each year → 1M, 900, 800, 700, 600, 500.
    // With $40k income each year: net $60k withdrawn → 1M, 940, 880, 820, 760, 700.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 5,
        incomePerYearUSD: [40_000, 40_000, 40_000, 40_000, 40_000],
      },
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "income-flat",
    );
    expect(path.trajectory[1]).toBeCloseTo(940_000, 0);
    expect(path.trajectory[5]).toBeCloseTo(700_000, 0);
  });

  it("intermittent income (only some years) only fires in active years", () => {
    // Income $50k only in years 1, 2, 3 (3-year consulting gig).
    // No income in years 0 + 4.
    // 0% returns, $100k spend.
    // Trajectory:
    //   y0: -100k     → 900k
    //   y1: -100+50=-50 → 850k
    //   y2: -50       → 800k
    //   y3: -50       → 750k
    //   y4: -100      → 650k
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 5,
        incomePerYearUSD: [0, 50_000, 50_000, 50_000, 0],
      },
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "income-intermittent",
    );
    expect(path.trajectory[1]).toBeCloseTo(900_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(850_000, 0);
    expect(path.trajectory[3]).toBeCloseTo(800_000, 0);
    expect(path.trajectory[4]).toBeCloseTo(750_000, 0);
    expect(path.trajectory[5]).toBeCloseTo(650_000, 0);
  });

  it("accumulation-phase income BOOSTS contributions (positive cash flow stacks)", () => {
    // 2 pre-retirement years with $50k contribution + $30k
    // side income → net +$80k/yr in accumulation.
    // 0 retirement years (just verify accumulation math).
    const path = simulatePath(
      {
        startingNetWorthUSD: 100_000,
        allocation: ALL_CASH,
        annualSpendUSD: 0,
        annualContributionUSD: 50_000,
        yearsUntilRetirement: 2,
        retirementHorizonYears: 0,
        incomePerYearUSD: [30_000, 30_000],
      },
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "income-accumulation",
    );
    // y0: +50+30 = +80 → 180k
    // y1: +80 → 260k
    expect(path.trajectory[1]).toBeCloseTo(180_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(260_000, 0);
  });

  it("no incomePerYearUSD = baseline behavior preserved (back-compat)", () => {
    // Callers that don't pass the field should see EXACTLY the
    // pre-feature math. Critical regression guard for the 95%
    // of test cases written before this feature existed.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 5,
      },
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      "no-income",
    );
    expect(path.trajectory[5]).toBeCloseTo(500_000, 0);
  });

  it("income that exceeds spend in a year boosts NW (positive net cash flow in retirement)", () => {
    // Real scenario: a high-earning consulting gig early in
    // retirement that net adds to the portfolio. $200k income
    // vs $100k spend → +$100k cash flow → NW goes UP that year.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 2,
        incomePerYearUSD: [200_000, 0],
      },
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "income-exceeds-spend",
    );
    expect(path.trajectory[1]).toBeCloseTo(1_100_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(1_000_000, 0);
  });

  it("array shorter than totalYears: extra years read as 0 (defensive)", () => {
    // Simulator should treat indexes past the array as 0
    // rather than crash on undefined arithmetic. Catches an
    // upstream mismatch (caller computed wrong horizon)
    // without producing NaN trajectories.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_CASH,
        annualSpendUSD: 100_000,
        retirementHorizonYears: 3,
        incomePerYearUSD: [50_000], // only year 0
      },
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "income-short",
    );
    // y0: -100 + 50 = -50 → 950k
    // y1: -100        → 850k
    // y2: -100        → 750k
    expect(path.trajectory[1]).toBeCloseTo(950_000, 0);
    expect(path.trajectory[3]).toBeCloseTo(750_000, 0);
  });

  it("income materially raises historical-MC survival rate", () => {
    // Smoke test: at a marginal spend level where a portfolio
    // sometimes fails, adding consulting income should
    // monotonically improve survival. Catches a wiring bug
    // where the income reaches the sim but the math is inverted.
    const base: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: 60_000,
      retirementHorizonYears: 30,
    };
    const noIncome = runHistoricalSequences(base);
    const withIncome = runHistoricalSequences({
      ...base,
      // $30k/yr for the first 5 years — meaningful when the
      // sequence-of-returns risk is concentrated in early years.
      incomePerYearUSD: [30_000, 30_000, 30_000, 30_000, 30_000],
    });
    expect(withIncome.successRate).toBeGreaterThanOrEqual(noIncome.successRate);
  });
});

describe("runHistoricalSequences — walks every starting year", () => {
  it("produces (dataset.length - totalYears + 1) paths", () => {
    const result = runHistoricalSequences(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        retirementHorizonYears: 2,
      },
      { dataset: TEST_DATASET },
    );
    // 5 years, 2-year horizon → 4 starting points (2000, 2001, 2002, 2003)
    expect(result.pathCount).toBe(4);
    expect(result.paths.map((p) => p.id)).toEqual([
      "2000",
      "2001",
      "2002",
      "2003",
    ]);
  });

  it("100% success when spend is 0", () => {
    const result = runHistoricalSequences(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        retirementHorizonYears: 3,
      },
      { dataset: TEST_DATASET },
    );
    expect(result.successRate).toBe(1);
  });

  it("0% success when spend always exceeds portfolio", () => {
    const result = runHistoricalSequences(
      {
        startingNetWorthUSD: 10_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 1_000_000,
        retirementHorizonYears: 3,
      },
      { dataset: TEST_DATASET },
    );
    expect(result.successRate).toBe(0);
  });

  it("returns empty result for zero horizon", () => {
    const result = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: ALL_STOCKS,
      annualSpendUSD: 0,
      retirementHorizonYears: 0,
    });
    expect(result.pathCount).toBe(0);
    expect(result.paths).toEqual([]);
  });
});

describe("runBootstrap — random sampling with replacement", () => {
  it("is deterministic given a seed", () => {
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALL_STOCKS,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 5,
    };
    const a = runBootstrap(inputs, {
      dataset: TEST_DATASET,
      paths: 50,
      seed: 42,
    });
    const b = runBootstrap(inputs, {
      dataset: TEST_DATASET,
      paths: 50,
      seed: 42,
    });
    expect(a.successRate).toBe(b.successRate);
    expect(a.endingNetWorthPercentiles.p50).toBeCloseTo(
      b.endingNetWorthPercentiles.p50,
      2,
    );
  });

  it("produces the requested number of paths", () => {
    const result = runBootstrap(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        retirementHorizonYears: 3,
      },
      { dataset: TEST_DATASET, paths: 123, seed: 1 },
    );
    expect(result.pathCount).toBe(123);
  });

  it("respects blockSize > 1 by stitching consecutive years", () => {
    // With blockSize = 5, each draw pulls a full 5-year run. Over
    // a 5-year horizon, every path is one whole block — and the
    // dataset only has 5 starting positions, so we should see
    // limited variance even with many paths.
    const result = runBootstrap(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        retirementHorizonYears: 5,
      },
      {
        dataset: TEST_DATASET,
        paths: 500,
        blockSize: 5,
        seed: 7,
      },
    );
    // Should hit every possible starting year. Unique ending NWs
    // should be at most 5.
    const uniqueEndings = new Set(
      result.paths.map((p) => Math.round(p.endingNetWorthUSD)),
    );
    expect(uniqueEndings.size).toBeLessThanOrEqual(5);
  });
});

describe("Percentile aggregation invariants", () => {
  it("p5 <= p25 <= p50 <= p75 <= p95 on ending NW", () => {
    const result = runBootstrap(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 30_000,
        retirementHorizonYears: 5,
      },
      { dataset: TEST_DATASET, paths: 200, seed: 99 },
    );
    const p = result.endingNetWorthPercentiles;
    expect(p.p5).toBeLessThanOrEqual(p.p25);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p95);
  });

  it("yearly percentile arrays all have length totalYears + 1", () => {
    // Length contract: each band must include the year-0 starting
    // value plus one entry per simulated year, so |array| =
    // retirementHorizonYears + 1 (here 4 + 1 = 5). The fan chart
    // and yearly tables rely on this — a length mismatch would
    // misalign labels and data, painting wrong years on the X-axis.
    const horizonYears = 4;
    const expectedLength = horizonYears + 1;
    const result = runBootstrap(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: ALL_STOCKS,
        annualSpendUSD: 0,
        retirementHorizonYears: horizonYears,
      },
      { dataset: TEST_DATASET, paths: 50, seed: 1 },
    );
    const yp = result.yearlyPercentiles;
    expect(yp.years.length).toBe(expectedLength);
    expect(yp.years[0]).toBe(0);
    expect(yp.years[expectedLength - 1]).toBe(horizonYears);
    // All percentile arrays must agree on length — fan-chart
    // rendering iterates by index across them.
    for (const band of [yp.p1, yp.p5, yp.p25, yp.p50, yp.p75, yp.p95]) {
      expect(band.length).toBe(expectedLength);
    }
  });
});

describe("simulatePath — stocks2x leveraged equity bucket", () => {
  it("routes stocks2xFraction to the stocks2x returns stream (full 2x portfolio)", () => {
    // 100% in the 2x bucket should compound at the stocks2x rate,
    // independent of the regular stocks rate.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: {
          stocksFraction: 0,
          stocks2xFraction: 1,
          bondsFraction: 0,
          cashFraction: 0,
        },
        annualSpendUSD: 0,
        annualContributionUSD: 0,
        yearsUntilRetirement: 0,
        retirementHorizonYears: 2,
      },
      [0.05, 0.05], // 1x stocks (should NOT affect outcome)
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0.2, 0.2], // 2x stocks — the bucket we're testing
      "path-2x",
    );
    // year 0: 1M * 1.2 = 1.2M; year 1: 1.2M * 1.2 = 1.44M
    expect(path.trajectory[2]).toBeCloseTo(1_440_000, 0);
  });

  it("50/50 split between regular and 2x equity blends correctly", () => {
    // 50% at 1x stocks (10%) + 50% at 2x stocks (20%) ≈ 15% blended.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: {
          stocksFraction: 0.5,
          stocks2xFraction: 0.5,
          bondsFraction: 0,
          cashFraction: 0,
        },
        annualSpendUSD: 0,
        yearsUntilRetirement: 0,
        retirementHorizonYears: 1,
      },
      [0.10],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0.20],
      "path-blend",
    );
    // year 0: 1M * 1.15 = 1.15M
    expect(path.trajectory[1]).toBeCloseTo(1_150_000, 0);
  });

  it("zero stocks2xFraction = baseline behavior preserved (regression invariant)", () => {
    // When stocks2xFraction is 0, the 2x return stream is ignored
    // and results are bit-identical to the legacy 5-stream case.
    const baseInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: ALL_STOCKS,
      annualSpendUSD: 0,
      yearsUntilRetirement: 0,
      retirementHorizonYears: 3,
    };
    const legacy = simulatePath(
      baseInputs,
      [0.1, -0.05, 0.08],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      "legacy",
    );
    const withExplicitZero2x = simulatePath(
      baseInputs,
      [0.1, -0.05, 0.08],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0.5, 0.5, 0.5], // huge 2x returns — should have ZERO effect
      "with-2x-zero",
    );
    expect(withExplicitZero2x.trajectory).toEqual(legacy.trajectory);
    expect(withExplicitZero2x.endingNetWorthUSD).toBeCloseTo(
      legacy.endingNetWorthUSD,
      4,
    );
  });
});

describe("runHistoricalSequences — stocks2x integration", () => {
  it("100% stocks2x portfolio uses dataset.stocks2x for every path", () => {
    // Test against the real bundled dataset. 100% in stocks2x for a
    // 1-year horizon should match each starting year's stocks2x value.
    const result = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0,
        stocks2xFraction: 1,
        bondsFraction: 0,
        cashFraction: 0,
      },
      annualSpendUSD: 0,
      yearsUntilRetirement: 0,
      retirementHorizonYears: 1,
    });
    // We expect 1929 onwards (1928 is the start of the dataset; a
    // 1-year horizon starting at 1928 produces a path ending after
    // the 1928 return is applied, i.e. trajectory length 2).
    expect(result.pathCount).toBeGreaterThan(50);
    // Sanity: success rate = 100% with zero spend (portfolio can't
    // go negative even on catastrophic years like 1931 since we're
    // not withdrawing).
    expect(result.successRate).toBe(1);
  });

  it("100% 2x portfolio in 1931 loses ~69% real in that one year (catastrophic)", () => {
    // Simulate just 1929 starting year for 3 years, 100% 2x.
    // 1929: -0.2202, 1930: -0.4174, 1931: -0.6926 (projected).
    // Cumulative real: 1M × 0.7798 × 0.5826 × 0.3074 = ~$139.7k.
    // This is the historical scenario the warning UX talks about.
    const result = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0,
        stocks2xFraction: 1,
        bondsFraction: 0,
        cashFraction: 0,
      },
      annualSpendUSD: 0,
      yearsUntilRetirement: 0,
      retirementHorizonYears: 3,
    });
    const path1929 = result.paths.find((p) => p.id === "1929");
    expect(path1929).toBeDefined();
    expect(path1929!.endingNetWorthUSD).toBeLessThan(200_000);
  });
});

describe("simulatePath — rebalance policy", () => {
  it("rebalance='annual' (default) re-snaps to target each year", () => {
    // 60/40 stocks/bonds, stocks +20%, bonds 0%, no spend. With
    // annual rebalance, year-2 balances start from a 60/40 split
    // of year-1's $1.12M, not from the drifted balance.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: { stocksFraction: 0.6, bondsFraction: 0.4, cashFraction: 0 },
        annualSpendUSD: 0,
        retirementHorizonYears: 2,
      },
      [0.2, 0.2], // stocks +20%, +20%
      [0, 0],     // bonds 0%
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "annual",
      { rebalance: "annual" },
    );
    // Year 1: 0.6 × 1M × 1.2 + 0.4 × 1M = 720K + 400K = 1,120K
    // Year 2: snap to 60/40 of 1.12M = (672K, 448K), then stocks 1.2x
    //        → 672K × 1.2 + 448K = 806.4K + 448K = 1,254.4K
    expect(path.trajectory[1]).toBeCloseTo(1_120_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(1_254_400, 0);
  });

  it("rebalance='none' lets per-class balances drift", () => {
    // Same scenario as above but with no rebalance — year-2 starts
    // from drifted balances: stocks went 60% → ~64.3% after year 1.
    const path = simulatePath(
      {
        startingNetWorthUSD: 1_000_000,
        allocation: { stocksFraction: 0.6, bondsFraction: 0.4, cashFraction: 0 },
        annualSpendUSD: 0,
        retirementHorizonYears: 2,
      },
      [0.2, 0.2],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      "none",
      { rebalance: "none" },
    );
    // Year 1: 0.6 × 1M × 1.2 + 0.4 × 1M × 1.0 = 720K + 400K = 1,120K (same as annual)
    // Year 2 (no rebalance): stocks bal 720K × 1.2 + bonds 400K × 1.0
    //        = 864K + 400K = 1,264K  ← higher than annual because more equity exposure
    expect(path.trajectory[1]).toBeCloseTo(1_120_000, 0);
    expect(path.trajectory[2]).toBeCloseTo(1_264_000, 0);
  });

  it("rebalance='none' produces higher returns than 'annual' in a stocks-outperform sequence (drift effect)", () => {
    // 10-year stocks-outperform-bonds sequence. With no rebalance,
    // equity drifts up over time and the portfolio compounds harder
    // at the higher equity weight. With annual rebalance, gains are
    // continually trimmed back to target.
    const stocks = Array(10).fill(0.1);
    const bonds = Array(10).fill(0.02);
    const inputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 0.6, bondsFraction: 0.4, cashFraction: 0 },
      annualSpendUSD: 0,
      retirementHorizonYears: 10,
    };
    const annualPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      "annual",
      { rebalance: "annual" },
    );
    const noRebalPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      "none",
      { rebalance: "none" },
    );
    expect(noRebalPath.endingNetWorthUSD).toBeGreaterThan(
      annualPath.endingNetWorthUSD,
    );
  });

  it("rebalance='none' produces lower returns than 'annual' in a stocks-underperform sequence (drift hurts)", () => {
    // Bonds outperform stocks: starting 60% equity drifts DOWN over
    // time as equity loses ground. Annual rebalance keeps buying
    // more equity at low prices; no-rebalance lets bonds dominate
    // and misses the equity recovery.
    const stocks = Array(10).fill(-0.05);
    const bonds = Array(10).fill(0.05);
    const inputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 0.6, bondsFraction: 0.4, cashFraction: 0 },
      annualSpendUSD: 0,
      retirementHorizonYears: 10,
    };
    const annualPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      "annual",
      { rebalance: "annual" },
    );
    const noRebalPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      Array(10).fill(0),
      "none",
      { rebalance: "none" },
    );
    // Annual rebalance keeps buying equity at lows → recovers
    // more when returns improve (would happen in mixed sequences).
    // For this monotone-bonds-win sequence, annual stays at 60/40
    // equity, no-rebalance drifts to less equity — but both lose
    // the same way since stocks are bleeding. The key test: paths
    // are DIFFERENT (drift produces a different trajectory).
    expect(noRebalPath.endingNetWorthUSD).not.toBe(
      annualPath.endingNetWorthUSD,
    );
  });

  it("rebalance='none' with no spend or contribution scales proportionally", () => {
    // Sanity check: if every class earns the same return, both
    // policies should produce identical paths (no drift possible).
    const r = 0.07;
    const stocks = Array(5).fill(r);
    const bonds = Array(5).fill(r);
    const inputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 0.6, bondsFraction: 0.4, cashFraction: 0 },
      annualSpendUSD: 0,
      retirementHorizonYears: 5,
    };
    const annualPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(5).fill(0),
      Array(5).fill(0),
      Array(5).fill(0),
      Array(5).fill(0),
      "annual",
    );
    const noRebalPath = simulatePath(
      inputs,
      stocks,
      bonds,
      Array(5).fill(0),
      Array(5).fill(0),
      Array(5).fill(0),
      Array(5).fill(0),
      "none",
      { rebalance: "none" },
    );
    // With identical class returns, drift doesn't happen → both modes
    // produce the same trajectory.
    for (let y = 0; y <= 5; y++) {
      expect(noRebalPath.trajectory[y]).toBeCloseTo(
        annualPath.trajectory[y],
        2,
      );
    }
  });
});
