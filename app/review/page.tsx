"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { AuthHydrator } from "@/app/_components/infra/AuthHydrator";
import { PersistenceHydrator } from "@/app/_components/infra/PersistenceHydrator";
import {
  effectiveHouseholdAssumptions,
  resolveAssumptionsForMember,
} from "@/lib/projection/useActiveProjection";
import {
  activeMembers,
  filterHousehold,
  filterHouseholdByTaxBucket,
  householdForRollups,
  householdNetWorth,
  householdIncomeSum,
  liquidHousehold,
  TAX_TREATMENT_LABELS,
  taxBucketTotals,
  totalMonthlyContributions,
  type Holding,
  type TaxTreatment,
} from "@/lib/types";
import {
  filterHouseholdByClass,
  leverageBuckets,
} from "@/lib/portfolio/leverageBuckets";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import {
  suggestedIndependenceCorpus,
  weightedRealExcess,
} from "@/lib/budget/budget";
import { runHistoricalSequences } from "@/lib/projection/monteCarlo";
import { memberFilteredSnapshots } from "@/lib/data/history";
import { loadSnapshots, type Snapshot } from "@/lib/persistence/persistence";
import { formatUSD, formatUSDCompact, formatPercent } from "@/lib/format";
import { applyScenario } from "@/lib/insights/scenarios";
import { AllocBar, KV, LeverageBar, Section, TaxBar } from "./_components";

/**
 * /review — printable Annual Review.
 *
 * One-page artifact users actually keep and share. Pulls together:
 *   - Current NW + breakdown
 *   - YoY change (from snapshots, if any)
 *   - Savings rate + total contributions
 *   - Independence projection (target, suggested corpus, gap, blended
 *     real-excess inflation note)
 *   - Allocation snapshot
 *   - Historical Monte Carlo success rate (Trinity-style, real)
 *
 * Print CSS hides nav + decorations so the user gets a clean
 * letter-page artifact when they hit Cmd+P. No server round-
 * trip; everything renders client-side from their existing
 * state.
 */
