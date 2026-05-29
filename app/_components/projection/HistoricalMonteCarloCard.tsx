"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import {
  HISTORICAL_RETURNS_FIRST_YEAR,
  HISTORICAL_RETURNS_LAST_YEAR,
  LEVERAGED_2X_REAL_DATA_START_YEAR,
} from "@/lib/data/historicalReturns";
import {
  runBootstrap,
  runHistoricalSequences,
  type MonteCarloResult,
} from "@/lib/projection/monteCarlo";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { computeLeveragedEquityBuckets } from "@/lib/portfolio/leveragedEquity";
import { ageHousehold } from "@/lib/portfolio/futureAllocation";
import { projectIndependence } from "@/lib/projection/independence";
import {
  activeMemberIds,
  householdNetWorth,
} from "@/lib/types";
import {
  clampHaircut,
  effectiveHaircut,
  effectiveVariableShare,
  suggestedIndependenceCorpus,
} from "@/lib/budget/budget";
import {
  filterIncomeStreamsForRollups,
  incomePerYearUSD,
} from "@/lib/budget/incomeStreams";
import { formatUSD, formatUSDCompact } from "@/lib/format";
import { Fan } from "./historical-mc/Fan";
import {
  ModeChip,
  NumberInput,
  PercentileBox,
} from "./historical-mc/fields";
import { worstPathContext } from "./historical-mc/worstPathContext";
import { HistoricalReturnsTableModal } from "./HistoricalReturnsTableModal";

/**
 * Historical Monte Carlo card — runs the user's plan against
 * actual historical sequences (1928–2025) and a bootstrap
 * variant, reports success rate + percentile bands + the worst
 * historical start year.
 *
 * UX goals:
 *   1. Headline: "X% historical success rate" — one number the
 *      user can take away.
 *   2. Honest narrative: when it's <90%, surface which historical
 *      starts caused the failures (great depression / stagflation
 *      / GFC). Educates without lecturing.
 *   3. No false precision: success rate based on ~67 historical
 *      starts isn't a statistical certainty, and the card says so.
 *   4. Bootstrap mode for users who want more paths (with a clear
 *      "this is generated, not historical" note).
 *
 * Real-terms throughout. Aligns with the rest of the app's
 * real-CAGR / real-SWR / today's-dollars model.
 */
