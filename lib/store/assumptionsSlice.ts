/**
 * Plan-assumption state.
 *
 * `assumptions`       Household-default plan parameters (target,
 *                     withdrawal rate, inflation, horizons …).
 *                     Every projection that doesn't specify a
 *                     member draws from here.
 * `memberAssumptions` Per-member override layer. Sparse — only
 *                     members with custom values appear. A
 *                     member's effective assumptions = household
 *                     defaults merged with their entry; entries
 *                     win on overlap.
 *
 * The setMemberAssumption helper enforces the invariant that an
 * empty override map gets pruned (so a member that resets every
 * override doesn't leave a stale empty record on the next sync).
 */

import type { Assumptions } from "@/lib/types";

export type AssumptionsSliceState = {
  assumptions: Assumptions;
  memberAssumptions: Record<string, Partial<Assumptions>>;
};

export type AssumptionsSliceActions = {
  setAssumption: <K extends keyof Assumptions>(
    key: K,
    value: Assumptions[K],
  ) => void;
  setMemberAssumption: <K extends keyof Assumptions>(
    memberId: string,
    key: K,
    value: Assumptions[K] | undefined,
  ) => void;
  clearMemberAssumptions: (memberId: string) => void;
};

/**
 * Factory for the initial state. Takes the default household
 * assumptions as an argument so demo-mode vs real-mode can each
 * seed with their respective defaults without duplicating this
 * slice file.
 */
export function createAssumptionsSliceInitial(
  defaults: Assumptions,
): AssumptionsSliceState {
  return {
    assumptions: defaults,
    memberAssumptions: {},
  };
}

export function createAssumptionsSliceActions(
  set: (
    fn: (s: AssumptionsSliceState) => Partial<AssumptionsSliceState>,
  ) => void,
): AssumptionsSliceActions {
  return {
    setAssumption: (key, value) =>
      set((s) => ({ assumptions: { ...s.assumptions, [key]: value } })),

    setMemberAssumption: (memberId, key, value) =>
      set((s) => {
        const next = { ...s.memberAssumptions };
        const cur = { ...(next[memberId] ?? {}) };
        if (value === undefined) {
          delete cur[key];
        } else {
          cur[key] = value;
        }
        // Drop the whole entry when a member has no overrides
        // left — keeps the synced payload clean (no stale empty
        // objects on Drive).
        if (Object.keys(cur).length === 0) {
          delete next[memberId];
        } else {
          next[memberId] = cur;
        }
        return { memberAssumptions: next };
      }),

    clearMemberAssumptions: (memberId) =>
      set((s) => {
        if (!(memberId in s.memberAssumptions)) return {};
        const next = { ...s.memberAssumptions };
        delete next[memberId];
        return { memberAssumptions: next };
      }),
  };
}
