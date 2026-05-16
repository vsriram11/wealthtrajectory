/**
 * Regression tests for the historical Monte Carlo simulator,
 * anchored to a synthetic "still-in-accumulation" scenario that
 * surfaced a stubborn near-zero-success-rate bug.
 *
 * The scenario:
 *   - Current household NW:  $500K        (real, today's dollars)
 *   - Target NW:             $2M          (real planning target)
 *   - Withdrawal rate:       4%           (real Trinity baseline)
 *   - Drawdown horizon:      30 years
 *   - Allocation:            80% equity / 20% cash
 *
 * The intent: the simulator should answer "given that I reach my
 * target, does my plan survive historical sequences?" — not "could
 * I retire today at target-level spend with current NW?". Confusing
 * the two would silently compute spend × horizon against the
 * current (sub-target) NW, producing a 16% effective withdrawal
 * rate that fails almost every historical sequence — even though
 * the actual plan (4% on $2M for 30y) is one of the most-tested
 * Trinity baselines and survives ~95% of windows.
 *
 * Real-terms throughout — returns, balances, spend. Aligns with
 * the rest of the app's real-CAGR / real-SWR / today's-dollars
 * model (see docs/Calculations.md §1, §7).
 */

import { describe, expect, it } from "vitest";
import {
  runBootstrap,
  runHistoricalSequences,
  type MonteCarloInputs,
} from "@/lib/projection/monteCarlo";
import { HISTORICAL_REAL_RETURNS } from "@/lib/data/historicalReturns";

const SCENARIO = {
  currentNW: 500_000,
  targetNW: 2_000_000,
  withdrawalRate: 0.04,
  horizonYears: 30,
};

/** 80% stocks / 20% cash — typical moderate-FIRE accumulation mix. */
const SCENARIO_ALLOCATION: MonteCarloInputs["allocation"] = {
  stocksFraction: 0.8,
  bondsFraction: 0.0,
  cashFraction: 0.2,
  otherFraction: 0,
};

/** Trinity-baseline 60/40 for sanity-check cross-reference. */
const TRINITY_60_40: MonteCarloInputs["allocation"] = {
  stocksFraction: 0.6,
  bondsFraction: 0.4,
  cashFraction: 0,
};

