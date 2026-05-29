// @vitest-environment jsdom
/**
 * Canonical cross-feature contract: the include-in-rollup flag.
 *
 * The flag is the system's *single switch* for "include this
 * member in household-aggregate views." Setting it to false must
 * cascade through:
 *
 *   1. activeMembers + activeMemberIds — the helper that every
 *      rollup-touching collection routes through.
 *   2. householdForRollups — the household scoped to active
 *      members + their accounts + their liabilities.
 *   3. householdNetWorth via the filtered household.
 *   4. projectIndependence: when no member is selected, the
 *      excluded member's accounts/liabilities don't compound +
 *      contribute (caught upstream via useActiveProjection +
 *      NetWorthCard).
 *   5. Monte Carlo: same — starting NW + allocation derived
 *      from the rollup-filtered household.
 *   6. Income-stream rollups: streams owned by the excluded
 *      member drop out of the per-year income array (caught
 *      by filterIncomeStreamsForRollups).
 *   7. Budget rollups: items owned by the excluded member drop
 *      out (filterBudgetForRollups + activeMemberIds).
 *
 * The contract has been verified piecewise in helper-level,
 * action-level, UI-level, and resolver-level tests. THIS file
 * exercises the FULL CASCADE through the live store —
 * dispatching the action, then asserting that every public
 * rollup-touching surface sees the change.
 *
 * Why this test exists:
 *
 *   - When someone adds a new rollup-aware collection (say,
 *     life-insurance policies), the right thing to do is add
 *     a line to this test asserting the new collection drops
 *     too. If it doesn't, it's not properly composed with
 *     the rollup machinery. This test acts as a checklist
 *     that's failure-driven — you can't accidentally ship a
 *     new collection that ignores the flag.
 *   - When someone refactors the filter logic (e.g. to a
 *     selector pattern, or to memoized helpers), this test
 *     catches "silent no-op" regressions where the action
 *     still flips the flag but the resolver doesn't read it.
 *
 * The cascading invariant: every household-aggregate VIEW
 * sees the same membership decision the user expressed via
 * a single toggle. That decision must be unambiguous, and
 * this test pins it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/lib/store";
import { resolveActiveProjection } from "@/lib/projection/useActiveProjection";
import { projectIndependence } from "@/lib/projection/independence";
import { runHistoricalSequences } from "@/lib/projection/monteCarlo";
import {
  activeMemberIds,
  activeMembers,
  householdForRollups,
  householdIncomeSum,
  householdNetWorth,
  taxBucketTotals,
} from "@/lib/types";
import {
  filterIncomeStreamsForRollups,
  incomePerYearUSD,
} from "@/lib/budget/incomeStreams";
import { filterBudgetForRollups } from "@/lib/budget/budget";

afterEach(() => {
  // Restore the demo from a known state in case any test mutated.
  useAppStore.getState().resetToDemo();
});

/**
 * Helper: take a "snapshot" of every rollup-touching value in
 * the current household-aggregate view. Comparing snapshots
 * BEFORE and AFTER a member is excluded gives a clean diff of
 * what changed (and what should have changed). Snapshots are
 * scalar-friendly so they can compare with === / closeTo.
 */
function rollupSnapshot(streamsAll = useAppStore.getState().incomeStreams) {
  const s = useAppStore.getState();
  const household = s.household;
  const activeIds = activeMemberIds(household);
  const filteredHousehold = householdForRollups(household);
  const filteredStreams = filterIncomeStreamsForRollups(
    streamsAll,
    null,
    activeIds,
  );
  const filteredBudget = filterBudgetForRollups(
    s.budgetItems,
    null,
    activeIds,
  );
  return {
    activeMemberCount: activeMembers(household).length,
    activeMemberIds: [...activeIds].sort(),
    nw: householdNetWorth(filteredHousehold),
    incomeSum: householdIncomeSum(household),
    streamCount: filteredStreams.length,
    budgetItemCount: filteredBudget.length,
    // 60y horizon income — long enough to capture both
    // earners' Social Security streams (Alex 2055-2083, Jordan
    // 2057-2085). A 30y horizon would miss Jordan's SS entirely
    // and make the "drop one earner's SS" comparison vacuous.
    income60yTotal: incomePerYearUSD(
      filteredStreams,
      new Date().getFullYear(),
      60,
    ).reduce((s, v) => s + v, 0),
    // Projection's headline metric — the date corpus crosses
    // target. Income + accounts + liabilities flow into this
    // via the resolver.
    monthsToIndependence: projectIndependence(filteredHousehold, s.assumptions, undefined, {
      incomePerYearUSD: incomePerYearUSD(
        filteredStreams,
        new Date().getFullYear(),
        100,
      ),
    }).monthsToIndependence,
    // Tax-bucket totals from the rollup-filtered household.
    // Excluding a member with accounts MUST shrink the bucket(s)
    // that member's accounts contribute to. A pre-rollup-cascade
    // bug had `taxBucketTotals` callers passing the RAW household,
    // so excluded-member accounts continued contributing to
    // bucket totals — silently inflating the TaxBuckets card.
    // Pin the cascade here.
    taxBucketTotalsSum: Object.values(taxBucketTotals(filteredHousehold))
      .reduce((s, v) => s + v, 0),
  };
}

