/**
 * Static and lifecycle (glide-path) target-allocation state.
 *
 * `targetAllocation`  Static "this is my ideal mix" target.
 *                     Drives the Target Allocation card's
 *                     drift indicators.
 * `glidePath`         Optional age-keyed waypoints that shadow
 *                     the static target when set — at age N the
 *                     glide path interpolates between adjacent
 *                     waypoints to produce the effective target.
 *
 * Both are persisted to Drive + IDB. Either or both may be null.
 * When both are set, glidePath wins for drift / target-tracking
 * computations.
 */

import { normalizeGlidePath, type GlidePath } from "@/lib/portfolio/glidePath";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";

export type TargetAllocationSliceState = {
  targetAllocation: TargetAllocation | null;
  glidePath: GlidePath | null;
};

export type TargetAllocationSliceActions = {
  setTargetAllocation: (target: TargetAllocation | null) => void;
  setGlidePath: (gp: GlidePath | null) => void;
};

export const TARGET_ALLOCATION_SLICE_INITIAL: TargetAllocationSliceState = {
  targetAllocation: null,
  glidePath: null,
};

export function createTargetAllocationSliceActions(
  set: (patch: Partial<TargetAllocationSliceState>) => void,
): TargetAllocationSliceActions {
  return {
    setTargetAllocation: (target) => set({ targetAllocation: target }),
    // Normalize on every set so any downstream consumer can assume
    // ascending unique ages — the custom waypoint editor accepts
    // edits in any order and we don't want every consumer to
    // re-sort defensively.
    setGlidePath: (gp) =>
      set({ glidePath: gp == null ? null : normalizeGlidePath(gp) }),
  };
}
