"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { pushToDrive } from "@/lib/sync/cloudSync";

/**
 * Layer 2 confirmation modal for the post-Frame-B sign-in flow.
 *
 * Opens when AuthHydrator finds NO Drive backup for the just-signed-
 * in account AND the user's local household is NOT the strict demo
 * seed — i.e. there's user data that COULD be pushed to Drive but
 * we want explicit consent before we do it.
 *
 * Why the consent matters: `findBackupFile` returning null is
 * USUALLY "this account is fresh, no prior backup," but on rare
 * Drive-index races it can mean "the file is there, we just can't
 * see it yet." Auto-pushing on that race would PATCH (overwrite)
 * the real backup with the user's current state — catastrophic if
 * the user is signing in on a new device to RESTORE a prior backup.
 *
 * Two paths out:
 *   - Confirm: call pushToDrive (Drive backup gets created).
 *   - Skip: defer the initial sync. We mark googleLastSyncAt so
 *     CloudSyncer's initial-sync gate releases (future debounce-
 *     pushes will run), but no upload happens NOW. The user can
 *     resync via the Data tab later.
 */
export function InitialSyncConfirmModal() {
  const pending = useAppStore((s) => s.pendingInitialSyncConfirm);
  const setGoogleSyncState = useAppStore((s) => s.setGoogleSyncState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!pending) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    confirmButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [pending]);

  if (!pending) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // Keep `pendingInitialSyncConfirm: true` THROUGHOUT the push.
      // The pre-fix code cleared it BEFORE awaiting pushToDrive, which
      // meant a failed push would unmount the modal mid-handler (the
      // `if (!pending) return null` guard at the top of render)  —
      // the user would see the buttons vanish without an actionable
      // error. The audit fix: only clear on success, so a failure
      // leaves the modal open with the inline error visible and the
      // Push button re-enabled for retry.
      //
      // Busy is the re-entry guard during the await; double-clicking
      // Push can't queue a second concurrent pushToDrive call because
      // both buttons disable on `disabled={busy}`.
      const result = await pushToDrive(useAppStore, {
        bypassInitialSyncGate: true,
      });
      if (result !== "ok") {
        // pushToDrive already wrote a user-visible error to
        // googleSyncError. Surface a brief in-modal hint too so the
        // user knows the action they triggered didn't land — and
        // because we kept the modal open, the user can read it AND
        // retry from the same surface (or Skip to defer).
        setError(
          "Push failed — see the sync status banner for details.",
        );
        return;
      }
      setGoogleSyncState({
        pendingInitialSyncConfirm: false,
        googleSyncError: null,
        googleSyncBlockedReason: null,
        lastSyncOutcome: "uploaded-local",
      });
    } catch (e) {
      setError(
        `Could not push to Drive: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    // "Skip" doesn't sign the user out — they stay connected and
    // can manually sync via the Data tab. We set googleLastSyncAt
    // so CloudSyncer's initial-sync gate releases (otherwise the
    // user's next edit would queue a debounce-push that gets
    // blocked-by-initial-sync forever).
    setGoogleSyncState({
      pendingInitialSyncConfirm: false,
      googleLastSyncAt: Date.now(),
      googleSyncError: null,
      googleSyncBlockedReason: null,
      lastSyncOutcome: null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="initial-sync-modal-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          handleSkip();
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-elevated p-5 shadow-xl">
        <h2
          id="initial-sync-modal-title"
          className="text-sm font-semibold text-text"
        >
          Push current data to Drive?
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
          We didn&rsquo;t find an existing backup in your Google
          Drive. If you&rsquo;re signing in to restore data from
          another device, choose <strong>Skip for now</strong> —
          you can resync from the Data tab once your other device
          uploads. If you&rsquo;re setting up a new backup,
          choose <strong>Push</strong>.
        </p>
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-negative/40 bg-negative/10 px-2.5 py-1.5 text-[11px] text-negative"
          >
            {error}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="rounded-md border border-border-strong bg-bg-surface px-3 py-1.5 text-[12px] text-text-muted disabled:opacity-40 active:opacity-70 hover:text-text"
            aria-label="Skip the initial Drive sync — defer the decision"
          >
            Skip for now
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
            aria-label="Push current local data to Drive as the initial backup"
          >
            {busy ? "Pushing…" : "Push to Drive"}
          </button>
        </div>
      </div>
    </div>
  );
}
