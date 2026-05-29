/**
 * Reusable Drive-pull helper. Wraps the "find backup → decrypt →
 * importPayload" flow so any caller (AuthHydrator's mount + resume
 * paths, the EncryptionUnlockBanner's post-unlock retry, the Data
 * page's Sync now button) goes through the same code path.
 *
 * Returns one of:
 *   - "ok"               : pulled + imported successfully
 *   - "no-backup"        : signed-in user has no backup yet
 *   - "encrypted"        : ciphertext exists but no passphrase is
 *                          loaded — caller should prompt the user
 *   - "error"            : transient (network / decode) failure;
 *                          message is in store.googleSyncError
 *   - "throttled"        : skipped because a sync ran very recently
 *                          (caller passed throttle=true)
 *
 * Also writes the appropriate store updates: googleSyncing,
 * googleSyncError, googleLastSyncAt, and the structured
 * googleSyncBlockedReason ("encrypted" / null) so the unlock
 * banner can react.
 */

import type { useAppStore } from "@/lib/store";
import { getAccessToken } from "@/lib/sync/googleAuth";
import {
  downloadBackup,
  findBackupFile,
  uploadBackup,
} from "@/lib/sync/googleDrive";
import {
  applyImportedPayload,
  exportData,
  parseImport,
} from "@/lib/persistence/dataIO";
import {
  DriveUnreadableError,
  checkShrinkageAgainstDrive,
} from "@/lib/sync/syncSafety";
import { loadSnapshots } from "@/lib/persistence/persistence";

export type PullResult =
  | "ok"
  | "no-backup"
  | "encrypted"
  | "shrinkage-blocked"
  | "error"
  | "throttled";

export type PushResult =
  | "ok"
  | "blocked-by-encryption"
  | "blocked-by-shrinkage"
  | "blocked-by-initial-sync"
  | "error";

const DEFAULT_THROTTLE_MS = 60 * 1000;

/**
 * Inbound shrinkage guard: refuse to import a Drive payload that
 * would wipe a non-empty local collection down to empty. Symmetric
 * to CloudSyncer's outbound guard — both directions now reject
 * "this would lose data" transitions.
 *
 * The trigger scenario: user edits on Device A, Device A's queued
 * upload doesn't fire before they switch (browser killed the tab,
 * background-throttled timer, network down). Device B pulls Drive
 * (still stale), imports, and overwrites Device A's IDB on next
 * sync. Without this guard, the data is lost from both sides.
 *
 * With the guard:
 *   - We refuse the import
 *   - googleSyncBlockedReason = "import-shrinkage"
 *   - Banner gives the user the choice: keep local (manual upload
 *     pushes local to Drive, replacing the stale Drive copy) or
 *     accept Drive (acknowledged data loss, manual override).
 */
// Re-export from syncSafety.ts so the recovery banner has a
// stable import path. The canonical definition lives in
// syncSafety.ts because that's the lower-level module that owns
// the outbound-shrinkage guard; this file owns the inbound
// (download) guard and inherits the same collection list.
export {
  SHRINKAGE_GUARDED_ARRAY_COLLECTIONS,
  SHRINKAGE_GUARDED_MAP_COLLECTIONS,
} from "@/lib/sync/syncSafety";
import {
  SHRINKAGE_GUARDED_ARRAY_COLLECTIONS,
  SHRINKAGE_GUARDED_MAP_COLLECTIONS,
} from "@/lib/sync/syncSafety";
type ShrinkageGuardedArrayCollection =
  (typeof SHRINKAGE_GUARDED_ARRAY_COLLECTIONS)[number];
type ShrinkageGuardedMapCollection =
  (typeof SHRINKAGE_GUARDED_MAP_COLLECTIONS)[number];

function isInboundShrinkage(
  drivePayload: Partial<
    Record<ShrinkageGuardedArrayCollection, unknown[]>
  > &
    Partial<Record<ShrinkageGuardedMapCollection, Record<string, unknown>>>,
  localState: Record<ShrinkageGuardedArrayCollection, unknown[]> &
    Record<ShrinkageGuardedMapCollection, Record<string, unknown>>,
): { shrinking: string[] } | null {
  const shrinking: string[] = [];
  for (const k of SHRINKAGE_GUARDED_ARRAY_COLLECTIONS) {
    const driveArr = drivePayload[k];
    const driveLen = Array.isArray(driveArr) ? driveArr.length : 0;
    const localLen = localState[k].length;
    if (localLen > 0 && driveLen === 0) shrinking.push(k);
  }
  for (const k of SHRINKAGE_GUARDED_MAP_COLLECTIONS) {
    const driveMap = drivePayload[k];
    const driveCount =
      driveMap && typeof driveMap === "object" && !Array.isArray(driveMap)
        ? Object.keys(driveMap).length
        : 0;
    const localCount = Object.keys(localState[k]).length;
    if (localCount > 0 && driveCount === 0) shrinking.push(k);
  }
  return shrinking.length > 0 ? { shrinking } : null;
}

