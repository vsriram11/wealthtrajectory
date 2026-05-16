"use client";

import { useAppStore } from "@/lib/store";

export function EmptyState() {
  const mode = useAppStore((s) => s.mode);
  const user = useAppStore((s) => s.user);
  const hasAccounts = useAppStore((s) => s.household.accounts.length > 0);
  const beginCreating = useAppStore((s) => s.beginCreatingAccount);
  const resetToDemo = useAppStore((s) => s.resetToDemo);

  if (mode !== "real" || hasAccounts) return null;

  return (
    <section className="px-5 pt-6">
      <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface p-6 text-center">
        <div className="text-sm font-medium text-text">
          {user ? "Welcome — let's add your first account" : "Your data, your device"}
        </div>
        <p className="mx-auto mt-1.5 max-w-xs text-xs text-text-muted">
          {user
            ? "Your data auto-saves locally and backs up to your private Google Drive folder."
            : "Your data is stored locally in your browser (IndexedDB) and persists across refreshes. See Data → Privacy for the full data-flow story."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={beginCreating}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg active:opacity-80"
          >
            + Add account
          </button>
          {/* Hide the demo-data shortcut once signed in (data-loss footgun). */}
          {!user && (
            <button
              type="button"
              onClick={resetToDemo}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-muted active:opacity-70"
            >
              Back to mock starter data
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
