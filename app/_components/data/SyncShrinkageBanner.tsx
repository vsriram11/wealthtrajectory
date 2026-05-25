"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { pullFromDrive, pushToDrive } from "@/lib/sync/cloudSync";

/**
 * Banner that surfaces when an inbound Drive import was refused
 * because it would wipe a non-empty local collection
 * (`googleSyncBlockedReason === "import-shrinkage"`).
 *
 * Trigger scenario: user edits on Device A, A's queued upload
 * doesn't fire before they switch (force-close / background-
 * throttle / network drop). Device B pulls Drive (stale) and
 * importPayload would clobber local. Without this guard, the
 * data is lost from both sides.
 *
 * Two clear choices:
 *   - "Keep local & push" → upload current local state to Drive,
 *     replacing the stale copy. Recovers Device A's edits onto
 *     Drive so other devices can pull them.
 *   - "Accept Drive (lose local)" → force-import Drive anyway,
 *     acknowledging the local data is intentionally being
 *     overwritten. Requires confirm — destructive.
 *
 * Mounted in app/page.tsx above page content so it's reachable
 * from anywhere, not just the Data page.
 */
export function SyncShrinkageBanner() {
  const blockedReason = useAppStore((s) => s.googleSyncBlockedReason);
  const syncError = useAppStore((s) => s.googleSyncError);
  const [busy, setBusy] = useState<"keep" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (blockedReason !== "import-shrinkage") return null;

  const keepLocal = async () => {
    setError(null);
    setBusy("keep");
    // Yield once so React can paint the "Pushing…" state before we
    // start the heavy crypto + network work. Otherwise the whole
    // chain runs in one event-handler task and INP (Chrome's
    // interaction-to-next-paint metric) registers the full delay
    // as a frozen-UI event on the button — even though the user
    // got immediate visual feedback intent. Real fix for the
    // underlying ~1.5s would be moving PBKDF2 to a Web Worker;
    // this is the cheap shim that buys good INP today.
    await new Promise<void>((r) => setTimeout(r, 0));
    // Clear the import-shrinkage block so pushToDrive's encryption-
    // block check doesn't see a stale reason. The push helper will
    // re-set if it hits a different problem.
    useAppStore
      .getState()
      .setGoogleSyncState({ googleSyncBlockedReason: null });
    const result = await pushToDrive(useAppStore, {
      bypassShrinkageGuard: true,
    });
    setBusy(null);
    if (result !== "ok") {
      setError(`Push failed (${result}). Try again from Data → Sync now.`);
    }
  };

  const acceptDrive = async () => {
    if (
      !confirm(
        "This will overwrite your local data with what's on Drive — anything in your local state that isn't on Drive will be lost. Continue?",
      )
    )
      return;
    setError(null);
    setBusy("accept");
    // Yield once so React can paint the "Pulling…" state before we
    // start the heavy decryption + import work. See `keepLocal`
    // for the same fix — both buttons trigger PBKDF2-heavy paths
    // and need the browser to land a paint between the click and
    // the crypto.
    await new Promise<void>((r) => setTimeout(r, 0));
    // Clear the blocked reason so any racing pullFromDrive call
    // (e.g. tab-resume sync) doesn't immediately re-fire the
    // banner against the user's explicit choice. Note we do NOT
    // clear local collections here — that was the old approach,
    // and it didn't work reliably because the setState mutation
    // triggered CloudSyncer subscribers + reactivity races that
    // left localState.incomeStreams populated by the time
    // pullFromDrive read it. Instead we let pullFromDrive itself
    // skip the shrinkage check via skipShrinkageCheck below;
    // importPayload then overwrites local with Drive's payload,
    // which is the actual semantics of "Accept Drive (lose
    // local)".
    useAppStore.getState().setGoogleSyncState({
      googleSyncBlockedReason: null,
      googleSyncError: null,
    });
    // Force bypasses the queued-upload throttle so a CloudSyncer-
    // scheduled push from prior local edits doesn't block this
    // pull. skipShrinkageCheck lets the inbound guard accept the
    // smaller-than-local Drive payload — the whole point of
    // this code path is that the user opted into that.
    console.info(
      "[SyncShrinkageBanner] acceptDrive → pullFromDrive with skipShrinkageCheck=true (force=true, silent=true)",
    );
    const result = await pullFromDrive(useAppStore, {
      silent: true,
      force: true,
      skipShrinkageCheck: true,
    });
    console.info(
      `[SyncShrinkageBanner] acceptDrive result=${result}`,
    );
    setBusy(null);
    if (result !== "ok" && result !== "no-backup") {
      setError(`Re-pull failed (${result}). Local data has been cleared.`);
    }
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-negative/40 bg-negative/5 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-negative/20 text-negative"
          >
            {/* warning icon */}
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
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-negative">
              Drive is missing data you have locally
            </div>
            <div className="mt-0.5 text-[12px] text-text-muted">
              {syncError ??
                "Drive has fewer items than your local copy. Refused to import to avoid losing data."}
            </div>
            <div className="mt-2 text-[11px] leading-snug text-text-dim">
              Likely cause: another device added items that never finished
              uploading. Pick what to keep —{" "}
              <span className="font-semibold">push local to Drive</span>{" "}
              (recovers your local items everywhere) or{" "}
              <span className="font-semibold">accept Drive</span> (loses
              local items).
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={keepLocal}
                disabled={busy !== null}
                className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
              >
                {busy === "keep" ? "Pushing…" : "Keep local & push to Drive"}
              </button>
              <button
                type="button"
                onClick={acceptDrive}
                disabled={busy !== null}
                className="rounded-md border border-negative/40 bg-bg-elevated px-3 py-1.5 text-[12px] font-medium text-negative disabled:opacity-40 active:opacity-80"
              >
                {busy === "accept" ? "Pulling…" : "Accept Drive (lose local)"}
              </button>
            </div>
            {error && (
              <div className="mt-2 rounded-md border border-negative/40 bg-negative/10 px-2 py-1 text-[11px] text-negative">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
