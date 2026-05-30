"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  getAccessToken,
  hasGoogleClientId,
  signIn,
  signOut,
} from "@/lib/sync/googleAuth";
import {
  claimActiveSession,
  downloadBackup,
  findBackupFile,
  uploadBackup,
  type DriveBackupRef,
} from "@/lib/sync/googleDrive";
import {
  applyImportedPayload,
  exportData,
  parseImport,
} from "@/lib/persistence/dataIO";
import { pullFromDrive, pushToDrive } from "@/lib/sync/cloudSync";
import {
  generateSessionId,
  writeLocalSessionId,
} from "@/lib/sync/sessionLocal";

/**
 * Detect Drive's "insufficient authentication scopes" 403. The
 * stringified error from authed() includes the body text, so a
 * substring match is reliable enough.
 */
function isInsufficientScopeError(message: string): boolean {
  return (
    /Drive 403/.test(message) &&
    /Insufficient Permission|insufficient authentication scopes/i.test(
      message,
    )
  );
}

/**
 * Detect Google's `access_denied` OAuth response — the test-user
 * allowlist miss. The GIS token response surfaces this as
 * `response.error === "access_denied"`, which `signIn()` rejects
 * with `new Error("access_denied")` (lib/sync/googleAuth.ts).
 * Documented user path: email the maintainer to be added to the
 * allowlist; see docs/OAUTH_VERIFICATION.md.
 */
function isAccessDeniedError(message: string): boolean {
  return /access_denied/i.test(message);
}

type ConnectStep =
  | { kind: "idle" }
  | { kind: "merging"; cloud: DriveBackupRef; cloudText: string };

