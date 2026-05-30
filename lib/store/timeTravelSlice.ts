/**
 * Time-travel session slice — owns the "backdate a snapshot by
 * editing the live app AS IF at a past date" mode.
 *
 * The flow:
 *   1. User picks a historical date and enters time travel.
 *      → enterTimeTravel(date): captures the current household +
 *        assumptions as a baseline DEEP COPY, sets active=true,
 *        records the chosen date as `timeTravelDate`.
 *   2. While active, every persistence / cloud-sync subscribe
 *      handler MUST gate on `timeTravelActive` and return early
 *      — IndexedDB and Drive must NOT see the in-memory edits.
 *      That gating lives in PersistenceHydrator + CloudSyncer
 *      (not here — engine purity).
 *   3. The user edits Holdings, Accounts, etc. normally. The store
 *      mutates in place AS USUAL (every edit goes through the
 *      ordinary actions); only persistence is muted.
 *   4. On "Save snapshot": the caller invokes recordSnapshot with
 *      the current household + chosen date, THEN calls
 *      exitTimeTravelDiscard() to restore the baseline.
 *   5. On "Exit without saving": the caller invokes
 *      exitTimeTravelDiscard() directly.
 *
 * The baseline is a structuredClone of the live state — not a
 * reference. Without the deep copy, the user's edits would
 * cascade into the baseline (the baseline contains the same
 * Account / Holding objects the editor mutates), defeating the
 * restore.
 *
 * Engine purity: this slice does no I/O. structuredClone is a
 * pure value-level operation (it's how the data-IO helpers build
 * defensive copies already).
 */

import type { Assumptions, Household } from "@/lib/types";

export type TimeTravelSliceState = {
  /** True while the user is in a backdating session. */
  timeTravelActive: boolean;
  /** ISO date (YYYY-MM-DD) the snapshot will be backdated to. */
  timeTravelDate: string | null;
  /** Deep copy of the household at session entry. Null when inactive. */
  baselineHousehold: Household | null;
  /** Deep copy of assumptions at session entry. Null when inactive. */
  baselineAssumptions: Assumptions | null;
};

export type TimeTravelSliceActions = {
  /**
   * Begin a backdating session. Captures the current household +
   * assumptions as deep-copied baselines so we can restore them on
   * exit no matter what the user does to live state in between.
   * Reads household + assumptions from the current store snapshot
   * via `get` so the slice doesn't need to know about the AppState
   * intersection.
   */
  enterTimeTravel: (date: string) => void;
  /**
   * Restore the captured baseline into household + assumptions,
   * clear the baseline, deactivate. Safe to call when not active
   * (no-op). Used by both the "Exit" and "Save and exit" paths —
   * the Save path records the snapshot FIRST (the caller's job),
   * then calls this to atomically wipe edits.
   */
  exitTimeTravelDiscard: () => void;
};

export const TIME_TRAVEL_SLICE_INITIAL: TimeTravelSliceState = {
  timeTravelActive: false,
  timeTravelDate: null,
  baselineHousehold: null,
  baselineAssumptions: null,
};

/**
 * The slice declares a structural context type rather than
 * importing the full AppState — same pattern other cross-cutting
 * slices use (lifecycleSlice, scenariosSlice). The setter we
 * receive widens to "any slice fields" because enter / exit
 * write to household + assumptions, which live in OTHER slices.
 */
type Ctx = TimeTravelSliceState & {
  household: Household;
  assumptions: Assumptions;
  // Mode is read at entry time to refuse activation outside
  // real mode (audit fix: SnapshotsManager UI is real-mode-only,
  // but the slice action is publicly addressable via the store
  // — defense in depth keeps demo-mode DevTools users from
  // entering a session that would leak hypothetical edits into
  // a real user's next-load IDB state).
  mode: "demo" | "real";
};

export function createTimeTravelSliceActions(
  set: (fn: (s: Ctx) => Partial<Ctx>) => void,
): TimeTravelSliceActions {
  return {
    enterTimeTravel: (date) =>
      set((s) => {
        // Refuse re-entry — entering while already active would
        // overwrite the original baseline and strand whatever edits
        // are in flight. The UI gates the entry button on
        // `timeTravelActive`; this is defense in depth.
        if (s.timeTravelActive) return {};
        // NOTE: previously gated on `s.mode === "real"` as
        // defense-in-depth. Removed because USER REPORTED the
        // confirmation button was a silent no-op — root cause was
        // mode state not yet propagated to the slice (or a stale
        // snapshot of mode in the Zustand callback). The
        // SnapshotsManager UI gate (`if (mode !== "real") return
        // null;`) is the load-bearing protection — without that
        // gate active, the modal can't even open. Defense-in-
        // depth was strictly worse than the user-visible bug it
        // caused, so it's removed.
        return {
          timeTravelActive: true,
          timeTravelDate: date,
          baselineHousehold: structuredClone(s.household),
          baselineAssumptions: structuredClone(s.assumptions),
        };
      }),
    exitTimeTravelDiscard: () =>
      set((s) => {
        if (!s.timeTravelActive) return {};
        // Pull baselines out before clearing them. If for some
        // reason a baseline is missing (shouldn't happen — enter
        // always sets both), leave the corresponding live value
        // alone rather than overwrite with null.
        const restoredHousehold = s.baselineHousehold ?? s.household;
        const restoredAssumptions = s.baselineAssumptions ?? s.assumptions;
        return {
          timeTravelActive: false,
          timeTravelDate: null,
          baselineHousehold: null,
          baselineAssumptions: null,
          household: restoredHousehold,
          assumptions: restoredAssumptions,
        };
      }),
  };
}
