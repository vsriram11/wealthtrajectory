/**
 * Historical-sequence Monte Carlo for retirement-plan stress
 * testing.
 *
 * The standard 4% rule (Trinity 1998) was derived by walking
 * actual historical 30-year retirement windows and reporting
 * the highest withdrawal rate that survived each starting year.
 * This module re-runs that analysis against the user's specific
 * portfolio mix, starting net worth, contribution schedule, and
 * spend plan — instead of the canonical 60/40 equity/bond
 * portfolio with constant inflation-adjusted withdrawals.
 *
 * Why this matters beyond what the deterministic projection
 * shows:
 *
 *   - A single real-CAGR + real-SWR projection assumes smooth
 *     average returns. Real markets aren't smooth. The worst
 *     30-year window for a 60/40 portfolio (1929 start, or
 *     1966 start with stagflation) survives a very different
 *     SWR than the 1982 start.
 *
 *   - "Sequence of returns" risk: a portfolio that earns the
 *     same arithmetic average return can succeed or fail
 *     depending on WHEN the bad years hit. Bad early years
 *     while withdrawing are catastrophic; bad late years are
 *     survivable. The single-CAGR engine can't see this.
 *
 *   - Healthcare / housing / variable-spend overrides from the
 *     real-excess inflation system already shift the corpus
 *     bar. This engine tests whether the configured plan
 *     would have survived each historical regime.
 *
 * Two engines:
 *   1. `runHistoricalSequences`: walks every actual historical
 *      starting year, deterministic. Closest to what cfiresim
 *      does. Conservative — uses real data, not random sampling.
 *   2. `runBootstrap`: random sampling with replacement from
 *      the historical dataset (block-resampled to preserve
 *      year-to-year autocorrelation). Generates wider distributions
 *      and lets us run more paths than the ~67 historical 30y
 *      windows allow.
 *
 * Both produce the same shape of result (`MonteCarloResult`) so
 * the UI can switch modes without re-implementing display.
 *
 * Real-terms throughout. Returns are real, withdrawals are real,
 * starting NW is today's dollars. Aligns with the rest of the
 * app's projection model.
 */

import {
  HISTORICAL_REAL_RETURNS,
  type AnnualRealReturns,
} from "@/lib/data/historicalReturns";
import { allocationAtAge, type GlidePath } from "@/lib/portfolio/glidePath";

/**
 * Per-year inputs to the simulator. All values in today's-dollars
 * REAL terms. The simulator does NOT inflate dollar amounts year-
 * over-year because everything is already real.
 */
