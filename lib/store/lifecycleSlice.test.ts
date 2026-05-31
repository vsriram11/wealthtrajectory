import { describe, expect, it, vi } from "vitest";
import type { Assumptions, Household } from "@/lib/types";
import {
  LIFECYCLE_SLICE_INITIAL,
  createLifecycleSliceActions,
  type LifecycleSliceContext,
} from "./lifecycleSlice";

const EMPTY_HH: Household = {
  id: "empty",
  members: [{ id: "default", displayName: "You" }],
  accounts: [],
  liabilities: [],
};

const DEMO_HH: Household = {
  id: "demo",
  members: [{ id: "alex", displayName: "Alex" }],
  accounts: [],
  liabilities: [],
};

const EMPTY_ASSUMP: Assumptions = {
  targetNetWorthUSD: 2_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

const DEMO_ASSUMP: Assumptions = {
  targetNetWorthUSD: 3_500_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 35,
  expectedInflationRate: 0.03,
};

function makeFakeStore(seed: Partial<LifecycleSliceContext> = {}) {
  let state: LifecycleSliceContext = {
    ...LIFECYCLE_SLICE_INITIAL,
    mode: "demo",
    household: DEMO_HH,
    householdAnnualIncomeUSD: null,
    assumptions: DEMO_ASSUMP,
    memberAssumptions: {},
    preferredMemberId: null,
    selectedMemberId: null,
    editingHoldingId: null,
    editingLiabilityId: null,
    editingAccountId: null,
    creatingAccount: false,
    creatingHoldingForAccountId: null,
    managingMembers: false,
    targetAllocation: null,
    glidePath: null,
    goals: [],
    budgetItems: [],
    incomeStreams: [],
    scenarios: [],
    activeScenarioId: null,
    healthPlans: [],
    healthImportanceWeights: {},
    driveEncryptionEnabled: false,
    googleConnected: false,
    googleSyncing: false,
    googleSyncError: null,
    googleLastSyncAt: null,
    user: null,
    subscription: "free",
    subscriptionCheckedAt: null,
    viewBasis: "face",
    // Time-travel fields — added to LifecycleSliceContext when
    // TIME_TRAVEL_SLICE_INITIAL was added to freshSlate's spread
    // (audit round-2 fix). Tests default to inactive baseline.
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    editingSnapshotT: null,
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: LifecycleSliceContext) => Partial<LifecycleSliceContext>,
    ) => {
      state = { ...state, ...fn(state) };
    },
    get: () => state,
  };
}

const config = {
  clearRealState: vi.fn(async () => {}),
  demoHousehold: DEMO_HH,
  demoAssumptions: DEMO_ASSUMP,
  demoIncomeStreams: [],
  demoBudget: [],
  emptyHousehold: EMPTY_HH,
  emptyAssumptions: EMPTY_ASSUMP,
};

describe("switchToReal", () => {
  it("flips to real mode + empty household + clean slate, preserving auth", () => {
    const s = makeFakeStore({
      mode: "demo",
      household: DEMO_HH,
      scenarios: [
        {
          id: "sc1",
          name: "x",
          color: "#fff",
          createdAt: 0,
          overrides: {},
        },
      ],
      user: { email: "a@b.com" } as never,
      googleConnected: true,
      subscription: "pro",
      subscriptionCheckedAt: 12345,
      googleLastSyncAt: 999,
    });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.switchToReal();

    expect(s.state.mode).toBe("real");
    expect(s.state.household).toBe(EMPTY_HH);
    expect(s.state.scenarios).toEqual([]);
    expect(s.state.assumptions).toBe(EMPTY_ASSUMP);

    // Auth + sync preserved
    expect(s.state.user).toEqual({ email: "a@b.com" });
    expect(s.state.googleConnected).toBe(true);
    expect(s.state.subscription).toBe("pro");
    expect(s.state.subscriptionCheckedAt).toBe(12345);
    expect(s.state.googleLastSyncAt).toBe(999);

    // Sync flags reset
    expect(s.state.googleSyncing).toBe(false);
    expect(s.state.googleSyncError).toBeNull();
  });
});

describe("promoteToReal", () => {
  it("flips mode demo→real WITHOUT wiping the user's current state", () => {
    const editedHousehold = { ...DEMO_HH, members: [...DEMO_HH.members] };
    const s = makeFakeStore({
      mode: "demo",
      household: editedHousehold,
      scenarios: [
        { id: "sc1", name: "x", color: "#fff", createdAt: 0, overrides: {} },
      ],
      user: null,
      googleConnected: false,
    });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.promoteToReal();

    // Mode flipped.
    expect(s.state.mode).toBe("real");
    // Household + scenarios + everything else preserved (this is
    // the whole point — `switchToReal` wipes, `promoteToReal`
    // preserves). Without this guarantee the auto-promote in
    // PersistenceHydrator would silently delete the user's first
    // edit on its way to enabling persistence.
    expect(s.state.household).toBe(editedHousehold);
    expect(s.state.scenarios).toHaveLength(1);
  });

  it("is a no-op when already in real mode", () => {
    const realHousehold = { ...DEMO_HH };
    const s = makeFakeStore({ mode: "real", household: realHousehold });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.promoteToReal();
    expect(s.state.mode).toBe("real");
    expect(s.state.household).toBe(realHousehold);
  });
});

