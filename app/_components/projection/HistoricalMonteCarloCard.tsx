"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  effectiveHouseholdAssumptions,
  resolveAssumptionsForMember,
} from "@/lib/projection/useActiveProjection";
import {
  HISTORICAL_RETURNS_FIRST_YEAR,
  HISTORICAL_RETURNS_LAST_YEAR,
  LEVERAGED_2X_REAL_DATA_START_YEAR,
} from "@/lib/data/historicalReturns";
import {
  runBootstrap,
  runHistoricalSequences,
  type MonteCarloResult,
  type SimulationPath,
} from "@/lib/projection/monteCarlo";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { computeLeveragedEquityBuckets } from "@/lib/portfolio/leveragedEquity";
import {
  activeMemberIds,
  activeMembers,
  filterHousehold,
  householdForRollups,
  householdNetWorth,
  liquidHousehold,
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
  const household = useAppStore((s) => s.household);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const budgetItems = useAppStore((s) => s.budgetItems);
  const incomeStreams = useAppStore((s) => s.incomeStreams);
  const liquidityView = useAppStore((s) => s.liquidityView);

  // Same effective-assumptions resolution as Plan tab uses.
  const effective = memberId
    ? resolveAssumptionsForMember(
        assumptions,
        memberAssumptions,
        memberId,
      )
    : effectiveHouseholdAssumptions(
        assumptions,
        memberAssumptions,
        // Pre-filter through activeMembers so blended assumptions
        // honor the include-in-rollup flag (same filter used by
        // income / age helpers — single source of truth).
        activeMembers(household),
      );

  // Honor all three global filters: rollup-include → member →
  // liquidity. When no specific member is selected, the rollup
  // view is the default scoping (excluded members' accounts +
  // liabilities drop out of NW + allocation). When a member IS
  // explicitly selected, that filter wins — you see THAT person's
  // view regardless of their rollup-include flag.
  //
  // (Mirrors the composition in `useActiveProjection`. Kept
  // inline here because this card pre-computes inputs for the MC
  // simulator separately from the projection hook.)
  const scopedHousehold = useMemo(() => {
    const scoped = memberId
      ? filterHousehold(household, memberId)
      : householdForRollups(household);
    return liquidityView === "liquid" ? liquidHousehold(scoped) : scoped;
  }, [household, memberId, liquidityView]);

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

  const portfolio = useMemo(
    () => computePortfolio(scopedHousehold),
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
  // Split equity into the 2x-recognized bucket (SSO/SPUU/QLD) and the
  // remainder, so the simulator can route the 2x portion to the
  // RYTNX-derived `stocks2x` return series. Non-recognized leveraged
  // equity (TQQQ/UPRO/SOXL/etc.) stays in the regular stocks bucket;
  // the warning card surfaces those positions separately.
  const leveragedBuckets = useMemo(
    () => computeLeveragedEquityBuckets(scopedHousehold),
    [scopedHousehold],
  );
  const stocks2xFraction =
    portfolio.netWorthUSD > 0
      ? leveragedBuckets.stocks2xUSD / portfolio.netWorthUSD
      : 0;
  const regularStocksFraction = Math.max(
    0,
    portfolio.classes.equityShare - stocks2xFraction,
  );
  const allocation = useMemo(
    () => ({
      stocksFraction: regularStocksFraction,
      stocks2xFraction,
      bondsFraction: portfolio.classes.bondShare,
      cashFraction: portfolio.classes.cashShare,
      commodityFraction: commodityShare,
      realEstateFraction: realEstateShare,
      otherFraction: otherAltsShare,
    }),
    [
      regularStocksFraction,
      stocks2xFraction,
      portfolio.classes.bondShare,
      portfolio.classes.cashShare,
      commodityShare,
      realEstateShare,
      otherAltsShare,
    ],
  );

  const effectiveStartingNW = Math.max(0, startingNW);
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
          activeMemberIds(household),
        ),
        new Date().getFullYear(),
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
      return runHistoricalSequences(inputs);
    }
    return runBootstrap(inputs, {
      paths: Math.max(100, Math.min(10000, bootstrapPaths)),
      seed: 1, // deterministic — UI feels stable across re-renders
    });
  }, [
    effectiveStartingNW,
    allocation,
    annualSpend,
    budgetItems,
    incomeStreams,
    household,
    memberId,
    effective,
    horizonYears,
    mode,
    bootstrapPaths,
    altsAs,
    glidePathActive,
    glidePath,
    memberAge,
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

        <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2 text-[10px] leading-snug text-text-dim">
          <div className="font-medium text-text">What this is modeling</div>
          <ul className="mt-1 space-y-1">
            <li>
              <span className="text-text">Real-terms throughout</span> —
              returns, spend, and NW are all in today&apos;s dollars; no
              nominal/CPI mixing.
            </li>
            <li>
              <span className="text-text">Allocation inferred from your portfolio:</span>{" "}
              {(allocation.stocksFraction * 100).toFixed(0)}% stocks /{" "}
              {(allocation.bondsFraction * 100).toFixed(0)}% bonds /{" "}
              {(allocation.cashFraction * 100).toFixed(0)}% cash
              {commodityShare > 0.001 && (
                <>
                  {" "}/ {(commodityShare * 100).toFixed(0)}% commodity
                  (gold series)
                </>
              )}
              {realEstateShare > 0.001 && (
                <>
                  {" "}/ {(realEstateShare * 100).toFixed(0)}% real estate
                  (Damodaran RE price series)
                </>
              )}
              {otherAltsShare > 0.001 && (
                <>
                  {" "}/ {(otherAltsShare * 100).toFixed(0)}% alts (
                  {altsAs === "stocks" ? "as stocks" : "as cash"})
                </>
              )}
              .
            </li>
            {glidePathActive ? (
              <li>
                <span className="text-text">Glide path active.</span>{" "}
                Allocation interpolates per year between your{" "}
                {glidePath!.waypoints.length} waypoint
                {glidePath!.waypoints.length === 1 ? "" : "s"} as you
                age (currently {memberAge}). The percentages shown
                above are <em>today&apos;s</em> mix; the simulator
                resolves the actual mix for each future year.
                Annual rebalancing assumed.
              </li>
            ) : (
              <li>
                <span className="text-text">Static allocation, annual rebalance.</span>{" "}
                The mix above is held constant across the horizon. If
                you configure a glide-path on the Allocation page,
                the simulator will honor it here.
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

