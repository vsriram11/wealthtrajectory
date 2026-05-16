"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

const AUTO_DISMISS_MS = 8000;

export function SignInOutcomeBanner() {
  const outcome = useAppStore((s) => s.lastSyncOutcome);
  const user = useAppStore((s) => s.user);
  const dismissSyncOutcome = useAppStore((s) => s.dismissSyncOutcome);
  const signOutReason = useAppStore((s) => s.lastSignOutReason);
  const setLastSignOutReason = useAppStore((s) => s.setLastSignOutReason);

  // Auto-dismiss the success outcome.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(dismissSyncOutcome, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [outcome, dismissSyncOutcome]);

  // Sign-out-reason banner takes priority — it explains why the user
  // suddenly isn't signed in. Stays up until dismissed (no auto-hide
  // because data-loss adjacent — make sure they read it).
  if (signOutReason) {
    const { title, body } =
      signOutReason === "inactivity"
        ? {
            title: "Signed out — 30 minutes of inactivity",
            body: "You were idle for 30 minutes, so we ended the session. Tap Sign in to pick up where you left off.",
          }
        : {
            title: "Signed out — another device took over",
            body: "Someone signed in to this account on another browser or device. Only one active session is allowed at a time. Sign in here again to take the session back.",
          };
    return (
      <div className="px-5 pb-3">
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-300/40 bg-amber-300/5 p-3"
          role="status"
        >
          <span
            className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-text">{title}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
              {body}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastSignOutReason(null)}
            className="rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-text-dim hover:text-text-muted active:opacity-70"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  if (!outcome || !user) return null;

  const name = user.name?.split(" ")[0] ?? user.email;
  const { title, body, tone } = (() => {
    switch (outcome) {
      case "imported":
        return {
          title: `Welcome back, ${name}.`,
          body: "We loaded your saved plan from your private Google Drive folder.",
          tone: "positive" as const,
        };
      case "uploaded-local":
        return {
          title: `Signed in, ${name}.`,
          body: "Your existing local data has been backed up to your Google Drive folder.",
          tone: "positive" as const,
        };
      case "uploaded-fresh":
        return {
          title: `Welcome, ${name}.`,
          body: "We didn't find an existing backup — you're starting in a fresh, empty workspace. Add an account to get going, or tap 'Use mock data' to demo with synthetic numbers.",
          tone: "neutral" as const,
        };
    }
  })();

  return (
    <div className="px-5 pb-3">
      <div
        className={`flex items-start gap-3 rounded-xl border p-3 ${
          tone === "positive"
            ? "border-positive/30 bg-positive/5"
            : "border-accent/30 bg-accent/5"
        }`}
        role="status"
      >
        <span
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
            tone === "positive" ? "bg-positive" : "bg-accent"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text">{title}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{body}</div>
        </div>
        <button
          type="button"
          onClick={dismissSyncOutcome}
          className="rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-text-dim hover:text-text-muted active:opacity-70"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
