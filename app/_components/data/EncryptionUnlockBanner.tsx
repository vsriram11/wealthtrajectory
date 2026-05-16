"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { pullFromDrive } from "@/lib/sync/cloudSync";

/**
 * Persistent banner that surfaces when Drive sync is blocked by a
 * missing passphrase (`googleSyncBlockedReason === "encrypted"`).
 *
 * UX:
 *   - Renders on every page (mounted by app/page.tsx, above the
 *     page body) so a force-closed-then-reopened user can't miss
 *     it like they would with the old Data-page-only error.
 *   - Tap "Unlock" opens a modal sheet with a passphrase input.
 *   - On successful unlock, we set the passphrase + immediately
 *     re-pull from Drive. If the re-pull succeeds, the blocked
 *     reason clears and the banner disappears. If the passphrase
 *     was wrong, the banner stays and we show an inline error.
 *
 * Why a separate banner + sheet rather than embedding in the
 * existing GoogleSyncCard / EncryptionCard:
 *   - Those live on the Data page; this needs to be reachable from
 *     anywhere
 *   - The unlock flow is its own narrow task; a focused sheet is
 *     less cluttered than retrofitting the full encryption card
 */
export function EncryptionUnlockBanner() {
  const blockedReason = useAppStore((s) => s.googleSyncBlockedReason);
  const driveEncryptionEnabled = useAppStore((s) => s.driveEncryptionEnabled);
  const passphrase = useAppStore((s) => s.encryptionPassphrase);
  const user = useAppStore((s) => s.user);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Two trigger paths into the banner:
  //   1. A sync attempt already failed with encrypted ciphertext on
  //      Drive → blockedReason === "encrypted".
  //   2. We persisted (last time the user enabled encryption, OR a
  //      prior session detected ciphertext on Drive) that encryption
  //      is in use — surface the unlock CTA *before* a sync even
  //      fails, so the user doesn't see a "first-time setup" UI
  //      when they've been here before.
  const shouldShow =
    !!user &&
    !passphrase &&
    (blockedReason === "encrypted" || driveEncryptionEnabled);

  if (!shouldShow) return null;

  return (
    <>
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-amber-300/50 bg-amber-300/10 p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-300/20 text-amber-300"
            >
              {/* lock icon */}
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
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-200">
                Drive backup locked
              </div>
              <div className="mt-0.5 text-[12px] text-amber-200/80">
                Your backup is encrypted. Enter your passphrase to sync
                across devices.
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="mt-2 rounded-md bg-amber-300/20 px-3 py-1.5 text-[12px] font-semibold text-amber-100 active:opacity-80"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      </section>

      {sheetOpen && (
        <EncryptionUnlockSheet onClose={() => setSheetOpen(false)} />
      )}
    </>
  );
}

function EncryptionUnlockSheet({ onClose }: { onClose: () => void }) {
  const setPassphrase = useAppStore((s) => s.setEncryptionPassphrase);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setError(null);
    if (!draft) {
      setError("Enter your passphrase.");
      return;
    }
    setBusy(true);
    // Load the passphrase, then immediately re-pull from Drive. If
    // the passphrase is wrong, pullFromDrive returns "encrypted"
    // (decrypt threw → blocked reason stays set). We then clear the
    // passphrase so the next attempt isn't stuck with a bad value.
    setPassphrase(draft);
    const result = await pullFromDrive(useAppStore, { silent: true });
    setBusy(false);
    if (result === "encrypted") {
      // Wrong passphrase — clear so the EncryptionCard's "enabled"
      // flag flips back off and the user can try again here.
      setPassphrase(null);
      setError(
        "That passphrase didn't unlock the backup. Check for typos and try again.",
      );
      return;
    }
    if (result === "error") {
      setError(
        "Couldn't reach Drive. Check your connection and try again.",
      );
      return;
    }
    // ok / no-backup / throttled: passphrase accepted (or no backup
    // to test against). Close the sheet — the banner will hide
    // itself when blockedReason clears.
    setDraft("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                Unlock Drive backup
              </div>
              <div className="text-xl font-semibold text-text">
                Enter your passphrase
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="Passphrase"
              autoComplete="current-password"
              autoFocus
              className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
            />
            <label className="flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="accent-accent"
              />
              Show
            </label>
            {error && (
              <div className="rounded-md border border-negative/40 bg-negative/5 px-2 py-1 text-[11px] text-negative">
                {error}
              </div>
            )}
            <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px] leading-snug text-text-dim">
              The passphrase stays in this tab only — we never send or
              store it. If you&apos;ve forgotten it, the encrypted backup
              can&apos;t be recovered; you&apos;d need to disable encryption
              from the Data page and start fresh.
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={busy || draft.length === 0}
              className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
            >
              {busy ? "Unlocking…" : "Unlock & sync"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