/**
 * Pull the Drive backup and import it. Use `silent: true` for
 * background re-pulls (skips the welcome-banner lastSyncOutcome
 * update). Use `throttle: true` to no-op when a recent sync
 * already ran — handy for tab-resume re-syncs.
 *
 * Threading `store` rather than calling `useAppStore.getState()`
 * inline keeps this testable later if we want to mock the store.
 * Today both paths use the singleton.
 */
export async function pullFromDrive(
  store: typeof useAppStore,
  options: {
    silent?: boolean;
    throttle?: boolean;
    throttleMs?: number;
    /**
     * Bypass the `googleSyncing` / `googleUploadScheduled` /
     * throttle-window early-returns. ONLY for explicit user-
     * consent flows like the shrinkage-recovery banner's
     * "Accept Drive (lose local)" button, where the user has
     * already chosen to overwrite local data and any concurrent
     * upload would be racing the user's intent anyway. Other
     * callers (AuthHydrator's tab-resume sync, EncryptionCard
     * unlock) should leave this false so they cooperate with
     * CloudSyncer's debounce.
     */
    force?: boolean;
    /**
     * Skip the inbound shrinkage guard (the check that refuses
     * to import a Drive payload whose collections are smaller
     * than local). Used by SyncShrinkageBanner's "Accept Drive
     * (lose local)" — the user has explicitly opted to accept
     * the smaller Drive payload AND lose any local-only items,
     * so the guard's protection isn't wanted anymore.
     *
     * Critical: without this, no amount of pre-clearing local
     * collections from the caller side reliably bypasses the
     * guard, because the consent flow involves enough state
     * mutations (clearing collections triggers CloudSyncer
     * subscribers, etc.) that a race can repopulate or hold a
     * reference to the populated state by the time pullFromDrive
     * reads it. The semantically-correct fix is to let the
     * caller declare intent directly.
     */
    skipShrinkageCheck?: boolean;
  } = {},
): Promise<PullResult> {
  const silent = options.silent ?? false;
  const throttle = options.throttle ?? false;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const force = options.force ?? false;
  const skipShrinkageCheck = options.skipShrinkageCheck ?? false;

  const s = store.getState();
  if (!s.user) return "no-backup";
  if (!force) {
    if (s.googleSyncing) return "throttled";
    // Refuse to pull while a CloudSyncer upload is queued or
    // executing. Otherwise a backgrounded tab whose setTimeout was
    // throttled could be raced by the resume sync — the pull would
    // overwrite local edits with stale Drive state, then the
    // queued upload would push the overwritten payload out.
    if (s.googleUploadScheduled) return "throttled";
    if (throttle) {
      const last = s.googleLastSyncAt ?? 0;
      if (Date.now() - last < throttleMs) return "throttled";
    }
  }

  s.setGoogleSyncState({ googleSyncing: true, googleSyncError: null });
  try {
    const token = await getAccessToken();
    const existing = await findBackupFile(token);
    if (!existing) {
      s.setGoogleSyncState({
        googleSyncing: false,
        googleSyncBlockedReason: null,
      });
      return "no-backup";
    }
    const text = await downloadBackup(token, existing.id);
    // Any time Drive returns ciphertext, this device should remember
    // that encryption is in use — even if decrypt succeeds here.
    // Without this, a device that *successfully* decrypts wouldn't
    // flip the persisted flag, and a later session on the same
    // device (passphrase wiped) would show the first-time setup UI.
    const { looksEncrypted, unwrapBackup } = await import("@/lib/sync/crypto");
    if (looksEncrypted(text) && !store.getState().driveEncryptionEnabled) {
      store.setState({ driveEncryptionEnabled: true });
    }
    let plain: string;
    try {
      plain = await unwrapBackup(text, store.getState().encryptionPassphrase);
    } catch (err) {
      const needsPassphrase =
        err instanceof Error && err.name === "EncryptedRequiresPassphrase";
      s.setGoogleSyncState({
        googleSyncing: false,
        googleSyncError: needsPassphrase
          ? "Your Drive backup is encrypted. Enter your passphrase to sync."
          : err instanceof Error
            ? err.message
            : String(err),
        googleSyncBlockedReason: needsPassphrase ? "encrypted" : null,
      });
      if (needsPassphrase) {
        // Drive payload is ciphertext but we have no passphrase. Persist
        // the "encryption is set up" flag so subsequent sessions / tabs
        // can prompt for the passphrase before they even attempt a
        // sync — without this, a fresh tab forgets entirely until it
        // fails a sync.
        store.setState({ driveEncryptionEnabled: true });
      }
      return needsPassphrase ? "encrypted" : "error";
    }
    const parsed = parseImport(plain);
    // Inbound shrinkage guard. If accepting this Drive payload
    // would wipe a non-empty local collection (the most common
    // class of inadvertent data loss when an upload didn't make
    // it from another device), refuse the import and surface a
    // recovery banner asking the user to choose.
    //
    // Caller can opt out via skipShrinkageCheck — used by the
    // recovery banner's "Accept Drive (lose local)" path where
    // the user has explicitly consented to the data loss.
    if (!skipShrinkageCheck) {
      const localNow = store.getState();
      // Round-1-D1 audit CRITICAL fix: snapshot count comes from
      // IDB (not the store). MUST be loaded BEFORE the shrinkage
      // check, otherwise a Drive payload with snapshots: [] would
      // pass the guard and silently wipe N local snapshots via
      // replaceAllSnapshots downstream.
      const localSnapshotsForShrinkage = await loadSnapshots();
      const shrinkage = isInboundShrinkage(parsed, {
        healthImportanceWeights: localNow.healthImportanceWeights,
        memberAssumptions: localNow.memberAssumptions,
        scenarios: localNow.scenarios,
        goals: localNow.goals,
        budgetItems: localNow.budgetItems,
        incomeStreams: localNow.incomeStreams,
        healthPlans: localNow.healthPlans,
        snapshots: localSnapshotsForShrinkage,
      });
      if (shrinkage) {
        s.setGoogleSyncState({
          googleSyncing: false,
          googleSyncError: `Drive is missing ${shrinkage.shrinking.join(", ")} that you have locally — refused to import. Open the recovery banner to keep local or accept Drive.`,
          googleSyncBlockedReason: "import-shrinkage",
        });
        console.warn(
          "[pullFromDrive] aborted import to prevent data loss",
          shrinkage,
        );
        return "shrinkage-blocked";
      }
    }
    // Round-1 audit CRITICAL fix: apply via the bundled helper so
    // store-backed slices AND IDB-backed snapshots both move atomically
    // (caller can't forget the snapshot mirror).
    await applyImportedPayload(parsed, s.importPayload);
    s.setGoogleSyncState({
      googleSyncing: false,
      googleLastSyncAt: Date.now(),
      googleSyncError: null,
      googleSyncBlockedReason: null,
      ...(silent ? {} : { lastSyncOutcome: "imported" }),
    });
    return "ok";
  } catch (e) {
    s.setGoogleSyncState({
      googleSyncing: false,
      googleSyncError: e instanceof Error ? e.message : String(e),
    });
    return "error";
  }
}

