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
  selectedMemberId: string | null;
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
    selectedMemberId: null,
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

  it("baseline is a REFERENCE to the current household (user-reported structuredClone crash fix)", () => {
    // Contract change: baselineHousehold is now a PLAIN
    // REFERENCE to the current household at entry-time, NOT a
    // deep clone. A user hit "Maximum call stack size exceeded"
    // on structuredClone(household) for their real data.
    //
    // The reference-only approach is correct because the
    // project convention (CLAUDE.md §2 "Store action setters
    // produce fresh references") guarantees Zustand actions
    // create NEW arrays/objects rather than mutating in place.
    // So when the user edits during time-travel, the edited
    // path gets new refs; the original household reference
    // (stored as baseline) is untouched.
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    const householdAtEntry = s.state.household;
    const assumptionsAtEntry = s.state.assumptions;
    a.enterTimeTravel("2022-01-01");
    // Baseline IS the entry-time reference.
    expect(s.state.baselineHousehold).toBe(householdAtEntry);
    expect(s.state.baselineAssumptions).toBe(assumptionsAtEntry);
  });

  it("baseline survives subsequent fresh-reference store mutations (the invariant the reference-only approach relies on)", () => {
    // Simulate the real-world flow: user enters time-travel,
    // THEN edits the household (via a normal Zustand action
    // that creates a new household reference per the project
    // convention). The baseline must STILL point at the
    // pre-entry state — because Zustand actions don't mutate
    // in place, only assign new refs.
    const s = makeFakeStore();
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    const baselineRef = s.state.baselineHousehold!;
    // Simulate a "fresh reference" mutation (the Zustand
    // convention): assign a brand-new household object.
    s.set(() => ({
      household: { ...s.state.household, id: "mutated" as never },
    }));
    // Live household reflects the change.
    expect(s.state.household.id).toBe("mutated");
    // Baseline is untouched — still points at the original.
    expect(s.state.baselineHousehold).toBe(baselineRef);
    expect(s.state.baselineHousehold!.id).not.toBe("mutated");
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

  it("reverts isManualPrice flag flipped during the session (user-reported bug fix)", () => {
    // Scenario: user enters time-travel, sets a manual price for
    // a stock whose historical price fetch failed. They exit
    // (with or without save). The manual flag MUST NOT stick to
    // the live state — otherwise the next live-refresh skips the
    // holding and the live NW is stuck at the user's historical
    // override.
    const liveTrackedHolding = {
      kind: "equity" as const,
      id: "TQQQ_HOLDING",
      symbol: "TQQQ",
      shares: 100,
      lastPriceUSD: 80,
      lastPricedAt: 1_700_000_000_000,
      isManualPrice: false, // CRITICAL: live in baseline
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: 8_000,
      expectedRealCAGR: 0.15,
      leverage: 3,
      styleBox: { LARGE_BLEND: 1 } as never,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    };
    const baselineHousehold = {
      id: "hh" as never,
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "a1" as never,
          displayName: "Brokerage",
          category: "BROKERAGE" as never,
          ownerId: "m1" as never,
          monthlyContributionUSD: 0,
          holdings: [liveTrackedHolding],
        },
      ],
      liabilities: [],
    };
    const s = makeFakeStore({
      mode: "real",
      household: baselineHousehold as never,
    });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2025-12-30");
    // Simulate the user manually setting a price during
    // time-travel: replicate what setHoldingPrice would do on the
    // store — flip the flag + change the price.
    s.set(() => ({
      household: {
        ...s.state.household,
        accounts: s.state.household.accounts.map((acct) => ({
          ...acct,
          holdings: acct.holdings.map((h) => ({
            ...h,
            isManualPrice: true,
            lastPriceUSD: 52,
            valueUSD: 100 * 52,
          })) as never,
        })),
      } as never,
    }));
    // Pre-condition: in-session holding is now manual at $52.
    const sessionHolding = s.state.household.accounts[0].holdings[0];
    expect("isManualPrice" in sessionHolding && sessionHolding.isManualPrice).toBe(true);

    // Exit-discard.
    a.exitTimeTravelDiscard();

    // Post-condition: the manual flag is reverted in live state,
    // so the next live-refresh will pick the holding up again.
    const liveHolding = s.state.household.accounts[0].holdings[0];
    expect("isManualPrice" in liveHolding && liveHolding.isManualPrice).toBe(false);
    // The price ALSO reverts via the baseline (baseline had $80).
    expect("lastPriceUSD" in liveHolding && liveHolding.lastPriceUSD).toBe(80);
  });
});

