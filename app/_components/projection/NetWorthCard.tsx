"use client";

import { useEffect, useMemo, useState } from "react";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { projectIndependence } from "@/lib/projection/independence";
import {
  formatLeverage,
  formatPercent,
  formatUSD,
  formatUSDCompact,
} from "@/lib/format";
import {
  activeMemberIds,
  householdNetWorth,
  type Household,
} from "@/lib/types";
import {
  filterIncomeStreamsForRollups,
  incomePerYearUSD,
} from "@/lib/budget/incomeStreams";
import { useAppStore } from "@/lib/store";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { runHistoricalSequences } from "@/lib/projection/monteCarlo";
import {
  type MonteCarloOverlay,
  type ProjectionChartVisibility,
} from "./ProjectionChart";
import { LiquidityChip } from "@/app/_components/ui/LiquidityChip";
import { LiquidOnlyCaption } from "@/app/_components/shell/LiquidOnlyCaption";
import { ProjectionView } from "./net-worth/ProjectionView";
import { HistoryView } from "./net-worth/HistoryView";

type Tab = "projection" | "history";

export function NetWorthCard() {
  const { household: viewHousehold, assumptions, scenarioName, memberId } =
    useActiveProjection();
  // Future-income streams, scoped via the same composition rule
  // the rest of the rollup machinery uses (per-member view vs
  // household-aggregate, with rollup-include filtering). The
  // projection adds this as a positive monthly cash flow, so a
  // ten-year consulting gig pulls Independence Day sooner AND
  // protects against lost-decade ruin.
  const incomeStreams = useAppStore((s) => s.incomeStreams);
  const householdAll = useAppStore((s) => s.household);
  // The projection engine iterates up to ~70 years (the
  // accumulation cap); size the array to cover both that and the
  // drawdown horizon so the simulator never hits an off-the-end
  // year that silently reads 0 income while the stream is still
  // supposed to be active.
  const incomePerYear = useMemo(
    () =>
      incomePerYearUSD(
        filterIncomeStreamsForRollups(
          incomeStreams,
          memberId,
          activeMemberIds(householdAll),
        ),
        new Date().getFullYear(),
        100,
      ),
    [incomeStreams, memberId, householdAll],
  );
  // `mounted` gates time-dependent rendering (the "Live · Nm ago"
  // chip below). SSR + first client render show the chip without
  // the relative time; once useEffect runs post-hydration the
  // relative-time tail appears. Without this gate, Date.now() at
  // SSR returns a different value than Date.now() at first client
  // render, and React 19 logs a hydration mismatch (#418). The
  // canonical "did-mount" pattern needs a single setState in the
  // effect; same exception other files in this codebase take.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => setMounted(true), []);

  const portfolio = useMemo(
    () => computePortfolio(viewHousehold),
    [viewHousehold],
  );
  const netWorth = useMemo(
    () => householdNetWorth(viewHousehold),
    [viewHousehold],
  );
  const projection = useMemo(
    () =>
      projectIndependence(viewHousehold, assumptions, undefined, {
        incomePerYearUSD: incomePerYear,
      }),
    [viewHousehold, assumptions, incomePerYear],
  );
  const stressProjection = useMemo(
    () =>
      projection.independenceDate
        ? projectIndependence(viewHousehold, assumptions, undefined, {
            stress: "lost-decade",
            incomePerYearUSD: incomePerYear,
          })
        : null,
    [viewHousehold, assumptions, projection.independenceDate, incomePerYear],
  );

  const empty = viewHousehold.accounts.length === 0 || netWorth <= 0;
  const [tab, setTab] = useState<Tab>("projection");

  // Chart line visibility. The two dashed horizontals (target +
  // legacy) default ON to preserve existing behavior. The Monte
  // Carlo p50 (median historical-sequence trajectory) defaults ON
  // so the dashboard's first-impression includes a stochastic-aware
  // anchor alongside the deterministic projection — the lazy MC
  // compute below kicks in on first paint, which costs a single
  // historical-sequence pass but is fast enough to be invisible to
  // the user. p5 / p95 / worst remain OFF by default so the chart
  // doesn't immediately look cluttered. Independence + ruin markers
  // are always on (they're meaningful event pins, not editorialized
  // lines); stress overlay default ON when available so existing
  // Pro users don't lose the line.
  const [lineVis, setLineVis] = useState<ProjectionChartVisibility>({
    target: true,
    legacy: true,
    stress: true,
    independenceMarker: true,
    ruinMarker: true,
    mcWorst: false,
    mcP5: false,
    mcP50: true,
    mcP95: false,
  });
  const toggleLine = (k: keyof ProjectionChartVisibility) =>
    setLineVis((v) => ({ ...v, [k]: !v[k] }));

  // Lazy MC compute. Only runs the historical-sequence pass when
  // the user has enabled at least one MC overlay chip, so the
  // home chart's first-paint cost is unchanged for the default
  // configuration. We pull allocation + horizon from the same
  // sources HistoricalMonteCarloCard uses, so the overlay numbers
  // reconcile across the Stress tab and the home chart.
  const mcEnabled = Boolean(
    lineVis.mcWorst || lineVis.mcP5 || lineVis.mcP50 || lineVis.mcP95,
  );
  const mcOverlay = useMemo<MonteCarloOverlay | null>(() => {
    if (!mcEnabled) return null;
    const portfolioMetrics = portfolio.classes;
    // Drawdown question framing: start MC at max(current, target).
    // Matches the Historical Monte Carlo card so the two surfaces
    // tell the same story.
    const startingNW = Math.max(
      netWorth,
      assumptions.targetNetWorthUSD || 0,
    );
    if (startingNW <= 0) return null;
    const annualSpend =
      (assumptions.withdrawalRate || 0.04) * (assumptions.targetNetWorthUSD || startingNW);
    const horizon = Math.max(
      1,
      Math.min(60, Math.round(assumptions.drawdownHorizonYears || 30)),
    );
    const otherFraction =
      portfolioMetrics.cryptoShare +
      portfolioMetrics.privateStockShare +
      portfolioMetrics.otherShare;
    const result = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: {
        stocksFraction: portfolioMetrics.equityShare,
        bondsFraction: portfolioMetrics.bondShare,
        cashFraction: portfolioMetrics.cashShare,
        commodityFraction: portfolioMetrics.commodityShare,
        realEstateFraction: portfolioMetrics.realEstateShare,
        otherFraction,
      },
      annualSpendUSD: annualSpend,
      // Pass the same per-year income array the projection uses
      // so the worst-historical sequence respects income streams
      // too. Without this, the chart's "lost decade" overlay
      // would show portfolio ruin in scenarios where the user
      // actually has $24k/yr Social Security coming in.
      incomePerYearUSD: incomePerYear,
      retirementHorizonYears: horizon,
      otherTreatedAsStocks: true,
    });
    if (result.paths.length === 0) return null;
    // Worst trajectory: the path with the lowest ending NW. The
    // path id is the historical starting year (e.g. "1929" or
    // "1966") so the legend can label it specifically.
    const worst = result.paths
      .slice()
      .sort((a, b) => a.endingNetWorthUSD - b.endingNetWorthUSD)[0];
    // MC's year-0 corresponds to the Independence point (or, if the user is
    // already past target, today). Map it to the chart's month
    // axis via the deterministic projection's independenceSeriesIndex.
    const independenceMonth =
      projection.independenceSeriesIndex != null
        ? projection.series[projection.independenceSeriesIndex].monthOffset
        : 0;
    return {
      startMonthOffset: independenceMonth,
      worstId: worst.id,
      worst: worst.trajectory,
      p5: result.yearlyPercentiles.p5,
      p50: result.yearlyPercentiles.p50,
      p95: result.yearlyPercentiles.p95,
    };
  }, [
    mcEnabled,
    portfolio,
    netWorth,
    assumptions,
    incomePerYear,
    projection.independenceSeriesIndex,
    projection.series,
  ]);

  return (
    <section className="px-5">
      <div className="rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Net worth
            {scenarioName && (
              <span className="ml-2 normal-case tracking-normal text-accent">
                · {scenarioName}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {/*
              Liquidity filter chip — only renders when the household
              has illiquid holdings. Compact pill style so it doesn't
              compete visually with the headline net-worth figure.
            */}
            <LiquidityChip />
            <span className="text-[11px] text-text-dim">
              Target {formatUSDCompact(assumptions.targetNetWorthUSD)}
            </span>
          </span>
        </div>
        <div className="mt-1.5 num text-4xl font-semibold">
          {formatUSD(netWorth)}
        </div>
        <LiquidOnlyCaption memberId={memberId} />
        {!empty && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-dim">
            <span>
              {formatPercent(portfolio.weightedRealCAGR)} weighted real return
            </span>
            {/*
              Effective leverage is free for everyone — the engine
              computes it from preset defaults (e.g. TQQQ → 3×, UPRO
              → 3×, real-estate → user-entered mortgage leverage).
              Only the per-holding leverage override is gated to Pro;
              the rolled-up number is informational and shouldn't be
              paywalled. We hide it when it's effectively 1× to keep
              the caption short for unleveraged portfolios.
            */}
            {portfolio.effectiveLeverage > 1.01 && (
              <>
                <span>·</span>
                <span
                  className={
                    portfolio.effectiveLeverage <= 1.25
                      ? "text-text-dim"
                      : portfolio.effectiveLeverage <= 2
                        ? "text-amber-300"
                        : "text-negative"
                  }
                >
                  {formatLeverage(portfolio.effectiveLeverage)} effective leverage
                </span>
              </>
            )}
            {(() => {
              const t = mostRecentPriceAt(viewHousehold);
              if (!t) return null;
              return (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
                    {/* Only show the relative-time tail after mount —
                        Date.now() during SSR vs client render would
                        otherwise differ and trip a hydration warning. */}
                    Live{mounted ? ` · ${formatTerseRelative(t)}` : ""}
                  </span>
                </>
              );
            })()}
          </div>
        )}

        <div className="mt-3 flex gap-1 rounded-full border border-border bg-bg-elevated p-0.5">
          <TabBtn
            active={tab === "projection"}
            onClick={() => setTab("projection")}
            label="Projection"
          />
          <TabBtn
            active={tab === "history"}
            onClick={() => setTab("history")}
            label="History"
          />
        </div>

        {tab === "projection" ? (
          <ProjectionView
            projection={projection}
            stressProjection={stressProjection}
            assumptions={assumptions}
            empty={empty}
            lineVis={lineVis}
            toggleLine={toggleLine}
            mcOverlay={mcOverlay}
            mcLoading={mcEnabled && mcOverlay == null}
          />
        ) : (
          <HistoryView
            household={viewHousehold}
            netWorth={netWorth}
            memberId={memberId}
            empty={empty}
          />
        )}
      </div>
    </section>
  );
}

function TabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition active:opacity-70 ${
        active ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}


export function HomeMetrics() {
  const { household: filtered } = useActiveProjection();
  const m = useMemo(() => computePortfolio(filtered), [filtered]);
  if (m.netWorthUSD === 0) return null;
  const leverageColor =
    m.effectiveLeverage <= 1.25
      ? "text-text"
      : m.effectiveLeverage <= 2
        ? "text-amber-300"
        : "text-negative";

  // Effective leverage + Real CAGR are both free — the engine computes
  // them from preset defaults (leveraged ETFs, real-estate mortgages,
  // cash 0×) without needing the per-holding override editor.
  return (
    <section className="px-5 pt-3">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Effective leverage"
          value={formatLeverage(m.effectiveLeverage)}
          sub={`${formatUSDCompact(m.effectiveExposureUSD)} exposure on ${formatUSDCompact(m.netWorthUSD)}`}
          valueClass={`num text-2xl font-semibold ${leverageColor}`}
        />
        <Metric
          label="Real CAGR"
          value={formatPercent(m.weightedRealCAGR)}
          sub="Weighted across all holdings"
          valueClass="num text-2xl font-semibold text-accent"
        />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className={`mt-1 ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-text-dim">{sub}</div>
    </div>
  );
}

/**
 * Most-recent price-fetch timestamp across all live-priced holdings.
 * Drives the "Live · 3m ago" freshness indicator in the card header.
 */
function mostRecentPriceAt(household: Household): number | null {
  let latest: number | null = null;
  for (const account of household.accounts) {
    for (const holding of account.holdings) {
      if (
        holding.kind !== "equity" &&
        holding.kind !== "bond" &&
        holding.kind !== "crypto"
      ) {
        continue;
      }
      if (holding.lastPricedAt == null) continue;
      if (latest == null || holding.lastPricedAt > latest) {
        latest = holding.lastPricedAt;
      }
    }
  }
  return latest;
}

/** Compact "Nm ago" / "Nh ago" / "Nd ago" relative-time string. */
function formatTerseRelative(t: number): string {
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