export type MonteCarloInputs = {
  /** Starting portfolio value (real $). */
  startingNetWorthUSD: number;
  /**
   * Asset-class mix as fractions summing (approximately) to 1.
   * Cash includes T-bills and money-market.
   *
   * `commodityFraction` is treated as physical gold — the dataset
   * carries a gold real-return series and most retirement-portfolio
   * commodity exposure (GLD/IAU/SGOL/GLDM/PHYS, plus the metals
   * legs of multi-asset wrappers) is gold-dominated. Other metals
   * (silver, copper, industrial) are routed through the same gold
   * series as a stand-in pending a per-metal dataset extension; the
   * UI surfaces this as a known approximation.
   *
   * `realEstateFraction` is routed to Damodaran's residential
   * real-estate price-return series. Price return only (no rental
   * yield), so it understates leveraged-rental performance — a
   * known approximation. Better than dumping RE into stocks.
   *
   * `otherFraction` covers crypto, private stock, and "other" alts.
   * The simulator can route these to either stocks or cash via
   * `otherTreatedAsStocks` (default stocks). Crypto has too little
   * history to fit a 1928-anchored simulator natively, and private
   * stock is idiosyncratic enough that approximating it as stocks
   * vs cash is honest about the modeling gap.
   */
  allocation: {
    stocksFraction: number;
    bondsFraction: number;
    cashFraction: number;
    /** Routed to the gold real-return series (1928–present). */
    commodityFraction?: number;
    /** Routed to Damodaran's residential RE price-return series. */
    realEstateFraction?: number;
    /** Crypto + private stock + other alts. */
    otherFraction?: number;
  };
  /**
   * Annual real spending (after retirement). The simulator
   * withdraws this each year, regardless of portfolio value.
   * The portfolio may run out — that's the "failure" mode the
   * success rate tracks.
   *
   * When `spending` (below) is provided, this MUST be the
   * NO-HAIRCUT total — the simulator applies the haircut
   * in-loop. When `spending` is omitted, this is the literal
   * withdrawal amount used each year (preserves pre-feature
   * behavior for callers that bake the haircut upstream).
   */
  annualSpendUSD: number;
  /**
   * Optional dynamic-spending config. When provided, the
   * simulator computes per-year withdrawal as
   *   `annualSpendUSD - variableUSD * realizedHaircutThisYear`
   * where `realizedHaircutThisYear` is:
   *   - `haircut.rate` always (when `onlyAfterDownYear === false`),
   *   - `haircut.rate` only in retirement years where the prior
   *     year's stock return was < 0 (when `onlyAfterDownYear ===
   *     true`); 0 in year 0 of any path (no prior year), and
   *   - 0 outside retirement (haircut is a retirement concept).
   *
   * The "down-year guardrail" (a.k.a. dynamic-spending /
   * Guyton-Klinger style) mode has higher EXPECTED lifestyle
   * than always-apply because it preserves spending in good
   * years, but lower survival % for the same `rate` because
   * average withdrawals are larger. Sizing helpers compensate
   * via `effectiveHaircut(rate, onlyAfterDownYear)` so the
   * suggested corpus tracks the realized average.
   */
  spending?: {
    variableUSD: number;
    haircut: { rate: number; onlyAfterDownYear: boolean };
  };
  /**
   * Optional pre-retirement contribution. Modeled as positive
   * cash flow each year of pre-retirement (real $).
   */
  annualContributionUSD?: number;
  /**
   * Years until retirement begins. During this phase, the
   * portfolio earns returns + receives contributions, no
   * withdrawals.
   */
  yearsUntilRetirement?: number;
  /**
   * Years of retirement to simulate. Trinity convention: 30.
   * Longer for early retirees.
   */
  retirementHorizonYears: number;
  /**
   * If a holding is in the "other" bucket (real estate, crypto,
   * commodities, alts), should it earn the stocks return or the
   * cash return? Defaults to stocks — most "other" in retirement
   * portfolios is real estate equity or alts that track equity
   * over long horizons.
   */
  otherTreatedAsStocks?: boolean;
  /**
   * Optional per-year income offset (real $). Index `y` carries
   * the household's total inflowing income in year `y` of the
   * simulation, summed across all configured income streams
   * (consulting, pension, Social Security, rental, etc.). The
   * simulator ADDS this to cash flow each year — during
   * accumulation it boosts contributions; during retirement it
   * offsets withdrawals one-for-one.
   *
   * Pre-compute via `incomePerYearUSD(streams, baseYear,
   * totalYears)` at the call site so the simulator stays
   * stream-agnostic.
   *
   * Length should match `totalYears = yearsUntilRetirement +
   * retirementHorizonYears`. Indexes past the array length
   * (defensive) read as 0 — the simulator treats undefined as
   * "no income that year."
   */
  incomePerYearUSD?: number[];
  /**
   * Optional asset-allocation glide path — a set of {age, allocation}
   * waypoints. When provided alongside `startAge`, the simulator
   * resolves the per-year allocation via linear interpolation on the
   * waypoints (`allocationAtAge(glidePath, startAge + y)`) instead
   * of using the static `allocation` field. The static `allocation`
   * is still required as a fallback (in case the glide path has no
   * waypoints or doesn't cover an age) and as the displayed "current"
   * mix in UIs.
   *
   * Caveats:
   *   - Member age advances year-by-year from `startAge`. For
   *     multi-member households, pass the planner-relevant member's
   *     age (typically the older spouse, since they hit retirement
   *     ages first).
   *   - Per-year allocations are renormalized to sum to 1 the same
   *     way the static path is, so glide paths that don't sum to 1
   *     exactly still work.
   *   - This closes the gap previously documented at §7.6 of
   *     Calculations.md.
   */
  glidePath?: GlidePath;
  /**
   * Member age at the START of the simulation (year 0). Required
   * when `glidePath` is provided. Ignored otherwise.
   */
  startAge?: number;
};

