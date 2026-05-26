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
import { cleanup, render, screen } from "@testing-library/react";
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
