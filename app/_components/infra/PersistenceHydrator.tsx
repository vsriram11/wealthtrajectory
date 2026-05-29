"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import {
  loadRealState,
  maybeRecordMonthlySnapshot,
  maybeRecordSnapshot,
  saveRealState,
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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.mode !== "real") return;
      // Time-travel session gate — when active, the household /
      // assumptions in memory represent a HYPOTHETICAL past state
      // the user is editing for the purpose of taking a backdated
      // snapshot. Persisting them to IDB would clobber the live
      // present-day state on next load (and the auto-snapshot
      // path would record a duplicate at today's date with the
      // edited values). Both writes must be muted until the user
      // exits the session (which restores the baseline).
      if (state.timeTravelActive) return;
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
        // the 250ms debounce window, abort the save. The handler's
        // entry-time gate already covers the common path; this is
        // defense in depth for the queued-then-entered race.
        if (useAppStore.getState().timeTravelActive) return;
        void saveRealState({
          household: state.household,
          assumptions: state.assumptions,
          memberAssumptions: state.memberAssumptions,
          preferredMemberId: state.preferredMemberId,
          targetAllocation: state.targetAllocation,
          glidePath: state.glidePath,
          householdAnnualIncomeUSD: state.householdAnnualIncomeUSD,
          goals: state.goals,
          budgetItems: state.budgetItems,
          incomeStreams: state.incomeStreams,
          scenarios: state.scenarios,
          driveEncryptionEnabled: state.driveEncryptionEnabled,
          healthPlans: state.healthPlans,
          healthImportanceWeights: state.healthImportanceWeights,
        });
      }, 250);
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        void (async () => {
          // Same fire-time gate for the auto-snapshot path.
          if (useAppStore.getState().timeTravelActive) return;
          const fresh = useAppStore.getState();
          const wrote = await maybeRecordSnapshot(
            householdNetWorth(state.household),
            state.household,
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
    return () => {
      if (timer) clearTimeout(timer);
      if (snapTimer) clearTimeout(snapTimer);
      unsub();
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