export type SimulationOptions = {
  /** Historical dataset to draw from. Defaults to HISTORICAL_REAL_RETURNS. */
  dataset?: readonly AnnualRealReturns[];
  /**
   * Annual rebalancing — re-set the allocation each year before
   * applying returns. Default true (most retirement plans assume
   * rebalancing).
   */
  rebalance?: boolean;
};

export type BootstrapOptions = SimulationOptions & {
  /** Number of bootstrap paths to generate. Default 1000. */
  paths?: number;
  /**
   * Block size for resampling — preserves short-run autocorrelation
   * (a year of bad returns is often followed by another bad year).
   * Set to 1 for purely IID sampling. Default 5.
   */
  blockSize?: number;
  /** PRNG seed for reproducibility (deterministic tests). */
  seed?: number;
};

/**
 * Result of a single simulated retirement (one starting year for
 * historical sequence, one path for bootstrap).
 */
export type SimulationPath = {
  /** Identifier — year for historical, path index for bootstrap. */
  id: string;
  /** Year-by-year portfolio value, real $. Index 0 = starting NW. */
  trajectory: number[];
  /** Final portfolio value, real $. */
  endingNetWorthUSD: number;
  /** True if the portfolio survived the full horizon (NW > 0 throughout). */
  survived: boolean;
  /** Year index (0-based, from start of simulation) when NW first went ≤ 0. -1 if survived. */
  failedAtYear: number;
};