describe("Time-travel slice — recordTimeTravelPriceOutcome (manual-entry surfacing)", () => {
  it("records applied / clamped / failed outcomes into the right buckets", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2020-01-01");
    a.recordTimeTravelPriceOutcome("VOO", "applied");
    a.recordTimeTravelPriceOutcome("BTC-USD", "clamped");
    a.recordTimeTravelPriceOutcome("PRIVATE", "failed", "yahoo: 401");
    expect(s.state.timeTravelPriceStatus.appliedSymbols).toEqual(["VOO"]);
    expect(s.state.timeTravelPriceStatus.clampedSymbols).toEqual(["BTC-USD"]);
    expect(s.state.timeTravelPriceStatus.failedSymbols).toEqual([
      { symbol: "PRIVATE", reason: "yahoo: 401" },
    ]);
  });

  it("de-duplicates: a symbol that moves outcomes only appears in the latest bucket", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2020-01-01");
    a.recordTimeTravelPriceOutcome("VOO", "failed");
    a.recordTimeTravelPriceOutcome("VOO", "applied"); // retry succeeds
    expect(s.state.timeTravelPriceStatus.appliedSymbols).toEqual(["VOO"]);
    expect(s.state.timeTravelPriceStatus.failedSymbols).toEqual([]);
  });

  it("clears status on enter (fresh session)", () => {
    const s = makeFakeStore({ mode: "real" });
    s.set(() => ({
      timeTravelPriceStatus: {
        appliedSymbols: ["STALE"],
        clampedSymbols: [],
        failedSymbols: [],
      },
    }));
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2020-01-01");
    expect(s.state.timeTravelPriceStatus.appliedSymbols).toEqual([]);
  });

  it("clears status on exit (no bleed across sessions)", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2020-01-01");
    a.recordTimeTravelPriceOutcome("VOO", "applied");
    a.exitTimeTravelDiscard();
    expect(s.state.timeTravelPriceStatus.appliedSymbols).toEqual([]);
  });

  it("no-ops when called outside an active session", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.recordTimeTravelPriceOutcome("VOO", "applied");
    expect(s.state.timeTravelPriceStatus.appliedSymbols).toEqual([]);
  });
});

