"use client";

import { useEffect, useRef, useState } from "react";
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
  const firstFocusRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the date input when the modal opens — same pattern
  // as the inline edit form in SnapshotsManager.
  useEffect(() => {
    if (open && firstFocusRef.current) {
      firstFocusRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => {
    if (!isValidISO(date)) return;
    enterTimeTravel(date);
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
            While in the mode, none of your edits are saved to disk
            or synced to Drive.
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
            onChange={(e) => setDate(e.target.value)}
            // Defensive max — block future dates so a user can't
            // accidentally pick tomorrow and stage a snapshot
            // dated in the future.
            max={todayISO()}
            className="mt-1 w-full rounded border border-border-strong bg-bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border-strong bg-bg-surface px-3 py-1.5 text-[11px] text-text-muted active:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValidISO(date)}
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
          >
            Enter time-travel mode
          </button>
        </div>
      </div>
    </div>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
