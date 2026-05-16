import { describe, expect, it } from "vitest";
import type { Assumptions } from "@/lib/types";
import {
  createMembersActions,
  type MembersActionsContext,
} from "./membersActions";

function makeFakeStore(seed: Partial<MembersActionsContext> = {}) {
  let state: MembersActionsContext = {
    household: {
      id: "h1",
      members: [{ id: "m1", displayName: "Alex" }],
      accounts: [],
      liabilities: [],
    },
    memberAssumptions: {},
    selectedMemberId: null,
    preferredMemberId: null,
    budgetItems: [],
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: MembersActionsContext) => Partial<MembersActionsContext>,
    ) => {
      state = { ...state, ...fn(state) };
    },
    get: () => state,
  };
}

describe("addMember / renameMember", () => {
  it("trims name + falls back to 'Member' when empty", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    const id1 = a.addMember("  Bob  ");
    const id2 = a.addMember("   ");
    const members = s.state.household.members;
    expect(members.find((m) => m.id === id1)!.displayName).toBe("Bob");
    expect(members.find((m) => m.id === id2)!.displayName).toBe("Member");
  });

  it("addMember returns a mem- prefixed id", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    expect(a.addMember("X").startsWith("mem-")).toBe(true);
  });

  it("renameMember ignores empty / whitespace-only names", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    a.renameMember("m1", "  ");
    expect(s.state.household.members[0].displayName).toBe("Alex");
  });
});

describe("setMemberIncome", () => {
  it("treats 0 as a valid earner state; coerces invalid to null/0", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);

    a.setMemberIncome("m1", 80000);
    expect(s.state.household.members[0].incomeUSD).toBe(80000);

    a.setMemberIncome("m1", 0);
    expect(s.state.household.members[0].incomeUSD).toBe(0);

    // negative is finite → clamps to 0 (not null)
    a.setMemberIncome("m1", -50);
    expect(s.state.household.members[0].incomeUSD).toBe(0);

    a.setMemberIncome("m1", NaN);
    expect(s.state.household.members[0].incomeUSD).toBeNull();
    a.setMemberIncome("m1", null);
    expect(s.state.household.members[0].incomeUSD).toBeNull();
  });
});

describe("setMemberAge", () => {
  it("rounds fractional ages + rejects zero/negative", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    a.setMemberAge("m1", 37.6);
    expect(s.state.household.members[0].age).toBe(38);
    a.setMemberAge("m1", 0);
    expect(s.state.household.members[0].age).toBeNull();
    a.setMemberAge("m1", -3);
    expect(s.state.household.members[0].age).toBeNull();
  });
});

describe("removeMember", () => {
  it("refuses while accounts / liabilities / budget items reference the member", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob" },
        ],
        accounts: [
          {
            id: "a",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m2",
            monthlyContributionUSD: 0,
            holdings: [],
          },
        ],
        liabilities: [],
      },
    });
    const a = createMembersActions(s.set, s.get);
    expect(a.removeMember("m2")).toBe(false);
    expect(s.state.household.members).toHaveLength(2);
  });

  it("refuses to leave the household empty", () => {
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    expect(a.removeMember("m1")).toBe(false);
    expect(s.state.household.members).toHaveLength(1);
  });

  it("cascades: clears memberAssumptions / selectedMemberId / preferredMemberId", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob" },
        ],
        accounts: [],
        liabilities: [],
      },
      memberAssumptions: {
        m2: { targetNetWorthUSD: 5_000_000 } as Partial<Assumptions>,
      },
      selectedMemberId: "m2",
      preferredMemberId: "m2",
    });
    const a = createMembersActions(s.set, s.get);
    expect(a.removeMember("m2")).toBe(true);
    expect(s.state.household.members).toHaveLength(1);
    expect(s.state.memberAssumptions.m2).toBeUndefined();
    expect(s.state.selectedMemberId).toBeNull();
    expect(s.state.preferredMemberId).toBeNull();
  });
});

describe("setMemberIncludeInRollup", () => {
  // Helper: a 2-member household where both members start in the
  // "implicit included" state (no flag persisted). Mirrors the
  // back-compat shape callers will encounter most often.
  const twoMembers = () =>
    makeFakeStore({
      household: {
        id: "h1",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob" },
        ],
        accounts: [],
        liabilities: [],
      },
    });

  it("toggles a member off + back on", () => {
    const s = twoMembers();
    const a = createMembersActions(s.set, s.get);

    expect(a.setMemberIncludeInRollup("m2", false)).toBe(true);
    expect(s.state.household.members[1].includeInRollup).toBe(false);

    expect(a.setMemberIncludeInRollup("m2", true)).toBe(true);
    expect(s.state.household.members[1].includeInRollup).toBe(true);
  });

  it("refuses to toggle off the last active member", () => {
    // Single-member household — toggling off would leave zero
    // active. The action must no-op + return false (mirroring
    // removeMember's ≥1-member floor) so downstream rollups
    // never have to handle an empty active set.
    const s = makeFakeStore();
    const a = createMembersActions(s.set, s.get);
    expect(a.setMemberIncludeInRollup("m1", false)).toBe(false);
    expect(s.state.household.members[0].includeInRollup).toBeUndefined();
  });

  it("refuses when toggling off the LAST member among an excluded set", () => {
    // 3 members, 2 already excluded. Toggling the remaining
    // active one off would empty the rollup — refused.
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [
          { id: "m1", displayName: "Alex", includeInRollup: false },
          { id: "m2", displayName: "Bob" },
          { id: "m3", displayName: "Cara", includeInRollup: false },
        ],
        accounts: [],
        liabilities: [],
      },
    });
    const a = createMembersActions(s.set, s.get);
    expect(a.setMemberIncludeInRollup("m2", false)).toBe(false);
    // Re-enabling an already-excluded member should still work
    // even when only one is currently active — the active count
    // is going up, not down.
    expect(a.setMemberIncludeInRollup("m1", true)).toBe(true);
    expect(s.state.household.members[0].includeInRollup).toBe(true);
  });

  it("no-ops on missing member id", () => {
    const s = twoMembers();
    const a = createMembersActions(s.set, s.get);
    expect(a.setMemberIncludeInRollup("nope", false)).toBe(false);
    expect(s.state.household.members).toHaveLength(2);
  });

  it("no-ops when the value already matches (no wasteful re-render)", () => {
    const s = twoMembers();
    const a = createMembersActions(s.set, s.get);
    // m1 is implicitly included → setting to true should be a no-op.
    const before = s.state.household;
    expect(a.setMemberIncludeInRollup("m1", true)).toBe(false);
    // Same reference identity — proves we didn't go through the
    // setter (which would have shallow-copied household).
    expect(s.state.household).toBe(before);
  });
});

describe("reorderMembers", () => {
  it("honors orderedIds + tail-pads missing ids", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob" },
          { id: "m3", displayName: "Cara" },
        ],
        accounts: [],
        liabilities: [],
      },
    });
    const a = createMembersActions(s.set, s.get);
    a.reorderMembers(["m3", "m1"]);
    expect(s.state.household.members.map((m) => m.id)).toEqual([
      "m3",
      "m1",
      "m2",
    ]);
  });
});
