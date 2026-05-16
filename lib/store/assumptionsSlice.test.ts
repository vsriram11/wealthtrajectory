import { describe, expect, it } from "vitest";
import type { Assumptions } from "@/lib/types";
import {
  createAssumptionsSliceActions,
  createAssumptionsSliceInitial,
  type AssumptionsSliceState,
} from "./assumptionsSlice";

const DEFAULTS: Assumptions = {
  targetNetWorthUSD: 2_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

function makeFakeStore() {
  let state: AssumptionsSliceState = createAssumptionsSliceInitial(DEFAULTS);
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: AssumptionsSliceState) => Partial<AssumptionsSliceState>,
    ) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("createAssumptionsSliceInitial", () => {
  it("seeds with the provided defaults + empty member overrides", () => {
    const init = createAssumptionsSliceInitial(DEFAULTS);
    expect(init.assumptions).toBe(DEFAULTS);
    expect(init.memberAssumptions).toEqual({});
  });
});

describe("setAssumption", () => {
  it("updates a single household-default field without disturbing others", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setAssumption("targetNetWorthUSD", 5_000_000);
    expect(s.state.assumptions.targetNetWorthUSD).toBe(5_000_000);
    expect(s.state.assumptions.withdrawalRate).toBe(0.04); // unchanged
  });

  // Regression guard for the persistence layer: the
  // PersistenceHydrator + CloudSyncer subscribers diff state
  // by REFERENCE EQUALITY (state.assumptions === prev.assumptions)
  // to detect changes worth saving. If a setter ever mutates
  // in-place — keeping the same reference but flipping a field —
  // every save+sync path would silently miss the change. The
  // user reported this concern directly: "updates to those
  // should also sync, make sure." This test asserts the
  // setter ALWAYS produces a new reference, so changes to ANY
  // assumption key (including drawdownPhases, which is the
  // recent addition) flow through every subscriber.
  it("produces a fresh assumptions reference for every set (persistence-diff invariant)", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    const before = s.state.assumptions;
    a.setAssumption("targetNetWorthUSD", 5_000_000);
    expect(s.state.assumptions).not.toBe(before);
  });

  it("drawdownPhases update flips the reference (sync trigger)", () => {
    // Specific check on the field the user explicitly called
    // out — drawdownPhases changes must propagate through the
    // assumptions-reference-equality diff that CloudSyncer +
    // PersistenceHydrator use to detect changes worth pushing.
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    const before = s.state.assumptions;
    a.setAssumption("drawdownPhases", [
      { startMonthsAfterIndependence: 120, withdrawalRate: 0.035 },
    ]);
    expect(s.state.assumptions).not.toBe(before);
    expect(s.state.assumptions.drawdownPhases).toEqual([
      { startMonthsAfterIndependence: 120, withdrawalRate: 0.035 },
    ]);
  });
});

describe("setMemberAssumption", () => {
  it("creates a member entry on first override", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    expect(s.state.memberAssumptions.m1).toEqual({
      targetNetWorthUSD: 3_000_000,
    });
  });

  it("merges additional overrides into an existing entry", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    a.setMemberAssumption("m1", "withdrawalRate", 0.03);
    expect(s.state.memberAssumptions.m1).toEqual({
      targetNetWorthUSD: 3_000_000,
      withdrawalRate: 0.03,
    });
  });

  it("clearing a single field with undefined removes just that key", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    a.setMemberAssumption("m1", "withdrawalRate", 0.03);
    a.setMemberAssumption("m1", "targetNetWorthUSD", undefined);
    expect(s.state.memberAssumptions.m1).toEqual({ withdrawalRate: 0.03 });
  });

  it("clearing the last override removes the whole member entry", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    a.setMemberAssumption("m1", "targetNetWorthUSD", undefined);
    // Entry gone — keeps the synced payload clean of empty objects.
    expect("m1" in s.state.memberAssumptions).toBe(false);
  });
});

describe("clearMemberAssumptions", () => {
  it("drops every override for a single member", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    a.setMemberAssumption("m2", "targetNetWorthUSD", 1_000_000);
    a.clearMemberAssumptions("m1");
    expect("m1" in s.state.memberAssumptions).toBe(false);
    // m2's override survives the m1 clear, fully intact — not
    // just "exists". A regression that wiped both members
    // would be caught here.
    expect(s.state.memberAssumptions.m2?.targetNetWorthUSD).toBe(1_000_000);
  });

  it("is a no-op when the member has no overrides", () => {
    const s = makeFakeStore();
    const a = createAssumptionsSliceActions(s.set);
    a.setMemberAssumption("m1", "targetNetWorthUSD", 3_000_000);
    const before = s.state.memberAssumptions;
    a.clearMemberAssumptions("ghost");
    // Identity unchanged
    expect(s.state.memberAssumptions).toBe(before);
  });
});