export default function ReviewPage() {
  const household = useAppStore((s) => s.household);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const budgetItems = useAppStore((s) => s.budgetItems);
  const liquidityView = useAppStore((s) => s.liquidityView);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  // Audit fix (round-3 BLOCK #2): re-fetch on revision bump so
  // the Annual Review picks up snapshot mutations from other
  // tabs (SnapshotsManager edits, TimeTravelBanner saves, auto
  // writes). Empty-deps version showed stale snapshot deltas
  // until next mount.
  const snapshotsRevision = useAppStore((s) => s.snapshotsRevision);
  useEffect(() => {
    void loadSnapshots().then((s) => setSnapshots(s));
  }, [snapshotsRevision]);

  // Round-6 audit HIGH: Annual Review previously read base
  // `assumptions` AND base household, ignoring the active scenario.
  // A user with scenario "Aggressive savings" active would see the
  // Scenarios section list it as "Active" while the headline figures
  // (target, withdrawal rate, NW, MC success rate) reflected the
  // BASE assumptions — internally inconsistent on a printable
  // artifact people save + share. Resolve the active scenario here
  // and feed its (household, assumptions) into every downstream
  // computation. Surface the "Reflecting active scenario" note in
  // the header so the reader knows the figures are NOT the base.
  const scenarios = useAppStore((s) => s.scenarios);
  const activeScenarioId = useAppStore((s) => s.activeScenarioId);
  const activeScenario = activeScenarioId
    ? scenarios.find((sc) => sc.id === activeScenarioId)
    : null;

  const baseEffective = memberId
    ? resolveAssumptionsForMember(assumptions, memberAssumptions, memberId)
    : effectiveHouseholdAssumptions(
        assumptions,
        memberAssumptions,
        // Match the household-aggregate view: blend assumptions
        // for active members only when no specific person is
        // selected. Mirrors the same fix in useActiveProjection.
        activeMembers(household),
      );

  // Apply ALL THREE global filters here so the review consistently
  // shows whatever scope the user was last viewing:
  //   1. rollup-include  — when no member is selected, drop
  //      excluded members + their accounts/liabilities;
  //   2. per-member      — when a member is selected, slice to
  //      their accounts/liabilities (overrides rollup-include);
  //   3. liquidity       — when "liquid" mode is on, keep liquid
  //      holdings only.
  // (Earlier version only applied liquidityView, which let a user
  // in member view see "Annual Review" showing the whole
  // household's NW but only their own contributions — exactly
  // the kind of mismatch that erodes trust in a printable
  // artifact.)
  const baseScopedHousehold = useMemo(() => {
    let h = memberId
      ? filterHousehold(household, memberId)
      : householdForRollups(household);
    if (liquidityView === "liquid") h = liquidHousehold(h);
    return h;
  }, [household, memberId, liquidityView]);

  // Apply active scenario to BOTH household and assumptions, so every
  // downstream value (NW, contributions, target, MC) reflects the
  // same plan view the user is operating in. When no scenario is
  // active, pass-through.
  const { scopedHousehold, effective } = useMemo(() => {
    if (!activeScenario) {
      return { scopedHousehold: baseScopedHousehold, effective: baseEffective };
    }
    const applied = applyScenario(
      baseScopedHousehold,
      baseEffective,
      activeScenario.overrides,
    );
    return { scopedHousehold: applied.household, effective: applied.assumptions };
  }, [activeScenario, baseScopedHousehold, baseEffective]);

  const nw = householdNetWorth(scopedHousehold);
  const portfolio = computePortfolio(scopedHousehold);
  const monthlyContrib = totalMonthlyContributions(household, memberId);
  const householdIncome = householdIncomeSum(household);

  // Leverage buckets — same 4-bucket model as the Allocation page.
  const leverage = useMemo(
    () => leverageBuckets(filterHouseholdByClass(scopedHousehold, "ALL")),
    [scopedHousehold],
  );

  // Tax buckets across the scoped household.
  const taxBuckets = useMemo(
    () => taxBucketTotals(scopedHousehold),
    [scopedHousehold],
  );
  const taxOrder: TaxTreatment[] = [
    "PRE_TAX",
    "ROTH",
    "HSA",
    "TAXABLE",
    "EDUCATION",
  ];
  const taxTotal = taxOrder.reduce((s, t) => s + taxBuckets[t], 0);

  // Top holdings by face value — a concentration view that's a
  // first-class part of any "Can this couple retire?" video. We
  // flatten the scoped household, sort desc by valueUSD, and take
  // the top 8.
  const topHoldings = useMemo(() => {
    const flat: Array<{
      symbol: string;
      kind: Holding["kind"];
      valueUSD: number;
      share: number;
    }> = [];
    for (const a of scopedHousehold.accounts) {
      for (const h of a.holdings) {
        if (h.valueUSD <= 0) continue;
        const symbol =
          h.kind === "cash"
            ? "Cash"
            : h.kind === "real_estate" || h.kind === "other"
              ? h.name
              : h.symbol;
        flat.push({
          symbol,
          kind: h.kind,
          valueUSD: h.valueUSD,
          share: nw > 0 ? h.valueUSD / nw : 0,
        });
      }
    }
    flat.sort((a, b) => b.valueUSD - a.valueUSD);
    return flat.slice(0, 8);
  }, [scopedHousehold, nw]);

  // Goals + healthcare — surface what the user has set up so the
  // printable artifact captures their plan, not just the math.
  // (Scenarios + activeScenario hoisted to the top so they can
  // drive the household + assumptions resolution above.)
  const goals = useAppStore((s) => s.goals);
  const healthPlans = useAppStore((s) => s.healthPlans);

  // YoY change from snapshots. `renderedAt` anchors "one year ago"
  // at mount so the memo stays stable across re-renders — drifting
  // the anchor on every render would also drift the chosen
  // snapshot without changing what the user wanted to see.
  const [renderedAt] = useState<number>(() => Date.now());
  const yoy = useMemo(() => {
    // Round-1 (snapshot audit) CRITICAL: pre-filter snapshots
    // through the member chip so the YoY delta compares the same
    // person's slice (or rollup) on both sides. Without this, a
    // user filtered to "Alex" sees `nw` (Alex's slice) diffed
    // against household-wide snapshot NW → fictional delta on a
    // printable artifact users save + share.
    const filteredSnaps = memberFilteredSnapshots(snapshots, memberId);
    if (filteredSnaps.length === 0) return null;
    const target = renderedAt - 365 * 24 * 60 * 60 * 1000;
    let best: Snapshot | null = null;
    for (const s of filteredSnaps) {
      if (s.t <= target && (!best || s.t > best.t)) best = s;
    }
    if (!best || best.netWorthUSD <= 0) return null;
    const delta = nw - best.netWorthUSD;
    const pct = delta / best.netWorthUSD;
    return { from: best.netWorthUSD, to: nw, delta, pct };
  }, [snapshots, nw, renderedAt, memberId]);

  // Independence math.
  const target = effective.targetNetWorthUSD;
  const gap = target - nw;
  const gapMonths =
    gap > 0 && monthlyContrib > 0
      ? Math.ceil(gap / monthlyContrib)
      : null;

  const suggestedCorpus = useMemo(
    () =>
      suggestedIndependenceCorpus(
        budgetItems,
        effective.withdrawalRate,
        effective.retirementVariableHaircut ?? 0,
        effective.retirementTaxRate,
      ),
    [budgetItems, effective],
  );
  const blendedExcess = useMemo(
    () =>
      weightedRealExcess(
        budgetItems,
        effective.retirementVariableHaircut ?? 0,
      ),
    [budgetItems, effective],
  );

  // Historical Monte Carlo, using current allocation + budget-implied
  // spend (or target × SWR as a fallback).
  //
  // Prefer the budget-derived corpus as the basis when available —
  // it's anchored to actual line items the user typed, not to a
  // synthetic target. Falls back to `target × SWR` when budget is
  // empty or returns null.
  const annualSpend =
    suggestedCorpus != null
      ? suggestedCorpus * effective.withdrawalRate
      : target * effective.withdrawalRate;
  // The Monte Carlo asks the *drawdown* question: "Once I hit my
  // target NW, does my plan survive retirement?" — so the simulation
  // must start at the larger of current NW or target. Starting at
  // current NW (when the user is still accumulating) silently
  // simulates "retire today at planned-target spend," which fails
  // every historical sequence and reports 0% — the bug the user hit
  // when current NW was a fraction of target. Matches the home-page
  // and Stress-tab Historical Monte Carlo card's framing.
  const startingNetWorthUSD = Math.max(nw, target);
  const mcResult = useMemo(
    () =>
      runHistoricalSequences({
        startingNetWorthUSD,
        allocation: {
          stocksFraction: portfolio.classes.equityShare,
          bondsFraction: portfolio.classes.bondShare,
          cashFraction: portfolio.classes.cashShare,
          otherFraction:
            portfolio.classes.cryptoShare +
            portfolio.classes.commodityShare +
            portfolio.classes.realEstateShare +
            portfolio.classes.privateStockShare +
            portfolio.classes.otherShare,
        },
        annualSpendUSD: annualSpend,
        retirementHorizonYears: effective.drawdownHorizonYears ?? 30,
      }),
    [startingNetWorthUSD, portfolio, annualSpend, effective.drawdownHorizonYears],
  );

  const now = new Date();
  const memberName = memberId
    ? household.members.find((m) => m.id === memberId)?.displayName
    : null;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-bg px-6 py-10 text-text print:max-w-none print:bg-white print:px-0 print:py-0 print:text-black">
      {/* Mount the same hydrators the home page has so a cold load
          of /review (bookmark, refresh, deep link) still pulls auth
          + persisted state. If the user navigated client-side from
          /, these are re-mounted (cheap) but no double-fetch
          because zustand state already reflects the session. Both
          components are render-null side-effect mounts; safe to
          place in print:hidden so they don't render anywhere. */}
      <div className="print:hidden">
        <PersistenceHydrator />
        <AuthHydrator />
      </div>
      <div className="print:hidden">
        <Link
          href="/"
          className="text-[12px] text-text-muted hover:text-text"
        >
          ← Back to app
        </Link>
      </div>

      <header className="mt-3 border-b border-border pb-4 print:border-b-2 print:border-black">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold print:text-3xl">
            Annual Independence Review
          </h1>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-[12px] text-text-muted active:opacity-70 hover:text-text print:hidden"
          >
            Print / PDF
          </button>
        </div>
        <div className="mt-1 text-[12px] text-text-dim print:text-gray-600">
          {now.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          {memberName ? ` · ${memberName}` : " · Household view"}
          {activeScenario && ` · Scenario: ${activeScenario.name}`}
        </div>
      </header>

      <Section title="Net worth">
        <KV
          label="Today's net worth (real $)"
          value={formatUSD(nw)}
          big
        />
        {yoy && (
          <KV
            label="Year-over-year"
            value={`${yoy.delta >= 0 ? "+" : "−"}${formatUSDCompact(Math.abs(yoy.delta))} (${(yoy.pct * 100).toFixed(1)}%)`}
            tone={yoy.delta >= 0 ? "positive" : "negative"}
          />
        )}
        <KV
          label="Independence target"
          value={formatUSD(target)}
        />
        <KV
          label="Gap to target"
          value={gap > 0 ? formatUSD(gap) : "Reached"}
          tone={gap > 0 ? "negative" : "positive"}
        />
        {gapMonths != null && (
          <KV
            label="At current contribution rate"
            value={`~${Math.floor(gapMonths / 12)}y ${gapMonths % 12}mo to close the gap (pre-returns)`}
          />
        )}
      </Section>

      <Section title="Allocation">
        <AllocBar
          stocks={portfolio.classes.equityShare}
          bonds={portfolio.classes.bondShare}
          cash={portfolio.classes.cashShare}
          other={
            portfolio.classes.cryptoShare +
            portfolio.classes.commodityShare +
            portfolio.classes.realEstateShare +
            portfolio.classes.privateStockShare +
            portfolio.classes.otherShare
          }
        />
      </Section>

      {/* Leverage breakdown — 4 buckets matching the Allocation page.
          Designed to print well: each row is one line with the
          dollar amount + percent. No expand/collapse chevrons here
          because the print view should show everything inline. */}
      <Section title="Leverage breakdown">
        <LeverageBar buckets={leverage.buckets} />
      </Section>

      {/* Tax-shelter composition — shows pre-tax / Roth / HSA /
          taxable splits with dollar values. Useful for the "are
          they over-concentrated in pre-tax?" question that comes
          up in retirement-planning content. */}
      {taxTotal > 0 && (
        <Section title="Tax buckets">
          <TaxBar
            buckets={taxOrder.map((t) => ({
              label: TAX_TREATMENT_LABELS[t],
              usd: taxBuckets[t],
              share: taxBuckets[t] / taxTotal,
            }))}
          />
        </Section>
      )}

      {/* Top holdings — concentration view, top 8 by face value. */}
      {topHoldings.length > 0 && (
        <Section title="Top holdings">
          <div className="space-y-1">
            {topHoldings.map((h, i) => (
              <div
                key={`${h.symbol}-${i}`}
                className="flex items-baseline justify-between border-b border-border/40 py-1 text-sm print:border-gray-300"
              >
                <span className="min-w-0 flex-1 truncate text-text print:text-black">
                  {h.symbol}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wider text-text-dim print:text-gray-600">
                    {h.kind === "private_stock"
                      ? "Private"
                      : h.kind === "real_estate"
                        ? "Real estate"
                        : h.kind === "commodity"
                          ? "Commodity"
                          : h.kind}
                  </span>
                </span>
                <span className="num shrink-0 text-sm font-semibold text-text print:text-black">
                  {formatUSDCompact(h.valueUSD)}
                  <span className="ml-1.5 text-[10px] text-text-dim print:text-gray-600">
                    {(h.share * 100).toFixed(1)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Savings rate">
        <KV
          label="Monthly contributions"
          value={formatUSD(monthlyContrib)}
        />
        <KV
          label="Annual contributions"
          value={formatUSD(monthlyContrib * 12)}
        />
        {householdIncome != null && householdIncome > 0 && (
          <KV
            label="Savings rate (% of gross income)"
            value={formatPercent((monthlyContrib * 12) / householdIncome)}
          />
        )}
      </Section>

      <Section title="Retirement assumptions">
        <KV
          label="Withdrawal rate (SWR)"
          value={formatPercent(effective.withdrawalRate)}
        />
        <KV
          label="Retirement tax rate"
          value={formatPercent(effective.retirementTaxRate ?? 0.2)}
        />
        <KV
          label="Variable-spend haircut"
          value={formatPercent(effective.retirementVariableHaircut ?? 0)}
        />
        {suggestedCorpus != null && (
          <KV
            label="Budget-suggested independence corpus"
            value={formatUSDCompact(suggestedCorpus)}
          />
        )}
        {Math.abs(blendedExcess) > 0.001 && (
          <KV
            label="Blended real-excess inflation"
            value={`${blendedExcess > 0 ? "+" : ""}${(blendedExcess * 100).toFixed(2)}%`}
            tone={blendedExcess > 0 ? "amber" : "positive"}
          />
        )}
      </Section>

      <Section title="Historical Monte Carlo">
        <KV
          label={`Success rate across ${mcResult.pathCount} historical ${effective.drawdownHorizonYears ?? 30}y windows`}
          value={`${(mcResult.successRate * 100).toFixed(1)}%`}
          big
          tone={
            mcResult.successRate >= 0.95
              ? "positive"
              : mcResult.successRate >= 0.85
                ? "neutral"
                : mcResult.successRate >= 0.7
                  ? "amber"
                  : "negative"
          }
        />
        <KV
          label="Median ending net worth (real $)"
          value={formatUSDCompact(mcResult.endingNetWorthPercentiles.p50)}
        />
        <KV
          label="Worst-case (p5) ending net worth"
          value={formatUSDCompact(mcResult.endingNetWorthPercentiles.p5)}
        />
      </Section>

      {/* Scenarios — what alternate plans the user has saved. */}
      {scenarios.length > 0 && (
        <Section title="Scenarios">
          <div className="space-y-1">
            {scenarios.map((sc) => {
              const isActive = activeScenarioId === sc.id;
              const bits: string[] = [];
              if (sc.overrides.cagrDelta) {
                const d = sc.overrides.cagrDelta * 100;
                bits.push(`CAGR ${d > 0 ? "+" : ""}${d.toFixed(2)}pt`);
              }
              if (sc.overrides.contributionMultiplier !== undefined &&
                sc.overrides.contributionMultiplier !== 1) {
                bits.push(
                  `Contrib ×${sc.overrides.contributionMultiplier.toFixed(2)}`,
                );
              }
              if (sc.overrides.withdrawalRate !== undefined) {
                bits.push(
                  `SWR ${(sc.overrides.withdrawalRate * 100).toFixed(2)}%`,
                );
              }
              if (sc.overrides.targetNetWorthUSD !== undefined) {
                bits.push(
                  `Target ${formatUSDCompact(sc.overrides.targetNetWorthUSD)}`,
                );
              }
              return (
                <div
                  key={sc.id}
                  className="flex items-baseline justify-between border-b border-border/40 py-1 text-sm print:border-gray-300"
                >
                  <span className="min-w-0 flex-1 truncate text-text print:text-black">
                    {sc.name}
                    {isActive && (
                      <span className="ml-1.5 rounded-sm bg-accent/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-accent print:bg-gray-200 print:text-black">
                        Active
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-dim print:text-gray-600">
                    {bits.length > 0 ? bits.join(" · ") : "No overrides"}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Goals — non-Independence financial goals (down payment, kid's
          college, sabbatical, etc). Shows progress toward each. */}
      {goals.length > 0 && (
        <Section title="Goals">
          <div className="space-y-1">
            {goals.map((g) => {
              const pct =
                g.targetUSD > 0
                  ? Math.max(0, Math.min(1, g.currentUSD / g.targetUSD))
                  : 0;
              return (
                <div
                  key={g.id}
                  className="border-b border-border/40 py-1 text-sm print:border-gray-300"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="min-w-0 flex-1 truncate text-text print:text-black">
                      {g.name}
                    </span>
                    <span className="num shrink-0 text-sm text-text print:text-black">
                      {formatUSDCompact(g.currentUSD)} / {formatUSDCompact(g.targetUSD)}
                      <span className="ml-1.5 text-[10px] text-text-dim print:text-gray-600">
                        {(pct * 100).toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-elevated print:bg-gray-200">
                    <div
                      className="h-full bg-accent print:bg-gray-700"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Healthcare summary — premiums + coverage. */}
      {healthPlans.length > 0 && (
        <Section title="Healthcare">
          <KV
            label="Plans on file"
            value={String(healthPlans.length)}
          />
          <KV
            label="Total monthly premium"
            value={formatUSD(
              healthPlans.reduce(
                (s, p) => s + Math.max(0, p.monthlyPremiumUSD),
                0,
              ),
            )}
          />
        </Section>
      )}

      <footer className="mt-10 border-t border-border pt-4 text-[10px] leading-snug text-text-dim print:border-t-2 print:border-black print:text-gray-600">
        All values are real (inflation-adjusted, today&apos;s
        dollars). Independence projections use Trinity-style SWR over a
        30-year horizon by default. Monte Carlo replays actual
        historical sequences (1928–2025). Numbers update live as
        you edit your plan; this page is a snapshot of the
        current state.
      </footer>
    </main>
  );
}

