"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { getAccessToken, signOut } from "@/lib/sync/googleAuth";
import {
  downloadBackup,
  findBackupFile,
  loadActiveSession,
  uploadBackup,
} from "@/lib/sync/googleDrive";
import { exportData } from "@/lib/persistence/dataIO";
import { loadSnapshots } from "@/lib/persistence/persistence";
import { isDemoHousehold } from "@/lib/types";
import {
  DriveUnreadableError,
  checkShrinkageAgainstDrive,
} from "@/lib/sync/syncSafety";
import {
  isWithinClaimGrace,
  readLocalSessionId,
  writeLocalSessionId,
} from "@/lib/sync/sessionLocal";

/**
 * Watches household/assumptions/scenarios while connected to Drive and
 * debounce-uploads after 3s of idle.
 *
 * Hard-coded NEVER to upload while mode !== "real". A signed-in user
 * who somehow ends up in demo mode (legacy code paths, a stale tab,
 * a future bug) must not silently overwrite their Drive backup with
 * the synthetic DEMO_HOUSEHOLD — that's an unrecoverable data-loss
 * footgun. The "Use mock data" button is also hidden from the header
 * when signed in (defense in depth), but the gate lives here so
 * neither path can corrupt Drive.
 */
export function CloudSyncer() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe((state, prev) => {
      if (!state.googleConnected) return;
      if (state.mode !== "real") return;
      // Belt-and-suspenders: never upload the demo household, even if
      // some future bug leaves us in real mode with demo data.
      // isDemoHousehold checks for the hardcoded demo IDs that no
      // user-created household can produce.
      if (isDemoHousehold(state.household)) return;
      // Time-travel session gate — same reasoning as the IDB gate
      // in PersistenceHydrator. The in-memory household represents
      // a HYPOTHETICAL past state the user is editing for the
      // purpose of a backdated snapshot. Uploading those edits to
      // Drive would overwrite every other device's view of the
      // user's actual present-day holdings — catastrophic. The
      // gate fires BEFORE the debounce timer starts so a queued
      // upload from before-time-travel doesn't fire mid-session
      // either (the cleanup path below also clears any pending
      // timer when the subscription re-runs).
      if (state.timeTravelActive) {
        // Cancel any in-flight debounce timer on entry. The
        // fire-time gate at line ~110 already catches a fired
        // timer, but cancelling here saves the round-trip and
        // (critically) clears the `googleUploadScheduled` flag
        // that AuthHydrator's tab-resume path watches — without
        // this, a queued-then-entered session leaves the flag
        // stuck true, blocking the resume pull until the
        // session exits.
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        useAppStore
          .getState()
          .setGoogleSyncState({ googleUploadScheduled: false });
        return;
      }
      if (
        state.household === prev.household &&
        state.assumptions === prev.assumptions &&
        state.scenarios === prev.scenarios &&
        state.memberAssumptions === prev.memberAssumptions &&
        state.preferredMemberId === prev.preferredMemberId &&
        state.targetAllocation === prev.targetAllocation &&
        state.glidePath === prev.glidePath &&
        state.householdAnnualIncomeUSD === prev.householdAnnualIncomeUSD &&
        state.goals === prev.goals &&
        state.budgetItems === prev.budgetItems &&
        state.incomeStreams === prev.incomeStreams &&
        state.healthPlans === prev.healthPlans &&
        state.healthImportanceWeights === prev.healthImportanceWeights &&
        // Round-1-D3 audit CRITICAL fix: snapshots live in IDB, but
        // the slice carries a monotonic revision counter that
        // SnapshotsManager bumps after every create / edit / delete.
        // Without this comparison the debounced uploader was blind
        // to snapshot mutations.
        state.snapshotsRevision === prev.snapshotsRevision
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      // Mark the upload as scheduled so pullFromDrive (in
      // AuthHydrator's tab-resume path) refuses to fire while a
      // queued debounced upload is pending. Without this flag, a
      // backgrounded tab whose setTimeout was throttled could be
      // out-raced by the resume sync — pullFromDrive pulls stale
      // Drive state, importPayload overwrites unsynced local
      // edits, then the queued upload finally fires with the
      // overwritten payload (silently corrupting both sides).
      useAppStore
        .getState()
        .setGoogleSyncState({ googleUploadScheduled: true });
      timer = setTimeout(async () => {
        const s = useAppStore.getState();
        if (!s.googleConnected) {
          s.setGoogleSyncState({ googleUploadScheduled: false });
          return;
        }
        if (s.mode !== "real") {
          s.setGoogleSyncState({ googleUploadScheduled: false });
          return;
        }
        // Re-check the time-travel gate at fire time too — a debounce
        // scheduled BEFORE the user entered time travel must not fire
        // mid-session with the hypothetical state. The subscribe
        // handler already clears the prior timer when state changes,
        // but enterTimeTravel itself doesn't change any of the
        // diffed slice references, so the existing timer may survive.
        if (s.timeTravelActive) {
          s.setGoogleSyncState({ googleUploadScheduled: false });
          return;
        }
        // Re-check fingerprint at fire time too — state may have
        // changed in the 3-second debounce window.
        if (isDemoHousehold(s.household)) {
          s.setGoogleSyncState({ googleUploadScheduled: false });
          return;
        }
        // CRITICAL data-integrity gate: refuse to upload until the
        // initial pull from Drive has confirmed what's already there.
        // Without this, a new device with stale or empty IDB will
        // upload its own state before AuthHydrator has had a chance
        // to import the existing Drive backup — overwriting the real
        // data. `googleLastSyncAt` is set by EVERY successful sync
        // path (imported / uploaded-local / uploaded-fresh), so it's
        // a reliable "we know what Drive has" signal.
        if (s.googleLastSyncAt == null) {
          s.setGoogleSyncState({
            googleUploadScheduled: false,
            googleSyncError:
              "Waiting for initial Drive sync to complete before uploading.",
          });
          return;
        }
        // CRITICAL #2: refuse to upload while the encryption block
        // is set — the user's Drive backup is sealed but we don't
        // have a passphrase loaded, so anything we upload would
        // overwrite an unreadable ciphertext with whatever we have
        // locally (loses the user's real data).
        if (s.googleSyncBlockedReason === "encrypted") {
          s.setGoogleSyncState({ googleUploadScheduled: false });
          return;
        }
        // CRITICAL #3: cross-device degradation guard. Even before
        // we've contacted Drive, if THIS device knows encryption was
        // set up (persisted flag) but the passphrase isn't loaded,
        // refuse the upload and surface the unlock banner. Without
        // this, a freshly-signed-in second device with no IDB
        // passphrase would happily push plaintext over the ciphertext
        // backup, silently disabling encryption.
        if (s.driveEncryptionEnabled && !s.encryptionPassphrase) {
          s.setGoogleSyncState({
            googleUploadScheduled: false,
            googleSyncError:
              "Encryption is set up on this account, but the passphrase isn't loaded in this tab. Unlock to sync.",
            googleSyncBlockedReason: "encrypted",
          });
          return;
        }
        s.setGoogleSyncState({ googleSyncing: true, googleSyncError: null });
        try {
          const token = await getAccessToken();
          // Single-active-session guard: refuse to upload if another
          // device has claimed the session marker. Without this, an
          // open tab with stale state would clobber the active
          // device's edits on every keystroke. On mismatch, sign
          // out cleanly with the "other-device" reason so the user
          // sees a banner instead of a confusing silent failure.
          const local = readLocalSessionId();
          // Inside the claim grace window we trust our local sid even
          // if Drive returns something different (eventual-consistency
          // / duplicate-file race). Outside grace, a mismatch genuinely
          // means another device claimed.
          if (local && !isWithinClaimGrace()) {
            const remote = await loadActiveSession(token);
            if (remote && remote.sessionId !== local) {
              s.setLastSignOutReason("other-device");
              writeLocalSessionId(null);
              signOut();
              s.setUser(null);
              s.setGoogleSyncState({
                googleSyncing: false,
                googleUploadScheduled: false,
              });
              return;
            }
          }
          // Pre-upload shrinkage guard: fetch the current Drive
          // backup and refuse to upload if doing so would wipe a
          // non-empty collection (scenarios / goals / budgetItems)
          // down to zero.
          //
          // CRITICAL behavior change: if the shrinkage guard can't
          // read Drive content (encrypted-without-passphrase, parse
          // error), we now REFUSE the upload. The old fail-open
          // behavior silently overwrote encrypted Drive backups with
          // plaintext stale state on devices where the user hadn't
          // yet entered their passphrase — the exact failure mode
          // a user reported (and confirmed with "it said synced but
          // it never asked me for the passphrase"). Fail-closed
          // here means the user might see a stuck-sync error if
          // Drive is genuinely unreadable for non-encryption reasons,
          // but that's recoverable (manual sync after fixing); the
          // data-loss alternative isn't.
          try {
            const existing = await findBackupFile(token);
            if (existing) {
              const driveText = await downloadBackup(token, existing.id);
              // Round-1-D1 audit CRITICAL fix: include local
              // snapshot count in the outbound shrinkage check so
              // the debounced CloudSyncer upload doesn't silently
              // wipe Drive snapshots when local IDB is empty (fresh
              // device that hasn't completed initial sync yet, but
              // CloudSyncer's gate already requires googleLastSyncAt
              // != null — still belt-and-suspenders).
              const localSnapshotsForShrinkage = await loadSnapshots();
              const shrinkage = await checkShrinkageAgainstDrive(
                driveText,
                s.encryptionPassphrase,
                {
                  scenarios: s.scenarios,
                  goals: s.goals,
                  budgetItems: s.budgetItems,
                  incomeStreams: s.incomeStreams,
                  healthPlans: s.healthPlans,
                  healthImportanceWeights: s.healthImportanceWeights,
                  memberAssumptions: s.memberAssumptions,
                  snapshots: localSnapshotsForShrinkage,
                },
              );
              if (shrinkage) {
                s.setGoogleSyncState({
                  googleSyncing: false,
                  googleUploadScheduled: false,
                  googleSyncError: `Refused to upload — would wipe ${shrinkage.shrinking.join(", ")} from Drive (Drive has data, local doesn't). Refresh to re-sync, then try again.`,
                });
                console.warn(
                  "[CloudSyncer] aborted upload to prevent data loss",
                  shrinkage,
                );
                return;
              }
            }
          } catch (guardErr) {
            // Fail-closed. If we can't read Drive to compare, we
            // can't safely upload — uploading anyway risks
            // overwriting good data with stale local state.
            const isEncrypted =
              guardErr instanceof DriveUnreadableError &&
              guardErr.reason === "encrypted";
            console.warn(
              "[CloudSyncer] refusing upload — can't verify Drive content",
              guardErr,
            );
            s.setGoogleSyncState({
              googleSyncing: false,
              googleUploadScheduled: false,
              googleSyncError: isEncrypted
                ? "Your Drive backup is encrypted. Enter your passphrase to sync."
                : `Refused to upload — couldn't verify Drive content: ${
                    guardErr instanceof Error
                      ? guardErr.message
                      : String(guardErr)
                  }`,
              googleSyncBlockedReason: isEncrypted ? "encrypted" : null,
            });
            if (isEncrypted) {
              // Drive has ciphertext we can't decrypt → encryption was
              // set up (possibly on another device). Persist that fact
              // so the next session shows the unlock UI right away.
              useAppStore.setState({ driveEncryptionEnabled: true });
            }
            return;
          }

          // CRITICAL: include snapshots in the Drive payload.
          // Round-2 audit fix — the previous inline exportData
          // call omitted the snapshots field, so every
          // debounced auto-upload (the common path, fires after
          // any state change) overwrote Drive with a snapshot-
          // less backup. A subsequent device wiped/restored
          // from Drive lost ALL snapshot history. pushToDrive
          // (cloudSync.ts:460) does it right; this code path
          // diverged silently.
          const snapshotsForUpload = await loadSnapshots();
          const json = exportData({
            household: s.household,
            assumptions: s.assumptions,
            scenarios: s.scenarios,
            memberAssumptions: s.memberAssumptions,
            preferredMemberId: s.preferredMemberId,
            targetAllocation: s.targetAllocation,
            glidePath: s.glidePath,
            householdAnnualIncomeUSD: s.householdAnnualIncomeUSD,
            goals: s.goals,
            budgetItems: s.budgetItems,
            incomeStreams: s.incomeStreams,
            healthPlans: s.healthPlans,
            healthImportanceWeights: s.healthImportanceWeights,
            snapshots: snapshotsForUpload,
          });
          // When the user has enabled end-to-end encryption (PRD §7.10),
          // wrap the payload in an fp-enc-v1 envelope before upload.
          // Drive then stores ciphertext only — even an account-level
          // compromise of the user's Google account can't read the
          // financial details without the passphrase. The passphrase
          // lives in memory only (Zustand state), never in IDB or
          // Drive itself.
          const payload = s.encryptionPassphrase
            ? await (
                await import("@/lib/sync/crypto")
              ).encryptString(json, s.encryptionPassphrase)
            : json;
          await uploadBackup(token, payload);
          s.setGoogleSyncState({
            googleSyncing: false,
            googleUploadScheduled: false,
            googleLastSyncAt: Date.now(),
          });
        } catch (e) {
          s.setGoogleSyncState({
            googleSyncing: false,
            googleUploadScheduled: false,
            googleSyncError: e instanceof Error ? e.message : String(e),
          });
        }
      }, 3000);
    });
    return () => {
      if (timer) {
        clearTimeout(timer);
        // Clearing the timer also cancels the upload — make sure
        // the flag doesn't leak into the next mount and block
        // pullFromDrive forever.
        useAppStore
          .getState()
          .setGoogleSyncState({ googleUploadScheduled: false });
      }
      unsub();
    };
  }, []);

  return null;
}
