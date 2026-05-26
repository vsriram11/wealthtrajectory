"use client";

import { useCallback, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

/**
 * Cross-device transfer (Data → Export / Drive sync) discoverability
 * banner. Issue #4.
 *
 * Counter-proposal to the issue's demo-only scoping: catches the
 * MOMENT of need rather than the FIRST 30 SECONDS of demo browsing.
 * Surfaces when:
 *
 *   1. User is in REAL mode (no point pestering a demo browser).
 *   2. User has DATA (`accounts.length > 0`) — otherwise there's
 *      nothing to back up yet.
 *   3. No Drive sync configured (`!user || lastSyncAt == null`) —
 *      the user hasn't already chosen the cloud path.
 *   4. Not dismissed recently (`dataTransferCalloutDismissedAt`
 *      stored in localStorage; banner re-surfaces after 30 days).
 *
 * Why localStorage + a 30-day re-surface (instead of one-time-and-
 * forever): users add data over months. A user who dismisses on day
 * 1 with one account benefits from a re-prompt when they add their
 * spouse's accounts six months later. 30 days is long enough not to
 * be nagging, short enough that a returning user gets a reminder.
 *
 * The banner links to the Data page where both Export/Import
 * (sign-in-free, file-based) AND Drive sync (cloud, ProGate'd) live.
 * Users pick the path that fits — the proposal explicitly mentions
 * Export, and a single CTA covers both since they're on the same
 * page.
 */
const STORAGE_KEY = "fp:dataTransferCalloutDismissedAt";

// 30 days. Long enough not to nag; short enough to re-surface for
// returning users who've added data since.
const REPROMPT_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function parseDismissedAt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function serializeDismissedAt(v: number | null): string {
  return v == null ? "" : String(v);
}

export function BackupDiscoverabilityBanner() {
  const mode = useAppStore((s) => s.mode);
  const accountsCount = useAppStore((s) => s.household.accounts.length);
  const user = useAppStore((s) => s.user);
  const lastSyncAt = useAppStore((s) => s.googleLastSyncAt);
  const hydrated = useAppStore((s) => s.hydrated);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  const [dismissedAt, setDismissedAt] = useLocalStorageState<number | null>(
    STORAGE_KEY,
    null,
    parseDismissedAt,
    serializeDismissedAt,
  );
  // Capture wall-clock time ONCE per mount (useState initializer
  // runs once; subsequent renders read the stored value). We don't
  // need realtime expiry — a user who dismisses + keeps the tab
  // open for 30 days won't see the re-prompt until next session,
  // which is fine. Avoids calling Date.now() in render (impure).
  const [now] = useState(() => Date.now());

  const dismiss = useCallback(
    () => setDismissedAt(Date.now()),
    [setDismissedAt],
  );
  const goToData = useCallback(() => {
    setCurrentPage("data");
  }, [setCurrentPage]);

  // Render gates. The order matters — bail early on the cheapest
  // checks first, hydration last so we don't flash the banner
  // during the first paint while IDB is still loading.
  if (mode !== "real") return null;
  if (accountsCount === 0) return null;
  // User has Drive sync working → they've already solved this.
  if (user && lastSyncAt != null) return null;
  if (!hydrated) return null;
  if (dismissedAt != null && now - dismissedAt < REPROMPT_AFTER_MS) {
    return null;
  }

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-accent">
              Back up your plan
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-text">
              Your data lives in this browser only.{" "}
              <span className="text-text-muted">
                Export to an encrypted file (move via AirDrop, Dropbox,
                email, USB — no sign-in needed) or sync to your private
                Google Drive folder so it follows you across devices.
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goToData}
                className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg active:opacity-80"
              >
                Set up backup
              </button>
              <button
                type="button"
                onClick={dismiss}
                title="Hides for 30 days, then re-prompts in case your data has grown"
                className="rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-[12px] font-medium text-text-muted active:opacity-70"
                aria-label="Dismiss backup reminder for 30 days"
              >
                Dismiss for 30 days
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Exported for tests so the suite can reset / freeze the dismissal
// timer without re-deriving the key in two places.
export const BACKUP_DISCOVERABILITY_STORAGE_KEY = STORAGE_KEY;
export const BACKUP_DISCOVERABILITY_REPROMPT_AFTER_MS = REPROMPT_AFTER_MS;
