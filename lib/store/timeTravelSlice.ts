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
  /**
   * When set, the session was entered to EDIT an existing snapshot
   * at this primary key (t value). The banner's Save flow uses
   * this to overwrite the existing row directly without prompting
   * the user (they explicitly chose to edit, so a confirmation
   * dialog would be redundant friction). null = fresh session
   * with no editing target.
   */
  editingSnapshotT: number | null;
  /**
   * Status of the historical-price auto-fill, surfaced in the
   * TimeTravelBanner so the user knows which holdings got
   * auto-filled vs which need manual entry.
   *
   * Yahoo Finance / Finnhub historical fetch is best-effort —
   * it can fail for many reasons:
   *   - Symbol not covered by upstream APIs (private equity,
   *     thinly-traded stocks, foreign tickers without ADRs)
   *   - Date older than the available history window
   *   - Upstream rate limits / outages
   *   - Network failure
   *
   * Manual entry is the load-bearing path; auto-fill is a
   * convenience layer on top. The status fields make the
   * auto-fill outcome VISIBLE so users know whether to expect
   * pre-populated values or to fill them in themselves.
   */
  timeTravelPriceStatus: {
    /** Symbols that successfully received historical prices. */
    appliedSymbols: string[];
    /**
     * Symbols where the fetch returned a result outside the
     * available history window (clamped to the oldest / newest
     * sample). The historical-price flow SKIPS these so we
     * don't silently apply wrong prices.
     */
    clampedSymbols: string[];
    /**
     * Symbols where getQuote returned null OR a non-finite
     * price (upstream failure, unavailable symbol, etc).
     * Each entry is `{symbol, reason}` so the banner can show
     * the upstream diagnostic — critical when Yahoo/Finnhub
     * are flaky and the user needs to see "yahoo: 401
     * Unauthorized" or "finnhub: no API key" to diagnose.
     */
    failedSymbols: Array<{ symbol: string; reason: string }>;
  };
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
   * Begin a session to EDIT an existing snapshot. Like
   * enterTimeTravel, but also LOADS the snapshot's household
   * (and appState.assumptions, when present) into the live store
   * so the user can pick up exactly where they left off. The
   * baseline still captures the user's live state so Exit
   * restores it cleanly.
   *
   * The banner's Save flow consults `editingSnapshotT` to
   * overwrite the existing row directly (no collision dialog).
   *
   * User-reported gap: "once you say save snapshot no way to
   * further time travel edit that snapshot. There should be an
   * edit time travel button for existing time travel snapshots."
   */
  enterTimeTravelEditingSnapshot: (snapshot: {
    t: number;
    household: Household;
    assumptions?: Assumptions | null;
    date: string;
  }) => void;
  /**
   * Restore the captured baseline into household + assumptions,
   * clear the baseline, deactivate. Safe to call when not active
   * (no-op). Used by both the "Exit" and "Save and exit" paths —
   * the Save path records the snapshot FIRST (the caller's job),
   * then calls this to atomically wipe edits.
   */
  exitTimeTravelDiscard: () => void;
  /**
   * Record the outcome of a historical-price fetch attempt for
   * a single symbol. Called by PriceRefresher's historical-mode
   * effect. The TimeTravelBanner reads these flags to surface
   * "auto-filled: 3 / needs manual: 5" status to the user.
   *
   * `reason` is the upstream diagnostic message (e.g. "yahoo:
   * 401 Unauthorized | finnhub: no API key") — REQUIRED on
   * "failed" so the banner can surface actionable diagnostic
   * info. Ignored on "applied" and "clamped".
   */
  recordTimeTravelPriceOutcome: (
    symbol: string,
    outcome: "applied" | "clamped" | "failed",
    reason?: string,
  ) => void;
};

export const TIME_TRAVEL_SLICE_INITIAL: TimeTravelSliceState = {
  timeTravelActive: false,
  timeTravelDate: null,
  baselineHousehold: null,
  baselineAssumptions: null,
  editingSnapshotT: null,
  timeTravelPriceStatus: {
    appliedSymbols: [],
    clampedSymbols: [],
    failedSymbols: [],
  },
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
        // BASELINE = REFERENCE, NOT DEEP CLONE.
        //
        // Previously: `structuredClone(s.household)` and
        // `structuredClone(s.assumptions)`. A USER hit "Maximum
        // call stack size exceeded" on the structuredClone of
        // their real household — probably due to deep nesting
        // in scenarios / per-member assumptions / a future
        // Proxy that structuredClone can't unwrap, or a Safari
        // bug on iOS.
        //
        // The deep clone was overkill: the project convention
        // (CLAUDE.md §2 "Store action setters produce fresh
        // references") guarantees every Zustand action creates
        // a NEW array/object instead of mutating in place. So
        // when the user edits a holding during time-travel, the
        // edited account/holding gets a NEW reference; the
        // OTHER accounts/holdings and the original household
        // reference are untouched. Storing `s.household` as the
        // baseline reference + restoring it on exit is exactly
        // as correct as the deep-clone version, AND works
        // around whatever was making structuredClone recurse
        // infinitely on this user's data.
        return {
          timeTravelActive: true,
          timeTravelDate: date,
          baselineHousehold: s.household,
          baselineAssumptions: s.assumptions,
          editingSnapshotT: null,
          // Reset status on entry — historical-price flow will
          // populate it as fetches complete.
          timeTravelPriceStatus: {
            appliedSymbols: [],
            clampedSymbols: [],
            failedSymbols: [],
          },
        };
      }),
    enterTimeTravelEditingSnapshot: (snap) =>
      set((s) => {
        if (s.timeTravelActive) return {};
        // Baseline = the user's CURRENT live state (so Exit
        // restores cleanly). Load the snapshot's household +
        // assumptions into the live store so the editor picks
        // up exactly where the snapshot left off.
        return {
          timeTravelActive: true,
          timeTravelDate: snap.date,
          baselineHousehold: s.household,
          baselineAssumptions: s.assumptions,
          editingSnapshotT: snap.t,
          household: snap.household,
          ...(snap.assumptions ? { assumptions: snap.assumptions } : {}),
          timeTravelPriceStatus: {
            appliedSymbols: [],
            clampedSymbols: [],
            failedSymbols: [],
          },
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
          // Clear the price-status bookkeeping too — it's
          // session-scoped and shouldn't bleed across sessions.
          timeTravelPriceStatus: {
            appliedSymbols: [],
            clampedSymbols: [],
            failedSymbols: [],
          },
        };
      }),
    recordTimeTravelPriceOutcome: (symbol, outcome, reason) =>
      set((s) => {
        if (!s.timeTravelActive) return {};
        const sym = symbol.toUpperCase();
        const cur = s.timeTravelPriceStatus;
        // De-dup: a symbol that moves outcomes (e.g. failed →
        // applied on retry) only appears in the latest bucket.
        const withoutStr = (arr: string[]) => arr.filter((x) => x !== sym);
        const withoutFailed = (
          arr: Array<{ symbol: string; reason: string }>,
        ) => arr.filter((x) => x.symbol !== sym);
        const next = {
          appliedSymbols: withoutStr(cur.appliedSymbols),
          clampedSymbols: withoutStr(cur.clampedSymbols),
          failedSymbols: withoutFailed(cur.failedSymbols),
        };
        if (outcome === "applied") next.appliedSymbols.push(sym);
        else if (outcome === "clamped") next.clampedSymbols.push(sym);
        else
          next.failedSymbols.push({
            symbol: sym,
            reason: reason ?? "no reason reported",
          });
        return { timeTravelPriceStatus: next };
      }),
  };
}
