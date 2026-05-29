// @vitest-environment jsdom
/**
 * Regression: the Historical Monte Carlo card must honor the active
 * scenario.
 *
 * The bug this pins (reported by the user — TQQQ + scenario picker):
 *
 *   - The card used to read `state.household` / `state.assumptions`
 *     directly from the store, bypassing the scenario merge that
 *     happens inside `useActiveProjection`.
 *   - Result: switching the active scenario didn't change the
 *     defaulted starting NW / annual spend / success rate, because
 *     the card never saw the scenario's `targetNetWorthUSD` /
 *     `withdrawalRate` overrides.
 *
 * Same class of bug as #11 (AllocationPanel). The fix routes the
 * card through `useActiveProjection`, which already applies the
 * rollup → member → liquidity → scenario chain in one place.
 *
 * These tests stamp the real Zustand store + render the card (jsdom),
 * then assert the on-screen defaults reflect scenario overrides.
 * A future refactor that re-reads the raw store slices will break
 * this test before it ships.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { HistoricalMonteCarloCard } from "./HistoricalMonteCarloCard";
import type { Account, Assumptions, Household } from "@/lib/types";
import {
  castAccountId,
  castHoldingId,
  castHouseholdId,
  castMemberId,
} from "@/lib/entityIds";

/**
 * Single-member household with $1M in equity. Used as the starting
 * portfolio for every test below — kept simple so the only thing
 * varying across tests is the active scenario.
 */
function buildHousehold(): Household {
  const account: Account = {
    id: castAccountId("acct-1"),
    category: "BROKERAGE",
    displayName: "Brokerage",
    ownerId: castMemberId("m1"),
    monthlyContributionUSD: 0,
    holdings: [
      {
        id: castHoldingId("h-spy"),
        kind: "equity",
        symbol: "SPY",
        shares: 1,
        lastPriceUSD: 1_000_000,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        acquiredAt: null,
        valueUSD: 1_000_000,
        expectedRealCAGR: 0.07,
        leverage: 1,
        styleBox: {
          LARGE_VALUE: 0,
          LARGE_BLEND: 1,
          LARGE_GROWTH: 0,
          MID_VALUE: 0,
          MID_BLEND: 0,
          MID_GROWTH: 0,
          SMALL_VALUE: 0,
          SMALL_BLEND: 0,
          SMALL_GROWTH: 0,
        },
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      },
    ],
  };
  return {
    id: castHouseholdId("h"),
    members: [{ id: castMemberId("m1"), displayName: "Alex", age: 40 }],
    accounts: [account],
    liabilities: [],
  };
}

/**
 * Two-asset household used by the projection-forward tests: $500k
 * stocks (7% real CAGR) + $500k bonds (1.5% real CAGR), 50/50 today.
 * Below the $2M target by enough years that the projected-forward
 * composition is materially different from today's — exactly the
 * setup that surfaces CAGR-only scenario effects on MC.
 */
function buildTwoAssetHousehold(): Household {
  const account: Account = {
    id: castAccountId("acct-2"),
    category: "BROKERAGE",
    displayName: "Mixed",
    ownerId: castMemberId("m1"),
    monthlyContributionUSD: 0,
    holdings: [
      {
        id: castHoldingId("h-vti"),
        kind: "equity",
        symbol: "VTI",
        shares: 1,
        lastPriceUSD: 500_000,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        acquiredAt: null,
        valueUSD: 500_000,
        expectedRealCAGR: 0.07,
        leverage: 1,
        styleBox: {
          LARGE_VALUE: 0,
          LARGE_BLEND: 1,
          LARGE_GROWTH: 0,
          MID_VALUE: 0,
          MID_BLEND: 0,
          MID_GROWTH: 0,
          SMALL_VALUE: 0,
          SMALL_BLEND: 0,
          SMALL_GROWTH: 0,
        },
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      },
      {
        id: castHoldingId("h-bnd"),
        kind: "bond",
        symbol: "BND",
        shares: 1,
        lastPriceUSD: 500_000,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        acquiredAt: null,
        valueUSD: 500_000,
        expectedRealCAGR: 0.015,
        leverage: 1,
        averageDurationYears: 6,
        bondType: { GOVT: 0.5, CORPORATE: 0.5 },
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      },
    ],
  };
  return {
    id: castHouseholdId("h2"),
    members: [{ id: castMemberId("m1"), displayName: "Alex", age: 40 }],
    accounts: [account],
    liabilities: [],
  };
}

