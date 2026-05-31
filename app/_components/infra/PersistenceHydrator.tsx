"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import {
  clearTimeTravelSession,
  loadRealState,
  loadTimeTravelSession,
  maybeRecordMonthlySnapshot,
  maybeRecordSnapshot,
  saveRealState,
  saveTimeTravelSession,
} from "@/lib/persistence/persistence";
import { captureSnapshotAppState } from "@/lib/persistence/snapshotAppState";
import { householdNetWorth } from "@/lib/types";

export function PersistenceHydrator() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await loadRealState();
      if (cancelled) return;
      const current = useAppStore.getState();
      if (data && current.mode !== "real") {
        useAppStore.getState().hydrateFromPersisted({
          household: data.household,
          assumptions: data.assumptions,
          memberAssumptions: data.memberAssumptions,
          preferredMemberId: data.preferredMemberId,
          targetAllocation: data.targetAllocation,
          glidePath: data.glidePath,
          householdAnnualIncomeUSD: data.householdAnnualIncomeUSD,
          goals: data.goals,
          budgetItems: data.budgetItems,
          incomeStreams: data.incomeStreams,
          scenarios: data.scenarios,
          driveEncryptionEnabled: data.driveEncryptionEnabled,
          healthPlans: data.healthPlans,
          healthImportanceWeights: data.healthImportanceWeights,
        });
      } else {
        // Mark hydration as settled even when there's no data on disk
        // so AuthHydrator's first-sign-in path can wait on us before
        // deciding "no local data → switchToReal + upload empty"
        // (which would silently wipe IDB data on a slow disk read).
        useAppStore.setState({ hydrated: true });
      }
      // After the live state lands, check for a persisted
      // time-travel session. If found, restore it on top of the
      // hydrated state — the user picks up exactly where they
      // left off, banner and all, with their edits intact.
      // User-reported gap: "enter time travel snapshot mode, exit
      // the app, come back a few mins later, values changed."
      // Without persistence the session was silently discarded on
      // tab close.
      const session = await loadTimeTravelSession();
      if (cancelled) return;
      if (session) {
        useAppStore.getState().restoreTimeTravelSession({
          timeTravelDate: session.timeTravelDate,
          editingSnapshotT: session.editingSnapshotT,
          household: session.household,
          assumptions: session.assumptions,
          baselineHousehold: session.baselineHousehold,
          baselineAssumptions: session.baselineAssumptions,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    let sessionTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe((state, prev) => {
      // Frame B (no-sign-in support): if a state change fires while
      // we're still in demo mode, the user has just made their first
      // edit — promote the session to real mode (preserves all
      // current data) so the downstream IDB writes + Drive sync
      // gates work normally. We DON'T return after promoteToReal:
      // the synchronous re-fire would see (state.household ===
      // prev.household) after the promote (since only mode flipped)
      // and early-return at the diff check below — silently losing
      // the user's edit. So we fall through and let THIS fire
      // schedule the save with `state` still pointing at the user's
      // actual diff vs `prev`.
      //
      // Filter: skip the no-op fires that happen during initial
      // hydration (those leave all tracked slices identical and the
      // diff check below already returns early on them).
      if (state.mode !== "real") {
        // Keep this list IN SYNC with the diff check below — every
        // field the save layer persists must trigger auto-promote,
        // or a demo user's edit to that field gets silently dropped
        // (the noUserEdit check returns true and the save below
        // also gates on mode === "real"). Audit R1 caught the
        // omission of preferredMemberId — the Members sheet
        // selector wrote it to the store but the filter said "no
        // real change" so nothing persisted.
        const noUserEdit =
          state.household === prev.household &&
          state.assumptions === prev.assumptions &&
          state.memberAssumptions === prev.memberAssumptions &&
          state.preferredMemberId === prev.preferredMemberId &&
          state.targetAllocation === prev.targetAllocation &&
          state.glidePath === prev.glidePath &&
          state.householdAnnualIncomeUSD === prev.householdAnnualIncomeUSD &&
          state.goals === prev.goals &&
          state.budgetItems === prev.budgetItems &&
          state.incomeStreams === prev.incomeStreams &&
          state.scenarios === prev.scenarios &&
          state.driveEncryptionEnabled === prev.driveEncryptionEnabled &&
          state.healthPlans === prev.healthPlans &&
          state.healthImportanceWeights === prev.healthImportanceWeights;
        if (noUserEdit) return;
        useAppStore.getState().promoteToReal();
        // Fall through to the save logic below.
      }
      // Time-travel session gate — when active, the household /
      // assumptions in memory represent a HYPOTHETICAL past state
      // the user is editing for the purpose of taking a backdated
      // snapshot. The live state (REAL_KEY) must stay untouched;
      // BUT the session itself is persisted to a SEPARATE IDB key
      // so the user can resume it after closing the tab.
      if (state.timeTravelActive) {
        // Cancel any in-flight live-state save / snap timers —
        // they were scheduled by the pre-time-travel state change
        // (or the entry transition) and must not run now.
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (snapTimer) {
          clearTimeout(snapTimer);
          snapTimer = null;
        }
        // Schedule the session-record save (debounced). Persists
        // the live edit state + baseline so reload restores
        // exactly where the user left off.
        if (sessionTimer) clearTimeout(sessionTimer);
        sessionTimer = setTimeout(() => {
          const fresh = useAppStore.getState();
          if (!fresh.timeTravelActive) return;
          if (fresh.mode !== "real") return;
          if (!fresh.timeTravelDate) return;
          if (!fresh.baselineHousehold || !fresh.baselineAssumptions) return;
          void saveTimeTravelSession({
            timeTravelDate: fresh.timeTravelDate,
            editingSnapshotT: fresh.editingSnapshotT,
            household: fresh.household,
            assumptions: fresh.assumptions,
            baselineHousehold: fresh.baselineHousehold,
            baselineAssumptions: fresh.baselineAssumptions,
          });
        }, 250);
        return;
      }
      // Transition out of time-travel mode (Exit / Save snapshot):
      // wipe the persisted session record so a future reload
      // doesn't re-enter the just-finished session. Detected via
      // the prev→state transition; runs regardless of the diff
      // check below.
      if (prev.timeTravelActive && !state.timeTravelActive) {
        if (sessionTimer) {
          clearTimeout(sessionTimer);
          sessionTimer = null;
        }
        void clearTimeTravelSession();
      }
      if (
        state.household === prev.household &&
        state.assumptions === prev.assumptions &&
        state.memberAssumptions === prev.memberAssumptions &&
        state.preferredMemberId === prev.preferredMemberId &&
        state.targetAllocation === prev.targetAllocation &&
        state.glidePath === prev.glidePath &&
        state.householdAnnualIncomeUSD === prev.householdAnnualIncomeUSD &&
        state.goals === prev.goals &&
        state.budgetItems === prev.budgetItems &&
        state.incomeStreams === prev.incomeStreams &&
        state.scenarios === prev.scenarios &&
        state.driveEncryptionEnabled === prev.driveEncryptionEnabled &&
        state.healthPlans === prev.healthPlans &&
        state.healthImportanceWeights === prev.healthImportanceWeights
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Fire-time gate: if the user entered time-travel during
        // the 250ms debounce window, abort the save.
        // Read FRESH state at fire time so a save scheduled
        // pre-time-travel that hasn't been cancelled yet sees
        // the current (possibly hypothetical) household — and
        // the timeTravelActive gate aborts it before any write.
        const fresh = useAppStore.getState();
        if (fresh.timeTravelActive) return;
        if (fresh.mode !== "real") return;
        void saveRealState({
          household: fresh.household,
          assumptions: fresh.assumptions,
          memberAssumptions: fresh.memberAssumptions,
          preferredMemberId: fresh.preferredMemberId,
          targetAllocation: fresh.targetAllocation,
          glidePath: fresh.glidePath,
          householdAnnualIncomeUSD: fresh.householdAnnualIncomeUSD,
          goals: fresh.goals,
          budgetItems: fresh.budgetItems,
          incomeStreams: fresh.incomeStreams,
          scenarios: fresh.scenarios,
          driveEncryptionEnabled: fresh.driveEncryptionEnabled,
          healthPlans: fresh.healthPlans,
          healthImportanceWeights: fresh.healthImportanceWeights,
        });
      }, 250);
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        void (async () => {
          // Same fire-time pattern — read fresh state.
          const fresh = useAppStore.getState();
          if (fresh.timeTravelActive) return;
          if (fresh.mode !== "real") return;
          const wrote = await maybeRecordSnapshot(
            householdNetWorth(fresh.household),
            fresh.household,
            undefined,
            undefined,
            captureSnapshotAppState(fresh),
          );
          // R1-D7 audit CRITICAL fix: when the auto-snapshotter
          // actually writes a row, bump the sync-revision counter so
          // CloudSyncer's debounced uploader sees the change and
          // pushes to Drive. Without this, automatic snapshots were
          // local-only until some unrelated slice happened to
          // change. Skip on min-interval no-ops so we don't amplify
          // debounce load.
          if (wrote) {
            useAppStore.getState().bumpSnapshotsRevision();
          }
        })();
      }, 1500);
    });
    // Flush the pending session save on tab-hide / pagehide so a
    // user who closes the tab during the 250ms debounce window
    // doesn't lose their last few edits. `visibilitychange` fires
    // reliably on every browser including mobile Safari (where
    // `beforeunload` is unreliable). We fire-and-forget the IDB
    // put — the browser doesn't wait for IDB to flush before
    // closing, but in practice the put completes anyway. Worst
    // case: the user loses the last <250ms of edits, which is no
    // worse than the pre-session-persistence behavior.
    const flushSession = () => {
      if (sessionTimer) {
        clearTimeout(sessionTimer);
        sessionTimer = null;
      }
      const fresh = useAppStore.getState();
      if (!fresh.timeTravelActive) return;
      if (fresh.mode !== "real") return;
      if (!fresh.timeTravelDate) return;
      if (!fresh.baselineHousehold || !fresh.baselineAssumptions) return;
      void saveTimeTravelSession({
        timeTravelDate: fresh.timeTravelDate,
        editingSnapshotT: fresh.editingSnapshotT,
        household: fresh.household,
        assumptions: fresh.assumptions,
        baselineHousehold: fresh.baselineHousehold,
        baselineAssumptions: fresh.baselineAssumptions,
      });
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        flushSession();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", flushSession);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (snapTimer) clearTimeout(snapTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
      unsub();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", flushSession);
      }
    };
  }, []);

  // Take a baseline snapshot once on every load (in real mode), so passive
  // app opens still leave a trail of history behind. Captures the full
  // household composition so reconstruction can use real holdings at
  // each waypoint rather than back-projecting today's shares.
  //
  // TWO policies fire here:
  //   1. The 12h-debounced `maybeRecordSnapshot` — captures
  //      intraday-cadence detail when the user is actively using
  //      the app. Rows are timestamped at full ms precision.
  //   2. The calendar-month `maybeRecordMonthlySnapshot` — anchors
  //      the primary key to the first-of-month at noon UTC so
  //      successive opens within the same month are natural no-ops,
  //      and we accumulate a clean monthly time series even for
  //      passive users who only open the app sporadically. Capped
  //      at 240 rows (20 years monthly) to keep Drive payload size
  //      bounded.
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        const s = useAppStore.getState();
        if (s.mode !== "real") return;
        // Don't auto-snapshot the time-travel hypothetical at
        // today's date — the user is mid-edit on a backdated
        // session and the snapshot they want will be recorded
        // explicitly via the banner's Save button.
        if (s.timeTravelActive) return;
        const nw = householdNetWorth(s.household);
        const appState = captureSnapshotAppState(s);
        const wrote12h = await maybeRecordSnapshot(
          nw,
          s.household,
          undefined,
          undefined,
          appState,
        );
        // Run the monthly anchor alongside. Both helpers are
        // independent (different timestamps, different no-op
        // conditions), so a single load can land either, both, or
        // neither — and we want a single bump if ANY row was
        // written (CloudSyncer doesn't care which kind).
        const wroteMonthly = await maybeRecordMonthlySnapshot(
          nw,
          s.household,
          undefined,
          undefined,
          appState,
        );
        if (wrote12h || wroteMonthly) {
          useAppStore.getState().bumpSnapshotsRevision();
        }
      })();
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
