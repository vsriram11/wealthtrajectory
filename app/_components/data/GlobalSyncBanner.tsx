"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { pullFromDrive, pushToDrive } from "@/lib/sync/cloudSync";

/**
 * Generic Drive-sync error / stuck-state banner mounted on every
 * page. Catches the cases the dedicated banners (encryption,
 * shrinkage) don't:
 *
 *   - Initial sync hasn't completed: signed in but
 *     `googleLastSyncAt === null`. The user is in the "stuck on
 *     Waiting for initial Drive sync to complete" state.
 *   - A sync error surfaced (popup blocked, network failure, scope
 *     error, etc.) and there's no specific blocked-reason that the
 *     other banners would handle.
 *
 * One Retry button → pull-then-push, the same recovery path the
 * Data → Sync now button uses. Keeps the user from having to dig
 * into the Data tab to resolve a sync failure that's already
 * blocking them from saving.
 */
export function GlobalSyncBanner() {
  const user = useAppStore((s) => s.user);
  const syncing = useAppStore((s) => s.googleSyncing);
  const lastSyncAt = useAppStore((s) => s.googleLastSyncAt);
  const error = useAppStore((s) => s.googleSyncError);
  const blockedReason = useAppStore((s) => s.googleSyncBlockedReason);
  const driveEncryptionEnabled = useAppStore((s) => s.driveEncryptionEnabled);
  const passphrase = useAppStore((s) => s.encryptionPassphrase);
  const hydrated = useAppStore((s) => s.hydrated);

  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!user) return null;
  // The dedicated encrypted / shrinkage banners already own these
  // states with a much richer UI; don't double up.
  if (blockedReason === "encrypted" || blockedReason === "import-shrinkage")
    return null;
  // If encryption is remembered but no passphrase, the
  // EncryptionUnlockBanner owns the recovery flow.
  if (driveEncryptionEnabled && !passphrase) return null;
  // Wait for IDB hydration before deciding "no sync yet" — otherwise
  // we'd flash this banner during the first second of every load.
  if (!hydrated) return null;

  const stuckOnInitial = lastSyncAt == null && !syncing;
  const hasError = !!error;
  if (!stuckOnInitial && !hasError) return null;

  const retry = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      const before = useAppStore.getState();
      if (before.googleLastSyncAt == null) {
        const pullResult = await pullFromDrive(useAppStore, { silent: true });
        if (
          pullResult === "encrypted" ||
          pullResult === "shrinkage-blocked"
        ) {
          // The dedicated banner will take over.
          return;
        }
        if (pullResult === "error") {
          setLocalError("Couldn't reach Drive. Check your connection.");
          return;
        }
      }
      const pushResult = await pushToDrive(useAppStore);
      if (pushResult !== "ok") {
        setLocalError(
          `Couldn't push to Drive (${pushResult}). Open Data → Sync now for details.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const title = stuckOnInitial
    ? "Drive sync hasn't completed yet"
    : "Drive sync error";
  const body =
    stuckOnInitial && !hasError
      ? "Your changes are saved locally but haven't synced to Drive. Tap retry to pull the latest and upload pending edits."
      : (error ??
        "Something went wrong while syncing to Drive.");

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/5 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-300/20 text-amber-300"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <polyline points="21 4 21 10 15 10" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-200">{title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-amber-200/80">
              {body}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={retry}
                disabled={busy}
                className="rounded-md bg-amber-300/20 px-3 py-1.5 text-[12px] font-semibold text-amber-100 disabled:opacity-40 active:opacity-80"
              >
                {busy ? "Retrying…" : "Retry sync"}
              </button>
            </div>
            {localError && (
              <div className="mt-2 rounded-md border border-negative/40 bg-negative/10 px-2 py-1 text-[11px] text-negative">
                {localError}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