function baseAssumptions(): Assumptions {
  return {
    targetNetWorthUSD: 2_000_000,
    withdrawalRate: 0.04,
    legacyFloorUSD: 0,
    drawdownHorizonYears: 30,
    expectedInflationRate: 0.025,
  };
}

function seed(opts: { targetNetWorthUSD?: number; withdrawalRate?: number }) {
  const assumptions: Assumptions = {
    ...baseAssumptions(),
    ...(opts.targetNetWorthUSD != null
      ? { targetNetWorthUSD: opts.targetNetWorthUSD }
      : {}),
    ...(opts.withdrawalRate != null
      ? { withdrawalRate: opts.withdrawalRate }
      : {}),
  };
  useAppStore.setState({
    household: buildHousehold(),
    assumptions,
    memberAssumptions: {},
    selectedMemberId: null,
    liquidityView: "total",
    scenarios: [],
    activeScenarioId: null,
    budgetItems: [],
    incomeStreams: [],
    glidePath: null,
  });
}

afterEach(() => {
  cleanup();
  useAppStore.setState({
    scenarios: [],
    activeScenarioId: null,
    incomeStreams: [],
    budgetItems: [],
    memberAssumptions: {},
  });
});

describe("HistoricalMonteCarloCard — active-scenario cascade", () => {
  it("uses base targetNetWorthUSD when no scenario is active", () => {
    seed({ targetNetWorthUSD: 2_000_000, withdrawalRate: 0.04 });
    render(<HistoricalMonteCarloCard />);
    // The card defaults starting NW to max(currentNW, targetNW). With
    // $1M current NW + $2M target → starting-NW input defaults to $2M.
    // The card renders three numeric inputs in order: Starting NW,
    // Annual real spend, Horizon. Grabbing the first one targets
    // Starting NW without coupling to label-association quirks.
    const startingNW = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(startingNW.value).toBe("2000000");
  });

  it("scenario that doubles targetNetWorthUSD propagates into the card's defaults", () => {
    // Base plan: $2M target. Scenario bumps it to $4M. After
    // activating the scenario, the card's starting NW (the
    // defaulted Math.max(currentNW, targetNW)) must reflect $4M —
    // not the base $2M. This is the regression: previously the
    // card read state.assumptions directly and ignored scenario
    // overrides, so the on-screen number stayed at $2M no matter
    // which scenario was active.
    seed({ targetNetWorthUSD: 2_000_000 });
    const scenarioId = useAppStore.getState().addScenario({
      name: "Higher target",
      overrides: { targetNetWorthUSD: 4_000_000 },
    });
    useAppStore.getState().setActiveScenario(scenarioId);

    render(<HistoricalMonteCarloCard />);
    // The card renders three numeric inputs in order: Starting NW,
    // Annual real spend, Horizon. Grabbing the first one targets
    // Starting NW without coupling to label-association quirks.
    const startingNW = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(startingNW.value).toBe("4000000");
  });

  it("scenario name surfaces in the methodology block when active", () => {
    seed({});
    const scenarioId = useAppStore.getState().addScenario({
      name: "Conservative WR",
      overrides: { withdrawalRate: 0.03 },
    });
    useAppStore.getState().setActiveScenario(scenarioId);
    render(<HistoricalMonteCarloCard />);
    // The methodology block now calls out which scenario is active
    // — so the user knows the displayed numbers are scenario-
    // merged and not the base plan. Mostly an honesty signal.
    expect(screen.getByText("Conservative WR")).toBeInTheDocument();
    expect(
      screen.getByText(/Active scenario:/i),
    ).toBeInTheDocument();
  });

  it("scenario WR override changes the displayed starting withdrawal rate", () => {
    // 4% → 8% WR doubles the annual-spend default (target × WR).
    // The card prints "(X.XX% starting WR)" in the success-rate
    // copy. Activating a WR-override scenario must change that
    // printed number.
    seed({ targetNetWorthUSD: 2_000_000, withdrawalRate: 0.04 });
    const scenarioId = useAppStore.getState().addScenario({
      name: "Aggressive WR",
      overrides: { withdrawalRate: 0.08 },
    });
    useAppStore.getState().setActiveScenario(scenarioId);
    render(<HistoricalMonteCarloCard />);
    // 8% WR on $2M starting NW = $160k/yr → "8.00% starting WR".
    expect(screen.getByText(/8\.00% starting WR/)).toBeInTheDocument();
  });
});

