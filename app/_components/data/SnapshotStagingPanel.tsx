"use client";

import { useMemo, useState } from "react";
import { formatUSD, formatUSDCompact } from "@/lib/format";
import {
  dropAccount,
  dropHolding,
  scaleHousehold,
  setHoldingValue,
  summarizeAccount,
  summarizeStagingDiff,
  type StagingDiff,
} from "@/lib/portfolio/stagedHousehold";
import type { Household } from "@/lib/types";

/**
 * Presentational staging panel — no store dependency. Mounts when
 * the user enters "Stage past holdings" mode in SnapshotsManager.
 * Owns its own minor UI state (scale slider draft); all mutations
 * to the staged household go through the pure helpers in
 * lib/portfolio/stagedHousehold.ts and surface via `onChange`.
 *
 * Three editing primitives:
 *   1. Global scale slider (0–200%): "rewind by ~25%"
 *   2. Per-holding "Drop"
 *   3. Per-account "Drop"
 *
 * The base household (frozen at entry) is shown side-by-side with
 * the staged total so the user can see the delta as they edit.
 *
 * Commit + Cancel are owned by the parent so the parent can wire
 * Commit to `recordSnapshot` and unmount this panel atomically on
 * either path.
 */
export function SnapshotStagingPanel({
  base,
  staged,
  onChange,
  onCommit,
  onCancel,
  busy,
  collisionExists,
}: {
  base: Household;
  staged: Household;
  onChange: (next: Household) => void;
  onCommit: () => void;
  onCancel: () => void;
  busy: boolean;
  /** When true, Commit renames to "Replace" — same flow as the main
   *  Save button uses. Caller computes from the draft date. */
  collisionExists: boolean;
}) {
  // Scale slider draft (percent display). 100 = no scaling. The
  // user can drag, see preview, click "Apply" to commit it into
  // staged. We don't auto-apply on every drag — silent staged
  // mutations on slider scrub would be hard to reason about.
  const [scaleDraft, setScaleDraft] = useState<number>(100);

  const diff: StagingDiff = useMemo(
    () => summarizeStagingDiff(base, staged),
    [base, staged],
  );

  const applyScale = () => {
    const factor = Math.max(0, Math.min(2, scaleDraft / 100));
    if (factor === 1) return;
    onChange(scaleHousehold(staged, factor));
    // Reset slider to neutral after applying so successive applies
    // compose visibly rather than silently re-applying the same %.
    setScaleDraft(100);
  };

  const resetAll = () => {
    onChange(structuredClone(base));
    setScaleDraft(100);
  };

  // Sort accounts by total value desc so the biggest movers float to
  // the top — same UX pattern as the Holdings page.
  const sortedAccounts = useMemo(() => {
    const withTotals = staged.accounts.map((a) => ({
      account: a,
      ...summarizeAccount(a),
    }));
    withTotals.sort((a, b) => b.totalUSD - a.totalUSD);
    return withTotals;
  }, [staged]);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-semibold text-accent">
          Stage past holdings
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[10px] text-text-dim underline-offset-2 hover:underline disabled:opacity-40"
          aria-label="Cancel staging — discard all changes"
        >
          Cancel
        </button>
      </div>

      <div
        className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-[10px] leading-snug text-text-dim"
        role="status"
      >
        These edits affect ONLY the snapshot you&apos;re about to save.
        Your live accounts, holdings, and the Drive backup are{" "}
        <strong>not touched</strong> — Cancel discards the staged
        state entirely.
      </div>

      {/* NW summary: base vs staged with the delta. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-border bg-bg-surface px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-text-dim">
            Live NW (today)
          </div>
          <div className="num mt-0.5 text-[12px] font-semibold text-text">
            {formatUSD(diff.baseNetWorthUSD)}
          </div>
        </div>
        <div className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-accent">
            Staged NW
          </div>
          <div className="num mt-0.5 text-[12px] font-semibold text-accent">
            {formatUSD(diff.stagedNetWorthUSD)}
          </div>
        </div>
        <div
          className={`rounded-md border px-2 py-1.5 ${
            diff.deltaUSD === 0
              ? "border-border bg-bg-surface"
              : diff.deltaUSD < 0
                ? "border-negative/40 bg-negative/5"
                : "border-positive/40 bg-positive/5"
          }`}
        >
          <div className="text-[9px] uppercase tracking-wider text-text-dim">
            Delta
          </div>
          <div
            className={`num mt-0.5 text-[12px] font-semibold ${
              diff.deltaUSD < 0
                ? "text-negative"
                : diff.deltaUSD > 0
                  ? "text-positive"
                  : "text-text"
            }`}
          >
            {diff.deltaUSD > 0 ? "+" : ""}
            {formatUSD(diff.deltaUSD)}
          </div>
        </div>
      </div>

      {/* Scale-all slider. Practical for "rewind by N%" rewinds where
          the user doesn't want to per-holding-edit a dozen rows. */}
      <div className="rounded-md border border-border bg-bg-surface p-2">
        <div className="flex items-center justify-between gap-2">
          <label
            className="text-[10px] text-text-muted"
            htmlFor="snapshot-scale-slider"
          >
            Scale all holdings by{" "}
            <span className="num text-text">{scaleDraft}%</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={applyScale}
              disabled={busy || scaleDraft === 100}
              className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold text-bg disabled:opacity-40"
              aria-label={`Apply ${scaleDraft}% scale to all holdings`}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={resetAll}
              disabled={busy || diff.unchanged}
              className="rounded-md border border-border-strong bg-bg-elevated px-2 py-0.5 text-[10px] text-text-muted disabled:opacity-40"
              aria-label="Reset staged state to match live state"
            >
              Reset all
            </button>
          </div>
        </div>
        <input
          id="snapshot-scale-slider"
          type="range"
          min={0}
          max={200}
          step={1}
          value={scaleDraft}
          onChange={(e) => setScaleDraft(Number(e.target.value))}
          disabled={busy}
          className="mt-1.5 w-full accent-accent"
        />
        <div className="mt-0.5 flex justify-between text-[9px] text-text-dim">
          <span>0%</span>
          <span>100% (no change)</span>
          <span>200%</span>
        </div>
        <div className="mt-1 text-[10px] text-text-dim">
          Useful for rewinding the entire portfolio by a market-move
          percentage (e.g. <span className="num">77%</span> to model
          &ldquo;values were ~23% lower then&rdquo;).
        </div>
      </div>

      {/* Account list — each with Drop button + per-holding rows. */}
      <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-bg-surface">
        {sortedAccounts.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-text-dim">
            All accounts dropped. The snapshot will record an empty
            household.
          </div>
        ) : (
          sortedAccounts.map(({ account, totalUSD, holdingsCount }) => (
            <div
              key={account.id}
              className="border-b border-border/60 last:border-b-0"
            >
              <div className="flex items-baseline justify-between gap-2 bg-bg-elevated/50 px-2 py-1">
                <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-text">
                  {account.displayName}
                  <span className="ml-1.5 text-[9px] uppercase tracking-wider text-text-dim">
                    {account.category}
                  </span>
                </div>
                <span className="num text-[11px] text-text-muted">
                  {formatUSDCompact(totalUSD)}{" "}
                  <span className="text-[9px] text-text-dim">
                    · {holdingsCount} pos
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(dropAccount(staged, account.id))}
                  disabled={busy}
                  className="rounded-md border border-negative/40 bg-negative/5 px-1.5 py-0.5 text-[9px] font-medium text-negative disabled:opacity-40"
                  aria-label={`Drop entire ${account.displayName} account from the staged snapshot`}
                >
                  Drop acct
                </button>
              </div>
              <div className="px-2 py-1">
                {account.holdings.length === 0 ? (
                  <div className="text-[10px] text-text-dim">
                    No holdings remain.
                  </div>
                ) : (
                  account.holdings.map((h) => {
                    const label =
                      "symbol" in h && h.symbol
                        ? h.symbol
                        : "name" in h && h.name
                          ? h.name
                          : h.kind;
                    return (
                      <div
                        key={h.id}
                        className="flex items-center gap-2 py-0.5 text-[10px]"
                      >
                        <span className="min-w-0 flex-1 truncate text-text">
                          {label}
                          <span className="ml-1 text-[9px] uppercase tracking-wider text-text-dim">
                            {h.kind === "private_stock"
                              ? "private"
                              : h.kind === "real_estate"
                                ? "RE"
                                : h.kind}
                          </span>
                        </span>
                        <input
                          type="number"
                          value={Math.round(h.valueUSD)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v) || v < 0) return;
                            onChange(
                              setHoldingValue(staged, account.id, h.id, v),
                            );
                          }}
                          disabled={busy}
                          step={100}
                          min={0}
                          aria-label={`Override staged value for ${label}`}
                          className="num w-24 rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-right text-[10px] text-text outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onChange(dropHolding(staged, account.id, h.id))
                          }
                          disabled={busy}
                          className="rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[9px] text-text-muted disabled:opacity-40"
                          aria-label={`Drop ${label} from the staged snapshot`}
                        >
                          Drop
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Diff summary + Commit. */}
      <div className="rounded-md border border-border bg-bg-surface px-2 py-1.5 text-[10px] text-text-dim">
        {diff.unchanged ? (
          <span>
            Staged state matches live state. Apply a scale or drop
            something to make the snapshot meaningfully different.
          </span>
        ) : (
          <span>
            Staged diff:{" "}
            {diff.droppedAccounts > 0 && (
              <span>
                <span className="text-text">{diff.droppedAccounts}</span>{" "}
                account{diff.droppedAccounts === 1 ? "" : "s"} dropped
                {", "}
              </span>
            )}
            <span className="text-text">{diff.droppedHoldings}</span>{" "}
            holdings dropped,{" "}
            <span className="text-text">{diff.modifiedHoldings}</span>{" "}
            modified.
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border-strong bg-bg-elevated px-3 py-1 text-[11px] text-text-muted disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={busy || diff.unchanged || diff.stagedNetWorthUSD <= 0}
          aria-label={
            collisionExists
              ? "Replace existing snapshot at this date with the staged historical state"
              : "Save staged historical snapshot"
          }
          className={`rounded-md px-3 py-1 text-[11px] font-semibold disabled:opacity-40 active:opacity-80 ${
            collisionExists
              ? "bg-amber-300 text-bg"
              : "bg-accent text-bg"
          }`}
        >
          {busy
            ? collisionExists
              ? "Replacing…"
              : "Saving…"
            : collisionExists
              ? "Replace historical snapshot"
              : "Save historical snapshot"}
        </button>
      </div>
    </div>
  );
}