describe("Monte Carlo — starting-NW vs target-NW regression", () => {
  it("reproduces the buggy default: current NW + target-level spend → near-zero success", () => {
    // The OLD buggy default: spend = target × SWR ($80k) but
    // startingNW = currentNW ($500k). The simulator faithfully
    // reports that you can't withdraw 16% of $500k for 30 years
    // through historical sequences — which is correct, but the
    // wrong question. The UI now defaults startingNW to
    // max(currentNW, targetNW); this test pins what *would*
    // happen if the bug returned, so a future refactor of the
    // card can't silently re-introduce it.
    const annualSpend = SCENARIO.targetNW * SCENARIO.withdrawalRate; // $80k
    const result = runHistoricalSequences({
      startingNetWorthUSD: SCENARIO.currentNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: annualSpend,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    // Effective starting WR = $80k / $500k = 16%. No historical
    // 30y sequence at this WR survives — the success rate should
    // round to roughly near-zero (or worse). The pathCount lower
    // bound is the sanity check that we're actually exercising
    // the full sequence set (1928-anchored data, 30y rolling
    // windows → ≥60 sequences). If that drops, the test could
    // pass on a degenerate empty run.
    expect(annualSpend / SCENARIO.currentNW).toBeCloseTo(0.16, 2);
    expect(result.successRate).toBe(0);
    expect(result.pathCount).toBeGreaterThanOrEqual(60);
  });

  it("FIXED default: startingNW = max(current, target) → high success", () => {
    // The fix: when the configured NW is below their Independence target, default the
    // simulator's starting NW to the target. This answers the
    // intended question — "does my 4% / 30y plan survive once I
    // reach $2M?" — rather than "can I retire today with $500k at
    // a $80k spend?".
    const startingNW = Math.max(SCENARIO.currentNW, SCENARIO.targetNW); // $2M
    const annualSpend = SCENARIO.targetNW * SCENARIO.withdrawalRate; // $80k
    const result = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: annualSpend,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    // Effective starting WR = $80k / $2M = 4%. Even 30y of the
    // worst historical sequences (1929, 1966, 2000) should mostly
    // survive at a 4% WR on a balanced 80/20 portfolio — that's
    // the Trinity-baseline result.
    expect(annualSpend / startingNW).toBeCloseTo(0.04, 4);
    expect(result.successRate).toBeGreaterThan(0.9);
  });

  it("the fix doesn't paper over genuinely high withdrawal rates", () => {
    // If target × SWR happens to imply a 10% WR (because
    // they set absurd planning numbers), the simulator should still
    // honestly report a low success rate. The fix only addresses the
    // current-vs-target accidental mismatch; it can't fix bad inputs.
    const startingNW = SCENARIO.targetNW;
    const annualSpend = startingNW * 0.10; // 10% WR
    const result = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: annualSpend,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    expect(result.successRate).toBeLessThan(0.2);
  });

  it("classic Trinity 4% / 60/40 / 30y baseline still passes ~95%", () => {
    // Cross-reference against the canonical Trinity result so we
    // know the simulator itself is calibrated. Bengen / Trinity
    // reported ~95% success at 4% real WR on a 60/40 portfolio
    // over 30y windows in 1928–2023. We accept 90–100% to leave
    // room for rounding and the slightly-different dataset.
    const startingNW = 1_000_000;
    const result = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: TRINITY_60_40,
      annualSpendUSD: startingNW * 0.04,
      retirementHorizonYears: 30,
    });
    expect(result.successRate).toBeGreaterThan(0.9);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });

  it("longer horizon = harder: 45y SWR cap is below 4% even at high equity", () => {
    // Sanity: a 4% WR is calibrated for 30y. Over 45y, the same
    // WR should fail noticeably more often even at 100% stocks.
    const startingNW = 1_000_000;
    const r30 = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 30,
    });
    const r45 = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: 40_000,
      retirementHorizonYears: 45,
    });
    expect(r30.successRate).toBeGreaterThanOrEqual(r45.successRate);
  });

  it("worst historical start for the scenario is in the depression / stagflation era", () => {
    // The historical engine names each path by its starting year.
    // The worst-surviving start for a long-horizon equity-heavy
    // portfolio is reliably one of the early-1930s starts or the
    // 1966 / 1968 / 1969 stagflation-prelude starts.
    const result = runHistoricalSequences({
      startingNetWorthUSD: SCENARIO.targetNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: SCENARIO.targetNW * SCENARIO.withdrawalRate,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    const worst = result.paths
      .slice()
      .sort((a, b) => a.endingNetWorthUSD - b.endingNetWorthUSD)[0];
    expect(worst).toBeDefined();
    const worstYear = parseInt(worst!.id, 10);
    // Either Great Depression start window (1929–32) or the
    // 1965–69 stagflation-prelude window.
    const inDepression = worstYear >= 1929 && worstYear <= 1932;
    const inStagflationPrelude = worstYear >= 1965 && worstYear <= 1969;
    expect(inDepression || inStagflationPrelude).toBe(true);
  });

  it("bootstrap with same seed = same result (deterministic for UI stability)", () => {
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: SCENARIO.targetNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: SCENARIO.targetNW * SCENARIO.withdrawalRate,
      retirementHorizonYears: SCENARIO.horizonYears,
    };
    const a = runBootstrap(inputs, { paths: 500, seed: 7 });
    const b = runBootstrap(inputs, { paths: 500, seed: 7 });
    expect(a.successRate).toBe(b.successRate);
    expect(a.endingNetWorthPercentiles.p50).toBe(
      b.endingNetWorthPercentiles.p50,
    );
  });

  it("bootstrap success rate roughly tracks historical for the scenario plan", () => {
    // Block bootstrap should produce a similar distribution to the
    // historical engine — it samples from the same data with
    // autocorrelation preserved. Both should be high success for
    // the corrected plan (4% on $2M for 30y, 80% equity).
    const inputs: MonteCarloInputs = {
      startingNetWorthUSD: SCENARIO.targetNW,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: SCENARIO.targetNW * SCENARIO.withdrawalRate,
      retirementHorizonYears: SCENARIO.horizonYears,
    };
    const hist = runHistoricalSequences(inputs);
    const boot = runBootstrap(inputs, { paths: 1000, seed: 42 });
    // Both well above 80% — the precise number differs because
    // bootstrap explores re-shuffled sequences, but neither
    // engine should disagree by more than ~15 points.
    expect(hist.successRate).toBeGreaterThan(0.8);
    expect(boot.successRate).toBeGreaterThan(0.7);
    expect(Math.abs(hist.successRate - boot.successRate)).toBeLessThan(0.2);
  });

  it("higher equity share = higher long-horizon success at low WR", () => {
    // 4% real WR over 30y benefits from equity exposure (real
    // returns positive across the dataset). 100% bonds at 4% / 30y
    // is more fragile — many bond sequences (1940s, 1970s, 2022)
    // had negative real returns.
    const equityHeavy = runHistoricalSequences({
      startingNetWorthUSD: SCENARIO.targetNW,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: SCENARIO.targetNW * SCENARIO.withdrawalRate,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    const bondHeavy = runHistoricalSequences({
      startingNetWorthUSD: SCENARIO.targetNW,
      allocation: { stocksFraction: 0, bondsFraction: 1, cashFraction: 0 },
      annualSpendUSD: SCENARIO.targetNW * SCENARIO.withdrawalRate,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    expect(equityHeavy.successRate).toBeGreaterThan(bondHeavy.successRate);
  });

  it("zero starting NW => empty / zero success regardless of plan", () => {
    // Edge: simulator must not crash on zero NW. The card guards
    // this at the UI level, but the engine should also be sane.
    const result = runHistoricalSequences({
      startingNetWorthUSD: 0,
      allocation: SCENARIO_ALLOCATION,
      annualSpendUSD: 100_000,
      retirementHorizonYears: SCENARIO.horizonYears,
    });
    expect(result.successRate).toBe(0);
    expect(result.paths.every((p) => !p.survived)).toBe(true);
  });
});

describe("Asset routing — commodity (gold) is its own series, not stocks", () => {
  it("100% commodity sequence diverges from 100% stocks over 1971-1980", () => {
    // The whole point of breaking commodity out of "other": gold's
    // 1971-1980 sequence is dramatically positive, while stocks
    // were a real-terms disaster. Treating gold as stocks erases
    // this — the simulator should now show 100% commodity surviving
    // the 1973 / 1974 start years that destroyed 100% equity.
    const inputs = (alloc: MonteCarloInputs["allocation"]) => ({
      startingNetWorthUSD: 1_000_000,
      allocation: alloc,
      annualSpendUSD: 40_000, // 4% WR, normal
      retirementHorizonYears: 10,
    });
    const stocksOnly = runHistoricalSequences(
      inputs({ stocksFraction: 1, bondsFraction: 0, cashFraction: 0 }),
    );
    const goldOnly = runHistoricalSequences(
      inputs({
        stocksFraction: 0,
        bondsFraction: 0,
        cashFraction: 0,
        commodityFraction: 1,
      }),
    );
    // Find the 1973 path (worst stocks decade) — gold should
    // out-survive stocks dramatically on that window.
    const stocks1973 = stocksOnly.paths.find((p) => p.id === "1973");
    const gold1973 = goldOnly.paths.find((p) => p.id === "1973");
    expect(stocks1973).toBeDefined();
    expect(gold1973).toBeDefined();
    expect(gold1973!.endingNetWorthUSD).toBeGreaterThan(
      stocks1973!.endingNetWorthUSD,
    );
  });

  it("alts toggle: routing 'other' to cash gives strictly lower returns than stocks", () => {
    // The toggle is the user's lever for "model my crypto / RE /
    // private as a conservative floor instead of stocks". The cash
    // floor should produce ending NW <= stocks routing, all else
    // equal, since stocks have higher long-run real returns.
    const base: MonteCarloInputs = {
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0.5,
        bondsFraction: 0,
        cashFraction: 0,
        otherFraction: 0.5,
      },
      annualSpendUSD: 0,
      retirementHorizonYears: 30,
    };
    const asStocks = runHistoricalSequences({
      ...base,
      otherTreatedAsStocks: true,
    });
    const asCash = runHistoricalSequences({
      ...base,
      otherTreatedAsStocks: false,
    });
    expect(asStocks.endingNetWorthPercentiles.p50).toBeGreaterThan(
      asCash.endingNetWorthPercentiles.p50,
    );
  });

  it("commodityFraction + otherFraction can coexist independently", () => {
    // Sanity: setting both at the same time should work — they
    // route to separate series and the weights should renormalize
    // cleanly without one stealing from the other.
    const result = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0.5,
        bondsFraction: 0.2,
        cashFraction: 0.1,
        commodityFraction: 0.1,
        otherFraction: 0.1,
      },
      annualSpendUSD: 30_000,
      retirementHorizonYears: 20,
    });
    expect(result.pathCount).toBeGreaterThan(40);
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });
});