export function GoogleSyncCard() {
  const user = useAppStore((s) => s.user);
  const syncing = useAppStore((s) => s.googleSyncing);
  const error = useAppStore((s) => s.googleSyncError);
  const lastSyncAt = useAppStore((s) => s.googleLastSyncAt);
  const household = useAppStore((s) => s.household);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const preferredMemberId = useAppStore((s) => s.preferredMemberId);
  const targetAllocation = useAppStore((s) => s.targetAllocation);
  const householdAnnualIncomeUSD = useAppStore(
    (s) => s.householdAnnualIncomeUSD,
  );
  const scenarios = useAppStore((s) => s.scenarios);
  const goals = useAppStore((s) => s.goals);
  const budgetItems = useAppStore((s) => s.budgetItems);
  const incomeStreams = useAppStore((s) => s.incomeStreams);
  const encryptionPassphrase = useAppStore((s) => s.encryptionPassphrase);
  const importPayload = useAppStore((s) => s.importPayload);
  const bumpSnapshotsRevision = useAppStore(
    (s) => s.bumpSnapshotsRevision,
  );
  const setUser = useAppStore((s) => s.setUser);
  const setSyncState = useAppStore((s) => s.setGoogleSyncState);

  // Wrap-or-pass-through helper used by every upload path below so
  // encrypted-Drive-backup users get end-to-end encryption with zero
  // extra ceremony at each call site.
  const sealForUpload = async (plaintext: string): Promise<string> => {
    if (!encryptionPassphrase) return plaintext;
    const { encryptString } = await import("@/lib/sync/crypto");
    return encryptString(plaintext, encryptionPassphrase);
  };

  const [step, setStep] = useState<ConnectStep>({ kind: "idle" });

  if (!hasGoogleClientId()) return null;

  const hasLocalData = household.accounts.length > 0;
  const connected = !!user;

  const connect = async () => {
    setSyncState({ googleSyncing: true, googleSyncError: null });
    try {
      const { token, profile } = await signIn();
      setUser(profile);
      const existing = await findBackupFile(token);
      if (existing && hasLocalData) {
        const raw = await downloadBackup(token, existing.id);
        const { unwrapBackup } = await import("@/lib/sync/crypto");
        const text = await unwrapBackup(
          raw,
          useAppStore.getState().encryptionPassphrase,
        ).catch((e: Error) => {
          throw e;
        });
        setStep({ kind: "merging", cloud: existing, cloudText: text });
        setSyncState({ googleSyncing: false });
        return;
      }
      if (existing && !hasLocalData) {
        const raw = await downloadBackup(token, existing.id);
        const { unwrapBackup } = await import("@/lib/sync/crypto");
        const text = await unwrapBackup(
          raw,
          useAppStore.getState().encryptionPassphrase,
        );
        const parsed = parseImport(text);
        // Round-1 audit CRITICAL fix: applyImportedPayload bundles
        // the store import AND the IDB snapshot mirror, so this
        // first-cloud-pull path can't leave snapshot history
        // stranded.
        await applyImportedPayload(parsed, importPayload);
        // R1-D10 audit CRITICAL fix: bump snapshot revision so
        // History/Insights/Review consumers re-read after the
        // first-cloud-pull. Only when the payload actually carried
        // snapshots — see pullFromDrive comment.
        if (parsed.snapshots !== undefined) bumpSnapshotsRevision();
        setSyncState({
          googleSyncing: false,
          googleLastSyncAt: Date.now(),
        });
        return;
      }
      // First-time sign-in with no existing Drive backup → push
      // local as the initial backup. Through pushToDrive so the
      // shrinkage guard still runs (it'll be a no-op since Drive
      // has nothing); bypassInitialSyncGate because we're INSIDE
      // the initial sync flow.
      await pushToDrive(useAppStore, { bypassInitialSyncGate: true });
    } catch (e) {
      setSyncState({
        googleSyncing: false,
        googleSyncError: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const useCloud = async () => {
    if (step.kind !== "merging") return;
    try {
      const parsed = parseImport(step.cloudText);
      // Round-1 audit CRITICAL fix: useCloud is the "merge: prefer
      // cloud" branch — must mirror Drive snapshots into IDB or the
      // user keeps their old local snapshots while overwriting all
      // other slices.
      await applyImportedPayload(parsed, importPayload);
      // R1-D10 audit CRITICAL fix: bump snapshot revision so
      // History/Insights/Review consumers re-read after a
      // merge-prefer-cloud import.
      if (parsed.snapshots !== undefined) bumpSnapshotsRevision();
      setSyncState({ googleLastSyncAt: Date.now() });
      setStep({ kind: "idle" });
    } catch (e) {
      setSyncState({
        googleSyncError: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Merge-flow "Keep local & push": user has just signed in, saw
  // a cloud copy, chose to keep local. Explicit override of both
  // the initial-sync gate (we're still in the connect handshake)
  // and the shrinkage guard (the user chose this knowingly).
  const keepLocal = async () => {
    const result = await pushToDrive(useAppStore, {
      bypassInitialSyncGate: true,
      bypassShrinkageGuard: true,
    });
    if (result === "ok") setStep({ kind: "idle" });
  };

  // "Sync now" — intent is "make sync work right now", so if the
  // initial Drive pull hasn't completed yet (the gate that blocks
  // pushToDrive when googleLastSyncAt is null), pull first, then
  // push. Recovers a stuck "Waiting for initial Drive sync"
  // state without the user having to refresh or sign out / in.
  const syncNow = async () => {
    const before = useAppStore.getState();
    if (before.googleLastSyncAt == null) {
      const pullResult = await pullFromDrive(useAppStore, { silent: true });
      // If pull surfaced an actionable blocker (encrypted backup,
      // shrinkage conflict), the dedicated banner will show — bail
      // here so we don't immediately push and clobber.
      if (pullResult === "encrypted" || pullResult === "shrinkage-blocked")
        return;
      if (pullResult === "error") return;
    }
    await pushToDrive(useAppStore);
  };

  const handleSignOut = () => {
    signOut();
    setUser(null);
  };

  /**
   * Drop the in-memory token and re-run the OAuth consent flow.
   * Useful when an old token is missing scopes the app now needs.
   * Re-claims the session marker so we don't accidentally lose our
   * active-session ownership on the way through.
   */
  const reconnect = async () => {
    setSyncState({ googleSyncing: true, googleSyncError: null });
    try {
      signOut(); // clears the cached token + revokes
      const { token, profile } = await signIn();
      setUser(profile);
      const sid = generateSessionId();
      try {
        await claimActiveSession(token, sid);
        writeLocalSessionId(sid);
      } catch {
        /* claim is best-effort here; AuthHydrator will retry */
      }
      setSyncState({ googleSyncing: false, googleSyncError: null });
    } catch (e) {
      setSyncState({
        googleSyncing: false,
        googleSyncError: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const insufficientScope = !!error && isInsufficientScopeError(error);
  const accessDenied = !!error && isAccessDeniedError(error);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {connected && user!.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user!.pictureUrl}
                alt=""
                className="h-9 w-9 rounded-full border border-border-strong"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border-strong bg-bg-elevated">
                <GoogleGlyph />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">
                {connected
                  ? (user!.name ?? user!.email)
                  : "Sign in with Google"}
              </div>
              {connected ? (
                <div className="mt-0.5 truncate text-[11px] text-text-muted">
                  {user!.email}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-text-dim">
                  Cross-device sync via your private appDataFolder on Drive,
                  plus identity for Pro plan.
                </div>
              )}
              {connected && lastSyncAt && (
                <div className="mt-1 text-[11px] text-text-dim">
                  Last sync {relTime(lastSyncAt)}
                </div>
              )}
              {error && (
                <div className="mt-1 text-[11px] text-negative">
                  {insufficientScope ? (
                    <>
                      Google says this app no longer has Drive access on
                      your account. Click <strong>Reconnect</strong> to
                      grant access again — your data on Drive is untouched.
                    </>
                  ) : accessDenied ? (
                    <>
                      Your Gmail isn&apos;t on the OAuth test-user
                      allowlist. Drive sync is in Google&apos;s 100-user
                      Testing tier — email{" "}
                      <a
                        href="mailto:varunsriram93@hotmail.com?subject=wealthtrajectory%20Drive%20sync%20access"
                        className="underline"
                      >
                        varunsriram93@hotmail.com
                      </a>{" "}
                      with the address you&apos;d like added (usually
                      within 24h). Until then, your data stays on this
                      device — Data → Export covers cross-device transfer.
                    </>
                  ) : (
                    error
                  )}
                </div>
              )}
              {connected && insufficientScope && (
                <button
                  type="button"
                  onClick={reconnect}
                  disabled={syncing}
                  className="mt-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent disabled:opacity-50 active:opacity-70"
                >
                  {syncing ? "Reconnecting…" : "Reconnect Google Drive"}
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {!connected && step.kind === "idle" && (
              <button
                type="button"
                onClick={connect}
                disabled={syncing}
                className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent disabled:opacity-50 active:opacity-70"
              >
                {syncing ? "Signing in…" : "Sign in"}
              </button>
            )}
            {connected && (
              <>
                <button
                  type="button"
                  onClick={syncNow}
                  disabled={syncing}
                  className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted disabled:opacity-50 active:opacity-70"
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-[11px] text-text-dim hover:text-negative active:opacity-70"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>

        {step.kind === "merging" && (
          <div className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/5 p-3 text-[11px] text-amber-300">
            <div className="font-medium text-text">
              Cloud copy found from{" "}
              {new Date(step.cloud.modifiedTime).toLocaleString()}
            </div>
            <div className="mt-1 text-text-muted">
              You also have local data on this device. Which one wins?
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={useCloud}
                className="flex-1 rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg active:opacity-80"
              >
                Use cloud copy
              </button>
              <button
                type="button"
                onClick={keepLocal}
                className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
              >
                Keep my local data
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#34A853"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#EA4335"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function relTime(t: number): string {
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
