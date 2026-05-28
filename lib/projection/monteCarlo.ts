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
    /**
     * Fraction allocated to a 2x daily-reset S&P 500 LETF
     * (SSO / SPUU / QLD by ticker recognition; see
     * `RECOGNIZED_2X_EQUITY_TICKERS` in
     * `lib/data/historicalReturns.ts`). Routed to the dataset's
     * `stocks2x` real-return series — which is RYTNX-derived
     * for 2001+ and formula-projected for 1928-2000.
     *
     * Note: `stocksFraction` and `stocks2xFraction` are
     * non-overlapping. Portfolio aggregation should put each
     * holding into exactly one bucket. Sum-to-1 with the other
     * fractions still holds.
     */
    stocks2xFraction?: number;
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
    /**
     * Fixed-nominal SORR-mitigation: freeze withdrawals at the
     * NOMINAL year-0 amount for the first `fixedNominalYears`
     * retirement years, instead of inflating with the cost of
     * living. Translated into the real-terms engine, this means
     * the effective real withdrawal in retirement-year y is
     *   annualSpendUSD / (1 + assumedInflationRate) ** y
     * for y ∈ [0, fixedNominalYears), then snaps back to the
     * full `annualSpendUSD` in real terms thereafter. The cut
     * deepens linearly: y0 takes the full real withdrawal, y1
     * takes ~97% of it (at 3% inflation), …, y9 takes ~76%. Over
     * a 10-year freeze the cumulative real shrinkage is ~14%
     * of one year's spend — meaningful sequence-of-returns risk
     * relief when applied during the early-retirement danger zone.
     *
     * Composes with the variable-haircut feature: the freeze
     * scales the BASE spend; the haircut subtracts the variable
     * slice. Both can be active simultaneously.
     *
     * Default behavior: no freeze (0 years). Set `years` > 0 +
     * a sensible `assumedInflationRate` (typically 0.025-0.035
     * for the US — match the household's expectedInflationRate
     * assumption for consistency) to turn it on.
     *
     * Reference: SORR-mitigation strategy with documented
     * efficacy in lean-FIRE / long-horizon plans (10y freeze
     * adds ~3-4 percentage points to historical success rate
     * for the canonical $1M / $40k / 45y lean baseline).
     */
    fixedNominalFreeze?: {
      years: number;
      assumedInflationRate: number;
    };
    /**
     * Cash-bucket priority: when true, retirement-year
     * withdrawals come from CASH FIRST (drained up to what's
     * available) before spilling proportionally to non-cash
     * classes. Models the "cash reserve" / "bond tent" SORR
     * mitigation discussed in Pfau / Kitces literature.
     *
     * Orthogonal to the rebalance policy:
     *   - `rebalance: "annual"` + this flag: cash gets refilled
     *     at each year-start snap → ongoing SORR shield
     *     (Kitces "refilling reserve" interpretation).
     *   - `rebalance: "none"` + this flag: cash is NEVER refilled
     *     by rebalance → depleting SORR shield, finite protection
     *     for the early-retirement danger zone (Pfau "depleting
     *     reserve" interpretation; user's intuition that bucket
     *     "should just use up cash and never refill").
     *
     * In accumulation, this flag has no effect (no withdrawals
     * to redirect). In retirement, cash-first applies whether
     * the prior year was up or down — the bucket exists to be
     * spent in retirement, not solely as a down-year guardrail.
     */
    cashBucketPriority?: boolean;
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

/**
 * Per-year rebalancing policy.
 *
 *   - "annual"  Snap to target weights (static allocation or
 *               glide-path-resolved per-year) at the start of every
 *               year, before returns are applied. Standard
 *               retirement-survival convention (Trinity Study,
 *               Bengen, cfiresim defaults).
 *   - "none"    Set initial weights at year 0 only, then let the
 *               portfolio drift based on differential class returns.
 *               Cash flow is distributed proportionally to current
 *               (post-return) weights each year, so spend doesn't
 *               itself force a rebalance — drift comes purely from
 *               returns. When a glide path is configured, only its
 *               year-0 waypoint is honored; later waypoints are
 *               ignored under this policy (no rebalance = no
 *               glide-target snap).
 */
