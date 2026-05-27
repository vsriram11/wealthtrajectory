// @vitest-environment jsdom
/**
 * ScenariosPanel — focused tests on the new Plan-targets section.
 *
 * Issue #8 (and PR-original ask): the editor now exposes
 * `targetNetWorthUSD` + `withdrawalRate` overrides. These are
 * the ONLY scenario fields that move the MC card's defaults
 * (CAGR / contribution overrides are architecturally no-ops in
 * the historical-MC sim — it draws from the dataset). So a
 * regression that breaks the percent ↔ fraction conversion at
 * save time, or that fails to write the override at all, would
 * silently make every user-built scenario MC-irrelevant.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { ScenariosPanel } from "./ScenariosPanel";
import {
  castAccountId,
  castHoldingId,
  castHouseholdId,
  castMemberId,
} from "@/lib/entityIds";
import type { Account, Assumptions, Household } from "@/lib/types";

function buildHousehold(): Household {
  const account: Account = {
    id: castAccountId("acct-1"),
    category: "BROKERAGE",
    displayName: "Brokerage",
    ownerId: castMemberId("m1"),
    monthlyContributionUSD: 1000,
    holdings: [
      {
        id: castHoldingId("h-spy"),
        kind: "equity",
        symbol: "SPY",
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
    ],
  };
  return {
    id: castHouseholdId("h"),
    members: [{ id: castMemberId("m1"), displayName: "Alex" }],
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

function seed() {
  useAppStore.setState({
    household: buildHousehold(),
    assumptions: baseAssumptions(),
    memberAssumptions: {},
    selectedMemberId: null,
    liquidityView: "total",
    scenarios: [],
    activeScenarioId: null,
  });
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ scenarios: [], activeScenarioId: null });
});

describe("ScenariosPanel — Plan-targets overrides", () => {
  it("withdrawalRate input takes a percentage and saves as fraction (5 → 0.05)", () => {
    // The chip is a percent display backed by a fraction store.
    // The conversion `pct / 100` happens on save. Pin it so a
    // refactor doesn't accidentally store 5 (5x withdrawal) when
    // the user typed 5 (5%).
    seed();
    render(<ScenariosPanel />);
    fireEvent.click(screen.getByRole("button", { name: /\+ What-if/ }));
    // Default scenario name is "What if I save more" — fine, accept it.
    const wrInput = screen.getByLabelText(
      /Withdrawal rate override/,
    ) as HTMLInputElement;
    fireEvent.change(wrInput, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /Add scenario/ }));

    const scenarios = useAppStore.getState().scenarios;
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].overrides.withdrawalRate).toBeCloseTo(0.05, 6);
  });

  it("targetNetWorthUSD input saves the raw USD amount unchanged", () => {
    seed();
    render(<ScenariosPanel />);
    fireEvent.click(screen.getByRole("button", { name: /\+ What-if/ }));
    const tnwInput = screen.getByLabelText(
      /Target NW override/,
    ) as HTMLInputElement;
    fireEvent.change(tnwInput, { target: { value: "4000000" } });

    fireEvent.click(screen.getByRole("button", { name: /Add scenario/ }));
    const scenarios = useAppStore.getState().scenarios;
    expect(scenarios[0].overrides.targetNetWorthUSD).toBe(4_000_000);
  });

  it("Use base button clears a touched plan-target override back to null", () => {
    // Touch the WR row to activate the override, then click
    // "Use base" to clear it. The saved scenario should NOT
    // carry the override. Without this, a "Use base" that left
    // the field activated would silently bake the current
    // numeric value into the override on save.
    seed();
    render(<ScenariosPanel />);
    fireEvent.click(screen.getByRole("button", { name: /\+ What-if/ }));
    const wrInput = screen.getByLabelText(
      /Withdrawal rate override/,
    ) as HTMLInputElement;
    fireEvent.change(wrInput, { target: { value: "5" } });

    // "Use base" appears for the active WR override only.
    fireEvent.click(
      screen.getByLabelText(/Clear Withdrawal rate override/),
    );

    fireEvent.click(screen.getByRole("button", { name: /Add scenario/ }));
    const scenarios = useAppStore.getState().scenarios;
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].overrides.withdrawalRate).toBeUndefined();
  });
});