export function HistoricalMonteCarloCard() {
  // Pull the fully-resolved projection inputs (rollup → member →
  // liquidity → per-member assumption overrides → active scenario
  // overrides) from the canonical resolver. Reading the raw store
  // slices directly here was the historical bug — scenario overrides
  // on `withdrawalRate` / `targetNetWorthUSD` / `legacyFloorUSD`
  // never reached the MC card because the scenario merge happens
  // inside `useActiveProjection`, not on `state.assumptions`. Same
  // class of bug as #11 (AllocationPanel).
  //
  // (Note: scenario `holdingCAGRs` / `cagrDelta` are no-ops for the
  // MC sim — it draws returns from the historical dataset, not from
  // `expectedRealCAGR`. The methodology block calls that out so the
  // user isn't surprised when a CAGR-only scenario leaves the
  // success rate unchanged.)
  const {
    household: scopedHousehold,
    assumptions: effective,
    scenarioName,
    memberId,
  } = useActiveProjection();
  const budgetItems = useAppStore((s) => s.budgetItems);
  const incomeStreams = useAppStore((s) => s.incomeStreams);
  // Capture the calendar year ONCE per mount via useState
  // initializer. Reading `new Date().getFullYear()` inside a
  // render-time useMemo would (a) violate react-hooks/purity
  // (impure call during render) and (b) make this component's
  // output date-dependent — a snapshot test would differ across
  // year boundaries. The session-scope capture is fine: nobody
  // is going to keep this tab open across New Year's Eve and
  // expect the income-streams baseYear to roll.
  const [baseYear] = useState(() => new Date().getFullYear());

  // Default the spend from the budget-derived corpus when set;
  // otherwise fall back to (target × SWR) as a sensible starting
  // point. User can override.
  const currentNW = householdNetWorth(scopedHousehold);
  // When the user has the conditional ("only after down years")
  // haircut mode on, the realized average withdrawal sits between
  // always-apply and never-apply — so the corpus suggestion uses
  // an EFFECTIVE haircut (rate × historical down-year frequency)
  // instead of the raw rate. Without this, conditional-mode users
  // would over-save (corpus sized for a haircut that only fires
  // ~31% of the time).
  const budgetCorpus = useMemo(
    () =>
      suggestedIndependenceCorpus(
        budgetItems,
        effective.withdrawalRate,
        effectiveHaircut(
          effective.retirementVariableHaircut,
          effective.retirementVariableHaircutOnDownYearOnly === true,
        ),
        effective.retirementTaxRate,
      ),
    [budgetItems, effective],
  );
  // The drawdown question is: *given that I reach my target, does my
  // plan survive?* So the simulator should start at the target NW (or
  // current, whichever is larger). Starting at `currentNW` when the
  // user is below target silently mixes two semantically different
  // questions — it asks "could I retire today at my planned
  // target-level spend" rather than "does my plan survive once I get
  // there." That mismatch produces near-zero success rates for users
  // still in accumulation: e.g. currentNW = $500k, target = $2M, SWR
  // 4% → simulated spend of $80k against a $500k starting balance is
  // a 16% withdrawal rate, which fails almost every historical
  // sequence. max(current, target) routes the question correctly.
  const targetNW = effective.targetNetWorthUSD ?? 0;
  const defaultStartingNW = Math.max(currentNW, targetNW);
  const defaultAnnualSpend =
    budgetCorpus != null
      ? (effective.targetNetWorthUSD ?? budgetCorpus) *
        effective.withdrawalRate
      : (effective.targetNetWorthUSD ?? currentNW) *
        effective.withdrawalRate;

  const [horizonYears, setHorizonYears] = useState(
    effective.drawdownHorizonYears ?? 30,
  );
  const [annualSpend, setAnnualSpend] = useState(
    Math.round(defaultAnnualSpend),
  );
  const [startingNW, setStartingNW] = useState(
    Math.round(defaultStartingNW),
  );
  // Did the user override starting NW manually? If not, keep it in
  // sync with `defaultStartingNW` as upstream inputs (member filter,
  // target, current NW) shift. Once they touch the input, freeze.
  const [startingNWTouched, setStartingNWTouched] = useState(false);
  if (!startingNWTouched && startingNW !== Math.round(defaultStartingNW)) {
    setStartingNW(Math.round(defaultStartingNW));
  }
  const startingMode =
    targetNW > 0 && startingNW >= targetNW
      ? ("at_target" as const)
      : ("below_target" as const);
  const [mode, setMode] = useState<"historical" | "bootstrap">("historical");
  // Reference-data viewer for the underlying historical-MC dataset.
  // Opened from the "View year-by-year table →" affordance in the
  // methodology footnote at the bottom of the card.
  const [historicalTableOpen, setHistoricalTableOpen] = useState(false);
  const [bootstrapPaths, setBootstrapPaths] = useState(2000);
  // How to model the "other alts" bucket (crypto + direct RE +
  // private stock + plain "other"). Stocks is the more aggressive
  // assumption; cash is the conservative floor. Commodity is NOT in
  // this toggle — it has its own historical gold series.
  const [altsAs, setAltsAs] = useState<"stocks" | "cash">("stocks");
  // Rebalancing policy for the stress test. Default "annual" matches
  // standard retirement-survival convention (Trinity Study, Bengen,
  // cfiresim). "none" lets the portfolio drift based on differential
  // class returns — when a glide path is configured, only year 0 of
  // the glide path is honored under "none" since no rebalance = no
  // glide-target snap.
  // Rebalance × Cash-bucket as two orthogonal toggles (PR
  // redesign per user feedback: the old 3-way `Annual / None /
  // Bucket` collapsed two distinct strategies and produced
  // minimal observable change in success rate). The 2×2:
  //   - annual + bucket-off: Trinity baseline
  //   - annual + bucket-on:  refilling cash reserve (Kitces)
  //   - none + bucket-off:   set-and-forget drift
  //   - none + bucket-on:    DEPLETING cash reserve (Pfau), the
  //                           finite SORR shield for early years
  const [rebalance, setRebalance] = useState<"annual" | "none">("annual");
  const [cashBucketPriority, setCashBucketPriority] = useState(false);
  // Optional cash-bucket size override (in % of NW). Default
  // null = use whatever cashFraction the allocation produces.
  // When set, the simulator's allocation is rewritten at the
  // call site: `stocksFraction` shrinks to make room for the
  // larger cash slice. Defer the equity → cash swap tax hit
  // to a later iteration (documented in methodology copy).
  const [cashBucketSizePct, setCashBucketSizePct] = useState<number | null>(
    null,
  );

  // Project the household forward to the date the user is expected
  // to reach the Independence target — then derive allocation from
  // THAT composition, not today's. This is what makes a CAGR-only
  // scenario actually move the MC numbers: different per-holding
  // CAGRs produce different growth trajectories, so by the time the
  // user hits target the mix is different (e.g. a "stocks +2pt"
  // scenario ends up more equity-heavy at retirement than today's
  // 60/40 mix would suggest). The sim runs at the target NW, so its
  // allocation should reflect target-date composition.
  //
  // Edge cases:
  //   - Already at/past target (months == 0) → use today's mix.
  //   - Unreachable target (null) → use today's mix; the MC is still
  //     useful as "if I magically got there, would I survive?" — but
  //     scenario CAGR effects won't propagate here (correct: the
  //     plan doesn't reach the target either).
  //   - Below target → age the scoped household by monthsToTarget/12
  //     years. ageHousehold uses each holding's expectedRealCAGR
  //     (already scenario-merged through useActiveProjection), so
  //     scenarios cascade in automatically.
  // Pass income streams into projectIndependence so monthsToTarget
  // is computed against the user's ACTUAL cash flow, not a stream-
  // less idealization. This matters most for partial-coast users
  // with NEGATIVE income streams (sabbatical / step-down bridges
  // that drain the portfolio during accumulation) — without
  // streams, monthsToTarget is too short, and the at-target
  // composition we project for the MC sim reflects an unrealistic
  // date. The Outlook tab already feeds streams into its projection;
  // we match that here.
  const streamsScoped = useMemo(
    () =>
      filterIncomeStreamsForRollups(
        incomeStreams,
        memberId,
        activeMemberIds(scopedHousehold),
      ),
    [incomeStreams, memberId, scopedHousehold],
  );
  const monthsToTarget = useMemo(
    () =>
      projectIndependence(scopedHousehold, effective, undefined, {
        // Project across the same horizon the simulator uses; ~70y
        // covers any realistic Independence path. The engine
        // tolerates a shorter or longer array — extras are ignored,
        // misses default to 0.
        incomePerYearUSD: incomePerYearUSD(streamsScoped, baseYear, 70),
      }).monthsToIndependence,
    [scopedHousehold, effective, streamsScoped, baseYear],
  );
  const yearsToTarget =
    monthsToTarget != null && monthsToTarget > 0 ? monthsToTarget / 12 : 0;
  const projectedHousehold = useMemo(() => {
    if (yearsToTarget <= 0) return scopedHousehold;
    return ageHousehold(scopedHousehold, yearsToTarget);
  }, [scopedHousehold, yearsToTarget]);

  const portfolio = useMemo(
    () => computePortfolio(projectedHousehold),
    [projectedHousehold],
  );
  // Today's (un-aged) cash share, used ONLY for the bucket-
  // strategy "configure a cash slice" warning. The simulator
  // consumes the AGED `portfolio.classes.cashShare`, but the
  // warning text says "your cash allocation" — and the user's
  // mental model is "what I configured today," not "what my
  // portfolio will look like at retirement." A user with 5% cash
  // today and 20y of equity-compounding ahead would correctly
  // see <1% cash at target but the warning shouldn't nag them.
  const cashShareToday = useMemo(
    () => computePortfolio(scopedHousehold).classes.cashShare,
    [scopedHousehold],
  );
  // Detect whether the user has any mortgaged RE in the current
  // scope. Damodaran's RE series is UNLEVERED price return — for a
  // 5×-levered residence, a -10% real RE year actually wipes ~50%
  // of the homeowner's equity, not 10%. The simulator routes
  // equity-net value through unlevered returns, which understates
  // short-term volatility on mortgaged properties. Over long-run
  // averages this roughly nets out because the price-only series
  // also omits rental yield (which approximately offsets mortgage
  // interest + maintenance for a homeowner), so the approximation
  // is defensible for typical Independence planning — but worth surfacing
  // explicitly when a user is in "Total NW" mode and carries
  // levered residential exposure.
  const reLeverage = useMemo(() => {
    let equity = 0;
    let exposure = 0;
    for (const a of scopedHousehold.accounts) {
      for (const h of a.holdings) {
        if (h.kind !== "real_estate") continue;
        equity += h.valueUSD;
        exposure += h.valueUSD * h.leverage;
      }
    }
    return equity > 0 ? exposure / equity : 1;
  }, [scopedHousehold]);
  const reIsLevered =
    portfolio.classes.realEstateShare > 0.05 && reLeverage > 1.2;

  // Glide-path resolution. If the user has configured a glide path
  // (Vanguard-style "100% equity at 25 → 50% by 65 → 30% by 85"
  // shape), the simulator honors it by computing per-year allocation
  // via allocationAtAge. We pass the relevant member's current age
  // (for a multi-member household, prefer the member selected in the
  // UI; if "all", fall back to the oldest age since they hit
  // retirement-related milestones first). Glide path is null when
  // the user hasn't configured one — the simulator then uses the
  // static `allocation` for every year (existing behavior).
  const glidePath = useAppStore((s) => s.glidePath);
  const memberAge = useMemo(() => {
    const ages = scopedHousehold.members
      .map((m) => m.age)
      .filter((a): a is number => typeof a === "number" && a > 0);
    if (ages.length === 0) return undefined;
    // For "all", use the oldest. For a specific member, scopedHousehold
    // already filtered to just that member, so max == that member.
    return Math.max(...ages);
  }, [scopedHousehold]);
  const glidePathActive =
    glidePath != null &&
    glidePath.waypoints.length > 0 &&
    memberAge != null;
  // Commodity routes to the historical gold series; real estate
  // routes to Damodaran's price-return RE series. The remaining
  // alts — crypto / private stock / other — go to `otherFraction`
  // and are modeled per the alts toggle.
  const commodityShare = portfolio.classes.commodityShare;
  const realEstateShare = portfolio.classes.realEstateShare;
  const otherAltsShare =
    portfolio.classes.cryptoShare +
    portfolio.classes.privateStockShare +
    portfolio.classes.otherShare;
  // Model an at-retirement deleveraging of non-recognized leveraged
  // ETFs:
  //   - 3x S&P 500 (UPRO/SPXL) → 2x S&P (SSO/SPUU equivalent) →
  //     stocks2x bucket post-tax
  //   - 3x Nasdaq (TQQQ) → 2x Nasdaq (QLD equivalent) → stocks2x
  //     bucket post-tax
  //   - Other leveraged (SOXL/FAS/etc.) → 1x broad equity →
  //     stocks (1x) bucket post-tax
  // Capital-gains tax (only on holdings in TAXABLE accounts) is
  // applied to the deleveraging at the user's retirement tax rate
  // and SUBTRACTED from starting NW for the MC. Models the realistic
  // cost of restructuring a leveraged portfolio at retirement.
  // Leveraged-ETF deleveraging tax is computed against the holdings
  // as they exist AT retirement (projectedHousehold), not today —
  // matches the rest of the card's "MC starts at target date"
  // semantics. With a 20-year accumulation horizon, leveraged ETFs
  // can balloon vs cost basis, so the tax hit on a +2pt-CAGR scenario
  // is materially larger than on a baseline. Routing this through the
  // projected household is what the user observed differing across
  // scenarios already.
  const leveragedBuckets = useMemo(
    () =>
      computeLeveragedEquityBuckets(
        projectedHousehold,
        effective.retirementTaxRate,
      ),
    [projectedHousehold, effective.retirementTaxRate],
  );
  // Decompose equity into face values to recompose post-tax.
  // `regular1xEquityUSD` is the equity that's neither recognized 2x
  // nor leveraged-being-restructured — it stays at full face value.
  const totalEquityFaceUSD =
    portfolio.classes.equityShare * portfolio.netWorthUSD;
  const regular1xEquityUSD = Math.max(
    0,
    totalEquityFaceUSD -
      leveragedBuckets.stocks2xUSD -
      leveragedBuckets.nonRecognizedLeveragedUSD,
  );
  // Bucket dollar amounts going into the MC sim:
  //   stocks2x = recognized 2x face (unchanged) + post-tax 3x SPY/Nasdaq
  //   stocks   = regular 1x face (unchanged)  + post-tax other-leveraged
  const stocks2xBucketUSD =
    leveragedBuckets.stocks2xUSD +
    leveragedBuckets.postTaxDeleverageToStocks2xUSD;
  const stocks1xBucketUSD =
    regular1xEquityUSD + leveragedBuckets.postTaxDiversifyToStocks1xUSD;
  // Fractions of pre-tax NW. `resolveWeights` inside the simulator
  // normalizes these to sum-to-1, so a sub-1 raw sum (the tax-hit
  // shrinkage) is handled correctly when applied to the post-tax
  // `effectiveStartingNW` below — net effect: bucket dollars come
  // out as bucket_face_or_post_tax × (startingNW / netWorthUSD),
  // which scales correctly with what-if overrides.
  const stocks2xFraction =
    portfolio.netWorthUSD > 0
      ? stocks2xBucketUSD / portfolio.netWorthUSD
      : 0;
  const regularStocksFraction =
    portfolio.netWorthUSD > 0
      ? stocks1xBucketUSD / portfolio.netWorthUSD
      : 0;
  // Tax hit as a fraction of total pre-tax NW. Scales with the
  // user's startingNW override so what-if scenarios get proportional
  // tax drag — the assumption is portfolio composition is held
  // constant across what-if sizing.
  const taxHitFraction =
    portfolio.netWorthUSD > 0
      ? leveragedBuckets.deleveragingTaxHitUSD / portfolio.netWorthUSD
      : 0;
  // Cash-bucket size override (cap shared with the NumberInput's
  // max — single source of truth so the UI accepted range can't
  // drift from the effective clamp).
  const CASH_BUCKET_MAX_PCT = 50;
  // When the user wants a bigger cash slice than the portfolio
  // has today (e.g. 20% reserve from 3% cash), re-anchor the
  // allocation. Extra cash is sourced PROPORTIONALLY from every
  // non-cash class (1x stocks, 2x stocks, bonds, commodity, RE,
  // alts) — earlier v0 only stole from regular 1x stocks, which
  // silently sums-to-greater-than-100% allocations when the user
  // has little 1x stocks (e.g. mostly TQQQ + RE). `resolveWeights`
  // then normalized away the excess, giving a SMALLER actual cash
  // slice than the methodology displayed. Proportional steals
  // preserves sum-to-1.
  //
  // v1 does NOT model the equity → cash swap tax hit (would
  // require gain assumption + taxable-share math similar to the
  // deleveraging-tax flow); the methodology block surfaces the
  // gap so users aren't surprised.
  const cashFractionEffective = useMemo(() => {
    const today = portfolio.classes.cashShare;
    if (cashBucketSizePct == null) return today;
    const requested = Math.max(
      0,
      Math.min(CASH_BUCKET_MAX_PCT / 100, cashBucketSizePct / 100),
    );
    return Math.max(today, requested);
  }, [portfolio.classes.cashShare, cashBucketSizePct]);
  // Proportional re-scale factor for non-cash classes.
  // `scale = (1 - cashEff) / (1 - cashToday)`. When extra cash
  // is 0, scale = 1 (no-op). When cash doubles, every non-cash
  // class is scaled down so the sum stays at 1.
  const nonCashScale = useMemo(() => {
    const today = portfolio.classes.cashShare;
    if (cashFractionEffective <= today) return 1;
    const denominator = 1 - today;
    if (denominator <= 0) return 1;
    return (1 - cashFractionEffective) / denominator;
  }, [portfolio.classes.cashShare, cashFractionEffective]);
  const allocation = useMemo(
    () => ({
      stocksFraction: regularStocksFraction * nonCashScale,
      stocks2xFraction: stocks2xFraction * nonCashScale,
      bondsFraction: portfolio.classes.bondShare * nonCashScale,
      cashFraction: cashFractionEffective,
      commodityFraction: commodityShare * nonCashScale,
      realEstateFraction: realEstateShare * nonCashScale,
      otherFraction: otherAltsShare * nonCashScale,
    }),
    [
      regularStocksFraction,
      stocks2xFraction,
      portfolio.classes.bondShare,
      cashFractionEffective,
      commodityShare,
      realEstateShare,
      otherAltsShare,
      nonCashScale,
    ],
  );

  // Post-tax starting NW. When the user has leveraged ETFs that
  // the stress test models as deleveraged-at-retirement, the
  // capital-gains tax on that restructure comes out of starting NW.
  // When there are no leveraged positions to deleverage (or all
  // such positions are in tax-advantaged accounts),
  // `taxHitFraction` is 0 and this reduces to the original
  // `Math.max(0, startingNW)`.
  const effectiveStartingNW = Math.max(
    0,
    startingNW * (1 - taxHitFraction),
  );
  const effectiveWR =
    effectiveStartingNW > 0 ? annualSpend / effectiveStartingNW : 0;

  // Variable share of the spend being tested. Resolves via:
  // explicit assumption override → budget-derived → 35% default.
  // The MC simulator multiplies this by `annualSpend` to get
  // `variableUSD`, so the haircut applies to the same fraction
  // of whatever spend the user is testing — no double-cutting
  // when target NW and budget-implied corpus disagree.
  const result: MonteCarloResult = useMemo(() => {
    const variableShare = effectiveVariableShare(
      budgetItems,
      effective.retirementVariableShare,
    );
    const haircutRate = clampHaircut(effective.retirementVariableHaircut);
    const haircutOnDownYearOnly =
      effective.retirementVariableHaircutOnDownYearOnly === true;
    const inputs = {
      startingNetWorthUSD: effectiveStartingNW,
      allocation,
      annualSpendUSD: annualSpend,
      // Dynamic-spending config. Always pass it so the simulator
      // is the SINGLE source of truth for haircut application —
      // even the "always apply" mode now flows through here
      // rather than being baked upstream. When haircut is 0 this
      // is a no-op for the simulator's per-year math.
      spending: {
        variableUSD: annualSpend * variableShare,
        haircut: {
          rate: haircutRate,
          onlyAfterDownYear: haircutOnDownYearOnly,
        },
        // Cash-bucket priority: when on, retirement-year
        // withdrawals come from cash first. Combines with the
        // `rebalance` policy: annual → refilling bucket;
        // none → depleting bucket.
        cashBucketPriority,
        // Fixed-nominal freeze (SORR mitigation). The user
        // configures both the freeze duration and the assumed
        // inflation on the AssumptionsPanel. When years is 0
        // (default), the simulator no-ops — back-compat.
        ...(((): { fixedNominalFreeze?: {
          years: number;
          assumedInflationRate: number;
        } } => {
          const yearsRaw = effective.retirementFixedNominalYears;
          if (yearsRaw == null || yearsRaw <= 0) return {};
          return {
            fixedNominalFreeze: {
              years: yearsRaw,
              assumedInflationRate: effective.expectedInflationRate,
            },
          };
        })()),
      },
      // Future-income streams pre-computed into the per-year
      // array the simulator consumes. Filtered through the same
      // composition rule as the rest of the rollup machinery:
      //   - per-member view: only that member's streams
      //   - household view: only streams owned by active
      //     (rollup-included) members
      // Year 0 of the sim is the CURRENT calendar year; the
      // simulator iterates totalYears from there.
      incomePerYearUSD: incomePerYearUSD(
        filterIncomeStreamsForRollups(
          incomeStreams,
          memberId,
          // scopedHousehold is already rollup-filtered when memberId
          // is null (and member-sliced when set), so active member
          // ids derived from it match the canonical resolver.
          activeMemberIds(scopedHousehold),
        ),
        baseYear,
        Math.max(1, Math.min(60, horizonYears)),
      ),
      retirementHorizonYears: Math.max(1, Math.min(60, horizonYears)),
      otherTreatedAsStocks: altsAs === "stocks",
      // When a glide path is configured + we know the member's age,
      // pass them so the simulator interpolates the allocation
      // year-by-year instead of using the static one.
      ...(glidePathActive
        ? { glidePath: glidePath!, startAge: memberAge! }
        : {}),
    };
    if (mode === "historical") {
      return runHistoricalSequences(inputs, { rebalance });
    }
    return runBootstrap(inputs, {
      paths: Math.max(100, Math.min(10000, bootstrapPaths)),
      seed: 1, // deterministic — UI feels stable across re-renders
      rebalance,
    });
  }, [
    effectiveStartingNW,
    allocation,
    annualSpend,
    budgetItems,
    incomeStreams,
    scopedHousehold,
    memberId,
    effective,
    horizonYears,
    mode,
    bootstrapPaths,
    altsAs,
    glidePathActive,
    glidePath,
    memberAge,
    rebalance,
    cashBucketPriority,
    baseYear,
  ]);

  const successPct = (result.successRate * 100).toFixed(1);
  const tier =
    result.successRate >= 0.95
      ? { label: "Robust", tone: "text-positive" }
      : result.successRate >= 0.85
        ? { label: "Solid", tone: "text-accent" }
        : result.successRate >= 0.7
          ? { label: "At risk", tone: "text-amber-300" }
          : { label: "Fragile", tone: "text-negative" };

  // Worst historical start: for historical mode, this is the
  // worst-surviving start year; for bootstrap, just the path with
  // the lowest ending NW.
  const worstPath = useMemo(() => {
    if (result.paths.length === 0) return null;
    return result.paths
      .slice()
      .sort((a, b) => a.endingNetWorthUSD - b.endingNetWorthUSD)[0];
  }, [result.paths]);

  // Best path — opposite end of the ending-NW distribution. Used by
  // the interactive fan's "Best" highlight overlay.
  const bestPath = useMemo(() => {
    if (result.paths.length === 0) return null;
    return result.paths
      .slice()
      .sort((a, b) => b.endingNetWorthUSD - a.endingNetWorthUSD)[0];
  }, [result.paths]);

  const failedPaths = result.paths.filter((p) => !p.survived);

  if (effectiveStartingNW <= 0) {
    return (
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="text-sm font-medium text-text">
            Historical Monte Carlo
          </div>
          <div className="mt-1 text-[11px] text-text-dim">
            Add some accounts first — this simulator stress-tests
            your portfolio against actual historical sequences
            ({HISTORICAL_RETURNS_FIRST_YEAR}–{HISTORICAL_RETURNS_LAST_YEAR}).
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">
              Historical Monte Carlo
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {mode === "historical"
                ? `Tested across ${result.pathCount} actual historical ${horizonYears}-year windows (${HISTORICAL_RETURNS_FIRST_YEAR}–${HISTORICAL_RETURNS_LAST_YEAR}).`
                : `Bootstrap: ${result.pathCount} resampled paths from historical years. Block size 5y preserves autocorrelation.`}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-border bg-bg-elevated p-3">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Success rate
          </div>
          <div className={`num mt-0.5 text-3xl font-semibold ${tier.tone}`}>
            {successPct}%
          </div>
          <div className={`text-sm font-medium ${tier.tone}`}>
            {tier.label}
          </div>
          <div className="mt-1 text-[11px] leading-snug text-text-dim">
            Fraction of {mode === "historical" ? "historical starting years" : "bootstrap paths"} where{" "}
            <span className="num text-text">
              {formatUSDCompact(effectiveStartingNW)}
            </span>{" "}
            survived a {horizonYears}-year retirement at{" "}
            <span className="num text-text">
              {formatUSDCompact(annualSpend)}
            </span>
            /yr real spend ({(effectiveWR * 100).toFixed(2)}% starting WR).
            {failedPaths.length > 0 && mode === "historical" && (
              <>
                {" "}Failures clustered around{" "}
                <span className="text-text">
                  {[...new Set(failedPaths.map((p) => p.id))]
                    .slice(0, 5)
                    .join(", ")}
                  {failedPaths.length > 5 ? "…" : ""}
                </span>
                .
              </>
            )}
          </div>
          {startingMode === "at_target" && currentNW < targetNW && (
            <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[10px] leading-snug text-accent">
              Testing your plan at the target NW{" "}
              <span className="num">{formatUSDCompact(targetNW)}</span> (not
              your current{" "}
              <span className="num">{formatUSDCompact(currentNW)}</span>).
              The accumulation question — &ldquo;will I reach the
              target?&rdquo; — is answered by the Outlook tab.
            </div>
          )}
          {/* Deleveraging-at-retirement tax hit. Surfaces when the
              user has non-recognized leveraged ETFs in taxable
              accounts — the stress test models a retirement-date
              restructure and applies capital-gains tax at the
              configured retirement tax rate, reducing the starting
              NW the sim runs from. Without this annotation, users
              would see a smaller-than-expected starting NW and
              wonder why. */}
          {taxHitFraction > 0 && (
            <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
              Starting NW reflects a ~
              <span className="num">
                {formatUSDCompact(startingNW * taxHitFraction)}
              </span>{" "}
              capital-gains tax hit from deleveraging non-2x-SPY
              leveraged ETFs at retirement (
              <span className="num">
                {((effective.retirementTaxRate ?? 0.2) * 100).toFixed(0)}%
              </span>{" "}
              retirement tax rate × 100% gain assumption × value in
              taxable accounts). See the leveraged-allocation warning
              on the Allocation page for the per-position breakdown.
            </div>
          )}
          {effectiveWR > 0.06 && (
            <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
              Starting WR is{" "}
              <span className="num">{(effectiveWR * 100).toFixed(2)}%</span> —
              well above the 4% Trinity baseline. Low success rates here
              mostly reflect that mismatch, not your allocation.
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PercentileBox
            label="Deep tail (p1)"
            value={result.endingNetWorthPercentiles.p1}
          />
          <PercentileBox
            label="Worst-case (p5)"
            value={result.endingNetWorthPercentiles.p5}
          />
          <PercentileBox
            label="p25"
            value={result.endingNetWorthPercentiles.p25}
          />
          <PercentileBox
            label="Median (p50)"
            value={result.endingNetWorthPercentiles.p50}
          />
          <PercentileBox
            label="p75"
            value={result.endingNetWorthPercentiles.p75}
          />
          <PercentileBox
            label="Best-case (p95)"
            value={result.endingNetWorthPercentiles.p95}
          />
        </div>

        {worstPath && mode === "historical" && (
          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-3 py-2 text-[11px] leading-snug text-amber-200">
            Worst start:{" "}
            <span className="font-semibold">{worstPath.id}</span>
            {/* When the user has 2x exposure and the worst-failure
                start year predates the real RYTNX data (2001), flag
                that the 2x return for that sequence came from the
                projection formula, not direct observation. Keeps
                the UI honest about what's measured vs modeled. */}
            {stocks2xFraction > 0 &&
              Number.isFinite(Number(worstPath.id)) &&
              Number(worstPath.id) < LEVERAGED_2X_REAL_DATA_START_YEAR && (
                <span className="ml-1.5 inline-flex items-center rounded border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                  Projected 2x
                </span>
              )}{" "}
            →{" "}
            {worstPath.survived
              ? `survived but ended at ${formatUSDCompact(worstPath.endingNetWorthUSD)} real`
              : `ran out of money in year ${worstPath.failedAtYear}`}
            . This was likely the {worstPathContext(worstPath.id)}.
          </div>
        )}

        <Fan
          chart={result.yearlyPercentiles}
          worstPath={worstPath}
          bestPath={bestPath}
        />

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <NumberInput
            label="Starting NW"
            prefix="$"
            value={startingNW}
            onChange={(v) => {
              setStartingNWTouched(true);
              setStartingNW(Math.max(0, v));
            }}
            step={10_000}
            min={0}
            max={500_000_000}
          />
          <NumberInput
            label="Annual real spend"
            prefix="$"
            value={annualSpend}
            onChange={(v) => setAnnualSpend(Math.max(0, v))}
            step={1000}
            min={0}
            max={5_000_000}
          />
          <NumberInput
            label="Horizon (yrs)"
            value={horizonYears}
            onChange={(v) => setHorizonYears(Math.max(1, Math.min(60, v)))}
            step={1}
            min={1}
            max={60}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="inline-flex gap-1 rounded-full border border-border bg-bg-elevated p-0.5">
            <ModeChip
              label="Historical"
              active={mode === "historical"}
              onClick={() => setMode("historical")}
            />
            <ModeChip
              label="Bootstrap"
              active={mode === "bootstrap"}
              onClick={() => setMode("bootstrap")}
            />
          </div>
          {mode === "bootstrap" && (
            <NumberInput
              label="Paths"
              value={bootstrapPaths}
              onChange={(v) =>
                setBootstrapPaths(Math.max(100, Math.min(10000, v)))
              }
              step={500}
              min={100}
              max={10_000}
              compact
            />
          )}
        </div>

        {otherAltsShare > 0.01 && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="min-w-0 text-[10px] leading-snug text-text-dim">
              <span className="text-text">Model alts</span> (crypto,
              private stock, other) as
            </div>
            <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-border bg-bg-surface p-0.5">
              <ModeChip
                label="Stocks"
                active={altsAs === "stocks"}
                onClick={() => setAltsAs("stocks")}
              />
              <ModeChip
                label="Cash"
                active={altsAs === "cash"}
                onClick={() => setAltsAs("cash")}
              />
            </div>
          </div>
        )}

        {/* Rebalance × Cash-bucket as two orthogonal toggles.
            The 2×2 matrix:
              - annual + bucket-off: Trinity baseline
              - annual + bucket-on:  refilling reserve (Kitces)
              - none + bucket-off:   drift, proportional draw
              - none + bucket-on:    depleting reserve (Pfau) —
                                     finite SORR shield for early
                                     retirement years */}
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
          <div className="min-w-0 text-[10px] leading-snug text-text-dim">
            <span className="text-text">Rebalance</span> between
            asset classes
          </div>
          <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-border bg-bg-surface p-0.5">
            <ModeChip
              label="Annual"
              active={rebalance === "annual"}
              onClick={() => setRebalance("annual")}
            />
            <ModeChip
              label="None"
              active={rebalance === "none"}
              onClick={() => setRebalance("none")}
            />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
          <div className="min-w-0 text-[10px] leading-snug text-text-dim">
            <span className="text-text">Cash-bucket priority</span> in
            retirement (draw cash before equity)
          </div>
          <div className="inline-flex shrink-0 gap-0.5 rounded-full border border-border bg-bg-surface p-0.5">
            <ModeChip
              label="Off"
              active={!cashBucketPriority}
              onClick={() => setCashBucketPriority(false)}
            />
            <ModeChip
              label="On"
              active={cashBucketPriority}
              onClick={() => setCashBucketPriority(true)}
            />
          </div>
        </div>
        {cashBucketPriority && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="min-w-0 text-[10px] leading-snug text-text-dim">
              <span className="text-text">Cash bucket size</span>{" "}
              (override; default = today&apos;s cash share{" "}
              <span className="num">
                {(cashShareToday * 100).toFixed(2)}%
              </span>
              )
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1">
              <NumberInput
                label="%"
                value={cashBucketSizePct ?? Math.round(cashShareToday * 100)}
                onChange={(v) =>
                  setCashBucketSizePct(
                    Math.max(0, Math.min(CASH_BUCKET_MAX_PCT, v)),
                  )
                }
                step={1}
                min={0}
                max={CASH_BUCKET_MAX_PCT}
                compact
              />
            </span>
          </div>
        )}
        {cashBucketPriority && cashFractionEffective < 0.005 && (
          <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
            Cash-bucket priority is on but your effective cash slice
            is essentially 0%. With no cash to drain, the policy
            no-ops — either set a Cash bucket size above or add
            cash to your real portfolio.
          </div>
        )}
        {cashBucketPriority &&
          cashBucketSizePct != null &&
          cashBucketSizePct / 100 > cashShareToday + 0.001 && (
            <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-200">
              You&apos;ve sized the bucket above today&apos;s cash
              share. In reality, funding the larger bucket means
              selling equity at retirement — capital-gains tax on
              that sale is NOT modeled in this v1. Treat the
              success rate as an upper bound; the real-world
              number is lower by roughly the tax cost on the
              equity-to-cash swap.
            </div>
          )}

        <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2 text-[10px] leading-snug text-text-dim">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Methodology
          </div>
          <div className="font-medium text-text">
            What the stress test is actually doing
          </div>
          <ul className="mt-1 space-y-1">
            {scenarioName && (
              <li>
                <span className="text-text">
                  Active scenario:{" "}
                  <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-accent">
                    {scenarioName}
                  </span>
                </span>{" "}
                — withdrawal rate / target NW / legacy floor overrides
                propagate into the spend &amp; starting-NW defaults
                above. Contribution multipliers don&apos;t apply (MC is
                a drawdown-phase sim — contributions are accumulation-
                phase). CAGR overrides don&apos;t apply either: this
                sim draws returns from the historical dataset, not
                from your expected-CAGR assumptions.
              </li>
            )}
            <li>
              <span className="text-text">Real-terms throughout</span> —
              returns, spend, and NW are all in today&apos;s dollars; no
              nominal/CPI mixing.
            </li>
            <li>
              <span className="text-text">
                Allocation inferred from your portfolio
                {yearsToTarget > 0 && " AT target date"}:
              </span>{" "}
              {(allocation.stocksFraction * 100).toFixed(2)}% stocks /{" "}
              {(allocation.bondsFraction * 100).toFixed(2)}% bonds /{" "}
              {(allocation.cashFraction * 100).toFixed(2)}% cash
              {stocks2xFraction > 0.00005 && (
                <>
                  {" "}/ {(stocks2xFraction * 100).toFixed(2)}% 2x equity
                  (RYTNX series — real 2001+, projected pre-2001)
                </>
              )}
              {commodityShare > 0.00005 && (
                <>
                  {" "}/ {(commodityShare * 100).toFixed(2)}% commodity
                  (gold series)
                </>
              )}
              {realEstateShare > 0.00005 && (
                <>
                  {" "}/ {(realEstateShare * 100).toFixed(2)}% real estate
                  (Damodaran RE price series)
                </>
              )}
              {otherAltsShare > 0.00005 && (
                <>
                  {" "}/ {(otherAltsShare * 100).toFixed(2)}% alts (
                  {altsAs === "stocks" ? "as stocks" : "as cash"})
                </>
              )}
              .
            </li>
            {yearsToTarget > 0 && (
              <li>
                <span className="text-text">
                  Composition projected forward {yearsToTarget.toFixed(1)} yrs
                  to target date.
                </span>{" "}
                The MC sim starts at your target NW, so the allocation it
                uses reflects what the portfolio will look like AT
                target — each holding aged at its own expected real
                CAGR, contributions compounded in, liabilities amortized.
                This is why scenario CAGR / contribution overrides shift
                the MC results: they change the growth trajectory and
                therefore the at-retirement mix, even though today&apos;s
                holdings are unchanged.
              </li>
            )}
            {rebalance === "annual" ? (
              glidePathActive ? (
                <li>
                  <span className="text-text">
                    Glide path active + annual rebalance.
                  </span>{" "}
                  Allocation interpolates per year between your{" "}
                  {glidePath!.waypoints.length} waypoint
                  {glidePath!.waypoints.length === 1 ? "" : "s"} as
                  you age (currently {memberAge}). The percentages
                  shown above are <em>today&apos;s</em> mix; the
                  simulator resolves the per-year mix and snaps to
                  it each year (rebalance-to-target — no drift
                  tracking between rebalances).
                </li>
              ) : (
                <li>
                  <span className="text-text">
                    Static allocation + annual rebalance-to-target.
                  </span>{" "}
                  The mix above is held constant across the horizon;
                  the simulator snaps to it every year before applying
                  that year&apos;s returns (no drift tracking between
                  rebalances — matches Trinity Study / cfiresim
                  defaults). Configure a glide path on the Allocation
                  page and it&apos;ll honor that here instead.
                </li>
              )
            ) : (
              <li>
                <span className="text-text">
                  Set-and-forget — no rebalancing across the horizon.
                </span>{" "}
                Initial weights are{" "}
                {glidePathActive
                  ? "drawn from your glide path's age-" +
                    memberAge +
                    " waypoint (later waypoints are ignored — no rebalance = no glide-target snap)"
                  : "your current static allocation"}{" "}
                and the portfolio drifts based on differential class
                returns thereafter. Cash flow (spend / contributions)
                is distributed proportionally to current weights each
                year so it doesn&apos;t itself force a rebalance.
                Drift can raise expected wealth in stocks-outperform
                sequences AND raise sequence-risk exposure when
                equity grows beyond your target — neither effect is
                small over a 30+ year horizon.
              </li>
            )}
            {cashBucketPriority && (
              <li>
                <span className="text-text">
                  Cash-bucket priority {rebalance === "annual"
                    ? "(refilling reserve, Kitces interp.)"
                    : "(depleting reserve, Pfau interp.)"}
                  .
                </span>{" "}
                Retirement-year withdrawals come from the{" "}
                <span className="num text-text">
                  {(allocation.cashFraction * 100).toFixed(2)}%
                </span>{" "}
                cash slice first — only spilling proportionally to
                other classes when cash runs dry.{" "}
                {rebalance === "annual"
                  ? "CAVEAT: with annual rebalance, the next year-start snap restores cash share from appreciated equity. So at year-end MC snapshot resolution (what this simulator measures), the success rate is IDENTICAL to annual + no-bucket. The benefit is within-year liquidity / tax-lot timing, NOT survival rate. For OBSERVABLE SORR shielding in the simulator, switch rebalance to 'no rebalance' (depleting reserve)."
                  : "Cash is NEVER refilled (no rebalance) — the slice monotonically depletes. Once exhausted, withdrawals fall through to proportional draw. This is a FINITE shield for the early-retirement danger zone (typically ~5-10 years), not perpetual protection. Survival rate genuinely diverges from no-bucket."}{" "}
                Composes with the fixed-nominal freeze and variable
                haircut: all three can be on simultaneously.
              </li>
            )}
            <li>
              <span className="text-text">
                Mid-year cash-flow timing.
              </span>{" "}
              Contributions (pre-retirement) and spend (retirement)
              are applied at mid-year: a $40K real spend in a −10%
              year reduces NW by $40K × (1 + −0.05) = $38K, not the
              full $40K — the unspent half avoids the second half of
              the drawdown. Matches the deterministic Independence
              projection.
            </li>
            {(leveragedBuckets.stocks2xUSD +
              leveragedBuckets.postTaxDeleverageToStocks2xUSD >
              0) && (
              <li>
                <span className="text-text">
                  2x equity routes to the stocks2x return series
                </span>{" "}
                — RYTNX-derived real data 2001+, formula-projected
                pre-2001. Recognized 2x SPY positions (SSO/SPUU/QLD)
                are kept at face value;{" "}
                {leveragedBuckets.postTaxDeleverageToStocks2xUSD > 0 &&
                  "3x SPY/Nasdaq positions (UPRO/SPXL/TQQQ) are modeled as deleveraged to 2x at retirement, post-tax."}
              </li>
            )}
            {leveragedBuckets.deleveragingTaxHitUSD > 0 && (
              <li>
                <span className="text-text">
                  At-retirement deleveraging restructure.
                </span>{" "}
                Non-recognized leveraged positions are modeled as
                restructured at retirement (3x SPY/Nasdaq → 2x, other
                concentrated leverage → 1x). Capital-gains tax on the
                restructure (only for positions in taxable accounts)
                is applied to starting NW at the retirement tax rate
                — see the amber callout above the success-rate panel
                for your scenario&apos;s numbers.
              </li>
            )}
            {commodityShare > 0.001 && (
              <li>
                <span className="text-text">Commodity routing:</span> any
                metal (silver, copper, industrial) is modeled with the
                same gold real-return series as a stand-in until a
                per-metal dataset lands.
              </li>
            )}
            {realEstateShare > 0.001 && (
              <li>
                <span className="text-text">Real-estate routing:</span>{" "}
                Damodaran&apos;s RE series is PRICE return only (no
                rental yield), so it understates leveraged-rental
                performance. Better than dumping RE into stocks.
                {reIsLevered && (
                  <>
                    {" "}You hold mortgaged RE (avg {reLeverage.toFixed(1)}×
                    leverage). The simulator applies <em>unlevered</em>{" "}
                    price returns to your equity stake — long-run
                    averages roughly net out (rental yield omitted ≈
                    mortgage interest + maintenance paid), but
                    short-term volatility is understated: a −10% real
                    RE year on a 5×-levered home actually wipes ≈ 50%
                    of the equity. If your RE exposure matters to
                    your retirement plan, model it conservatively.
                  </>
                )}
              </li>
            )}
            <li>
              <span className="text-text">Data source:</span> Damodaran
              Jan 2026 refresh — S&amp;P 500, 10Y T-Bond, 3-mo T-Bill,
              Baa Corp, RE, Gold, plus RYTNX-derived 2x SPY (projected
              pre-2001). CPI-deflated to real returns. Past returns
              don&apos;t predict future ones.{" "}
              <button
                type="button"
                onClick={() => setHistoricalTableOpen(true)}
                className="rounded-sm text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                View year-by-year table →
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Year-by-year historical-returns viewer. Renders nothing when
          closed; the modal manages its own Escape / backdrop dismiss
          handlers so we don't have to wire them up here. */}
      <HistoricalReturnsTableModal
        open={historicalTableOpen}
        onClose={() => setHistoricalTableOpen(false)}
      />
    </section>
  );
}