/**
 * Reusable Drive-push helper. Every upload path in the app —
 * `CloudSyncer`'s debounced timer, `GoogleSyncCard`'s "Sync now"
 * button, `AuthHydrator`'s "uploaded-local" branch on sign-in —
 * MUST go through this function. Direct calls to `uploadBackup`
 * bypass the safety checks and have shipped data-loss bugs.
 *
 * Pre-flight guards (in order):
 *   1. Signed in. Else "error".
 *   2. mode === "real". Else "error" (never upload demo data).
 *   3. Not isDemoHousehold (paranoia). Else "error".
 *   4. Encryption block clear. Else "blocked-by-encryption".
 *   5. Initial Drive pull confirmed (googleLastSyncAt is set),
 *      UNLESS `bypassInitialSyncGate` is true (used by the
 *      "uploaded-fresh" branch of AuthHydrator, which is creating
 *      the first backup for a brand-new user). Else
 *      "blocked-by-initial-sync".
 *   6. Shrinkage guard: download current Drive content, refuse
 *      upload if doing so would wipe a non-empty collection
 *      (scenarios / goals / budgetItems) down to empty. THROWS
 *      `DriveUnreadableError` propagate to fail-closed
 *      ("blocked-by-encryption" if the Drive is encrypted without
 *      passphrase). UNLESS `bypassShrinkageGuard` is true, used by
 *      the explicit user-override action in `SyncShrinkageBanner`.
 *
 * On success, sets googleLastSyncAt and clears errors. On any
 * blocked / error result, writes a descriptive googleSyncError
 * and (for encryption) sets googleSyncBlockedReason so the
 * banner can react.
 */