describe("Time-travel slice — enterTimeTravelEditingSnapshot (re-edit existing snapshots)", () => {
  // USER GAP: "once you say save snapshot no way to further time
  // travel edit that snapshot. There should be an edit time
  // travel button for existing time travel snapshots."
  // This action loads a snapshot's household + assumptions into
  // the live store, captures the user's CURRENT live state as
  // the baseline, and sets editingSnapshotT so the banner's Save
  // flow overwrites the existing row instead of asking the user
  // to confirm overwrite.

  const SNAP_HH: Household = {
    id: "snapshot-hh",
    members: [{ id: "snap-m1", displayName: "From snapshot" } as never],
    accounts: [],
    liabilities: [],
  };
  const SNAP_T = Date.UTC(2023, 5, 15, 12);

  it("loads the snapshot's household into the live store + captures baseline", () => {
    const s = makeFakeStore({ mode: "real" });
    const liveHouseholdBefore = s.state.household;
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravelEditingSnapshot({
      t: SNAP_T,
      household: SNAP_HH,
      date: "2023-06-15",
    });
    expect(s.state.timeTravelActive).toBe(true);
    expect(s.state.timeTravelDate).toBe("2023-06-15");
    expect(s.state.editingSnapshotT).toBe(SNAP_T);
    // Live household is now the snapshot's household — VALUE
    // equal, but a DEEP CLONE (not a shared reference). The
    // clone is the R1 audit critical fix: previously, editing
    // the loaded household mutated the snapshot object held by
    // SnapshotsManager AND the Dexie cache row, leaking
    // discarded edits across the Exit boundary.
    expect(s.state.household).toStrictEqual(SNAP_HH);
    expect(s.state.household).not.toBe(SNAP_HH);
    // Baseline preserved the user's pre-edit state for Exit.
    expect(s.state.baselineHousehold).toBe(liveHouseholdBefore);
  });

  it("optionally loads snapshot's assumptions when provided", () => {
    const s = makeFakeStore({ mode: "real" });
    const liveAssumptionsBefore = s.state.assumptions;
    const snapAssumptions = {
      ...liveAssumptionsBefore,
      withdrawalRate: 0.035,
    };
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravelEditingSnapshot({
      t: SNAP_T,
      household: SNAP_HH,
      assumptions: snapAssumptions,
      date: "2023-06-15",
    });
    expect(s.state.assumptions.withdrawalRate).toBe(0.035);
    expect(s.state.baselineAssumptions).toBe(liveAssumptionsBefore);
  });

  it("keeps live assumptions when snapshot has no assumptions field", () => {
    const s = makeFakeStore({ mode: "real" });
    const liveAssumptionsBefore = s.state.assumptions;
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravelEditingSnapshot({
      t: SNAP_T,
      household: SNAP_HH,
      assumptions: null,
      date: "2023-06-15",
    });
    expect(s.state.assumptions).toBe(liveAssumptionsBefore);
  });

  it("refuses re-entry while already active (defense in depth)", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2022-01-01");
    a.enterTimeTravelEditingSnapshot({
      t: SNAP_T,
      household: SNAP_HH,
      date: "2023-06-15",
    });
    // Date unchanged from original entry.
    expect(s.state.timeTravelDate).toBe("2022-01-01");
    expect(s.state.editingSnapshotT).toBeNull();
  });

  it("Exit restores the baseline + clears editingSnapshotT", () => {
    const s = makeFakeStore({ mode: "real" });
    const liveHHBefore = s.state.household;
    const liveAssumpBefore = s.state.assumptions;
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravelEditingSnapshot({
      t: SNAP_T,
      household: SNAP_HH,
      date: "2023-06-15",
    });
    a.exitTimeTravelDiscard();
    expect(s.state.timeTravelActive).toBe(false);
    expect(s.state.editingSnapshotT).toBeNull();
    expect(s.state.household).toBe(liveHHBefore);
    expect(s.state.assumptions).toBe(liveAssumpBefore);
  });

  it("editingSnapshotT is cleared by a fresh enterTimeTravel (regular entry)", () => {
    const s = makeFakeStore({ mode: "real" });
    // Simulate residual state from a prior session.
    s.set(() => ({ editingSnapshotT: 12345 }));
    const a = createTimeTravelSliceActions(s.set);
    a.enterTimeTravel("2024-01-01");
    expect(s.state.editingSnapshotT).toBeNull();
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

describe("Time-travel slice — restoreTimeTravelSession (resume across reload)", () => {
  const RESUMED_HH: Household = {
    id: "resumed-hh",
    members: [{ id: "m1", displayName: "Resumed" } as never],
    accounts: [],
    liabilities: [],
  };
  const ORIGINAL_HH: Household = {
    id: "original-hh",
    members: [{ id: "m1", displayName: "Original" } as never],
    accounts: [],
    liabilities: [],
  };

  it("loads the saved session's household + baseline into live state", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    a.restoreTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: 1_700_000_000_000,
      household: RESUMED_HH,
      assumptions: s.state.assumptions,
      baselineHousehold: ORIGINAL_HH,
      baselineAssumptions: s.state.assumptions,
    });
    expect(s.state.timeTravelActive).toBe(true);
    expect(s.state.timeTravelDate).toBe("2023-06-15");
    expect(s.state.editingSnapshotT).toBe(1_700_000_000_000);
    // Live state IS the saved session's edited household.
    expect(s.state.household).toBe(RESUMED_HH);
    // Baseline points at the pre-session live state so Exit
    // restores cleanly.
    expect(s.state.baselineHousehold).toBe(ORIGINAL_HH);
  });

  it("refuses to overwrite an already-active session in memory", () => {
    const s = makeFakeStore({ mode: "real" });
    const a = createTimeTravelSliceActions(s.set);
    // Active session in memory (e.g. user entered freshly).
    a.enterTimeTravel("2024-01-01");
    const liveBefore = s.state.household;
    a.restoreTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: null,
      household: RESUMED_HH,
      assumptions: s.state.assumptions,
      baselineHousehold: ORIGINAL_HH,
      baselineAssumptions: s.state.assumptions,
    });
    // Memory wins — the disk record is ignored.
    expect(s.state.timeTravelDate).toBe("2024-01-01");
    expect(s.state.household).toBe(liveBefore);
  });
});