describe("HistoricalMonteCarloCard — projection-forward composition", () => {
  // The MC sim starts AT target NW, so the allocation it uses must
  // reflect the portfolio mix AT the target date, not today's. A
  // CAGR-only scenario shifts per-holding growth trajectories →
  // shifts the at-retirement mix → shifts the MC outputs. This was
  // the user's specific complaint: "scenarios are not globally
  // reflected" because the card used today's 50/50 regardless of
  // scenario CAGR.

  it("renders a 'Composition projected forward Xyrs to target date' methodology note when below target", () => {
    // Two-asset household, $1M total, $2M target → ~years to reach
    // depends on blended CAGR. The note should appear and the
    // "at target date" suffix should be on the allocation summary.
    useAppStore.setState({
      household: buildTwoAssetHousehold(),
      assumptions: baseAssumptions(),
      memberAssumptions: {},
      selectedMemberId: null,
      liquidityView: "total",
      scenarios: [],
      activeScenarioId: null,
      budgetItems: [],
      incomeStreams: [],
      glidePath: null,
    });
    render(<HistoricalMonteCarloCard />);
    expect(
      screen.getByText(/Composition projected forward.*yrs to target date/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/AT target date/)).toBeInTheDocument();
  });

  it("baseline two-asset allocation projects to MORE stocks than today's 50/50", () => {
    // Baseline 50/50 stocks (7%) / bonds (1.5%). Over the
    // accumulation horizon, stocks compound faster than bonds, so
    // at the target date the equity share is materially above 50%.
    // The methodology bullet renders the projected-at-target mix —
    // not today's 50/50 — which is the visible proof that the card
    // routes allocation through the aged household.
    useAppStore.setState({
      household: buildTwoAssetHousehold(),
      assumptions: baseAssumptions(),
      memberAssumptions: {},
      selectedMemberId: null,
      liquidityView: "total",
      scenarios: [],
      activeScenarioId: null,
      budgetItems: [],
      incomeStreams: [],
      glidePath: null,
    });
    render(<HistoricalMonteCarloCard />);
    // Find the "X% stocks / Y% bonds / Z% cash" line in the
    // methodology. Stocks should be > 50 (projected forward grows
    // them past today's parity), bonds < 50.
    const allocSummary = screen.getByText(/% stocks \/ /);
    const text = allocSummary.textContent ?? "";
    const stocksMatch = text.match(/(\d+(?:\.\d+)?)% stocks/);
    const bondsMatch = text.match(/(\d+(?:\.\d+)?)% bonds/);
    expect(stocksMatch).not.toBeNull();
    expect(bondsMatch).not.toBeNull();
    const stocksPct = Number(stocksMatch![1]);
    const bondsPct = Number(bondsMatch![1]);
    expect(stocksPct).toBeGreaterThan(50);
    expect(bondsPct).toBeLessThan(50);
  });

  it("CAGR-only scenario shifts the projected at-target allocation", () => {
    // The user's exact complaint: a CAGR-only scenario (no target /
    // WR / contribution overrides) must still move MC results,
    // because different per-holding CAGRs → different at-retirement
    // mix. We assert the baseline projected stocks-share != the
    // scenario-applied projected stocks-share. If the card routes
    // composition through today's holdings (the old bug), both
    // would render the same 50/50 → this test fails.

    // Baseline: 7% stocks / 1.5% bonds → time-to-target ≈ 16 years
    // at blended ~4.2% real CAGR. Projected mix: stocks-heavy.
    useAppStore.setState({
      household: buildTwoAssetHousehold(),
      assumptions: baseAssumptions(),
      memberAssumptions: {},
      selectedMemberId: null,
      liquidityView: "total",
      scenarios: [],
      activeScenarioId: null,
      budgetItems: [],
      incomeStreams: [],
      glidePath: null,
    });
    const { unmount } = render(<HistoricalMonteCarloCard />);
    const baselineStocks = readStocksPctFromAllocation();
    unmount();

    // Scenario: override the bond CAGR up to 8% (matching stocks
    // CAGR). Now both grow at similar rates → at-target mix stays
    // closer to today's 50/50. Projected stocks-share must DROP
    // vs baseline.
    const bondHoldingId = (useAppStore.getState().household.accounts[0]
      .holdings[1] as { id: string }).id;
    const scenarioId = useAppStore.getState().addScenario({
      name: "Catch-up bonds",
      overrides: { holdingCAGRs: { [bondHoldingId]: 0.08 } },
    });
    useAppStore.getState().setActiveScenario(scenarioId);
    render(<HistoricalMonteCarloCard />);
    const scenarioStocks = readStocksPctFromAllocation();

    // Same target NW, same WR, same horizon. ONLY difference is the
    // scenario's per-holding CAGR override. The at-target mix MUST
    // differ — that's what makes scenarios MC-relevant.
    expect(scenarioStocks).not.toBe(baselineStocks);
    // Sanity: bonds caught up → stocks share at target shrinks.
    expect(scenarioStocks).toBeLessThan(baselineStocks);
  });
});

