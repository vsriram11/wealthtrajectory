"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import {
  loadRealState,
  maybeRecordSnapshot,
  saveRealState,
} from "@/lib/persistence/persistence";
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
          const wrote = await maybeRecordSnapshot(
            householdNetWorth(state.household),
            state.household,
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
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        const s = useAppStore.getState();
        if (s.mode !== "real") return;
        const wrote = await maybeRecordSnapshot(
          householdNetWorth(s.household),
          s.household,
        );
        // R1-D7 audit CRITICAL fix: bump revision when the baseline
        // open-the-app-and-leave snapshot actually lands, so the
        // signed-in user's quarterly-check-in pattern reliably reaches
        // Drive. Skip on min-interval guard (no-op IDB).
        if (wrote) {
          useAppStore.getState().bumpSnapshotsRevision();
        }
      })();
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