export async function pushToDrive(
  store: typeof useAppStore,
  options: {
    bypassInitialSyncGate?: boolean;
    bypassShrinkageGuard?: boolean;
  } = {},
): Promise<PushResult> {
  const { bypassInitialSyncGate = false, bypassShrinkageGuard = false } =
    options;
  const s = store.getState();
  if (!s.user) return "error";
  if (s.mode !== "real") return "error";
  const { isDemoHousehold } = await import("@/lib/types");
  if (isDemoHousehold(s.household)) return "error";

  if (s.googleSyncBlockedReason === "encrypted") {
    s.setGoogleSyncState({
      googleSyncing: false,
      googleSyncError:
        "Your Drive backup is encrypted. Enter your passphrase before syncing.",
    });
    return "blocked-by-encryption";
  }

  // Cross-device safety: if THIS device previously knew encryption was
  // set up (persisted flag) but the in-memory passphrase isn't loaded,
  // refuse the push. Without this guard, a freshly-signed-in second
  // device that hasn't yet seen the encryption setup would happily
  // upload plaintext on top of the encrypted Drive backup — silently
  // degrading the user's encryption. Surfacing it as "encrypted"
  // routes to the unlock banner.
  if (s.driveEncryptionEnabled && !s.encryptionPassphrase) {
    s.setGoogleSyncState({
      googleSyncing: false,
      googleSyncError:
        "Encryption is set up on this account, but the passphrase isn't loaded in this tab. Unlock to sync.",
      googleSyncBlockedReason: "encrypted",
    });
    return "blocked-by-encryption";
  }

  if (!bypassInitialSyncGate && s.googleLastSyncAt == null) {
    s.setGoogleSyncState({
      googleSyncing: false,
      googleSyncError:
        "Waiting for the initial Drive sync to complete — try again in a moment.",
    });
    return "blocked-by-initial-sync";
  }

  s.setGoogleSyncState({ googleSyncing: true, googleSyncError: null });
  try {
    const token = await getAccessToken();

    if (!bypassShrinkageGuard) {
      try {
        const existing = await findBackupFile(token);
        if (existing) {
          const driveText = await downloadBackup(token, existing.id);
          // Round-1-D1 audit CRITICAL fix: snapshots are now in
          // SHRINKAGE_GUARDED_ARRAY_COLLECTIONS, so the outbound
          // guard MUST see the local snapshot count too — otherwise
          // a device with zero local snapshots would silently wipe
          // N snapshots on Drive when this user pushes.
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
              googleSyncError: `Refused to upload — would wipe ${shrinkage.shrinking.join(", ")} from Drive (Drive has data, local doesn't).`,
              googleSyncBlockedReason: "import-shrinkage",
            });
            console.warn(
              "[pushToDrive] aborted upload to prevent data loss",
              shrinkage,
            );
            return "blocked-by-shrinkage";
          }
        }
      } catch (guardErr) {
        // Fail-closed: if we can't read Drive (encrypted /
        // malformed / network), refuse the upload rather than risk
        // overwriting unverifiable content. The encrypted case
        // sets the banner-driving blocked reason.
        const isEncrypted =
          guardErr instanceof DriveUnreadableError &&
          guardErr.reason === "encrypted";
        s.setGoogleSyncState({
          googleSyncing: false,
          googleSyncError: isEncrypted
            ? "Your Drive backup is encrypted. Enter your passphrase before syncing."
            : `Refused to upload — couldn't verify Drive content: ${
                guardErr instanceof Error
                  ? guardErr.message
                  : String(guardErr)
              }`,
          googleSyncBlockedReason: isEncrypted ? "encrypted" : null,
        });
        return isEncrypted ? "blocked-by-encryption" : "error";
      }
    }

    // Round-1 audit CRITICAL fix: snapshots live in IDB (not in the
    // Zustand state slice), so we must pull them out at push time so
    // the Drive backup is the source-of-truth for the user's full
    // state. Without this, a user who wiped local data / changed
    // devices lost ALL their snapshot history.
    const snapshots = await loadSnapshots();
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
      snapshots,
    });
    const payload = s.encryptionPassphrase
      ? await (
          await import("@/lib/sync/crypto")
        ).encryptString(json, s.encryptionPassphrase)
      : json;
    await uploadBackup(token, payload);
    s.setGoogleSyncState({
      googleSyncing: false,
      googleLastSyncAt: Date.now(),
      googleSyncError: null,
    });
    return "ok";
  } catch (e) {
    s.setGoogleSyncState({
      googleSyncing: false,
      googleSyncError: e instanceof Error ? e.message : String(e),
    });
    return "error";
  }
}