export type RebalancePolicy = "annual" | "none";

export type SimulationOptions = {
  /** Historical dataset to draw from. Defaults to HISTORICAL_REAL_RETURNS. */
  dataset?: readonly AnnualRealReturns[];
  /**
   * Rebalancing policy. Decides whether class balances snap to
   * the target weights at each year-start.
   *   - "annual" (default): snap to target weights each year.
   *     Standard retirement-survival convention (Trinity Study,
   *     cfiresim, …).
   *   - "none": set-and-forget. Initial weights at year 0, then
   *     the portfolio drifts based on differential class returns.
   *
   * Cash-bucket priority is now ORTHOGONAL — see
   * `spending.cashBucketPriority`. The 2×2 matrix:
   *   - annual + no-bucket: Trinity baseline
   *   - annual + bucket: refilling cash reserve (Kitces interp)
   *   - none + no-bucket: drift, proportional draw
   *   - none + bucket: depleting cash reserve (Pfau interp; the
   *     SORR shield finite to the early-retirement years)
   *
   * (Older `"bucket"` rebalance policy collapsed two distinct
   * strategies and produced minimal observable difference vs
   * Annual — replaced by the 2D model.)
   */
  rebalance?: RebalancePolicy;
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
): {
  wS: number;
  wB: number;
  wC: number;
  wG: number;
  wR: number;
  /** Leveraged 2x equity bucket weight (routed to stocks2x series). */
  wL: number;
} {
  const otherFrac = Math.max(0, spec.otherFraction ?? 0);
  const stocksW =
    Math.max(0, spec.stocksFraction) + (otherIsStock ? otherFrac : 0);
  const bondsW = Math.max(0, spec.bondsFraction);
  const cashW =
    Math.max(0, spec.cashFraction) + (otherIsStock ? 0 : otherFrac);
  const goldW = Math.max(0, spec.commodityFraction ?? 0);
  const reW = Math.max(0, spec.realEstateFraction ?? 0);
  const lW = Math.max(0, spec.stocks2xFraction ?? 0);
  const total = stocksW + bondsW + cashW + goldW + reW + lW;
  if (total <= 0)
    return { wS: 0, wB: 0, wC: 0, wG: 0, wR: 0, wL: 0 };
  return {
    wS: stocksW / total,
    wB: bondsW / total,
    wC: cashW / total,
    wG: goldW / total,
    wR: reW / total,
    wL: lW / total,
  };
}

