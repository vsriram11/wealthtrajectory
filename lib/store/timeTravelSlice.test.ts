import { describe, expect, it } from "vitest";

import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import type { Assumptions, Household } from "@/lib/types";
import {
  TIME_TRAVEL_SLICE_INITIAL,
  createTimeTravelSliceActions,
  type TimeTravelSliceState,
} from "./timeTravelSlice";

type Ctx = TimeTravelSliceState & {
  household: Household;
  assumptions: Assumptions;
  mode: "demo" | "real";
};

function makeFakeStore(seed: Partial<Ctx> = {}) {
  let state: Ctx = {
    ...TIME_TRAVEL_SLICE_INITIAL,
    household: structuredClone(DEMO_HOUSEHOLD),
    assumptions: structuredClone(DEMO_ASSUMPTIONS),
    // Tests default to real mode (where time-travel is allowed).
    // Individual tests override seed.mode to verify the demo
    // refusal path.
    mode: "real",
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: Ctx) => Partial<Ctx>) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("Time-travel slice — enterTimeTravel", () => {
  it("captures baseline + sets active + records date", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    expect(s.state.timeTravelActive).toBe(true);
    expect(s.state.timeTravelDate).toBe("2022-01-01");
    expect(s.state.baselineHousehold).not.toBeNull();
    expect(s.state.baselineAssumptions).not.toBeNull();
  });

  it("baseline is a DEEP COPY, not a reference (no aliasing)", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    // Mutate the live household — baseline must NOT reflect the change.
    const liveAccount = s.state.household.accounts[0];
    expect(liveAccount).toBeDefined();
    const baseline = s.state.baselineHousehold!;
    // Reference identity check on the top-level Household + nested
    // arrays (the catastrophic alias would share array references).
    expect(baseline).not.toBe(s.state.household);
    expect(baseline.accounts).not.toBe(s.state.household.accounts);
    expect(baseline.members).not.toBe(s.state.household.members);
    expect(baseline.liabilities).not.toBe(s.state.household.liabilities);
    // Spot-check a nested object — Account is also a deep copy.
    if (baseline.accounts.length > 0) {
      expect(baseline.accounts[0]).not.toBe(s.state.household.accounts[0]);
    }
    // Baseline assumptions decoupled too.
    expect(s.state.baselineAssumptions).not.toBe(s.state.assumptions);
  });

  it("refuses re-entry while already active (defense in depth)", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    const firstBaseline = s.state.baselineHousehold;
    // Simulate a stray second call — UI gates the button, but the
    // slice shouldn't overwrite the existing baseline silently.
    a.enterTimeTravel("2019-06-15");
    expect(s.state.timeTravelDate).toBe("2022-01-01");
    expect(s.state.baselineHousehold).toBe(firstBaseline);
  });
});

describe("Time-travel slice — exitTimeTravelDiscard", () => {
  it("restores baseline into household + assumptions and clears state", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    const originalHousehold = s.state.household;
    const originalAssumptions = s.state.assumptions;
    a.enterTimeTravel("2022-01-01");
    // Mutate the live household to simulate time-travel edits.
    s.set(() => ({
      household: {
        ...s.state.household,
        accounts: [],
        liabilities: [],
      },
    }));
    expect(s.state.household.accounts).toHaveLength(0);
    a.exitTimeTravelDiscard();
    // Live household is restored to a value structurally equal to
    // the original snapshot (it's a structuredClone, so it's a
    // distinct reference but the same shape).
    expect(s.state.household.accounts.length).toBe(
      originalHousehold.accounts.length,
    );
    expect(s.state.household.liabilities.length).toBe(
      originalHousehold.liabilities.length,
    );
    // Assumptions match too — structuredClone preserves enumerable
    // fields verbatim.
    expect(s.state.assumptions.targetNetWorthUSD).toBe(
      originalAssumptions.targetNetWorthUSD,
    );
    // Slice state is cleared.
    expect(s.state.timeTravelActive).toBe(false);
    expect(s.state.timeTravelDate).toBeNull();
    expect(s.state.baselineHousehold).toBeNull();
    expect(s.state.baselineAssumptions).toBeNull();
  });

  it("is a no-op when not active", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    const beforeHousehold = s.state.household;
    const beforeAssumptions = s.state.assumptions;
    a.exitTimeTravelDiscard();
    // No baseline existed → live state references must not be
    // touched (no accidental clone, no swap to baseline-null).
    expect(s.state.household).toBe(beforeHousehold);
    expect(s.state.assumptions).toBe(beforeAssumptions);
    expect(s.state.timeTravelActive).toBe(false);
    expect(s.state.baselineHousehold).toBeNull();
  });

  it("edits made during the session do NOT leak into the baseline (cascade isolation)", () => {
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    const baselineFirstAccountId =
      s.state.baselineHousehold!.accounts[0]?.id;
    // Mutate a nested holding's valueUSD on the LIVE household to
    // simulate an in-session edit. Because enter used a deep clone,
    // the baseline's holding must stay at the pre-edit value.
    const liveAccount = s.state.household.accounts[0];
    if (liveAccount && liveAccount.holdings.length > 0) {
      const baselineHolding =
        s.state.baselineHousehold!.accounts[0].holdings[0];
      const baselineValue = baselineHolding.valueUSD;
      // Replace the live holding's value (mutation through normal
      // setHoldingValue would also produce a new household ref).
      s.set(() => ({
        household: {
          ...s.state.household,
          accounts: s.state.household.accounts.map((acc) =>
            acc.id === liveAccount.id
              ? {
                  ...acc,
                  holdings: acc.holdings.map((h, idx) =>
                    idx === 0 ? { ...h, valueUSD: 99 } : h,
                  ),
                }
              : acc,
          ),
        },
      }));
      // Baseline's holding value unchanged.
      expect(
        s.state.baselineHousehold!.accounts[0].holdings[0].valueUSD,
      ).toBe(baselineValue);
    }
    // Exit and confirm the restored household has the baseline's
    // first account id (i.e. we got the baseline back, not the
    // edited version).
    a.exitTimeTravelDiscard();
    expect(s.state.household.accounts[0]?.id).toBe(baselineFirstAccountId);
  });
});

describe("Time-travel slice — mode behavior (user-reported no-op fix)", () => {
  it("allows enterTimeTravel regardless of mode (slice gate removed — UI gate is load-bearing)", () => {
    // The previous slice-level mode==="real" gate caused a
    // user-visible no-op when clicking "Enter time-travel mode"
    // from the modal (root cause unclear — possibly stale mode
    // in the Zustand callback). The SnapshotsManager UI gate
    // prevents the modal from even opening in demo mode, so
    // removing the slice gate doesn't open a new attack surface.
    const s = makeFakeStore({ mode: "demo" });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2024-01-01");
    expect(s.state.timeTravelActive).toBe(true);
    expect(s.state.timeTravelDate).toBe("2024-01-01");
    expect(s.state.baselineHousehold).not.toBeNull();
  });
});
