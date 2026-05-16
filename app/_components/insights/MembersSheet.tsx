"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { NumberField } from "@/app/_components/ui/NumberField";

export function MembersSheet() {
  const open = useAppStore((s) => s.managingMembers);
  const close = useAppStore((s) => s.closeMembersSheet);
  const members = useAppStore((s) => s.household.members);
  const accounts = useAppStore((s) => s.household.accounts);
  const liabilities = useAppStore((s) => s.household.liabilities);
  const preferredMemberId = useAppStore((s) => s.preferredMemberId);
  const addMember = useAppStore((s) => s.addMember);
  const renameMember = useAppStore((s) => s.renameMember);
  const removeMember = useAppStore((s) => s.removeMember);
  const reorderMembers = useAppStore((s) => s.reorderMembers);
  const setPreferredMemberId = useAppStore((s) => s.setPreferredMemberId);
  const setMemberIncome = useAppStore((s) => s.setMemberIncome);
  const setMemberAge = useAppStore((s) => s.setMemberAge);
  const setMemberIncludeInRollup = useAppStore(
    (s) => s.setMemberIncludeInRollup,
  );

  // Derived counts for the rollup-status subtitle + the "last
  // active member" affordance below. Computed inline so we don't
  // pull another store selector for a trivial reduce.
  const activeCount = members.filter(
    (m) => m.includeInRollup !== false,
  ).length;

  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const counts = (id: string) => ({
    accounts: accounts.filter((a) => a.ownerId === id).length,
    liabilities: liabilities.filter((l) => l.ownerId === id).length,
  });

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    addMember(trimmed);
    setNewName("");
  };

  const moveMember = (id: string, dir: -1 | 1) => {
    const idx = members.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= members.length) return;
    const ids = members.map((m) => m.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorderMembers(ids);
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                Household
              </div>
              <div className="text-xl font-semibold text-text">Members</div>
              {/* Rollup-status subtitle. Only renders when at least one
                  member is excluded — silent in the steady "everyone
                  included" state so we don't crowd the header. This is
                  the SINGLE place we surface rollup membership status;
                  individual rollup panels stay clean. */}
              {activeCount < members.length && (
                <div className="mt-1 text-[11px] text-text-dim">
                  {activeCount} of {members.length} member
                  {members.length === 1 ? "" : "s"} included in rollups
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Done
            </button>
          </div>

          {/* Default view on open. Always visible so the feature is
              discoverable; the dropdown is disabled when there's only
              one member since "Household" would be the only meaningful
              option, but the affordance still telegraphs what's possible
              once a partner / kid / parent is added. */}
          <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-text">Default view on open</div>
                <div className="mt-0.5 text-[11px] text-text-dim">
                  {members.length > 1
                    ? "Where the app lands when you open it, refresh, or sign in. Synced with your data."
                    : "Add a member to enable per-member default views. The whole household is the only option for now."}
                </div>
              </div>
              <select
                value={preferredMemberId ?? "__HOUSEHOLD__"}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreferredMemberId(v === "__HOUSEHOLD__" ? null : v);
                }}
                disabled={members.length <= 1}
                className="shrink-0 rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="__HOUSEHOLD__">Household</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Helper text for the reorder affordance — keeps the
              chevrons from looking like decoration to a user who
              hasn't seen them before. */}
          {members.length > 1 && (
            <div className="mt-3 px-1 text-[10px] uppercase tracking-wider text-text-dim">
              Order · use ↑↓ to reorder · syncs across devices
            </div>
          )}

          <ul className="mt-4 space-y-2">
            {members.map((m, idx) => {
              const c = counts(m.id);
              const removable =
                c.accounts === 0 && c.liabilities === 0 && members.length > 1;
              // `includeInRollup` is optional on the persisted shape;
              // undefined === true (back-compat for data written
              // before the flag existed).
              const included = m.includeInRollup !== false;
              // The last active member must stay active so the rollup
              // never goes empty. Same floor as ≥1-member-exists.
              const canToggleOff = !(included && activeCount <= 1);
              return (
                <MemberRow
                  key={m.id}
                  displayName={m.displayName}
                  initialName={m.displayName}
                  incomeUSD={m.incomeUSD ?? null}
                  age={m.age ?? null}
                  included={included}
                  canToggleOff={canToggleOff}
                  counts={c}
                  removable={removable}
                  canMoveUp={idx > 0 && members.length > 1}
                  canMoveDown={idx < members.length - 1 && members.length > 1}
                  onMoveUp={() => moveMember(m.id, -1)}
                  onMoveDown={() => moveMember(m.id, 1)}
                  onRename={(name) => renameMember(m.id, name)}
                  onIncomeChange={(v) => setMemberIncome(m.id, v)}
                  onAgeChange={(v) => setMemberAge(m.id, v)}
                  onIncludeChange={(v) =>
                    setMemberIncludeInRollup(m.id, v)
                  }
                  onRemove={() => removeMember(m.id)}
                />
              );
            })}
          </ul>

          <div className="mt-5">
            <div className="rounded-xl border border-border bg-bg-elevated p-3">
              <div className="text-[11px] uppercase tracking-wider text-text-dim">
                Add a member
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                  placeholder="Kid · Parent · Other"
                  className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={newName.trim().length === 0}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
                >
                  Add
                </button>
              </div>
              <p className="mt-2 text-[11px] text-text-dim">
                You can assign accounts and liabilities to any member.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  displayName,
  initialName,
  incomeUSD,
  age,
  included,
  canToggleOff,
  counts,
  removable,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRename,
  onIncomeChange,
  onAgeChange,
  onIncludeChange,
  onRemove,
}: {
  displayName: string;
  initialName: string;
  incomeUSD: number | null;
  age: number | null;
  included: boolean;
  canToggleOff: boolean;
  counts: { accounts: number; liabilities: number };
  removable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (name: string) => void;
  onIncomeChange: (value: number | null) => void;
  onAgeChange: (value: number | null) => void;
  onIncludeChange: (value: boolean) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [confirming, setConfirming] = useState(false);

  // Disabled-toggle messaging: switch off is only blocked when
  // THIS row is currently the last active member.
  const toggleDisabled = included && !canToggleOff;

  // Helper copy that always describes the CURRENT effect of the
  // toggle. Mobile users can't see a tooltip, so the explanation
  // has to live in the visible UI. The disabled case explains WHY
  // the switch is locked rather than going silent — the user
  // shouldn't have to guess.
  const helperCopy = toggleDisabled
    ? "At least one member must stay in rollups. Enable another to switch off."
    : included
      ? "Income, age, and blended assumptions roll up to household totals."
      : "Set aside — not counted in household rollups. Underlying data is preserved.";

  return (
    <li className="rounded-xl border border-border bg-bg-elevated p-3">
      <div className="flex items-center gap-2">
        {(canMoveUp || canMoveDown) && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label="Move up"
              className="flex h-5 w-5 items-center justify-center rounded border border-border-strong bg-bg-surface text-text-muted disabled:opacity-30 active:opacity-70"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label="Move down"
              className="flex h-5 w-5 items-center justify-center rounded border border-border-strong bg-bg-surface text-text-muted disabled:opacity-30 active:opacity-70"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        )}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== initialName) onRename(trimmed);
            else setName(initialName);
          }}
          className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
        {removable && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-negative/40 bg-bg-surface px-2.5 py-2 text-xs font-medium text-negative active:opacity-70"
            aria-label="Delete member"
          >
            Delete
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            Income / yr
          </span>
          <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1.5">
            <span className="text-xs text-text-muted">$</span>
            <NumberField
              value={incomeUSD ?? 0}
              onChange={(v) => onIncomeChange(v > 0 ? v : null)}
              precision={0}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            Age
          </span>
          <NumberField
            value={age ?? 0}
            onChange={(v) => onAgeChange(v > 0 ? v : null)}
            precision={0}
            allowNegative={false}
            className="num w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-right text-sm font-medium text-text outline-none"
          />
        </label>
      </div>
      {/* Rollup-include control.
       *
       * Design choices:
       *   - One button is the entire affordance: label + helper
       *     copy + visual switch. The whole row is the click
       *     target, not just the pill — gives a generous touch
       *     target (≥44pt across) and avoids the "did I hit the
       *     toggle or the label?" ambiguity of split-control
       *     patterns.
       *   - role="switch" + aria-checked is the canonical SR
       *     idiom for an on/off control (more precise than a
       *     checkbox, which implies "agree / accept"). The
       *     accessible name is computed from the visible button
       *     text (browsers compute name-from-contents on buttons
       *     with role=switch), so SR users hear the same label
       *     sighted users see — no parallel aria-label string to
       *     drift.
       *   - Helper copy reflects the CURRENT state and is always
       *     visible. Mobile users can't see tooltips, so the
       *     "what does this do" answer has to live in the UI.
       *     The disabled-case copy explains the rule rather than
       *     going silent.
       *   - We don't dim the income/age inputs when excluded.
       *     Users still need to read + edit those values; visual
       *     "set aside" state is communicated by this row's copy
       *     and the switch position, not by muting other
       *     controls.
       */}
      <button
        type="button"
        role="switch"
        aria-checked={included}
        disabled={toggleDisabled}
        onClick={() => onIncludeChange(!included)}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-md border border-border bg-bg-surface/50 px-3 py-2 text-left transition-colors hover:border-border-strong focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-text">
            Include in household rollups
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-text-dim">
            {helperCopy}
          </span>
        </span>
        <SwitchThumb on={included} />
      </button>

      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
        <span>
          {counts.accounts} account{counts.accounts === 1 ? "" : "s"} ·{" "}
          {counts.liabilities} liabilit{counts.liabilities === 1 ? "y" : "ies"}
        </span>
        {!removable && (
          <span className="text-text-dim">
            {counts.accounts > 0 || counts.liabilities > 0
              ? "Reassign or delete owned items first"
              : "Last member can't be deleted"}
          </span>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-xs text-text-muted active:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            className="flex-1 rounded-md bg-negative px-3 py-2 text-xs font-semibold text-bg active:opacity-80"
          >
            Delete forever
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Pure-visual switch (no semantics — that's on the parent button
 * via role="switch" + aria-checked). Lives as a separate component
 * so the math behind track + thumb sizing is easy to reason about
 * and reuse if another switch shows up in the app.
 *
 * Sizing math (must add up exactly — the previous version had a
 * thumb that visibly overflowed the track):
 *   - Track:    44px wide × 24px tall   (w-11 h-6)
 *   - Thumb:    20px diameter           (w-5 h-5)
 *   - Inset:    2px of inner padding on every side
 *   - Travel:   44 − 20 − (2 × 2) = 20px (== translate-x-5)
 *   - Off pos:  thumb left edge at  2px  (== ml-0.5)
 *   - On pos:   off pos + travel = 22px → thumb right edge at 42px
 *               → 2px of track shows past the thumb on the right,
 *                 mirroring the 2px on the left in the off state.
 *
 * The `inline-flex items-center` layout vertically centers the
 * thumb without manual top offsets — so a future track-height
 * tweak doesn't silently misalign the thumb.
 */
function SwitchThumb({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border-strong"
      }`}
    >
      <span
        className={`ml-0.5 inline-block h-5 w-5 rounded-full bg-bg-surface shadow-sm transition-transform ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </span>
  );
}
