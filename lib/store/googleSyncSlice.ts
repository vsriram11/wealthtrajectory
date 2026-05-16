/**
 * Google Drive sync flags + telemetry.
 *
 * All of these are scratch state for the sync layer (CloudSyncer,
 * AuthHydrator, GoogleSyncCard) — never serialized to Drive. The
 * fields exist so the UI can show "Syncing…", "Last synced 3m ago",
 * "Sync blocked — enter your passphrase", etc.
 *
 * `setGoogleSyncState` accepts a partial patch so callers can
 * write multiple sync flags atomically (CloudSyncer flips
 * googleSyncing + googleLastSyncAt + googleSyncError in one
 * batch on every cycle).
 */

export type SyncBlockedReason = "encrypted" | "import-shrinkage" | null;

export type SyncOutcome =
  | "imported"
  | "uploaded-local"
  | "uploaded-fresh"
  | null;

export type GoogleSyncSliceState = {
  /** True while a sync round-trip is in flight. */
  googleSyncing: boolean;
  /** Last sync error message, surfaced verbatim. */
  googleSyncError: string | null;
  /** Wall-clock ms of the last successful sync. */
  googleLastSyncAt: number | null;
  /**
   * Structured "sync is blocked" signal. More reliable than
   * string-matching `googleSyncError` because messages drift.
   */
  googleSyncBlockedReason: SyncBlockedReason;
  /**
   * True between the moment CloudSyncer schedules a debounced
   * upload and the moment it actually completes. Closes a race
   * where a backgrounded tab's setTimeout was throttled, the
   * user returned, pullFromDrive fired (no in-flight
   * `googleSyncing`), pulled stale Drive state, and overwrote
   * local edits.
   */
  googleUploadScheduled: boolean;
  /** Result of the most recent post-sign-in cloud-sync. */
  lastSyncOutcome: SyncOutcome;
};

export type GoogleSyncSliceActions = {
  setGoogleSyncState: (patch: Partial<GoogleSyncSliceState>) => void;
  dismissSyncOutcome: () => void;
};

export const GOOGLE_SYNC_SLICE_INITIAL: GoogleSyncSliceState = {
  googleSyncing: false,
  googleSyncError: null,
  googleLastSyncAt: null,
  googleSyncBlockedReason: null,
  googleUploadScheduled: false,
  lastSyncOutcome: null,
};

export function createGoogleSyncSliceActions(
  set: (patch: Partial<GoogleSyncSliceState>) => void,
): GoogleSyncSliceActions {
  return {
    setGoogleSyncState: (patch) => set(patch),
    dismissSyncOutcome: () => set({ lastSyncOutcome: null }),
  };
}