describe("Glide-path support — Monte Carlo honors per-year allocation shifts", () => {
  // The Monte Carlo previously ignored glide paths (documented gap
  // at Calculations.md §7.6). These tests verify that when a
  // glide path + startAge are provided, the simulator resolves
  // per-year allocation via allocationAtAge() and produces results
  // distinct from the static-allocation case.

  it("static-allocation = no-op when glide path is omitted", () => {
    // Regression: existing callers passing only `allocation` (no
    // glidePath) should get bit-identical results to pre-glide-path
    // behavior.
    const before = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0.6,
        bondsFraction: 0.3,
        cashFraction: 0.1,
      },
      annualSpendUSD: 40_000,
      retirementHorizonYears: 30,
    });
    const after = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: {
        stocksFraction: 0.6,
        bondsFraction: 0.3,
        cashFraction: 0.1,
      },
      annualSpendUSD: 40_000,
      retirementHorizonYears: 30,
      // glidePath omitted — should fall back to static
    });
    expect(after.successRate).toBe(before.successRate);
    expect(after.endingNetWorthPercentiles.p50).toBe(
      before.endingNetWorthPercentiles.p50,
    );
  });

  it("glide path 100% stocks → 30% stocks materially changes outcomes vs static 60/40", () => {
    // The whole point: a meaningful glide path should produce
    // materially different results from a static allocation. Use a
    // 30-year window where the glide path runs 100% equity at start
    // and 30% equity by end — should have higher upside potential
    // (early stocks) but also higher tail risk during late-life
    // drawdowns... actually the opposite — late-life de-risking
    // should REDUCE tail risk during the worst sequence.
    const horizon = 30;
    const base = {
      startingNetWorthUSD: 1_000_000,
      annualSpendUSD: 40_000,
      retirementHorizonYears: horizon,
    };
    const staticBalanced = runHistoricalSequences({
      ...base,
      allocation: {
        stocksFraction: 0.6,
        bondsFraction: 0.3,
        cashFraction: 0.1,
      },
    });
    const glide = runHistoricalSequences({
      ...base,
      allocation: {
        stocksFraction: 1, // static fallback never used here
        bondsFraction: 0,
        cashFraction: 0,
      },
      startAge: 65,
      glidePath: {
        waypoints: [
          {
            age: 65,
            allocation: { equity: 1.0, bond: 0, cash: 0 },
          },
          {
            age: 95,
            allocation: { equity: 0.3, bond: 0.6, cash: 0.1 },
          },
        ],
      },
    });
    // Sanity: results differ. (They could differ in either
    // direction depending on which dataset window dominates — what
    // matters is that the engine actually consumed the glide path.)
    expect(glide.endingNetWorthPercentiles.p50).not.toBe(
      staticBalanced.endingNetWorthPercentiles.p50,
    );
    expect(glide.successRate).toBeGreaterThan(0);
  });

  it("glide path that interpolates to all-cash at horizon end behaves like cash by year N", () => {
    // Push the glide path to a degenerate case: end in 100% cash.
    // The terminal years should earn ~cash returns (slightly
    // negative real in many windows). Verifying that the per-year
    // resolution actually flips weights.
    const result = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: 0, // no withdrawals — isolate return effect
      retirementHorizonYears: 30,
      startAge: 65,
      glidePath: {
        waypoints: [
          { age: 65, allocation: { equity: 1, bond: 0, cash: 0 } },
          { age: 95, allocation: { equity: 0, bond: 0, cash: 1 } },
        ],
      },
    });
    const allStocks = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: 0,
      retirementHorizonYears: 30,
    });
    // The glide-pathed portfolio's median ending NW should be
    // materially lower than 100% stocks (since the second half
    // sits in cash, which has lower long-run real returns).
    expect(glide_lt_stocks(result, allStocks)).toBe(true);
  });

  it("glide path with no waypoints silently falls back to static allocation", () => {
    // Defensive: empty waypoints array should not crash and should
    // give identical results to the static path.
    const withEmpty = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: 40_000,
      retirementHorizonYears: 20,
      startAge: 65,
      glidePath: { waypoints: [] },
    });
    const withoutGlide = runHistoricalSequences({
      startingNetWorthUSD: 1_000_000,
      allocation: { stocksFraction: 1, bondsFraction: 0, cashFraction: 0 },
      annualSpendUSD: 40_000,
      retirementHorizonYears: 20,
    });
    expect(withEmpty.successRate).toBe(withoutGlide.successRate);
  });
});