describe("HistoricalMonteCarloCard — retirementFixedNominalYears propagation", () => {
  // Regression for the IIFE that replaced a `!` non-null
  // assertion: when the user has configured a non-zero freeze on
  // the AssumptionsPanel, the card must pass
  // `spending.fixedNominalFreeze` through to the simulator. The
  // IIFE narrows the type without an `as ` cast or `!`. This
  // test pins that the OUTPUT — the methodology block's
  // visible-allocation snippet AND the percentile bands —
  // actually responds to the freeze setting.

  it("a non-zero retirementFixedNominalYears changes the simulator's percentile bands", () => {
    // Same household / target / spend; only the freeze knob
    // differs. The freeze decays withdrawals in the first N
    // years → less drag in the SORR-vulnerable window → higher
    // ending NW percentiles. If the IIFE silently fails to
    // propagate the field, both runs match and this test fails.
    useAppStore.setState({
      household: buildTwoAssetHousehold(),
      assumptions: { ...baseAssumptions(), expectedInflationRate: 0.03 },
      memberAssumptions: {},
      selectedMemberId: null,
      liquidityView: "total",
      scenarios: [],
      activeScenarioId: null,
      budgetItems: [],
      incomeStreams: [],
      glidePath: null,
    });
    const { unmount } = render(<HistoricalMonteCarloCard />);
    const baselineP50Text =
      screen.getByText(/Median \(p50\)/).parentElement?.textContent ?? "";
    unmount();

    // Now seed with retirementFixedNominalYears = 10 (a
    // 10-year freeze, the regime that yields the biggest gain).
    useAppStore.setState({
      household: buildTwoAssetHousehold(),
      assumptions: {
        ...baseAssumptions(),
        expectedInflationRate: 0.03,
        retirementFixedNominalYears: 10,
      },
      memberAssumptions: {},
      selectedMemberId: null,
      liquidityView: "total",
      scenarios: [],
      activeScenarioId: null,
      budgetItems: [],
      incomeStreams: [],
      glidePath: null,
    });
    render(<HistoricalMonteCarloCard />);
    const frozenP50Text =
      screen.getByText(/Median \(p50\)/).parentElement?.textContent ?? "";

    // The two displays MUST differ. If the IIFE failed to
    // propagate the freeze, they'd be byte-identical. (We
    // assert non-equality rather than a specific value because
    // the dataset / projection-forward composition combine to
    // produce a number we don't want to hard-pin.)
    expect(frozenP50Text).not.toBe(baselineP50Text);
  });
});

