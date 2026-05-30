"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  deleteSnapshot,
  loadSnapshots,
  moveSnapshot,
  recordSnapshot,
  type Snapshot,
} from "@/lib/persistence/persistence";
import { captureSnapshotAppState } from "@/lib/persistence/snapshotAppState";
import {
  filterHousehold,
  householdForRollups,
  householdNetWorth,
} from "@/lib/types";
import { parseISODate } from "@/lib/dateInput";
import { memberFilteredSnapshots } from "@/lib/data/history";
import { formatUSD } from "@/lib/format";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { EnterTimeTravelModal } from "./EnterTimeTravelModal";

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
  // Snapshot edit-in-time-travel wiring. Action loads the
  // snapshot's household into the live store + sets
  // editingSnapshotT so the banner's Save flow overwrites the
  // row directly (no collision dialog). User-reported gap.
  const enterTimeTravelEditingSnapshot = useAppStore(
    (s) => s.enterTimeTravelEditingSnapshot,
  );
  const timeTravelActive = useAppStore((s) => s.timeTravelActive);
  // R1-D3 audit CRITICAL fix: snapshots live in IDB, so CloudSyncer's
  // slice-reference diff is structurally blind to snapshot
  // mutations. Bump this counter after every successful write so
  // the debounced uploader sees a change and schedules a Drive
  // push. Without this, snapshots stay local-only until some
  // unrelated slice happens to change.
  const bumpSnapshotsRevision = useAppStore(
    (s) => s.bumpSnapshotsRevision,
  );
  // Round-6 audit HIGH fix: surface the active-scenario mismatch.
  // The NetWorthCard (and every other projection-driven display)
  // reads through `useActiveProjection`, which applies the active
  // scenario's household + assumptions overrides. SnapshotsManager
  // intentionally captures the BASE (un-scenarioed) household —
  // because a snapshot is a historical record, not a hypothetical.
  // But that means when a scenario is active, the "Current NW" the
  // user sees here (and saves) will differ from the headline figure
  // on the dashboard. We need to make that mismatch visible.
  const { scenarioName, household: scenarioHousehold } = useActiveProjection();
  const scenarioAdjustedNW = useMemo(
    () => householdNetWorth(scenarioHousehold),
    [scenarioHousehold],
  );
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
  // Add-snapshot form state.
  const [draftDate, setDraftDate] = useState<string>(todayISO());
  const [draftLabel, setDraftLabel] = useState<string>("");
  // Collision detection — used by both the inline amber warning
  // AND the Save-vs-Replace button label so the action is honestly
  // named at the click site. (`snapshots` is fetched async; on
  // first render it's [] so no false-positive collision.)
  const draftT = useMemo(() => parseISO(draftDate), [draftDate]);
  const collidingSnapshot = useMemo(
    () =>
      Number.isFinite(draftT)
        ? (snapshots.find((s) => s.t === draftT) ?? null)
        : null,
    [snapshots, draftT],
  );
  // Time-travel session — a separate, full-app edit mode for
  // backdating snapshots. The button in this panel opens a date
  // picker; on confirm the store flips to `timeTravelActive=true`
  // and the TimeTravelBanner takes over. While the mode is
  // active, persistence + Drive sync are gated off so the user
  // can freely edit their holdings as if at the chosen past date,
  // then Save (writes a backdated snapshot) or Exit (restores the
  // baseline). Modal open state lives here so the trigger button
  // and the modal share an immediate scope.
  const [timeTravelModalOpen, setTimeTravelModalOpen] = useState(false);
  // Per-row edit state (Audit R1 HIGH #5 + #6). When non-null,
  // the row whose `t` matches is in edit mode; the draft fields
  // are scoped to that row's edits. Explicit Save/Cancel
  // replaces the unsafe onBlur-driven retime (which fired on
  // accidental focus loss, silently mutating data).
  const [editingT, setEditingT] = useState<number | null>(null);
  const [editDate, setEditDate] = useState<string>("");
  const [editNW, setEditNW] = useState<string>("");
  const [editLabel, setEditLabel] = useState<string>("");
  // Round-5 audit HIGH: track validation error inline so screen
  // readers (via aria-describedby) hear it and sighted users
  // see why Save didn't fire on an invalid NW input.
  const [editNWError, setEditNWError] = useState<string>("");
  // Two-stage delete confirm — Round-5 audit CRITICAL: replaces
  // delete-on-first-click with "click → confirm within 4s window"
  // so a misclick on the Delete button doesn't permanently
  // destroy a historical snapshot. `pendingDelete` is the `t` of
  // the row armed for confirm; auto-clears on timer or any
  // unrelated action.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  // Live-region status text (Round-5 audit HIGH). Polite SR
  // announcements after async save / delete success.
  const [statusMessage, setStatusMessage] = useState<string>("");
  // Focus management — Round-5 audit HIGH. Stash the row's Edit
  // button so we can restore focus on Cancel (don't drop focus to
  // <body>). The first edit-mode input gets focused on entry.
  const editButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const firstEditInputRef = useRef<HTMLInputElement | null>(null);

  // When entering edit mode, focus the first input. Keeps
  // keyboard / SR users oriented at the form they just opened.
  useEffect(() => {
    if (editingT != null && firstEditInputRef.current) {
      firstEditInputRef.current.focus();
    }
  }, [editingT]);

  // Auto-clear pendingDelete after 4s so it can't sit armed forever.
  useEffect(() => {
    if (pendingDelete == null) return;
    const id = window.setTimeout(() => setPendingDelete(null), 4000);
    return () => window.clearTimeout(id);
  }, [pendingDelete]);

  // Auto-clear status messages after they've been announced so
  // they don't accumulate visually.
  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(""), 3000);
    return () => window.clearTimeout(id);
  }, [statusMessage]);
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
  // match the user's mental model AND the figure every other card
  // on the page shows. Two layers:
  //   - When filtered to a member, scope to that member's slice.
  //   - When NOT filtered, scope to ROLLUP-included members only
  //     (matching the canonical householdForRollups pattern; other
  //     cards route through useActiveProjection which already
  //     applies this). A user who excluded a member would otherwise
  //     see Current NW here disagree with every other display.
  //
  // The snapshot PAYLOAD captures the FULL household (rollup flag
  // is a current view-level concept; snapshots preserve the
  // historical record). The display is just an honest pre-save
  // preview.
  const currentDisplayNW = useMemo(
    () =>
      memberId == null
        ? householdNetWorth(householdForRollups(household))
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
        // Round-1/2 audit fix: use the SAME NW the user saw in the
        // preview (which honors member filter + rollup-cascade).
        // Previously this read raw `householdNetWorth(household)`
        // → preview showed Alex's slice, saved value was the full
        // household.
        netWorthUSD: currentDisplayNW,
        // Round-1 audit fix: defensive clone so in-place store
        // mutations after save don't retroactively alter the
        // in-memory snapshot (until next refresh). Dexie serializes
        // on `put` so persisted data was safe, but the React state
        // here shares the reference until reload.
        // The `includeComposition` toggle gates BOTH the household
        // and the appState (target alloc, assumptions, goals, budget,
        // etc.). Either you opt into a rich snapshot that captures
        // the full state-of-the-world as of `t`, or you opt out for
        // a lightweight NW-only record. Splitting them would
        // produce a half-state that's hard to reason about.
        ...(includeComposition
          ? {
              household: structuredClone(household),
              appState: captureSnapshotAppState(useAppStore.getState()),
            }
          : {}),
        ...(draftLabel.trim() ? { label: draftLabel.trim() } : {}),
        // Manual provenance — protects this snapshot from being
        // auto-pruned. SnapshotsManager allows unlabeled saves
        // (draftLabel is optional), and the previous prune logic
        // (label == null → safe to delete) silently destroyed
        // unlabeled user saves on 240+ month horizons.
        source: "manual",
      };
      await recordSnapshot(snap);
      bumpSnapshotsRevision();
      await refresh();
      setDraftLabel("");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Round-5 audit CRITICAL: two-stage delete confirm. First click
   * arms the row (button label flips to "Confirm"); second
   * click within 4 seconds actually deletes. Auto-disarms on
   * timeout. Prevents permanent data loss from a misclick on the
   * wrong row (Edit + Delete are visually adjacent).
   */
  const handleDeleteClick = (t: number) => {
    if (pendingDelete !== t) {
      setPendingDelete(t);
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        await deleteSnapshot(t);
        bumpSnapshotsRevision();
        await refresh();
        setStatusMessage("Snapshot deleted.");
        setPendingDelete(null);
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Open the edit form for a snapshot row. Pre-fills with current
   * values. Round-1 audit HIGH #5: previously the date was the
   * ONLY editable field (via onBlur — unsafe), and NW + label
   * were read-only. Users who mistyped had to delete + recreate.
   */
  const handleStartEdit = (s: Snapshot) => {
    setEditingT(s.t);
    setEditDate(toISO(s.t));
    setEditNW(String(s.netWorthUSD));
    setEditLabel(s.label ?? "");
    setEditNWError("");
    setPendingDelete(null);
  };

  const handleCancelEdit = () => {
    const t = editingT;
    setEditingT(null);
    setEditDate("");
    setEditNW("");
    setEditLabel("");
    setEditNWError("");
    // Round-5 audit HIGH (focus management): restore focus to the
    // Edit button that opened this form. Without this, focus drops
    // to <body> on Cancel, disorienting keyboard / SR users.
    if (t != null) {
      const btn = editButtonRefs.current.get(t);
      if (btn) requestAnimationFrame(() => btn.focus());
    }
  };

  /**
   * Persist edits. Composes: (a) if date changed → `moveSnapshot`
   * to update the primary key, (b) write the snapshot with the new
   * NW + label fields via `recordSnapshot` (which `put`s at the
   * final `t`, replacing the previous row).
   */
  const handleSaveEdit = async (originalT: number) => {
    if (editingT !== originalT) return;
    const newT = parseISO(editDate);
    if (!Number.isFinite(newT)) {
      setEditNWError("Date must be a valid YYYY-MM-DD.");
      return;
    }
    // Round-5 audit HIGH: surface the validation error to the user
    // via aria-describedby + visible error text. Previously
    // silently returned on invalid input.
    const trimmed = editNW.trim();
    if (trimmed === "") {
      setEditNWError("Net worth is required.");
      return;
    }
    const newNW = Number(trimmed);
    if (!Number.isFinite(newNW)) {
      setEditNWError("Net worth must be a number.");
      return;
    }
    setEditNWError("");
    setBusy(true);
    // R1-D6 audit HIGH fix: if `moveSnapshot` succeeds (deletes the
    // old row, writes the new one) but then `recordSnapshot` throws,
    // OR if moveSnapshot itself fails mid delete-then-put, IDB has
    // ALREADY mutated and Drive needs to know. Track in a flag so
    // the `finally` block can bump unconditionally on any path that
    // may have touched IDB. The bump is monotonic, so an over-bump
    // is harmless (CloudSyncer just runs once extra), but a
    // missed-bump silently strands the edit local-only forever.
    let idbMayHaveMutated = false;
    try {
      // Find the original snapshot to preserve household + other
      // fields that aren't user-editable here.
      const original = snapshots.find((s) => s.t === originalT);
      if (!original) return;
      // If the date changed, move the row first so we don't end up
      // with two rows (one old, one new) at different t values.
      if (newT !== originalT) {
        await moveSnapshot(originalT, newT);
        idbMayHaveMutated = true;
      }
      // Now `put` at the final t with updated scalar fields.
      // structuredClone the household for the same defensive-clone
      // reason as handleAdd.
      const updated: Snapshot = {
        ...original,
        t: newT,
        netWorthUSD: newNW,
        ...(editLabel.trim() ? { label: editLabel.trim() } : {}),
        ...(original.household
          ? { household: structuredClone(original.household) }
          : {}),
        // Preserve appState across the edit with the same
        // defensive-clone treatment as household. The user is
        // editing NW/date/label, not the captured state-of-the-world.
        ...(original.appState
          ? { appState: structuredClone(original.appState) }
          : {}),
        // Editing through SnapshotsManager is a manual action —
        // upgrade source to "manual" even if the original was
        // an auto-snapshot the user adopted. Without this,
        // editing an auto-row would leave source="auto" and
        // the row could later be pruned despite user intent.
        source: "manual",
      };
      // If editLabel was cleared but original had a label, drop the
      // field (since the spread above only includes it conditionally).
      if (!editLabel.trim() && "label" in updated) {
        delete (updated as { label?: string }).label;
      }
      await recordSnapshot(updated);
      idbMayHaveMutated = true;
      await refresh();
      setStatusMessage("Snapshot updated.");
      handleCancelEdit();
    } finally {
      if (idbMayHaveMutated) bumpSnapshotsRevision();
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
      {/* WCAG 4.1.2: the toggle button can't NEST another interactive
          or status region. Round-12 audit. The summary status region
          lives as a SIBLING below the button instead. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        aria-label="Toggle snapshots panel"
      >
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Snapshots
        </div>
        <span
          className={`text-text-dim transition ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      <div
        className="px-3 pb-2 -mt-1 text-[10px] text-text-dim"
        role="status"
        aria-live="polite"
      >
        {summaryText}
      </div>

      {open && (
        <div className="border-t border-border px-3 py-3">
          {/* Round-5 audit HIGH: polite live region announces async
              save / delete success to screen readers. Visually
              hidden when empty; styled like a small chip when
              present. */}
          <div
            role="status"
            aria-live="polite"
            className={
              statusMessage
                ? "mb-2 rounded-md border border-positive/30 bg-positive/10 px-2 py-1 text-[11px] text-positive"
                : "sr-only"
            }
          >
            {statusMessage}
          </div>
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
            {collidingSnapshot &&
              (() => {
                const displayNW =
                  memberId != null && collidingSnapshot.household
                    ? householdNetWorth(
                        filterHousehold(
                          collidingSnapshot.household,
                          memberId,
                        ),
                      )
                    : collidingSnapshot.netWorthUSD;
                return (
                  <div
                    className="rounded-md border border-amber-300/40 bg-amber-300/5 px-2 py-1.5 text-[10px] text-amber-300"
                    role="status"
                  >
                    A snapshot already exists for this date (NW{" "}
                    {formatUSD(displayNW)}). The Save button below has
                    re-labeled to <strong>Replace</strong> — clicking
                    it will overwrite the existing record.
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
            {/* Round-6 audit HIGH fix: if a scenario is active AND it
                meaningfully changes NW, the user's dashboard shows the
                scenario figure while we save the base figure. Surface
                the mismatch so the user doesn't silently snapshot a
                value that disagrees with what they're looking at. */}
            {scenarioName != null &&
              Math.abs(scenarioAdjustedNW - currentDisplayNW) >= 1 && (
                <div
                  className="rounded-md border border-amber-300/40 bg-amber-300/5 px-2 py-1.5 text-[10px] text-amber-300"
                  role="status"
                >
                  Active scenario <em>{scenarioName}</em> is excluded
                  from snapshots. Snapshots record your{" "}
                  <em>actual</em> household state ({formatUSD(currentDisplayNW)}),
                  not the scenario projection (
                  {formatUSD(scenarioAdjustedNW)} shown elsewhere on
                  the page). Switch back to the base scenario if you
                  want the dashboard figure and the saved value to
                  match.
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
                aria-label={
                  collidingSnapshot
                    ? "Replace existing snapshot at this date"
                    : "Save new snapshot"
                }
                className={`rounded-md px-3 py-1 text-[11px] font-semibold disabled:opacity-40 active:opacity-80 ${
                  collidingSnapshot
                    ? "bg-amber-300 text-bg"
                    : "bg-accent text-bg"
                }`}
              >
                {busy
                  ? collidingSnapshot
                    ? "Replacing…"
                    : "Saving…"
                  : collidingSnapshot
                    ? "Replace snapshot"
                    : "Save snapshot"}
              </button>
            </div>
          </div>

          {/* Time-travel session entry. Clicking this opens a
              date-picker modal; on confirm the app enters
              backdating mode (a sticky banner at the top of the
              window, plus persistence + Drive sync muted for the
              duration). The user navigates to Holdings / Accounts
              and edits values to match the chosen past date, then
              hits Save in the banner to record the backdated
              snapshot — or Exit to discard everything. The full
              app-wide edit mode replaced the older inline scale /
              drop "Stage past holdings" panel: users needed the
              richness of the real Holdings UI, not a parallel
              mini-editor. */}
          <button
            type="button"
            onClick={() => setTimeTravelModalOpen(true)}
            className="mt-3 w-full rounded-lg border border-dashed border-border bg-bg-surface px-3 py-2 text-left text-[11px] text-text-muted hover:border-accent hover:text-accent"
            aria-label="Open the date-picker modal to enter time-travel backdating mode"
          >
            <span className="font-medium text-text">
              Backdate snapshot (time-travel mode)…
            </span>{" "}
            Enter a special mode where you can edit your holdings,
            accounts, and assumptions as if at a past date. Save to
            record a backdated snapshot; Exit to restore. None of
            your edits in the session are persisted to IndexedDB or
            Drive — your live data is safe.
          </button>
          <EnterTimeTravelModal
            open={timeTravelModalOpen}
            onClose={() => setTimeTravelModalOpen(false)}
          />

          {sorted.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {sorted.map((s) => {
                const isEditing = editingT === s.t;
                return (
                  <li
                    key={s.t}
                    className="rounded-md border border-border bg-bg-surface px-3 py-2"
                  >
                    {isEditing ? (
                      // EDIT MODE — Round-5 audit HIGHs: <form>
                      // wrapper enables Enter-to-save; Escape
                      // handler enables Esc-to-cancel; aria-busy
                      // signals async work; first input auto-
                      // focuses via ref + useEffect on editingT.
                      <form
                        aria-busy={busy}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleSaveEdit(s.t);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            handleCancelEdit();
                          }
                        }}
                        className="space-y-2"
                      >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="block text-[10px] text-text-muted">
                            Date
                            <input
                              ref={firstEditInputRef}
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="mt-0.5 w-full rounded border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
                            />
                          </label>
                          <label className="block text-[10px] text-text-muted">
                            Net worth (USD)
                            <input
                              type="number"
                              inputMode="decimal"
                              value={editNW}
                              onChange={(e) => {
                                setEditNW(e.target.value);
                                if (editNWError) setEditNWError("");
                              }}
                              aria-invalid={editNWError ? true : undefined}
                              aria-describedby={
                                editNWError ? `nw-err-${s.t}` : undefined
                              }
                              className={`num mt-0.5 w-full rounded border bg-bg-elevated px-2 py-1 text-[11px] text-text outline-none focus:border-accent ${
                                editNWError
                                  ? "border-red-400/60"
                                  : "border-border-strong"
                              }`}
                            />
                          </label>
                          <label className="block text-[10px] text-text-muted">
                            Label
                            <input
                              type="text"
                              placeholder="optional"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className="mt-0.5 w-full rounded border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-text outline-none placeholder:text-text-dim focus:border-accent"
                            />
                          </label>
                        </div>
                        {editNWError && (
                          <div
                            id={`nw-err-${s.t}`}
                            role="alert"
                            className="text-[10px] text-red-300"
                          >
                            {editNWError}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={busy}
                            className="rounded border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] text-text-muted disabled:opacity-40 active:opacity-70"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={busy}
                            className="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-bg disabled:opacity-40 active:opacity-80"
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      // READ MODE — Edit + Delete buttons.
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-text">
                              {formatDate(s.t)}
                            </span>
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
                        {/* Compact action row: icon-only for the
                            time-travel-edit affordance (would
                            otherwise wrap to two lines on mobile
                            and overlap the FULL badge per the
                            user-reported screenshot), short
                            labels for Edit / Del. Tight gap +
                            reduced horizontal padding to keep
                            everything on one line at iPhone-mini
                            widths. aria-labels carry the full
                            semantic for screen readers. */}
                        <div className="flex items-center gap-1">
                          {s.household && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!s.household) return;
                                enterTimeTravelEditingSnapshot({
                                  t: s.t,
                                  household: s.household,
                                  assumptions:
                                    s.appState?.assumptions ?? null,
                                  date: formatISODate(s.t),
                                });
                              }}
                              disabled={busy || timeTravelActive}
                              className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1.5 text-[14px] leading-none text-amber-300 disabled:opacity-40 active:opacity-70"
                              aria-label={`Re-enter time-travel mode to edit the holdings on the snapshot from ${formatDate(s.t)}`}
                              title="Re-enter time-travel to edit this snapshot's holdings"
                            >
                              ⏪
                            </button>
                          )}
                          <button
                            ref={(el) => {
                              if (el) editButtonRefs.current.set(s.t, el);
                              else editButtonRefs.current.delete(s.t);
                            }}
                            type="button"
                            onClick={() => handleStartEdit(s)}
                            disabled={busy}
                            className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 text-[11px] text-text-muted disabled:opacity-40 active:opacity-70 hover:text-text"
                            aria-label={`Edit snapshot scalar fields (date, NW, label) from ${formatDate(s.t)}, ${formatUSD(s.netWorthUSD)}`}
                            title="Edit date / net worth / label"
                          >
                            Edit
                          </button>
                          {/* Round-5 audit CRITICAL: two-stage
                              confirm. First click arms (label
                              flips to "Confirm"); second
                              click within 4s actually deletes.
                              Auto-disarms on timeout (effect
                              above). aria-label includes the row
                              context for screen readers. */}
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(s.t)}
                            disabled={busy}
                            className={`rounded border px-2 py-1.5 text-[11px] font-medium disabled:opacity-40 active:opacity-70 ${
                              pendingDelete === s.t
                                ? "border-negative bg-negative text-bg"
                                : "border-negative/40 bg-bg-surface text-negative"
                            }`}
                            aria-label={
                              pendingDelete === s.t
                                ? `Confirm delete of snapshot from ${formatDate(s.t)}`
                                : `Delete snapshot from ${formatDate(s.t)}, ${formatUSD(s.netWorthUSD)}`
                            }
                            title={
                              pendingDelete === s.t
                                ? "Tap to confirm deletion"
                                : "Delete this snapshot"
                            }
                          >
                            {pendingDelete === s.t ? "Confirm" : "Del"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
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
  // Routes through the shared helper. Round-trip validation
  // protects against silent overwrite: "2024-02-31" used to be
  // accepted and silently shifted to March 2, overwriting any
  // real March 2 snapshot. Now rejected → handler early-returns.
  const t = parseISODate(s);
  return t === null ? NaN : t;
}

function formatDate(t: number): string {
  return new Date(t).toLocaleDateString();
}

/**
 * Convert a snapshot's primary key (timestamp ms) back into a
 * YYYY-MM-DD ISO string for the time-travel banner's display.
 * Anchored to UTC so the round-trip through parseISO (noon UTC)
 * + new Date(t).toISOString() reproduces the same string.
 */
function formatISODate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
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
      return `No member-attributable snapshots (${droppedLegacyCount} legacy NW-only hidden — switch to household view to see them)`;
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
