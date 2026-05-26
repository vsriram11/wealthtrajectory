"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { PageId } from "@/lib/store";
import { signIn, signOut, getAccessToken } from "@/lib/sync/googleAuth";
import { claimActiveSession } from "@/lib/sync/googleDrive";
import {
  generateSessionId,
  writeLocalSessionId,
} from "@/lib/sync/sessionLocal";

const PAGE_TITLES: Record<PageId, string> = {
  home: "Independence",
  accounts: "Accounts",
  allocation: "Allocation",
  projections: "Projections",
  plan: "Plan",
  data: "Data",
  glossary: "Glossary",
};

export function DemoHeader() {
  const mode = useAppStore((s) => s.mode);
  const user = useAppStore((s) => s.user);
  const subscription = useAppStore((s) => s.subscription);
  const hasData = useAppStore((s) => s.household.accounts.length > 0);
  const resetToDemo = useAppStore((s) => s.resetToDemo);
  const setNavOpen = useAppStore((s) => s.setNavOpen);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setUser = useAppStore((s) => s.setUser);
  const setGoogleSyncState = useAppStore((s) => s.setGoogleSyncState);
  const googleSyncing = useAppStore((s) => s.googleSyncing);
  const googleLastSyncAt = useAppStore((s) => s.googleLastSyncAt);
  const currentPage = useAppStore((s) => s.currentPage);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  // Briefly flash a "Synced" pill after a successful sync. We track
  // the last sync timestamp we've already "consumed" in state;
  // showJustSynced derives from `googleLastSyncAt !== lastSeenSyncAt`.
  // After 2.5s the effect bumps lastSeenSyncAt to clear the pill —
  // setState happens in a timer callback, not synchronously in the
  // effect body, so we don't trigger cascading renders.
  const [lastSeenSyncAt, setLastSeenSyncAt] = useState<number | null>(
    googleLastSyncAt,
  );
  const showJustSynced =
    googleLastSyncAt != null && googleLastSyncAt !== lastSeenSyncAt;
  useEffect(() => {
    if (!showJustSynced) return;
    const t = setTimeout(() => setLastSeenSyncAt(googleLastSyncAt), 2500);
    return () => clearTimeout(t);
  }, [showJustSynced, googleLastSyncAt]);

  const handleReset = () => {
    if (hasData && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    resetToDemo();
  };

  const handleSignIn = async () => {
    setSigning(true);
    setGoogleSyncState({ googleSyncing: true, googleSyncError: null });
    try {
      const { token, profile } = await signIn();
      // Claim a fresh session marker on Drive BEFORE setUser so any
      // other device polling the marker sees the new sessionId and
      // self-signs-out. setUser kicks off AuthHydrator's cloud-sync.
      const sid = generateSessionId();
      try {
        await claimActiveSession(token, sid);
        writeLocalSessionId(sid);
      } catch {
        // Drive write failed. Do NOT persist a local sessionId here —
        // doing so would create a local id with no matching remote,
        // and the next SessionEnforcer poll would compare local
        // against whatever stale remote marker existed and kick the
        // user immediately. Leaving local null means SessionEnforcer
        // will retry the claim on its next interval (or visibility
        // change) and we stay signed in unprotected in the meantime.
      }
      // Coming back from an idle-kick / other-device-kick? Clear the
      // banner so the new session starts clean.
      useAppStore.getState().setLastSignOutReason(null);
      setUser(profile);
      // AuthHydrator handles the cloud-sync side-effect.
    } catch (e) {
      setGoogleSyncState({
        googleSyncing: false,
        googleSyncError: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSigning(false);
    }
  };

  const handleSignOut = () => {
    signOut();
    writeLocalSessionId(null);
    setUser(null);
    setMenuOpen(false);
  };

  // Re-claim the session marker on this device with a fresh sessionId.
  // Other devices polling Drive will see the new id on their next
  // check (within 30s) and self-sign-out. Useful when the periodic
  // poll hasn't kicked another device yet, or when the user wants
  // immediate confidence that no other device has access.
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [signedOutOthersAt, setSignedOutOthersAt] = useState<number | null>(null);
  const handleSignOutOtherDevices = async () => {
    setSigningOutOthers(true);
    try {
      const token = await getAccessToken();
      const sid = generateSessionId();
      await claimActiveSession(token, sid);
      writeLocalSessionId(sid);
      setSignedOutOthersAt(Date.now());
    } catch {
      /* swallow — surface via lack of confirmation timestamp */
    } finally {
      setSigningOutOthers(false);
    }
  };
  useEffect(() => {
    if (!signedOutOthersAt) return;
    const t = setTimeout(() => setSignedOutOthersAt(null), 4000);
    return () => clearTimeout(t);
  }, [signedOutOthersAt]);

  const initials = user
    ? (user.name ?? user.email)
        .split(/\s+/)
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <header className="relative flex items-center justify-between gap-3 px-5 pt-6 pb-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="rounded-md border border-border-strong bg-bg-elevated p-1.5 text-text-muted active:opacity-70"
          aria-label="Open menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="truncate text-base font-semibold tracking-tight">
          {PAGE_TITLES[currentPage]}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {googleSyncing && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-text-dim">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            Syncing…
          </span>
        )}
        {!googleSyncing && showJustSynced && user && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-positive">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
            Synced
          </span>
        )}
        {mode === "real" && !user && (
          <button
            type="button"
            onClick={handleReset}
            className={`text-[11px] font-medium active:opacity-70 ${
              confirming ? "text-negative" : "text-text-dim hover:text-text-muted"
            }`}
            aria-label={confirming ? "Confirm wipe of local data" : "Switch to mock data"}
          >
            {confirming ? "Tap to wipe local" : "Use mock data"}
          </button>
        )}
        {!user ? (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={signing}
            className="flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent disabled:opacity-50 active:opacity-70"
          >
            <GoogleGlyph />
            <span>{signing ? "Signing in…" : "Sign in"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="relative flex items-center gap-1.5 rounded-full border border-border-strong bg-bg-elevated px-1 py-1 active:opacity-70"
            aria-label="Account menu"
          >
            {user.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.pictureUrl}
                alt=""
                className="h-6 w-6 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold text-accent">
                {initials}
              </span>
            )}
            {subscription === "pro" && (
              <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                Pro
              </span>
            )}
          </button>
        )}
      </div>

      {menuOpen && user && (
        <div
          className="absolute right-5 top-14 z-40 w-60 rounded-xl border border-border-strong bg-bg-surface p-2 shadow-xl"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium text-text">
              {user.name ?? user.email}
            </div>
            <div className="truncate text-[11px] text-text-muted">{user.email}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-text-dim">
              {subscription === "pro" ? "Pro plan" : "Free plan"}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setCurrentPage("data");
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-bg-elevated active:opacity-70"
          >
            Plan & data settings
          </button>
          <button
            type="button"
            onClick={handleSignOutOtherDevices}
            disabled={signingOutOthers}
            className="mt-0.5 block w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-bg-elevated disabled:opacity-50 active:opacity-70"
          >
            {signingOutOthers
              ? "Signing out other devices…"
              : signedOutOthersAt
                ? "✓ Other devices will sign out shortly"
                : "Sign out other devices"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-0.5 block w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-bg-elevated active:opacity-70"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}

function GoogleGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
