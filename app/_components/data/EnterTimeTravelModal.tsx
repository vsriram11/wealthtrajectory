"use client";

import { useEffect, useRef, useState } from "react";
import { isPastOrToday, parseISODate, todayISODate } from "@/lib/dateInput";
import { useAppStore } from "@/lib/store";

/**
 * Date-picker modal that confirms entry into a time-travel
 * backdating session. Once the user confirms, the store flips to
 * `timeTravelActive=true` and the rest of the app enters the
 * read/edit-without-saving mode.
 *
 * Kept deliberately small — one date input, one Confirm, one
 * Cancel. The full set of caveats (no IDB / no Drive while
 * active) is shown so the user can't be surprised.
 */
export function EnterTimeTravelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const enterTimeTravel = useAppStore((s) => s.enterTimeTravel);
  const [date, setDate] = useState<string>(todayISO());
  const [error, setError] = useState<string | null>(null);
  const firstFocusRef = useRef<HTMLInputElement | null>(null);
  const lastFocusRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Auto-focus the date input when the modal opens AND remember
  // what had focus before so we can restore on close. WCAG 2.4.3
  // + ARIA Authoring Practices dialog pattern.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    if (firstFocusRef.current) firstFocusRef.current.focus();
    return () => {
      // Restore focus to whatever opened the modal — without
      // this, focus drops to <body> on close, which breaks
      // keyboard navigation flow.
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  // (Error message cleared inline by the date-change handler
  // below — see <input onChange>.)

  if (!open) return null;

  // Diagnostic refactor (user reported "click does nothing"):
  // we previously disabled the button via `disabled={!isValidISO}`.
  // If isValidISO returned false for any reason (e.g. an iOS date
  // picker delivering an unexpected string format, a build/cache
  // staleness issue, a regex mismatch), the button was silently
  // disabled and the user saw a no-op. The new flow:
  //   1. Button is ALWAYS clickable.
  //   2. handleConfirm validates inline and surfaces an error
  //      message if the date is malformed or in the future.
  //   3. On success: enterTimeTravel + onClose run normally.
  // This guarantees the user gets visible feedback for EVERY tap.
  const handleConfirm = () => {
    setError(null);
    const t = parseISODate(date);
    if (t === null) {
      setError(
        `Pick a valid date in YYYY-MM-DD format (got "${date}"). Try selecting the date again.`,
      );
      return;
    }
    if (!isPastOrToday(date)) {
      setError(
        `Pick a date that's today or earlier (got "${date}", today is ${todayISO()} UTC).`,
      );
      return;
    }
    try {
      enterTimeTravel(date);
    } catch (e) {
      // Defense-in-depth: if the slice action throws for any
      // reason (e.g. structuredClone failure on a corrupt
      // household shape), surface it instead of silently
      // swallowing.
      setError(
        `Could not enter time-travel mode: ${e instanceof Error ? e.message : String(e)}. Please report this.`,
      );
      return;
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="time-travel-modal-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          return;
        }
        // Focus trap: cycle Tab between firstFocusRef (the date
        // input) and lastFocusRef (the Confirm button). Shift+Tab
        // from first wraps to last; Tab from last wraps to first.
        // Cancel button is between them in natural source order
        // so the cycle goes Date → Cancel → Confirm → Date.
        if (e.key !== "Tab") return;
        const first = firstFocusRef.current;
        const last = lastFocusRef.current;
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-elevated p-4 shadow-2xl">
        <div
          id="time-travel-modal-title"
          className="text-sm font-semibold text-text"
        >
          Backdate snapshot — time-travel mode
        </div>
        <div className="mt-1 text-[11px] leading-snug text-text-muted">
          Pick the historical date you want to record a snapshot
          for. The app will enter a special mode where you can
          freely edit your holdings, accounts, and assumptions to
          match how things looked then.{" "}
          <strong className="text-amber-300">
            Your live data isn&rsquo;t touched while in the mode,
            and Drive sync is paused — session edits live in a
            separate resume record so reload returns you to the
            session.
          </strong>{" "}
          On Save, your edits become the snapshot payload; on Exit,
          everything is restored.
        </div>

        <label className="mt-3 block text-[11px] text-text-muted">
          Date to backdate to
          <input
            ref={firstFocusRef}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (error) setError(null);
            }}
            // Defensive max — block future dates so a user can't
            // accidentally pick tomorrow and stage a snapshot
            // dated in the future.
            max={todayISO()}
            className="mt-1 w-full rounded border border-border-strong bg-bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-[11px] text-negative"
          >
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-strong bg-bg-surface px-3 py-1.5 text-[11px] text-text-muted active:opacity-70"
          >
            Cancel
          </button>
          <button
            ref={lastFocusRef}
            type="button"
            onClick={handleConfirm}
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg active:opacity-80"
          >
            Enter time-travel mode
          </button>
        </div>
      </div>
    </div>
  );
}

// Thin wrapper preserved for naming continuity within this file.
function todayISO(): string {
  return todayISODate();
}
