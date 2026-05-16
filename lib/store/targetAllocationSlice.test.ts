import { describe, expect, it } from "vitest";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";
import type { GlidePath } from "@/lib/portfolio/glidePath";
import {
  TARGET_ALLOCATION_SLICE_INITIAL,
  createTargetAllocationSliceActions,
  type TargetAllocationSliceState,
} from "./targetAllocationSlice";

function makeFakeStore() {
  let state: TargetAllocationSliceState = { ...TARGET_ALLOCATION_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<TargetAllocationSliceState>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("TargetAllocation slice", () => {
  it("starts with no target and no glide path", () => {
    expect(TARGET_ALLOCATION_SLICE_INITIAL.targetAllocation).toBeNull();
    expect(TARGET_ALLOCATION_SLICE_INITIAL.glidePath).toBeNull();
  });

  it("setTargetAllocation stores and clears", () => {
    const s = makeFakeStore();
    const a = createTargetAllocationSliceActions(s.set);
    const target: TargetAllocation = {
      equity: 0.7,
      bond: 0.2,
      cash: 0.1,
    } as TargetAllocation;
    a.setTargetAllocation(target);
    expect(s.state.targetAllocation).toBe(target);
    a.setTargetAllocation(null);
    expect(s.state.targetAllocation).toBeNull();
  });

  it("setGlidePath stores and clears, independent of static target", () => {
    const s = makeFakeStore();
    const a = createTargetAllocationSliceActions(s.set);
    const gp: GlidePath = { waypoints: [] } as GlidePath;
    a.setTargetAllocation({ equity: 1, bond: 0, cash: 0 } as TargetAllocation);
    a.setGlidePath(gp);
    expect(s.state.glidePath).toBe(gp);
    // Static target unaffected
    expect(s.state.targetAllocation).not.toBeNull();
    a.setGlidePath(null);
    expect(s.state.glidePath).toBeNull();
  });
});
