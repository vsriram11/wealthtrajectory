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
    get_: () => state,
  };
}

describe("TargetAllocation slice", () => {
  it("starts with no target and no glide path", () => {
    expect(TARGET_ALLOCATION_SLICE_INITIAL.targetAllocation).toBeNull();
    expect(TARGET_ALLOCATION_SLICE_INITIAL.glidePath).toBeNull();
  });

  it("setTargetAllocation stores and clears", () => {
    const s = makeFakeStore();
    const a = createTargetAllocationSliceActions(s.set, s.get_);
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
    const a = createTargetAllocationSliceActions(s.set, s.get_);
    const gp: GlidePath = { waypoints: [] } as GlidePath;
    a.setTargetAllocation({ equity: 1, bond: 0, cash: 0 } as TargetAllocation);
    a.setGlidePath(gp);
    // setGlidePath now normalizes (sort + dedupe) so the stored
    // reference differs from the input — use deep-equality
    // instead of identity. Normalization on an empty-waypoints
    // path is a no-op semantically.
    expect(s.state.glidePath).toEqual(gp);
    // Static target unaffected
    expect(s.state.targetAllocation).not.toBeNull();
    a.setGlidePath(null);
    expect(s.state.glidePath).toBeNull();
  });

  it("setGlidePath normalizes (sorts ascending + dedupes same-age waypoints)", () => {
    // Issue #7 made setGlidePath the normalization point so any
    // downstream consumer can assume ascending unique ages. Pin
    // that invariant: an unsorted + duplicated input must come
    // out sorted + collapsed.
    const s = makeFakeStore();
    const a = createTargetAllocationSliceActions(s.set, s.get_);
    a.setGlidePath({
      waypoints: [
        { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
        { age: 30, allocation: { equity: 0.9, bond: 0.1 } },
        // Duplicate age — later write wins.
        { age: 60, allocation: { equity: 0.4, bond: 0.6 } },
      ],
    });
    const stored = s.state.glidePath;
    expect(stored).not.toBeNull();
    expect(stored!.waypoints.length).toBe(2);
    expect(stored!.waypoints[0].age).toBe(30);
    expect(stored!.waypoints[1].age).toBe(60);
    expect(stored!.waypoints[1].allocation.equity).toBe(0.4);
  });
});
