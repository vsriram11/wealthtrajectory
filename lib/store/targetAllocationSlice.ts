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
  get: () => TargetAllocationSliceState,
): TargetAllocationSliceActions {
  return {
    setTargetAllocation: (target) => set({ targetAllocation: target }),
    // Normalize on every set so any downstream consumer can assume
    // ascending unique ages — the custom waypoint editor accepts
    // edits in any order and we don't want every consumer to
    // re-sort defensively.
    //
    // Content-equality short-circuit: if the normalized input is
    // structurally identical to the currently-stored value, skip
    // the set entirely. Without this, every call (e.g. tapping
    // the same preset twice, re-saving an unedited waypoint list)
    // produces a fresh object reference → CloudSyncer detects a
    // "change" → schedules a Drive upload. Cheap to short-circuit
    // here so user-initiated round-trips that don't actually
    // change anything don't trigger needless syncs.
    setGlidePath: (gp) => {
      const next = gp == null ? null : normalizeGlidePath(gp);
      const current = get().glidePath;
      if (glidePathContentEqual(current, next)) return;
      set({ glidePath: next });
    },
  };
}

function glidePathContentEqual(
  a: GlidePath | null,
  b: GlidePath | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.waypoints.length !== b.waypoints.length) return false;
  for (let i = 0; i < a.waypoints.length; i++) {
    const aa = a.waypoints[i];
    const bb = b.waypoints[i];
    if (aa.age !== bb.age) return false;
    const keys = new Set([
      ...Object.keys(aa.allocation),
      ...Object.keys(bb.allocation),
    ]);
    for (const k of keys) {
      const av = (aa.allocation as Record<string, number | undefined>)[k] ?? 0;
      const bv = (bb.allocation as Record<string, number | undefined>)[k] ?? 0;
      if (Math.abs(av - bv) > 1e-9) return false;
    }
  }
  return true;
}
