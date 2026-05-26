"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  ACCOUNT_CATEGORY_LABELS,
  type AccountCategory,
} from "@/lib/types";
import { NumberField } from "@/app/_components/ui/NumberField";

const CATEGORIES: AccountCategory[] = [
  "401K",
  "ROTH_401K",
  "TRAD_IRA",
  "ROTH_IRA",
  "HSA",
  "BROKERAGE",
  "SAVINGS",
  "CHECKING",
  "FIVE_29",
  "TRUMP_ACCOUNT",
  "CRYPTO",
  "REAL_ESTATE",
  "OTHER",
];

/**
 * Extra explanatory copy shown beneath the category dropdown for
 * categories where the user is likely to need a definition. Keep
 * each entry short — this is in-form scaffolding, not a tutorial.
 */
const CATEGORY_HINTS: Partial<Record<AccountCategory, string>> = {
  TRUMP_ACCOUNT:
    "Launched July 4, 2026 — every American newborn child gets a free $1,000 invested in index funds. Must opt-in.",
};

export function AccountEditor() {
  const editingId = useAppStore((s) => s.editingAccountId);
  const creating = useAppStore((s) => s.creatingAccount);
  const close = useAppStore((s) => s.closeAccountEditor);
  const accounts = useAppStore((s) => s.household.accounts);
  const members = useAppStore((s) => s.household.members);
  // Whatever member the user is currently viewing in the app — used
  // as the default owner for new accounts so adding an account while
  // filtered to "Spouse" creates a Spouse-owned account rather than
  // silently dropping it under the first member.
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const updateAccount = useAppStore((s) => s.updateAccount);
  const createAccount = useAppStore((s) => s.createAccount);
  const removeAccount = useAppStore((s) => s.removeAccount);
  const beginCreatingHolding = useAppStore((s) => s.beginCreatingHolding);

  const existing = useMemo(
    () => (editingId ? accounts.find((a) => a.id === editingId) ?? null : null),
    [editingId, accounts],
  );

  // Default new-account owner picks the currently-selected member
  // when set (and still present in the household); otherwise falls
  // back to the first member. Existing-account edits override this in
  // the effect below from the saved record.
  const defaultOwnerId =
    (selectedMemberId &&
      members.some((m) => m.id === selectedMemberId) &&
      selectedMemberId) ||
    members[0]?.id ||
    "";
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AccountCategory>("BROKERAGE");
  const [ownerId, setOwnerId] = useState<string>(defaultOwnerId);
  const [contribution, setContribution] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resync form state when the modal opens for a different entity
  // (or flips create ↔ edit). Done as an in-render state adjustment
  // — the React 19 canonical pattern for "reset some state when a
  // prop changes" — so we don't bounce through useEffect.
  const subjectKey = existing?.id ?? (creating ? "__new" : null);
  const [prevSubjectKey, setPrevSubjectKey] = useState<string | null>(null);
  if (subjectKey !== prevSubjectKey) {
    setPrevSubjectKey(subjectKey);
    if (existing) {
      setName(existing.displayName);
      setCategory(existing.category);
      setOwnerId(existing.ownerId);
      setContribution(existing.monthlyContributionUSD);
      setConfirmDelete(false);
    } else if (creating) {
      setName("");
      setCategory("BROKERAGE");
      setOwnerId(defaultOwnerId);
      setContribution(0);
      setConfirmDelete(false);
    }
  }

  useEffect(() => {
    if (!editingId && !creating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, creating, close]);

  if (!editingId && !creating) return null;

  const canSave = name.trim().length > 0 && ownerId.length > 0;
  const holdingsCount = existing?.holdings.length ?? 0;
  const totalValue = existing
    ? existing.holdings.reduce((s, h) => s + h.valueUSD, 0)
    : 0;

  const save = () => {
    if (!canSave) return;
    if (existing) {
      updateAccount(existing.id, {
        displayName: name.trim(),
        category,
        ownerId,
        monthlyContributionUSD: contribution,
      });
    } else {
      const newId = createAccount({
        displayName: name.trim(),
        category,
        ownerId,
        monthlyContributionUSD: contribution,
      });
      close();
      // chain straight into the holding creator so the new account
      // doesn't sit empty
      setTimeout(() => beginCreatingHolding(newId), 50);
      return;
    }
    close();
  };

  const doDelete = () => {
    if (!existing) return;
    removeAccount(existing.id);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={editingId ? "Edit account" : "Add account"}
    >
      {/* Backdrop is decorative (no click-to-close) so a stray tap
          outside the sheet doesn't silently discard in-progress
          edits. Users close via the explicit Cancel button. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                {existing ? "Edit account" : "New account"}
              </div>
              <div className="text-xl font-semibold text-text">
                {existing?.displayName || "Account"}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Account name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fidelity 401(k)"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
            </Field>

            <Field label="Category">
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as AccountCategory)
                }
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ACCOUNT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              {CATEGORY_HINTS[category] && (
                <div
                  data-testid={`category-hint-${category}`}
                  className="mt-1.5 px-0.5 text-[11px] leading-snug text-text-dim"
                >
                  {CATEGORY_HINTS[category]}
                </div>
              )}
            </Field>

            <Field label="Owner">
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Monthly contribution">
              <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
                <span className="text-sm text-text-muted">$</span>
                <NumberField
                  value={contribution}
                  onChange={setContribution}
                  precision={0}
                  allowNegative={false}
                  className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
                />
                <span className="text-sm text-text-muted">/mo</span>
              </span>
            </Field>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
          >
            {existing ? "Save changes" : "Create account"}
          </button>

          {existing && (
            <div className="mt-6 rounded-xl border border-negative/30 bg-negative/5 p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-negative">
                Danger zone
              </div>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-2 w-full rounded-md border border-negative/40 bg-bg-surface px-3 py-2 text-sm font-medium text-negative active:opacity-70"
                >
                  Delete account
                </button>
              ) : (
                <div>
                  <div className="mt-2 text-sm text-text">
                    Delete <span className="font-semibold">{existing.displayName}</span>?
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {holdingsCount > 0
                      ? `${holdingsCount} holding${holdingsCount === 1 ? "" : "s"} totaling ${formatUSD(totalValue)} will be permanently removed from this household.`
                      : "This account has no holdings."}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-muted active:opacity-70"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={doDelete}
                      className="flex-1 rounded-md bg-negative px-3 py-2 text-sm font-semibold text-bg active:opacity-80"
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      {children}
    </label>
  );
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