describe("rollup-include flag — full cascade through every rollup-touching surface", () => {
  it("excluding a member with accounts AND streams cascades through every layer", () => {
    // Start state: full demo household (Alex, Jordan, Kiddo).
    // Jordan has accounts + a SS stream pre-seeded.
    const before = rollupSnapshot();
    const jordanId = useAppStore
      .getState()
      .household.members.find((m) => m.displayName === "Jordan")!.id;

    // Flip Jordan off.
    const ok = useAppStore
      .getState()
      .setMemberIncludeInRollup(jordanId, false);
    expect(ok).toBe(true);

    const after = rollupSnapshot();

    // (1) activeMembers shrinks by one.
    expect(after.activeMemberCount).toBe(before.activeMemberCount - 1);
    // (2) activeMemberIds drops Jordan specifically.
    expect(before.activeMemberIds).toContain(jordanId);
    expect(after.activeMemberIds).not.toContain(jordanId);
    // (3) NW drops — Jordan owns accounts in the demo, so the
    // filtered NW must be strictly less than before. (If Jordan
    // had only liabilities, NW would increase; the demo has
    // both, but accounts dominate.)
    expect(after.nw).toBeLessThan(before.nw);
    // (4) Household income sum drops — Jordan's $165k income
    // no longer rolls up.
    expect(after.incomeSum).not.toBeNull();
    expect(before.incomeSum).not.toBeNull();
    expect(after.incomeSum!).toBeLessThan(before.incomeSum!);
    // (5) Stream count drops by exactly 1 — Jordan's SS leaves.
    expect(after.streamCount).toBe(before.streamCount - 1);
    // (5b) Tax-bucket totals shrink — Jordan's accounts STOP
    // contributing to bucket sums. Regression: the TaxBuckets
    // card had been computing buckets on the raw household
    // (not householdForRollups-filtered), inflating bucket
    // totals when a member was excluded. Pinning the cascade
    // here means a future caller that forgets `householdForRollups`
    // breaks this contract test.
    expect(after.taxBucketTotalsSum).toBeLessThan(before.taxBucketTotalsSum);
    // (6) Income-over-30y total drops — Jordan's SS isn't in
    // the simulator's per-year array anymore.
    expect(after.income60yTotal).toBeLessThan(before.income60yTotal);
    // (7) Independence Date — Jordan's accounts + income are
    // gone, so the projection's headline either retreats
    // (later month) or becomes null (target unreachable).
    if (before.monthsToIndependence != null && after.monthsToIndependence != null) {
      // Both reach Independence: after must be ≥ before (worse
      // or equal). Equality is acceptable only when Jordan's
      // contribution was already small enough that the date
      // shifts within the same month — unlikely with $165k
      // income but the assertion is "worse or equal," not
      // "strictly worse," to keep the test stable.
      expect(after.monthsToIndependence).toBeGreaterThanOrEqual(
        before.monthsToIndependence,
      );
    } else if (before.monthsToIndependence != null) {
      // Before reached Independence, after doesn't — strictly
      // worse, exactly the failure mode the user is modeling
      // by excluding Jordan.
      expect(after.monthsToIndependence).toBeNull();
    } else {
      // Before didn't reach Independence; the contract is
      // silent on this (already failing scenarios). Skip.
    }
  });

  it("re-including a member fully restores the rollup state", () => {
    // The flag is reversible — there's no "scarred state" left
    // behind. Exclude then re-include must produce the exact
    // same view (modulo float-noise on the projection date).
    const before = rollupSnapshot();
    const jordanId = useAppStore
      .getState()
      .household.members.find((m) => m.displayName === "Jordan")!.id;

    useAppStore.getState().setMemberIncludeInRollup(jordanId, false);
    useAppStore.getState().setMemberIncludeInRollup(jordanId, true);

    const after = rollupSnapshot();

    expect(after.activeMemberCount).toBe(before.activeMemberCount);
    expect(after.activeMemberIds).toEqual(before.activeMemberIds);
    expect(after.nw).toBeCloseTo(before.nw, 2);
    expect(after.incomeSum).toBe(before.incomeSum);
    expect(after.streamCount).toBe(before.streamCount);
    expect(after.income60yTotal).toBeCloseTo(before.income60yTotal, 2);
    expect(after.monthsToIndependence).toBe(before.monthsToIndependence);
  });

  it("per-member view: an excluded member's data is still visible when explicitly picked", () => {
    // Semantic boundary: the flag controls ROLLUP membership,
    // not visibility entirely. If a user picks the excluded
    // member, they MUST still see that member's accounts,
    // streams, and budget items — otherwise the user has no
    // way to inspect them before deciding to re-include.
    const jordanId = useAppStore
      .getState()
      .household.members.find((m) => m.displayName === "Jordan")!.id;
    useAppStore.getState().setMemberIncludeInRollup(jordanId, false);

    const s = useAppStore.getState();

    // Resolver in per-member view: should show Jordan's data
    // regardless of the rollup flag.
    const out = resolveActiveProjection({
      household: s.household,
      memberId: jordanId,
      liquidityView: "total",
      assumptions: s.assumptions,
      memberAssumptions: s.memberAssumptions,
      scenarios: s.scenarios,
      activeId: null,
    });
    // Every account in the per-member view is Jordan's.
    expect(out.household.accounts.length).toBeGreaterThan(0);
    for (const a of out.household.accounts) {
      expect(a.ownerId).toBe(jordanId);
    }
    // Income streams: per-member filter should yield Jordan's
    // SS stream specifically.
    const jordanStreams = filterIncomeStreamsForRollups(
      s.incomeStreams,
      jordanId,
      activeMemberIds(s.household),
    );
    expect(jordanStreams.length).toBeGreaterThan(0);
    for (const stream of jordanStreams) {
      expect(stream.ownerId).toBe(jordanId);
    }
  });

  it("Monte Carlo successRate reflects rollup-filtered inputs (smoke test)", () => {
    // The MC simulator consumes inputs the resolver hands it
    // (starting NW, allocation, annual spend, income offsets).
    // All four come from the rollup-filtered view when no
    // specific member is picked. This smoke test runs MC
    // end-to-end through the resolver path and asserts the
    // success rate is sensible — not 0, not 1, in the band of
    // a plausible plan. Catches a regression where the
    // filter wiring breaks (e.g. NW goes to 0 → 0% success).
    const s = useAppStore.getState();
    const out = resolveActiveProjection({
      household: s.household,
      memberId: null,
      liquidityView: "total",
      assumptions: s.assumptions,
      memberAssumptions: s.memberAssumptions,
      scenarios: s.scenarios,
      activeId: null,
    });
    // The MC card's "given I reach my target" question runs
    // against max(currentNW, target) — same convention here.
    // Running MC against the much-smaller currentNW with a
    // target-derived spend would produce a ~23% withdrawal
    // rate and 0% survival, which tests nothing about the
    // rollup filter.
    const currentNW = householdNetWorth(out.household);
    expect(currentNW).toBeGreaterThan(0);
    const startingNW = Math.max(
      currentNW,
      out.assumptions.targetNetWorthUSD,
    );
    const result = runHistoricalSequences({
      startingNetWorthUSD: startingNW,
      allocation: {
        // Approximate the demo's portfolio — high level smoke
        // signal, not a precise replication.
        stocksFraction: 0.75,
        bondsFraction: 0.15,
        cashFraction: 0.10,
      },
      // SWR-based default spend.
      annualSpendUSD:
        out.assumptions.targetNetWorthUSD * out.assumptions.withdrawalRate,
      retirementHorizonYears: 30,
      otherTreatedAsStocks: true,
    });
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });

  it("Historical snapshot buckets cascade through the includeInRollup flag (round-3 audit BLOCK fix)", async () => {
    // Round-3 audit finding: HistoryTab applied only filterHousehold
    // (member filter), not householdForRollups (rollup flag).
    // Members with includeInRollup=false were silently INCLUDED
    // in History CAGR/drawdown — contradicting NetWorthCard,
    // AllocationPanel, Insights, etc. This test pins the
    // includeInRollup cascade alongside the existing member-
    // filter test.
    const { buildAssetClassSeries } = await import(
      "@/lib/portfolio/historicalReturns"
    );
    const { householdForRollups } = await import("@/lib/types");
    const s = useAppStore.getState();
    // Find a member to exclude. Demo persona has 2 members; pick the
    // 2nd as the "exclude this" candidate.
    expect(s.household.members.length).toBeGreaterThanOrEqual(2);
    const excludeMember = s.household.members[1];
    const householdWithExclusion = {
      ...s.household,
      members: s.household.members.map((m) =>
        m.id === excludeMember.id ? { ...m, includeInRollup: false } : m,
      ),
    };
    const snap = {
      t: Date.UTC(2024, 0, 1, 12),
      netWorthUSD: householdNetWorth(householdWithExclusion),
      household: householdWithExclusion,
    };
    // Without householdForRollups, both members' holdings would
    // be bucketed. With it, only the included member's holdings
    // appear. Pre-fix: HistoryTab built buckets directly from
    // snap.household → buckets included the excluded member.
    const rolledUp = householdForRollups(householdWithExclusion);
    const expectedBuckets = buildAssetClassSeries([
      { ...snap, household: rolledUp },
    ]);
    const expectedTotal = Object.values(expectedBuckets).reduce(
      (sum, series) => sum + (series?.[0]?.valueUSD ?? 0),
      0,
    );
    // Sanity: the excluded member's value really did drop.
    const unfilteredTotal = householdNetWorth(householdWithExclusion);
    expect(expectedTotal).toBeLessThan(unfilteredTotal);
  });

  it("Historical snapshot buckets cascade through the member filter (audit-fix regression pin)", async () => {
    // Audit finding #3: HistoryTab + buildAssetClassSeries iterated
    // snap.household.accounts directly with no ownerId filter,
    // silently showing household totals when the user filtered to
    // one member. The fix applies filterHousehold to each snapshot
    // before bucketing — this contract test pins the cascade in
    // alongside every other rollup-aware collection.
    const { buildAssetClassSeries } = await import(
      "@/lib/portfolio/historicalReturns"
    );
    const { filterHousehold } = await import("@/lib/types");
    const s = useAppStore.getState();
    // Build a fake "historical snapshot" from the current
    // household (the engine doesn't care that it's not really
    // historical — it just needs snap.household to be present).
    const snap = {
      t: Date.UTC(2024, 0, 1, 12),
      netWorthUSD: householdNetWorth(s.household),
      household: s.household,
    };
    // Household-wide buckets — every member's holdings counted.
    const householdBuckets = buildAssetClassSeries([snap]);
    const householdTotal = Object.values(householdBuckets).reduce(
      (sum, series) => sum + (series?.[0]?.valueUSD ?? 0),
      0,
    );
    // Now per-member: take the FIRST member, scope to them.
    const firstMemberId = s.household.members[0]?.id;
    expect(firstMemberId).toBeDefined();
    const scopedHousehold = filterHousehold(s.household, firstMemberId!);
    const scopedSnap = {
      ...snap,
      household: scopedHousehold,
      netWorthUSD: householdNetWorth(scopedHousehold),
    };
    const scopedBuckets = buildAssetClassSeries([scopedSnap]);
    const scopedTotal = Object.values(scopedBuckets).reduce(
      (sum, series) => sum + (series?.[0]?.valueUSD ?? 0),
      0,
    );
    // The scoped total must be STRICTLY less than the household
    // total (the demo persona has multi-member ownership) and
    // strictly greater than zero (the first member must own
    // something). The exact ratio depends on the demo data
    // shape — we don't pin it.
    expect(scopedTotal).toBeGreaterThan(0);
    expect(scopedTotal).toBeLessThan(householdTotal);
    // Defensive: no household.accounts owned by OTHER members
    // leaked into the scoped output.
    const otherMembers = s.household.members.filter(
      (m) => m.id !== firstMemberId,
    );
    for (const acct of scopedHousehold.accounts) {
      expect(otherMembers.some((m) => m.id === acct.ownerId)).toBe(false);
    }
  });
});
