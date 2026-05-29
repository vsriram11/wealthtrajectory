"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  recordSnapshot,
  type Snapshot,
} from "@/lib/persistence/persistence";
import { captureSnapshotAppState } from "@/lib/persistence/snapshotAppState";
import { householdNetWorth } from "@/lib/types";

/**
 * Sticky top banner that floats above the app shell while the
 * user is in a time-travel backdating session. Provides:
 *   - "Save snapshot": records a snapshot at the chosen date
 *     using the CURRENT (edited) household, then exits the
 *     session and restores the baseline.
 *   - "Exit": discards all edits, restores the baseline.
 *
 * Persistence-gating lives in PersistenceHydrator + CloudSyncer
 * (they early-return when `timeTravelActive` is set), so the
 * banner doesn't need to reach into either path. It just calls
 * recordSnapshot (which writes directly to the IDB snapshots
 * table — not the live-state save path) and exitTimeTravelDiscard.
 *
 * Rendered at root in app/page.tsx so it overlays every page.
 * Returns null when inactive — no DOM cost in the common case.
 */
export function TimeTravelBanner() {
  const active = useAppStore((s) => s.timeTravelActive);
  const date = useAppStore((s) => s.timeTravelDate);
  const household = useAppStore((s) => s.household);
  const exitTimeTravelDiscard = useAppStore((s) => s.exitTimeTravelDiscard);
  const bumpSnapshotsRevision = useAppStore((s) => s.bumpSnapshotsRevision);

  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Auto-dismiss the success flash after ~2.5s so the banner
  // returns to its idle hidden state. Mount lifecycle is owned
  // by app/page.tsx (which always renders <TimeTravelBanner />);
  // we just toggle savedFlash to control visibility.
  useEffect(() => {
    if (!savedFlash) return;
    const id = window.setTimeout(() => setSavedFlash(false), 2500);
    return () => window.clearTimeout(id);
  }, [savedFlash]);

  // Warn on tab close / nav-away while in an active session —
  // mid-session edits live only in memory, so a refresh or
  // accidental link-click silently nukes the session with no
  // recovery. The browser's generic "unsaved changes" prompt
  // is the best we can do (custom messages are blocked by
  // every modern browser); the warning STILL appears as a
  // dialog, which is the actual UX win.
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the returnValue string but
      // need it set non-empty to actually show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  // Two render branches:
  //   1. savedFlash takes precedence over the inactive early-return
  //      so the post-save success message actually renders. (Before
  //      this ordering: handleSave called setSavedFlash(true) THEN
  //      exitTimeTravelDiscard synchronously, so React's batched
  //      next render saw active=false; the early-return at the top
  //      ran first and the flash was never visible.)
  //   2. After flash dismisses (or normal idle), the inactive
  //      early-return takes over.
  if (savedFlash) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-50 border-b border-positive/40 bg-positive/15 px-4 py-2 text-center text-[12px] font-semibold text-positive"
      >
        Snapshot saved. Restoring live state…
      </div>
    );
  }

  if (!active || !date) return null;

  const handleSave = async () => {
    const t = parseISO(date);
    if (!Number.isFinite(t)) return;
    setBusy(true);
    try {
      // Defensive deep clone — the household reference is shared
      // with the live store; structuredClone guarantees the
      // snapshot payload is decoupled from whatever happens to
      // store state immediately after. Same applies to appState:
      // captureSnapshotAppState clones every field internally.
      const householdClone = structuredClone(household);
      const appState = captureSnapshotAppState(useAppStore.getState());
      const snap: Snapshot = {
        t,
        netWorthUSD: householdNetWorth(householdClone),
        household: householdClone,
        appState,
        // Manual provenance — protects this snapshot from being
        // auto-pruned by the monthly cap. Time-travel snapshots
        // are deliberate user actions and should be as durable
        // as the labeled checkpoint-style snapshots from
        // SnapshotsManager.
        source: "manual",
      };
      await recordSnapshot(snap);
      // Bump the snapshot revision so CloudSyncer sees the
      // change (snapshots live in IDB, slice diff is blind to
      // them). Same pattern SnapshotsManager uses.
      bumpSnapshotsRevision();
      // Show success flash (renders even after exit because the
      // flash branch precedes the inactive early-return).
      setSavedFlash(true);
      // Restore the baseline. This flips timeTravelActive=false.
      exitTimeTravelDiscard();
    } finally {
      // Guard against setState after unmount. The component
      // itself doesn't unmount (always rendered by app/page.tsx)
      // but a future refactor could move it; guard anyway.
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleExit = () => {
    if (busy) return;
    exitTimeTravelDiscard();
  };

  // Contrast note (audit UI#8 follow-up): `text-bg = #0a0d12`
  // (near-black) on `bg-amber-300/95 = #fcd34d` (bright amber)
  // produces a contrast ratio of ~13.7:1 — clears WCAG AAA
  // (7:1) comfortably. The app is dark-mode-only (no light
  // theme defined in tailwind.config.ts), so there's no
  // alternate theme where this would regress.
  return (
    <div
      role="region"
      aria-label="Time-travel backdating session active"
      className="sticky top-0 z-50 border-b border-amber-300/60 bg-amber-300/95 px-4 py-2 text-bg shadow-md"
    >
      <div className="mx-auto flex max-w-md flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-[12px] font-semibold leading-snug">
          <span aria-hidden>⚠ </span>
          BACKDATING for{" "}
          <span className="num underline decoration-bg/40 underline-offset-2">
            {date}
          </span>{" "}
          — live data is not being saved.
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="rounded-md bg-bg px-3 py-1 text-[11px] font-semibold text-accent disabled:opacity-40 active:opacity-80"
            aria-label="Save the current state as a backdated snapshot and exit time-travel mode"
          >
            {busy ? "Saving…" : "Save snapshot"}
          </button>
          <button
            type="button"
            onClick={handleExit}
            disabled={busy}
            className="rounded-md border border-bg/40 bg-amber-300/60 px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
            aria-label="Discard all time-travel edits and exit"
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}

function parseISO(s: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  // Anchor to noon UTC — same convention SnapshotsManager uses so
  // collision detection by `t` is consistent across entry paths.
  return new Date(`${s}T12:00:00Z`).getTime();
}