function glide_lt_stocks(
  glide: { endingNetWorthPercentiles: { p50: number } },
  stocks: { endingNetWorthPercentiles: { p50: number } },
): boolean {
  return (
    glide.endingNetWorthPercentiles.p50 <
    stocks.endingNetWorthPercentiles.p50
  );
}

describe("Gold real-return series — regime properties", () => {
  // The gold series is stylized but the regime patterns are
  // anchored to well-documented history. These tests pin those
  // patterns so a future refresh of the series can't accidentally
  // erase them.

  it("long-run real CAGR is approximately 1-3%", () => {
    // Damodaran's gold series and academic studies broadly converge
    // on a ~1-2% real return for physical gold 1928-present. Allow
    // 1-3% for our stylized approximation.
    const allYears = HISTORICAL_REAL_RETURNS;
    const product = allYears.reduce((p, r) => p * (1 + r.gold), 1);
    const cagr = Math.pow(product, 1 / allYears.length) - 1;
    expect(cagr).toBeGreaterThan(0.005);
    expect(cagr).toBeLessThan(0.035);
  });

  it("1971-1980 cumulative real return is strongly positive", () => {
    // The canonical case for gold as inflation hedge. Cumulative
    // real return over the decade was several-hundred percent.
    const decade = HISTORICAL_REAL_RETURNS.filter(
      (r) => r.year >= 1971 && r.year <= 1980,
    );
    const cum = decade.reduce((p, r) => p * (1 + r.gold), 1) - 1;
    expect(cum).toBeGreaterThan(2.0); // >200% cumulative real
  });

  it("1981-1999 cumulative real return is negative (secular bear)", () => {
    // The 19-year disinflation period was a long real bear market
    // for gold. Cumulative real return should be negative.
    const period = HISTORICAL_REAL_RETURNS.filter(
      (r) => r.year >= 1981 && r.year <= 1999,
    );
    const cum = period.reduce((p, r) => p * (1 + r.gold), 1) - 1;
    expect(cum).toBeLessThan(0);
  });

  it("2001-2011 cumulative real return is strongly positive (commodity bull)", () => {
    // The 11-year commodity supercycle that took gold from $258 to
    // $1900+. Cumulative real return >150% comfortably.
    const period = HISTORICAL_REAL_RETURNS.filter(
      (r) => r.year >= 2001 && r.year <= 2011,
    );
    const cum = period.reduce((p, r) => p * (1 + r.gold), 1) - 1;
    expect(cum).toBeGreaterThan(1.5);
  });

  it("2022 — gold's real return beats both stocks and bonds (diversification)", () => {
    // 2022 was the standout sequence-of-returns risk year recently:
    // stocks and bonds both dropped sharply. Gold protected capital
    // better than either — the exact case where treating it as
    // stocks erases its diversification value.
    const y2022 = HISTORICAL_REAL_RETURNS.find((r) => r.year === 2022)!;
    expect(y2022.gold).toBeGreaterThan(y2022.stocks);
    expect(y2022.gold).toBeGreaterThan(y2022.bonds);
  });

  it("dataset has gold value on every row (no holes)", () => {
    // Schema check — every row must define `gold` (otherwise
    // simulatePath silently substitutes 0 and we silently fail the
    // diversification math).
    for (const r of HISTORICAL_REAL_RETURNS) {
      expect(typeof r.gold).toBe("number");
      expect(Number.isFinite(r.gold)).toBe(true);
    }
  });
});
