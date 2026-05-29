"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  deleteSnapshot,
  loadSnapshots,
  moveSnapshot,
  recordSnapshot,
  type Snapshot,
} from "@/lib/persistence/persistence";
import { filterHousehold, householdNetWorth } from "@/lib/types";
import { memberFilteredSnapshots } from "@/lib/data/history";
import { formatUSD } from "@/lib/format";

/**
 * History snapshot manager.
 *
 * Lets the user explicitly create, retime, and delete snapshots that
 * anchor the history reconstruction. A snapshot can be:
 *   - A simple net-worth value at a given date (legacy / lightweight)
 *   - A full household composition at that date (so the chart uses
 *     the actual past holdings rather than back-projecting today's
 *     shares)
 *
 * The "save current state for date" flow captures the user's
 * current household composition with a user-chosen timestamp. The
 * common cases this addresses:
 *   - Recording a known historical net worth from a brokerage
 *     statement.
 *   - Backdating a known portfolio composition (e.g. "On 2022-01-01
 *     I held exactly these holdings"). User can mutate their
 *     household to match the past state, save a snapshot for that
 *     date, then restore the present state.
 */
export function SnapshotsManager() {
  const household = useAppStore((s) => s.household);
  const mode = useAppStore((s) => s.mode);
  // Honor the global member filter chip: when the user has
  // scoped the app to a specific member, the snapshot list +
  // displayed NW + summary stats should reflect THAT member's
  // slice — matching what every other card on the page already
  // does via `useActiveProjection`. Without this, a user
  // viewing "Alex" sees household-wide snapshot NW numbers,
  // inconsistent with the rest of the UI. Legacy NW-only
  // snapshots can't be attributed to a single member and drop
  // out of the filtered view (same semantic as HistoryView /
  // GrowthVelocityCard).
  const memberId = useAppStore((s) => s.selectedMemberId);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Add-snapshot form state
  const [draftDate, setDraftDate] = useState<string>(todayISO());
  const [draftLabel, setDraftLabel] = useState<string>("");
  const [includeComposition, setIncludeComposition] = useState(true);

  const refresh = async () => {
    const list = await loadSnapshots();
    setSnapshots(list);
  };

  // Async IndexedDB load on expand. The setSnapshots inside
  // refresh() is reached after an await — it's not synchronous in
  // this effect body — but ESLint can't trace through the async
  // call. The React 19 alternative (Suspense + `use()`) would
  // require returning a Promise from the parent and would
  // restructure the on-demand expand flow. Keep as-is and disable;
  // the load is gated by the `open` flag, so it never cascades
  // unprompted.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Apply the global member filter. `memberFilteredSnapshots`
  // recomputes each rich snapshot's NW from the member-filtered
  // household and drops legacy NW-only entries that can't be
  // attributed. When a member is selected, count the dropped
  // legacy snapshots so the summary text can surface "M legacy
  // hidden" — otherwise the user thinks the records vanished.
  // Memoized to match GrowthVelocityCard / HistoryView patterns
  // (and avoid identity-churning React.memo'd children downstream).
  // Hooks MUST come before any early return — the `if (mode !==
  // "real")` below depends on them not changing call order across
  // renders, so we always compute even when the panel is hidden.
  const filteredSnapshots = useMemo(
    () => memberFilteredSnapshots(snapshots, memberId),
    [snapshots, memberId],
  );
  const droppedLegacyCount =
    memberId == null ? 0 : snapshots.length - filteredSnapshots.length;
  const sorted = useMemo(
    () => [...filteredSnapshots].sort((a, b) => b.t - a.t),
    [filteredSnapshots],
  );
  // The live "Current NW" shown next to the Save button needs to
  // match the user's mental model. When filtered to a member,
  // showing household NW is misleading and contradicts every other
  // figure on the page. The snapshot PAYLOAD is still captured
  // whole (read-side filter handles the display), but what the
  // user SEES while deciding to save must be member-scoped.
  const currentDisplayNW = useMemo(
    () =>
      memberId == null
        ? householdNetWorth(household)
        : householdNetWorth(filterHousehold(household, memberId)),
    [household, memberId],
  );

  if (mode !== "real") return null;

  const handleAdd = async () => {
    const t = parseISO(draftDate);
    if (!Number.isFinite(t)) return;
    setBusy(true);
    try {
      const snap: Snapshot = {
        t,
        netWorthUSD: householdNetWorth(household),
        ...(includeComposition ? { household } : {}),
        ...(draftLabel.trim() ? { label: draftLabel.trim() } : {}),
      };
      await recordSnapshot(snap);
      await refresh();
      setDraftLabel("");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (t: number) => {
    setBusy(true);
    try {
      await deleteSnapshot(t);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRetime = async (oldT: number, newISO: string) => {
    const newT = parseISO(newISO);
    if (!Number.isFinite(newT) || newT === oldT) return;
    setBusy(true);
    try {
      await moveSnapshot(oldT, newT);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // Five-branch summary text — split out so the truth table is
  // explicit and the nested ternary doesn't grow another branch
  // when a future filter dimension is added.
  const summaryText = summarize(
    filteredSnapshots,
    memberId,
    droppedLegacyCount,
  );

  return (
    <div className="mt-4 rounded-xl border border-border bg-bg-elevated">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        aria-label="Toggle snapshots panel"
      >
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Snapshots
          </div>
          {/* Summary lives OUTSIDE the button's accessible name (via
              aria-label above) and is announced separately as a
              status region so screen-reader users hear filter
              changes without re-reading the toggle. */}
          <div
            className="mt-0.5 text-[10px] text-text-dim"
            role="status"
            aria-live="polite"
          >
            {summaryText}
          </div>
        </div>
        <span
          className={`text-text-dim transition ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          {/* Plain-language reassurance so users don't worry that
              capturing a snapshot will alter their live state. */}
          <div className="mb-3 rounded-md border border-positive/30 bg-positive/5 px-3 py-2 text-[11px] text-text-muted">
            <span className="font-medium text-positive">
              Snapshots are read-only history records.
            </span>{" "}
            Creating one captures your current net worth (and
            optionally holdings) at a chosen date. It does <em>not</em>{" "}
            change anything in your live accounts. Delete a snapshot
            anytime to remove that anchor from the chart.
          </div>

          <div className="space-y-2 rounded-lg border border-border-strong bg-bg-surface p-3">
            <div className="text-[11px] font-medium text-text">
              Capture snapshot from current state
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-text-muted">
                Date
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="rounded border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-1 items-center gap-1 text-[11px] text-text-muted">
                Label
                <input
                  type="text"
                  placeholder="optional"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  className="flex-1 rounded border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-accent"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={includeComposition}
                onChange={(e) => setIncludeComposition(e.target.checked)}
                className="accent-accent"
              />
              Include full holdings composition (lets the chart use
              actual past holdings, not just net worth)
            </label>
            {/* Collision indicator: snapshot's primary key is t
                (midnight UTC of the chosen date), so saving a second
                snapshot for the same date silently overwrites the
                first. Flagging it upfront lets the user decide
                before they lose their prior record. When filtered,
                show the MEMBER-scoped NW from the colliding snapshot
                so it matches every other figure the user is seeing. */}
            {(() => {
              const draftT = parseISO(draftDate);
              const collision = Number.isFinite(draftT)
                ? snapshots.find((s) => s.t === draftT)
                : null;
              if (!collision) return null;
              const displayNW =
                memberId != null && collision.household
                  ? householdNetWorth(
                      filterHousehold(collision.household, memberId),
                    )
                  : collision.netWorthUSD;
              return (
                <div className="rounded-md border border-amber-300/40 bg-amber-300/5 px-2 py-1.5 text-[10px] text-amber-300">
                  A snapshot already exists for this date (NW{" "}
                  {formatUSD(displayNW)}). Saving will replace it.
                </div>
              );
            })()}
            {memberId != null && (
              <div
                className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[10px] text-text-dim"
                role="status"
              >
                Snapshots are inherently household-wide records — the
                payload captures every member, and the figures shown
                above are filtered to the selected member only.
                Delete / retime applies to the entire snapshot.
              </div>
            )}
            <div className="flex items-center justify-between gap-3 text-[11px] text-text-dim">
              <span>
                Current NW:{" "}
                <span className="num text-text">
                  {formatUSD(currentDisplayNW)}
                </span>
              </span>
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy}
                className="rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
              >
                {busy ? "Saving…" : "Save snapshot"}
              </button>
            </div>
          </div>

          {/* Advanced flow: backdating a snapshot to a date when the
              portfolio looked different. Surfaced as collapsible
              guidance so the simple "save current state" case isn't
              cluttered with the destructive-edit warning. */}
          <details className="mt-3 rounded-lg border border-border bg-bg-surface px-3 py-2 text-[11px] text-text-muted">
            <summary className="cursor-pointer text-text-muted">
              Want to record a past state with different holdings?
            </summary>
            <div className="mt-2 space-y-1.5 text-text-dim">
              <p>
                The capture above always records your{" "}
                <em>current</em> holdings — only the date and label
                are configurable. To anchor a past date with a
                different composition (e.g. &ldquo;In 2022 I held only
                VTI&rdquo;), the safest workflow is:
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  <span className="text-text-muted">Back up first.</span>{" "}
                  On the{" "}
                  <span className="rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                    Data
                  </span>{" "}
                  page, hit <span className="text-text-muted">Export</span>
                  {" "}— that&apos;s your safety net if anything goes
                  sideways. If you&apos;re signed in, Drive sync is
                  already covering you too.
                </li>
                <li>
                  Edit holdings to match the past composition.
                </li>
                <li>
                  Come back here, set the date, and{" "}
                  <span className="text-text-muted">Save snapshot</span>.
                </li>
                <li>
                  Edit holdings back to the present. (Or restore from
                  your export.)
                </li>
              </ol>
            </div>
          </details>

          {sorted.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {sorted.map((s) => (
                <li
                  key={s.t}
                  className="rounded-md border border-border bg-bg-surface px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          defaultValue={toISO(s.t)}
                          onBlur={(e) =>
                            void handleRetime(s.t, e.target.value)
                          }
                          className="rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[11px] text-text outline-none focus:border-accent"
                          title="Edit the date this snapshot represents"
                        />
                        {s.household ? (
                          <span
                            className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent"
                            title="Includes holdings composition"
                          >
                            full
                          </span>
                        ) : (
                          <span
                            className="rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-text-dim"
                            title="Net-worth-only snapshot"
                          >
                            nw only
                          </span>
                        )}
                        {s.label && (
                          <span className="truncate text-[10px] text-text-muted">
                            {s.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 num text-[11px] text-text-muted">
                        {formatUSD(s.netWorthUSD)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.t)}
                      disabled={busy}
                      className="rounded border border-negative/40 bg-bg-surface px-2 py-1 text-[10px] font-medium text-negative disabled:opacity-40 active:opacity-70"
                      aria-label="Delete snapshot"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function todayISO(): string {
  return toISO(Date.now());
}

function toISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function parseISO(s: string): number {
  // Anchor to noon UTC so timezone wobble doesn't push the snapshot
  // into the wrong calendar day.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  return new Date(`${s}T12:00:00Z`).getTime();
}

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString();
}

/**
 * Summary line for the snapshot-panel header. Five mutually-
 * exclusive branches keyed on (filtered list empty?, member chip
 * active?, legacy snapshots dropped from the view?). Exported so
 * the test can pin the full truth table — small enough to keep
 * verifiable, big enough that a nested ternary is hostile to read.
 */
export function summarize(
  filteredSnapshots: Snapshot[],
  memberId: string | null,
  droppedLegacyCount: number,
): string {
  if (filteredSnapshots.length === 0) {
    if (memberId == null) {
      return "None yet — capture one to anchor your history";
    }
    if (droppedLegacyCount > 0) {
      return `No member-attributable snapshots (${droppedLegacyCount} legacy NW-only hidden — filterable only at household view)`;
    }
    return "No snapshots for this member";
  }
  const oldestText = formatDate(
    Math.min(...filteredSnapshots.map((s) => s.t)),
  );
  if (memberId == null) {
    return `${filteredSnapshots.length} recorded · oldest ${oldestText}`;
  }
  if (droppedLegacyCount > 0) {
    return `${filteredSnapshots.length} recorded · oldest ${oldestText} (filtered to selected member, ${droppedLegacyCount} legacy NW-only hidden)`;
  }
  return `${filteredSnapshots.length} recorded · oldest ${oldestText} (filtered to selected member)`;
}