function readStocksPctFromAllocation(): number {
  // Allocation precision in the methodology block is 2-decimal
  // (e.g. "57.13% stocks"). The regex accepts the decimal so the
  // helper survives the precision bump.
  const allocSummary = screen.getByText(/% stocks \/ /);
  const match = (allocSummary.textContent ?? "").match(
    /(\d+(?:\.\d+)?)% stocks/,
  );
  if (!match) throw new Error("stocks pct not found in allocation summary");
  return Number(match[1]);
}

function readCashPctFromAllocation(): number {
  const allocSummary = screen.getByText(/% stocks \/ /);
  const match = (allocSummary.textContent ?? "").match(
    /(\d+(?:\.\d+)?)% cash/,
  );
  if (!match) throw new Error("cash pct not found in allocation summary");
  return Number(match[1]);
}

describe("HistoricalMonteCarloCard — cash-bucket toggle truth table", () => {
  // The 2×2 priority × size override × glide-path matrix has several
  // ways to leak state across toggles. Round-4 audit surfaced one:
  // `cashBucketSizePct` could persist across a priority-OFF flip and
  // silently override allocation when re-enabled. The runtime gate
  // (`cashBucketOverrideActive`) blocks this — these tests pin that
  // behavior so a future refactor can't reintroduce the leak.

  // "refilling reserve" / "depleting reserve" only appear in the
  // methodology bullet (never in the toggle row), so it's a clean
  // signal that the bullet is rendered.
  const METHODOLOGY_BULLET = /(refilling|depleting) reserve/;

  it("baseline (priority OFF) shows methodology without cash-bucket bullet", () => {
    seed({ targetNetWorthUSD: 2_000_000, withdrawalRate: 0.04 });
    const { container } = render(<HistoricalMonteCarloCard />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(METHODOLOGY_BULLET);
  });

  it("toggling priority ON renders the methodology bullet", () => {
    seed({ targetNetWorthUSD: 2_000_000, withdrawalRate: 0.04 });
    const { container } = render(<HistoricalMonteCarloCard />);
    const priorityGroup = screen.getByRole("group", {
      name: "Cash-bucket priority",
    });
    fireEvent.click(
      priorityGroup.querySelector('[aria-pressed="false"]') as HTMLElement,
    );
    // textContent search: the bullet text spans multiple inline
    // elements so a single getByText query can fragment it. Querying
    // the methodology container's textContent is the robust approach.
    const text = container.textContent ?? "";
    expect(text).toMatch(METHODOLOGY_BULLET);
  });

  it("toggling priority OFF after setting a custom size does NOT leak the size into baseline allocation", () => {
    // Round-3/4 state-leak regression. Prior bug: the size override
    // survived priority-OFF and continued to drive the simulator's
    // allocation, contradicting the UI's "off" mode chip.
    seed({ targetNetWorthUSD: 2_000_000, withdrawalRate: 0.04 });
    render(<HistoricalMonteCarloCard />);
    const baselineCashPct = readCashPctFromAllocation();

    // Toggle priority ON.
    const priorityGroup = screen.getByRole("group", {
      name: "Cash-bucket priority",
    });
    fireEvent.click(
      priorityGroup.querySelector('[aria-pressed="false"]') as HTMLElement,
    );

    // Find the bucket size input — it's the 4th spinbutton (after
    // Starting NW, Annual spend, Horizon).
    const spinButtons = screen.getAllByRole(
      "spinbutton",
    ) as HTMLInputElement[];
    const sizeInput = spinButtons[3];
    fireEvent.change(sizeInput, { target: { value: "30" } });
    // Cash% in allocation should now be ~30%.
    expect(readCashPctFromAllocation()).toBeGreaterThan(25);

    // Toggle priority OFF — click the chip that is CURRENTLY
    // inactive (the "Off" chip with aria-pressed="false"). Clicking
    // the active chip would re-fire setCashBucketPriority(true) with
    // the same value, a no-op.
    fireEvent.click(
      priorityGroup.querySelector('[aria-pressed="false"]') as HTMLElement,
    );
    const afterOffCashPct = readCashPctFromAllocation();
    // Allow ±0.1% slack for 2-decimal rounding noise.
    expect(Math.abs(afterOffCashPct - baselineCashPct)).toBeLessThan(0.1);
  });
});