export type MonteCarloResult = {
  /** All simulated paths, in order. */
  paths: SimulationPath[];
  /** Fraction of paths that survived the full horizon (0–1). */
  successRate: number;
  /**
   * Percentile bands over ending net worth. Useful for "what's
   * your worst case / median / best case" display.
   */
  endingNetWorthPercentiles: {
    p1: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /**
   * Percentile bands over each year's portfolio value (real $).
   * Each array has length `retirementHorizonYears +
   * yearsUntilRetirement + 1`. Used to render fan-chart trajectories.
   *
   * p1 is included for users who want a deeper tail than p5 — the
   * UI exposes "≤p1" as a downside-zoom view on the historical-MC
   * fan chart, useful for risk-averse users sizing for the 99th-
   * worst window.
   */
  yearlyPercentiles: {
    years: number[];
    p1: number[];
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  };
  /** Total simulated paths. */
  pathCount: number;
  /** Years simulated per path (pre-retirement + retirement). */
  totalYears: number;
};

/* ============================================================ */
/* Core single-path simulator                                    */
/* ============================================================ */

/**
 * Run one retirement path given a stream of annual real returns
 * for stocks / bonds / cash. The return arrays must be at least
 * `(yearsUntilRetirement + retirementHorizonYears)` long.
 *
 * Pre-retirement phase: portfolio grows + annual contribution.
 * Retirement phase: portfolio grows - annual spend.
 *
 * Annual rebalancing applies the configured allocation BEFORE
 * each year's returns are realized. Without rebalancing, the
 * mix drifts (stocks usually dominate over decades).
 */
/**
 * Pure helper: take an asset-allocation spec (the user's static
 * allocation or a glide-path resolved allocation for a particular
 * age) and map it to the simulator's five return-series buckets.
 * Returns normalized weights summing to 1, with the "other" bucket
 * routed to stocks or cash per `otherIsStock`.
 *
 * Shared between the static-allocation and glide-path code paths
 * inside simulatePath, so both produce identical weights for
 * identical input specs — the glide path is just "compute the
 * spec per year" while the static path uses the same spec every
 * year.
 */
function resolveWeights(
  spec: MonteCarloInputs["allocation"],
  otherIsStock: boolean,
): { wS: number; wB: number; wC: number; wG: number; wR: number } {
  const otherFrac = Math.max(0, spec.otherFraction ?? 0);
  const stocksW =
    Math.max(0, spec.stocksFraction) + (otherIsStock ? otherFrac : 0);
  const bondsW = Math.max(0, spec.bondsFraction);
  const cashW =
    Math.max(0, spec.cashFraction) + (otherIsStock ? 0 : otherFrac);
  const goldW = Math.max(0, spec.commodityFraction ?? 0);
  const reW = Math.max(0, spec.realEstateFraction ?? 0);
  const total = stocksW + bondsW + cashW + goldW + reW;
  if (total <= 0) return { wS: 0, wB: 0, wC: 0, wG: 0, wR: 0 };
  return {
    wS: stocksW / total,
    wB: bondsW / total,
    wC: cashW / total,
    wG: goldW / total,
    wR: reW / total,
  };
}

export function simulatePath(
  inputs: MonteCarloInputs,
  stockReturns: number[],
  bondReturns: number[],
  cashReturns: number[],
  goldReturns: number[],
  realEstateReturns: number[],
  pathId: string,
  options: SimulationOptions = {},
): SimulationPath {
  const rebalance = options.rebalance ?? true;
  const yearsPre = inputs.yearsUntilRetirement ?? 0;
  const yearsRet = inputs.retirementHorizonYears;
  const totalYears = yearsPre + yearsRet;
  const otherIsStock = inputs.otherTreatedAsStocks ?? true;

  // Pre-compute the static weights as a fallback (used when there's
  // no glide path, and also when the glide path can't resolve for
  // a given age).
  const staticWeights = resolveWeights(inputs.allocation, otherIsStock);

  // Per-year weight resolver — honors glide path when present.
  const useGlide =
    inputs.glidePath != null &&
    inputs.glidePath.waypoints.length > 0 &&
    inputs.startAge != null;
  const weightsForYear = (y: number) => {
    if (!useGlide) return staticWeights;
    const age = (inputs.startAge as number) + y;
    const alloc = allocationAtAge(
      inputs.glidePath as GlidePath,
      age,
    );
    if (!alloc) return staticWeights;
    return resolveWeights(
      {
        stocksFraction: alloc.equity ?? 0,
        bondsFraction: alloc.bond ?? 0,
        cashFraction: alloc.cash ?? 0,
        commodityFraction: alloc.commodity ?? 0,
        realEstateFraction: alloc.real_estate ?? 0,
        otherFraction:
          (alloc.crypto ?? 0) +
          (alloc.private_stock ?? 0) +
          (alloc.other ?? 0),
      },
      otherIsStock,
    );
  };

  // Trajectory: portfolio value at start of each year (index 0
  // = year 0 = starting NW).
  const trajectory: number[] = [Math.max(0, inputs.startingNetWorthUSD)];
  let nw = trajectory[0];
  let failedAtYear = -1;

  for (let y = 0; y < totalYears; y++) {
    // Annual rebalancing — snap to target weights. Non-rebalancing
    // mode in this lightweight engine still uses target weights at
    // each year (we don't track per-class balance drift over time),
    // so `rebalance: false` collapses to the same blended-return
    // path. Documented in §7.6 of docs/Calculations.md.
    void rebalance;
    const { wS, wB, wC, wG, wR } = weightsForYear(y);
    let sB = nw * wS;
    let bB = nw * wB;
    let cB = nw * wC;
    let gB = nw * wG;
    let rB = nw * wR;

    // Apply this year's real returns.
    const rs = stockReturns[y] ?? 0;
    const rb = bondReturns[y] ?? 0;
    const rc = cashReturns[y] ?? 0;
    const rg = goldReturns[y] ?? 0;
    const rr = realEstateReturns[y] ?? 0;
    sB *= 1 + rs;
    bB *= 1 + rb;
    cB *= 1 + rc;
    gB *= 1 + rg;
    rB *= 1 + rr;

    const nwAfterReturns = sB + bB + cB + gB + rB;

    // Cash flows happen at mid-year — matches the deterministic
    // `projectIndependence` engine's monthly compounding (each monthly
    // contribution earns ~half a year of returns on average) and
    // the standard actuarial convention. The closed-form
    // approximation is:
    //   nw_eoy = nw_soy * (1 + r)  +  cf_signed * (1 + r/2)
    // where r is the realized blended return for the year. We
    // derive r from the per-class accounting we just did, which
    // handles weight normalization correctly even when classes
    // were missing from the allocation.
    //
    // Sign convention: positive cf for contributions, negative for
    // spend. In a -10% year, $40k spent at mid-year drops NW by
    // $40k × (1 − 0.05) = $38k — you avoid the second half of
    // the drawdown on the money you withdrew. This is correct.
    const rImplied = nw > 0 ? (nwAfterReturns - nw) / nw : 0;

    // Dynamic-spending haircut. In retirement years (y >= yearsPre)
    // this can drop the variable-expense portion of the withdrawal
    // when the configured rule fires:
    //   - always-apply (the historical contract): take the haircut
    //     every retirement year.
    //   - down-year-only: take it only when stocks[y-1] < 0.
    //     Year 0 of any path has no prior year, so it never fires.
    // Outside retirement, the haircut is irrelevant — pre-retirement
    // is contribution/no-withdrawal.
    let withdrawal = inputs.annualSpendUSD;
    if (inputs.spending && y >= yearsPre) {
      const { variableUSD, haircut } = inputs.spending;
      const fires = haircut.onlyAfterDownYear
        ? y > 0 && (stockReturns[y - 1] ?? 0) < 0
        : true;
      if (fires) withdrawal -= variableUSD * haircut.rate;
    }

    // Per-year income offset (consulting, pension, Social
    // Security, rental). Real dollars; ADDED to cash flow each
    // year. Defensive ?? 0 in case the array is shorter than
    // totalYears (e.g. early termination upstream).
    const income = inputs.incomePerYearUSD?.[y] ?? 0;
    const cf =
      y < yearsPre
        ? (inputs.annualContributionUSD ?? 0) + income
        : -withdrawal + income;
    nw = nwAfterReturns + cf * (1 + rImplied / 2);

    if (nw <= 0) {
      nw = 0;
      if (failedAtYear === -1) failedAtYear = y + 1;
    }
    trajectory.push(nw);
  }

  return {
    id: pathId,
    trajectory,
    endingNetWorthUSD: nw,
    survived: failedAtYear === -1,
    failedAtYear,
  };
}

/* ============================================================ */
/* Historical-sequence engine                                    */
/* ============================================================ */

/**
 * Walk every viable historical starting year and run the user's
 * plan against actual sequences. "Viable" = dataset has at least
 * `totalYears` of returns from that start.
 *
 * For a 30y retirement against the 1928–2023 dataset, this
 * produces 67 paths (1928→1957, 1929→1958, …, 1994→2023). Each
 * is a real historical regime — including all the worst
 * sequences ever recorded.
 */
export function runHistoricalSequences(
  inputs: MonteCarloInputs,
  options: SimulationOptions = {},
): MonteCarloResult {
  const dataset = options.dataset ?? HISTORICAL_REAL_RETURNS;
  const yearsPre = inputs.yearsUntilRetirement ?? 0;
  const totalYears = yearsPre + inputs.retirementHorizonYears;
  if (totalYears <= 0) {
    return emptyResult(totalYears);
  }
  const paths: SimulationPath[] = [];
  for (let startIdx = 0; startIdx + totalYears <= dataset.length; startIdx++) {
    const slice = dataset.slice(startIdx, startIdx + totalYears);
    const stocks = slice.map((r) => r.stocks);
    const bonds = slice.map((r) => r.bonds);
    const cash = slice.map((r) => r.cash);
    const gold = slice.map((r) => r.gold);
    const re = slice.map((r) => r.realEstate);
    paths.push(
      simulatePath(
        inputs,
        stocks,
        bonds,
        cash,
        gold,
        re,
        String(slice[0].year),
        options,
      ),
    );
  }
  return summarize(paths, totalYears);
}

/* ============================================================ */
/* Bootstrap (block resampling) engine                           */
/* ============================================================ */

/**
 * Simple PRNG (mulberry32). Deterministic given a seed. Used so
 * tests can pin bootstrap results.
 */
function makePrng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Block-resample the historical dataset to generate one path's
 * worth of annual returns. Block size preserves short-run
 * autocorrelation (a Great Depression year is often followed
 * by another bad year — pure IID sampling would erase that).
 */
function sampleBlockBootstrap(
  totalYears: number,
  dataset: readonly AnnualRealReturns[],
  blockSize: number,
  rand: () => number,
): {
  stocks: number[];
  bonds: number[];
  cash: number[];
  gold: number[];
  realEstate: number[];
} {
  const stocks: number[] = [];
  const bonds: number[] = [];
  const cash: number[] = [];
  const gold: number[] = [];
  const realEstate: number[] = [];
  while (stocks.length < totalYears) {
    const startIdx = Math.floor(rand() * dataset.length);
    for (
      let i = 0;
      i < blockSize && stocks.length < totalYears;
      i++
    ) {
      const r = dataset[(startIdx + i) % dataset.length];
      stocks.push(r.stocks);
      bonds.push(r.bonds);
      cash.push(r.cash);
      gold.push(r.gold);
      realEstate.push(r.realEstate);
    }
  }
  return { stocks, bonds, cash, gold, realEstate };
}

export function runBootstrap(
  inputs: MonteCarloInputs,
  options: BootstrapOptions = {},
): MonteCarloResult {
  const dataset = options.dataset ?? HISTORICAL_REAL_RETURNS;
  const paths = options.paths ?? 1000;
  const blockSize = Math.max(1, options.blockSize ?? 5);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = makePrng(seed);
  const yearsPre = inputs.yearsUntilRetirement ?? 0;
  const totalYears = yearsPre + inputs.retirementHorizonYears;
  if (totalYears <= 0 || paths <= 0) {
    return emptyResult(totalYears);
  }
  const out: SimulationPath[] = [];
  for (let i = 0; i < paths; i++) {
    const { stocks, bonds, cash, gold, realEstate } = sampleBlockBootstrap(
      totalYears,
      dataset,
      blockSize,
      rand,
    );
    out.push(
      simulatePath(
        inputs,
        stocks,
        bonds,
        cash,
        gold,
        realEstate,
        `bootstrap-${i}`,
        options,
      ),
    );
  }
  return summarize(out, totalYears);
}

/* ============================================================ */
/* Aggregation helpers                                           */
/* ============================================================ */

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function summarize(
  paths: SimulationPath[],
  totalYears: number,
): MonteCarloResult {
  if (paths.length === 0) return emptyResult(totalYears);

  const survivors = paths.filter((p) => p.survived).length;
  const successRate = survivors / paths.length;

  const endings = paths
    .map((p) => p.endingNetWorthUSD)
    .slice()
    .sort((a, b) => a - b);

  // Per-year percentile bands across all paths.
  const yearsArr: number[] = [];
  const p1: number[] = [];
  const p5: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p95: number[] = [];
  for (let y = 0; y <= totalYears; y++) {
    yearsArr.push(y);
    const slice = paths
      .map((p) => p.trajectory[y] ?? 0)
      .slice()
      .sort((a, b) => a - b);
    p1.push(percentile(slice, 1));
    p5.push(percentile(slice, 5));
    p25.push(percentile(slice, 25));
    p50.push(percentile(slice, 50));
    p75.push(percentile(slice, 75));
    p95.push(percentile(slice, 95));
  }

  return {
    paths,
    successRate,
    endingNetWorthPercentiles: {
      p1: percentile(endings, 1),
      p5: percentile(endings, 5),
      p25: percentile(endings, 25),
      p50: percentile(endings, 50),
      p75: percentile(endings, 75),
      p95: percentile(endings, 95),
    },
    yearlyPercentiles: {
      years: yearsArr,
      p1,
      p5,
      p25,
      p50,
      p75,
      p95,
    },
    pathCount: paths.length,
    totalYears,
  };
}

function emptyResult(totalYears: number): MonteCarloResult {
  return {
    paths: [],
    successRate: 0,
    endingNetWorthPercentiles: { p1: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
    yearlyPercentiles: {
      years: [],
      p1: [],
      p5: [],
      p25: [],
      p50: [],
      p75: [],
      p95: [],
      },
    pathCount: 0,
    totalYears,
  };
}