describe("resetToDemo", () => {
  it("invokes clearRealState + flips to demo + clean slate", () => {
    const clearRealState = vi.fn(async () => {});
    const a = createLifecycleSliceActions(
      makeFakeStore().set,
      makeFakeStore().get,
      { ...config, clearRealState },
    );
    a.resetToDemo();
    expect(clearRealState).toHaveBeenCalledOnce();
  });

  it("restores demo household + demo assumptions; preserves sign-in", () => {
    const s = makeFakeStore({
      mode: "real",
      household: EMPTY_HH,
      assumptions: EMPTY_ASSUMP,
      user: { email: "a@b.com" } as never,
      googleConnected: true,
    });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.resetToDemo();

    expect(s.state.mode).toBe("demo");
    expect(s.state.household).toBe(DEMO_HH);
    expect(s.state.assumptions).toBe(DEMO_ASSUMP);
    expect(s.state.user).toEqual({ email: "a@b.com" });
    expect(s.state.googleConnected).toBe(true);
  });
});

describe("hydrateFromPersisted", () => {
  it("flips mode to real + flag to hydrated + migrates household", () => {
    const s = makeFakeStore({ mode: "demo", hydrated: false });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: {
        id: "user",
        members: [{ id: "u1", displayName: "User" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: EMPTY_ASSUMP,
    });
    expect(s.state.mode).toBe("real");
    expect(s.state.hydrated).toBe(true);
  });

  it("falls back to current scenarios when the payload omits them (pre-IDB-scenarios saves)", () => {
    const inMemory = [
      { id: "sc-old", name: "x", color: "#fff", createdAt: 0, overrides: {} },
    ];
    const s = makeFakeStore({ scenarios: inMemory });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: EMPTY_HH,
      assumptions: EMPTY_ASSUMP,
      // scenarios intentionally absent
    });
    expect(s.state.scenarios).toBe(inMemory);
  });

  it("zeroes legacy householdAnnualIncomeUSD after migration", () => {
    const s = makeFakeStore();
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: {
        id: "u",
        members: [{ id: "u1", displayName: "User" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: EMPTY_ASSUMP,
      householdAnnualIncomeUSD: 200_000,
    });
    // Income is migrated to the first member; the legacy field is
    // cleared so it doesn't round-trip through Drive again.
    expect(s.state.householdAnnualIncomeUSD).toBeNull();
    expect(s.state.household.members[0].incomeUSD).toBe(200_000);
  });

  it("respects payload's preferredMemberId when the member exists", () => {
    const s = makeFakeStore();
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: {
        id: "u",
        members: [
          { id: "u1", displayName: "User1" },
          { id: "u2", displayName: "User2" },
        ],
        accounts: [],
        liabilities: [],
      },
      assumptions: EMPTY_ASSUMP,
      preferredMemberId: "u2",
    });
    expect(s.state.preferredMemberId).toBe("u2");
    expect(s.state.selectedMemberId).toBe("u2");
  });

  it("drops payload's preferredMemberId when it points at a non-member", () => {
    const s = makeFakeStore();
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: {
        id: "u",
        members: [{ id: "u1", displayName: "User" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: EMPTY_ASSUMP,
      preferredMemberId: "ghost",
    });
    expect(s.state.preferredMemberId).toBeNull();
  });

  it("preserves in-memory driveEncryptionEnabled when payload omits it", () => {
    const s = makeFakeStore({ driveEncryptionEnabled: true });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.hydrateFromPersisted({
      household: EMPTY_HH,
      assumptions: EMPTY_ASSUMP,
      // driveEncryptionEnabled intentionally absent
    });
    expect(s.state.driveEncryptionEnabled).toBe(true);
  });
});

describe("importPayload", () => {
  it("filters memberAssumptions to members the payload's household actually has", () => {
    const s = makeFakeStore();
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.importPayload({
      household: {
        id: "u",
        members: [{ id: "u1", displayName: "User" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: EMPTY_ASSUMP,
      memberAssumptions: {
        u1: { targetNetWorthUSD: 5_000_000 },
        // ghost member shouldn't survive
        ghost: { targetNetWorthUSD: 10_000_000 },
      },
    });
    expect(Object.keys(s.state.memberAssumptions)).toEqual(["u1"]);
  });

  it("preserves auth on import (Drive backup shouldn't sign user out)", () => {
    const s = makeFakeStore({
      user: { email: "a@b.com" } as never,
      googleConnected: true,
      subscription: "pro",
      subscriptionCheckedAt: 42,
    });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.importPayload({
      household: EMPTY_HH,
      assumptions: EMPTY_ASSUMP,
    });
    expect(s.state.user).toEqual({ email: "a@b.com" });
    expect(s.state.googleConnected).toBe(true);
    expect(s.state.subscription).toBe("pro");
  });

  it("defaults empty collections when payload omits them", () => {
    const s = makeFakeStore({
      scenarios: [
        {
          id: "stale",
          name: "x",
          color: "#fff",
          createdAt: 0,
          overrides: {},
        },
      ],
      goals: [{ id: "g", name: "x", targetUSD: 100 } as never],
    });
    const a = createLifecycleSliceActions(s.set, s.get, config);
    a.importPayload({
      household: EMPTY_HH,
      assumptions: EMPTY_ASSUMP,
    });
    // Import REPLACES — stale in-memory data should be dropped.
    expect(s.state.scenarios).toEqual([]);
    expect(s.state.goals).toEqual([]);
  });
});