export function simulatePath(
  inputs: MonteCarloInputs,
  stockReturns: number[],
  bondReturns: number[],
  cashReturns: number[],
  goldReturns: number[],
  realEstateReturns: number[],
  /**
   * Per-year 2x leveraged equity returns (routed to `stocks2xFraction`).
   * Optional — when omitted, defaults to all zeros, which is correct
   * for callers that don't use the 2x bucket (their
   * `stocks2xFraction` should be 0 too). Inserted as a parameter
   * rather than absorbed into the dataset shape so the simulator
   * stays return-stream-agnostic at its boundary.
   */
  stocks2xReturnsOrPathId: number[] | string,
  pathIdOrOptions?: string | SimulationOptions,
  optionsArg: SimulationOptions = {},
): SimulationPath {
  // Backward-compat shim: callers that didn't pass a stocks2x array
  // shift their `pathId` and `options` into the new slots. The
  // simulator then uses a zero-filled stocks2x stream.
  let stocks2xReturns: number[];
  let pathId: string;
  // Note: `options` is reserved for the dataset hook used by tests
  // that swap in a synthetic return series. Other options used to
  // live here (the old `rebalance` flag — see SimulationOptions
  // doc) but were no-ops, so the parameter is currently
  // unconsumed inside the loop. Kept in the signature for the
  // dataset hook and future expansion.
  let options: SimulationOptions;
  if (typeof stocks2xReturnsOrPathId === "string") {
    // Old 5-stream signature: (..., realEstate, pathId, options?)
    stocks2xReturns = new Array(realEstateReturns.length).fill(0);
    pathId = stocks2xReturnsOrPathId;
    options = (pathIdOrOptions as SimulationOptions | undefined) ?? optionsArg;
  } else {
    // New 6-stream signature: (..., realEstate, stocks2x, pathId, options?)
    stocks2xReturns = stocks2xReturnsOrPathId;
    pathId = (pathIdOrOptions as string) ?? "";
    options = optionsArg;
  }
  const rebalancePolicy: RebalancePolicy = options.rebalance ?? "annual";
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

  // Per-class balances. In "annual" mode these are re-derived each
  // year from target weights × current nw (existing behavior, drift
  // is irrelevant). In "none" mode these persist across years —
  // initialized at year 0 from `weightsForYear(0)` × startingNW,
  // then drift based on differential class returns; cash flow each
  // year is distributed proportionally to current (post-return)
  // weights so cf itself doesn't force a rebalance.
  const initialWeights = weightsForYear(0);
  let sB = nw * initialWeights.wS;
  let bB = nw * initialWeights.wB;
  let cB = nw * initialWeights.wC;
  let gB = nw * initialWeights.wG;
  let rB = nw * initialWeights.wR;
  let lB = nw * initialWeights.wL;

  for (let y = 0; y < totalYears; y++) {
    // "bucket" mode behaves like "annual" except in retirement
    // years following a market drop, where the snap is skipped so
    // the equity slice can recover unsold AND the withdrawal is
    // taken from the cash bucket first. Compute the per-year
    // decision once so the snap branch + withdrawal branch agree.
    //
    // Trigger gate alignment with the variable-haircut feature:
    // `y >= yearsPre` (first retirement year is eligible) AND
    // `y > 0` (we need a prior-year stock return to read).
    // CRUCIAL: this means a user who retires RIGHT AFTER a
    // -30% accumulation-year crash IS protected by the bucket
    // strategy in year 0 of retirement — the exact SORR window
    // the strategy is designed for. An earlier off-by-one used
    // `y > yearsPre` and silently excluded that case.
    // Cash-bucket priority is now ORTHOGONAL to the rebalance
    // policy (PR #X redesign per user feedback). The rebalance
    // policy decides whether to SNAP each year; the bucket flag
    // decides whether retirement-year WITHDRAWAL comes from cash
    // first. The four combinations are:
    //   - annual + no-bucket: Trinity baseline (snap + proportional)
    //   - annual + bucket: refilling SORR shield (snap refills cash
    //     each year; retirement draws cash-first → cash refills on
    //     next snap → ongoing protection)
    //   - none + no-bucket: set-and-forget drift, proportional draw
    //   - none + bucket: DEPLETING SORR shield (cash never refills;
    //     retirement drains cash-first → cash falls to 0 → spills
    //     to equity). Finite protection for early-retirement years.
    //
    // The old `"bucket"` rebalance policy collapsed two distinct
    // strategies into one (refill-bucket-on-up-years-snap +
    // cash-first-on-down-followup-years) and produced minimal
    // observable change in user MC runs — the user surfaced this
    // and proposed the 2D model that this branch implements.
    const cashBucketActive =
      inputs.spending?.cashBucketPriority === true && y >= yearsPre;

    if (rebalancePolicy === "annual") {
      // Annual rebalance-to-target. Snap to weights BEFORE returns.
      // Standard retirement-survival convention.
      const { wS, wB, wC, wG, wR, wL } = weightsForYear(y);
      sB = nw * wS;
      bB = nw * wB;
      cB = nw * wC;
      gB = nw * wG;
      rB = nw * wR;
      lB = nw * wL;
    }
    // `none` mode: balances persist from the previous iteration. No snap.

    // Apply this year's real returns.
    const rs = stockReturns[y] ?? 0;
    const rb = bondReturns[y] ?? 0;
    const rc = cashReturns[y] ?? 0;
    const rg = goldReturns[y] ?? 0;
    const rr = realEstateReturns[y] ?? 0;
    const rl = stocks2xReturns[y] ?? 0;
    sB *= 1 + rs;
    bB *= 1 + rb;
    cB *= 1 + rc;
    gB *= 1 + rg;
    rB *= 1 + rr;
    lB *= 1 + rl;

    const nwAfterReturns = sB + bB + cB + gB + rB + lB;

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
    // Fixed-nominal freeze, applied FIRST so the variable-haircut
    // operates on the post-freeze base (the haircut intent is "cut
    // discretionary spend by X%" — that should apply to whatever
    // the real withdrawal is in this year, frozen or not). The
    // freeze is a multiplicative real-decay over the first
    // `fixedNominalFreeze.years` retirement years.
    if (inputs.spending?.fixedNominalFreeze && y >= yearsPre) {
      const { years: freezeYears, assumedInflationRate } =
        inputs.spending.fixedNominalFreeze;
      const yearsIntoRetirement = y - yearsPre;
      if (freezeYears > 0 && yearsIntoRetirement < freezeYears) {
        const decay = Math.pow(
          1 + assumedInflationRate,
          yearsIntoRetirement,
        );
        // Defensive: pathological inflation rates (≤ -1, imported
        // from corrupted Drive data despite UI bounds) would make
        // 1 + r = 0 → decay = 0 → divide-by-zero → Infinity. Same
        // for non-finite values. Engine NaN-safety contract says
        // bad inputs degrade to no-op, not poison downstream.
        if (Number.isFinite(decay) && decay > 0) {
          withdrawal = withdrawal / decay;
        }
      }
    }
    if (inputs.spending && y >= yearsPre) {
      const { variableUSD, haircut } = inputs.spending;
      const fires = haircut.onlyAfterDownYear
        ? y > 0 && (stockReturns[y - 1] ?? 0) < 0
        : true;
      if (fires) withdrawal -= variableUSD * haircut.rate;
    }
    // Clamp at 0. The fixed-nominal freeze + a large variable haircut
    // can compose to a negative `withdrawal`, which would flip the
    // cash-flow sign (negative-withdrawal becomes a positive deposit
    // in `cf = -withdrawal + income`). Engine should treat that as
    // "user took no draw this year," not "the simulator deposited
    // money into the portfolio." A user who configured a 100%
    // variable-haircut with a deep freeze decay is asking for "as
    // little spend as the haircut allows," not auto-saving. Clamp at
    // 0 makes the floor explicit.
    if (withdrawal < 0) withdrawal = 0;

    // Per-year income offset (consulting, pension, Social
    // Security, rental). Real dollars; ADDED to cash flow each
    // year. Defensive ?? 0 in case the array is shorter than
    // totalYears (e.g. early termination upstream).
    const income = inputs.incomePerYearUSD?.[y] ?? 0;
    const cf =
      y < yearsPre
        ? (inputs.annualContributionUSD ?? 0) + income
        : -withdrawal + income;
    const cfWithGrowth = cf * (1 + rImplied / 2);
    nw = nwAfterReturns + cfWithGrowth;

    if (cashBucketActive && y >= yearsPre) {
      // Cash-bucket-priority withdrawal: in retirement years (with
      // the flag enabled), the year's withdrawal comes out of the
      // cash bucket FIRST; any remainder spills proportionally
      // across the OTHER classes. Equity stays unsold through
      // crashes, materially reducing locked-in losses on the
      // SORR-vulnerable early-retirement window.
      //
      // Whether this is the REFILLING (Kitces) or DEPLETING (Pfau)
      // SORR shield depends on the rebalance policy: with
      // `annual`, the next year-start snap refills cash from
      // appreciated equity (ongoing protection); with `none`, the
      // cash bucket monotonically depletes (finite protection for
      // the first ~5-10 years, then falls through).
      //
      // Income (positive cf) is layered back via the standard
      // proportional distribution — income isn't a "withdrawal"
      // the user is choosing where to source from. NEGATIVE income
      // (partial-coast distribution) routes through the same
      // cash-first → spill logic so the bucket shields equity from
      // BOTH the planned spend AND any negative-income overlay.
      //
      // The mid-year growth adjustment applies to BOTH the
      // withdrawal and the income at the same blended rate the
      // rest of the engine uses, so the math doesn't drift away
      // from the existing convention.
      const drawAtMidYear = withdrawal * (1 + rImplied / 2);
      const incomeAtMidYear = income * (1 + rImplied / 2);
      // Drain from cash first, capped at what's available.
      // Floor cB at 0 defensively: a small negative drift from
      // an earlier `factor` rescale would otherwise let the min
      // return that negative, ADDING (subtracting-a-negative) to
      // drawRemaining AND leaving cash more negative. Guard once
      // here so the rest of the branch operates on clean inputs.
      const available = Math.max(0, cB);
      const fromCash = Math.min(available, drawAtMidYear);
      cB = available - fromCash;
      const drawRemaining = drawAtMidYear - fromCash;
      // Spillover: take what's left from non-cash classes
      // proportionally. Per-class accounting asymmetry: the
      // WITHDRAWAL is sourced cash-first by design (the strategy's
      // whole point), but POSITIVE INCOME is credited
      // proportionally to every class (it isn't a draw the user
      // controls the source of; it's an inflow that should land
      // where new contributions would). The two operations use
      // different denominators on purpose.
      const nonCashTotal = sB + bB + gB + rB + lB;
      if (drawRemaining > 0 && nonCashTotal > 0) {
        sB -= drawRemaining * (sB / nonCashTotal);
        bB -= drawRemaining * (bB / nonCashTotal);
        gB -= drawRemaining * (gB / nonCashTotal);
        rB -= drawRemaining * (rB / nonCashTotal);
        lB -= drawRemaining * (lB / nonCashTotal);
      }
      // Clamp non-cash classes BEFORE the income redistribution so
      // the proportionality math (`sB / totalNow`) sees only non-
      // negative weights. Without this, a class left slightly
      // negative by the spillover above would corrupt the income
      // distribution: `incomeAtMidYear * (-1e-12 / totalNow)`
      // pushes that class further negative while the offset goes
      // to nothing. Compounds across years.
      if (sB < 0) sB = 0;
      if (bB < 0) bB = 0;
      if (gB < 0) gB = 0;
      if (rB < 0) rB = 0;
      if (lB < 0) lB = 0;
      if (incomeAtMidYear > 0) {
        // Positive income: distribute to ALL classes by current
        // weights.
        const totalNow = sB + bB + cB + gB + rB + lB;
        if (totalNow > 0) {
          sB += incomeAtMidYear * (sB / totalNow);
          bB += incomeAtMidYear * (bB / totalNow);
          cB += incomeAtMidYear * (cB / totalNow);
          gB += incomeAtMidYear * (gB / totalNow);
          rB += incomeAtMidYear * (rB / totalNow);
          lB += incomeAtMidYear * (lB / totalNow);
        }
      } else if (incomeAtMidYear < 0) {
        // NEGATIVE income (partial-coast distribution, sabbatical
        // bridge — see lib/budget/incomeStreams.ts signed
        // semantics). This is a SECOND withdrawal in everything-
        // but-name; route it through the same cash-first → spill
        // logic so the bucket strategy actually shields equity
        // from BOTH the planned retirement spend AND any
        // negative-income overlay. Without this branch, the
        // negative income would be silently dropped (the per-
        // class nw re-derive at the end would erase the signed
        // cfWithGrowth from earlier). Real bug caught in audit.
        const distributionAmount = -incomeAtMidYear;
        const distFromCash = Math.min(Math.max(0, cB), distributionAmount);
        cB = Math.max(0, cB) - distFromCash;
        const distRemaining = distributionAmount - distFromCash;
        const nonCashAfter = sB + bB + gB + rB + lB;
        if (distRemaining > 0 && nonCashAfter > 0) {
          sB -= distRemaining * (sB / nonCashAfter);
          bB -= distRemaining * (bB / nonCashAfter);
          gB -= distRemaining * (gB / nonCashAfter);
          rB -= distRemaining * (rB / nonCashAfter);
          lB -= distRemaining * (lB / nonCashAfter);
        }
      }
      // Final clamp after the negative-income spillover (which
      // could also leave a class slightly negative through the
      // proportional subtraction). Cash is already non-negative
      // from `available = Math.max(0, cB)` upstream.
      if (sB < 0) sB = 0;
      if (bB < 0) bB = 0;
      if (gB < 0) gB = 0;
      if (rB < 0) rB = 0;
      if (lB < 0) lB = 0;
      // Re-derive nw from per-class balances so the aggregate is
      // exactly internally-consistent (avoid `cfWithGrowth`-derived
      // value drifting from the per-class accounting).
      nw = sB + bB + cB + gB + rB + lB;
      // If the portfolio bust this year, zero everything so the
      // next iteration starts from clean (negative) zero. The
      // trailing nw<=0 check at the end of the loop will mark
      // failedAtYear; this branch must mirror it.
      if (nw <= 0) {
        sB = 0;
        bB = 0;
        cB = 0;
        gB = 0;
        rB = 0;
        lB = 0;
      }
    } else if (rebalancePolicy === "none") {
      // "none" mode without cash-bucket priority: cash flow is
      // distributed proportionally to current (post-return) bucket
      // weights so cf itself doesn't force a rebalance. The drift
      // across years comes purely from differential class returns;
      // this step just keeps the per-class balances consistent
      // with the new total nw.
      if (nwAfterReturns > 0 && nw > 0) {
        const factor = nw / nwAfterReturns;
        sB *= factor;
        bB *= factor;
        cB *= factor;
        gB *= factor;
        rB *= factor;
        lB *= factor;
      } else if (nw <= 0) {
        sB = 0;
        bB = 0;
        cB = 0;
        gB = 0;
        rB = 0;
        lB = 0;
      }
    }
    // "annual" mode without cash-bucket priority doesn't need to
    // update per-class balances — they'll be re-snapped to target
    // weights × nw at the top of the next iteration.

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
    const stocks2x = slice.map((r) => r.stocks2x);
    paths.push(
      simulatePath(
        inputs,
        stocks,
        bonds,
        cash,
        gold,
        re,
        stocks2x,
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
  stocks2x: number[];
} {
  const stocks: number[] = [];
  const bonds: number[] = [];
  const cash: number[] = [];
  const gold: number[] = [];
  const realEstate: number[] = [];
  const stocks2x: number[] = [];
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
      stocks2x.push(r.stocks2x);
    }
  }
  return { stocks, bonds, cash, gold, realEstate, stocks2x };
}

export function runBootstrap(
  inputs: MonteCarloInputs,
  options: BootstrapOptions = {},
): MonteCarloResult {
  const dataset = options.dataset ?? HISTORICAL_REAL_RETURNS;
  const paths = options.paths ?? 1000;
  const blockSize = Math.max(1, options.blockSize ?? 5);
  // Default seed = 1 (deterministic). Engine purity rule
  // (CLAUDE.md §1) forbids `Math.random()` in lib/; callers that
  // want non-deterministic paths must pass a seed explicitly
  // (e.g. `Math.floor(Math.random() * 2**31)` at the call site).
  // In practice every in-tree caller already passes a seed, so
  // this fallback is dead — but the prior `Math.random()` default
  // was a latent purity violation that would have surfaced as
  // non-reproducible output the moment a caller forgot.
  const seed = options.seed ?? 1;
  const rand = makePrng(seed);
  const yearsPre = inputs.yearsUntilRetirement ?? 0;
  const totalYears = yearsPre + inputs.retirementHorizonYears;
  if (totalYears <= 0 || paths <= 0) {
    return emptyResult(totalYears);
  }
  const out: SimulationPath[] = [];
  for (let i = 0; i < paths; i++) {
    const { stocks, bonds, cash, gold, realEstate, stocks2x } =
      sampleBlockBootstrap(totalYears, dataset, blockSize, rand);
    out.push(
      simulatePath(
        inputs,
        stocks,
        bonds,
        cash,
        gold,
        realEstate,
        stocks2x,
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
