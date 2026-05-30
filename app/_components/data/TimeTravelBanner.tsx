"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  loadSnapshots,
  recordSnapshot,
  type Snapshot,
} from "@/lib/persistence/persistence";
import { captureSnapshotAppState } from "@/lib/persistence/snapshotAppState";
import { parseISODate } from "@/lib/dateInput";
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
  // When set, the session was entered to EDIT an existing
  // snapshot at this primary key. Skips the collision-prompt
  // dialog on Save (user explicitly chose to overwrite) and
  // adjusts the banner copy from "BACKDATING" → "EDITING
  // SNAPSHOT" so the user knows what they're doing.
  const editingSnapshotT = useAppStore((s) => s.editingSnapshotT);
  const household = useAppStore((s) => s.household);
  const exitTimeTravelDiscard = useAppStore((s) => s.exitTimeTravelDiscard);
  const bumpSnapshotsRevision = useAppStore((s) => s.bumpSnapshotsRevision);
  // Auto-fill status — surfaced inline so the user knows which
  // holdings got historical prices vs which need manual entry.
  // User explicitly asked: "make sure the fallback of manual
  // entry is clear from a UX and engineering standpoint."
  const priceStatus = useAppStore((s) => s.timeTravelPriceStatus);

  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  // Collision confirmation state (audit fix #3): when handleSave
  // detects an existing snapshot at the chosen `t`, surface a
  // "overwrite?" prompt instead of silently `put`-ing. Persistence's
  // `recordSnapshot` uses Dexie `put` which is unconditional, so
  // without this guard a backdated session would silently destroy
  // the existing row (auto-snapshot OR manual) at the same anchor.
  const [pendingOverwrite, setPendingOverwrite] = useState<{
    existingLabel: string | null;
    existingSource: "auto" | "manual" | "legacy";
  } | null>(null);
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

  const handleSave = async (overwrite = false) => {
    // When editing an existing snapshot, use its primary key
    // directly — bypass the parsed-from-string `t` (which would
    // anchor to noon UTC of the snapshot's display date,
    // potentially mismatching the original `t` if the snapshot
    // was originally taken at a non-noon timestamp). Also skip
    // the collision-prompt: the user explicitly chose to
    // overwrite this row.
    const t = editingSnapshotT ?? parseISO(date);
    if (!Number.isFinite(t)) return;
    const isEditingExisting = editingSnapshotT != null;
    setBusy(true);
    try {
      if (!overwrite && !isEditingExisting) {
        const rows = await loadSnapshots();
        const existing = rows.find((r) => r.t === t);
        if (existing) {
          setPendingOverwrite({
            existingLabel: existing.label ?? null,
            existingSource:
              existing.source === "auto"
                ? "auto"
                : existing.source === "manual"
                  ? "manual"
                  : "legacy",
          });
          setBusy(false);
          return;
        }
      }
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
      // Clear any pending overwrite state now that we're committing.
      setPendingOverwrite(null);
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
          {editingSnapshotT != null ? "EDITING SNAPSHOT" : "BACKDATING"} for{" "}
          <span className="num underline decoration-bg/40 underline-offset-2">
            {date}
          </span>{" "}
          — live data is not being saved.
          <PriceStatusLine priceStatus={priceStatus} />
        </div>
        <div className="flex items-center gap-1.5">
          {pendingOverwrite ? (
            // Overwrite confirmation row (audit fix #3). Shown
            // inline next to the regular controls so the user
            // doesn't lose context. Existing-snapshot metadata
            // is surfaced so the user can decide intelligently.
            <>
              <span
                role="status"
                aria-live="assertive"
                className="text-[11px] font-semibold text-bg"
              >
                A {pendingOverwrite.existingSource === "auto"
                  ? "monthly auto"
                  : pendingOverwrite.existingSource === "manual"
                    ? "user"
                    : "legacy"}{" "}
                snapshot already exists for {date}
                {pendingOverwrite.existingLabel
                  ? ` ("${pendingOverwrite.existingLabel}")`
                  : ""}
                . Overwrite?
              </span>
              <button
                type="button"
                onClick={() => void handleSave(true)}
                disabled={busy}
                className="rounded-md bg-negative/20 px-3 py-1 text-[11px] font-semibold text-bg ring-1 ring-negative/60 disabled:opacity-40 active:opacity-80"
                aria-label="Confirm overwrite of the existing snapshot"
              >
                {busy ? "Saving…" : "Overwrite"}
              </button>
              <button
                type="button"
                onClick={() => setPendingOverwrite(null)}
                disabled={busy}
                className="rounded-md border border-bg/40 bg-amber-300/60 px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
                aria-label="Cancel overwrite and keep the existing snapshot"
              >
                Keep existing
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy}
                className="rounded-md bg-bg px-3 py-1 text-[11px] font-semibold text-accent disabled:opacity-40 active:opacity-80"
                aria-label={
                  editingSnapshotT != null
                    ? "Save changes to the existing snapshot and exit time-travel mode"
                    : "Save the current state as a backdated snapshot and exit time-travel mode"
                }
              >
                {busy
                  ? "Saving…"
                  : editingSnapshotT != null
                    ? "Save changes"
                    : "Save snapshot"}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the historical-price auto-fill status. Hidden while
 * the lists are all empty (initial mount; non-tickered household).
 *
 * Three counts:
 *   - applied: holdings auto-filled to their historical price
 *     from the backdate's closing price.
 *   - manual: holdings where historical data is unavailable
 *     (out of window, upstream failure, untickered) — the user
 *     must enter the value manually. Bundled `clamped + failed`
 *     because the UX is the same: edit it yourself.
 *
 * This is the load-bearing UX surface for the "manual entry is
 * the fallback" semantic. Without it, the user would have no
 * idea which holdings need editing — they'd see today's prices
 * everywhere and assume the auto-fill worked silently.
 */
function PriceStatusLine({
  priceStatus,
}: {
  priceStatus: {
    appliedSymbols: string[];
    clampedSymbols: string[];
    failedSymbols: Array<{ symbol: string; reason: string }>;
  };
}) {
  const applied = priceStatus.appliedSymbols.length;
  const clamped = priceStatus.clampedSymbols.length;
  const failed = priceStatus.failedSymbols.length;
  const needsManual = clamped + failed;
  if (applied === 0 && needsManual === 0) return null;

  // Group failed symbols by their reason so duplicates collapse
  // (e.g., "yahoo: 401" applies to all 8 holdings → show once
  // with the symbol list, not 8 repetitions).
  const failuresByReason = new Map<string, string[]>();
  for (const f of priceStatus.failedSymbols) {
    const existing = failuresByReason.get(f.reason) ?? [];
    existing.push(f.symbol);
    failuresByReason.set(f.reason, existing);
  }

  return (
    <div className="mt-1 text-[11px] font-normal text-bg/90">
      {applied > 0 && (
        <div>
          ✓ {applied} ticker{applied === 1 ? "" : "s"} auto-filled
          ({priceStatus.appliedSymbols.slice(0, 5).join(", ")}
          {priceStatus.appliedSymbols.length > 5
            ? `, +${priceStatus.appliedSymbols.length - 5} more`
            : ""}
          ).
        </div>
      )}
      {needsManual > 0 && (
        <div className="font-semibold">
          ✏ Edit {needsManual} holding{needsManual === 1 ? "" : "s"}{" "}
          manually.
        </div>
      )}
      {clamped > 0 && (
        <div className="font-normal">
          • Outside available history window:{" "}
          {priceStatus.clampedSymbols.slice(0, 5).join(", ")}
          {priceStatus.clampedSymbols.length > 5
            ? `, +${priceStatus.clampedSymbols.length - 5} more`
            : ""}
          .
        </div>
      )}
      {failed > 0 && (
        <details className="font-normal">
          <summary className="cursor-pointer">
            • Price lookup failed for {failed} holding
            {failed === 1 ? "" : "s"} — tap to see why
          </summary>
          <div className="mt-1 ml-2 space-y-1">
            {Array.from(failuresByReason.entries()).map(([reason, syms]) => (
              <div
                key={reason}
                className="rounded border border-bg/30 bg-bg/10 px-2 py-1"
              >
                <div className="font-mono text-[10px] break-words">
                  {reason}
                </div>
                <div className="text-[10px] opacity-80">
                  Symbols: {syms.join(", ")}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function parseISO(s: string): number {
  // Delegates to the shared helper. Returns NaN (not null) for
  // back-compat with existing callers that use `Number.isFinite`.
  // Round-trip validation included — protects against silent
  // overwrite on dates like "2024-02-31" (audit BLOCK fix).
  const t = parseISODate(s);
  return t === null ? NaN : t;
}
