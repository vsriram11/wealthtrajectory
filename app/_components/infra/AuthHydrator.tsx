"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { readProfile, getAccessToken, signOut } from "@/lib/sync/googleAuth";
import {
  claimActiveSession,
  findBackupFile,
  loadActiveSession,
  uploadBackup,
} from "@/lib/sync/googleDrive";
import { exportData } from "@/lib/persistence/dataIO";
import { pullFromDrive, pushToDrive } from "@/lib/sync/cloudSync";
import { isDemoHouseholdStrict } from "@/lib/demo";
import {
  generateSessionId,
  isWithinClaimGrace,
  readLocalSessionId,
  writeLocalSessionId,
} from "@/lib/sync/sessionLocal";

// Cap how long we'll wait for PersistenceHydrator to settle. If IDB
// is genuinely slow / unavailable, fall through anyway after 2s so
// sign-in isn't gated on a broken disk.
const WAIT_HYDRATED_MAX_MS = 2000;

// Minimum interval between auto-pulls when the tab becomes visible.
// Without throttling, rapid tab-switching would hammer Drive. 60s
// is the right balance: a returning user gets the latest backup
// quickly, but a user flipping between tabs doesn't trigger a sync
// on every flip.
const RESYNC_MIN_INTERVAL_MS = 60 * 1000;

const SUB_CACHE_KEY = "wealthtrajectory.subscription.v1";
const SUB_TTL_MS = 24 * 60 * 60 * 1000;

type CachedSub = { status: "free" | "pro"; cachedAt: number; email: string };

function readCachedSub(): CachedSub | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUB_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedSub) : null;
  } catch {
    return null;
  }
}

function writeCachedSub(c: CachedSub | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (c) localStorage.setItem(SUB_CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(SUB_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * On mount:
 *   1. Restore the Google profile from localStorage so the UI renders
 *      the signed-in state immediately.
 *   2. If signed in, perform the initial cloud sync (auto-switch to
 *      real mode with cloud data if cloud has any).
 *   3. Fetch /api/subscription with a 24h localStorage cache.
 */
export function AuthHydrator() {
  const setUser = useAppStore((s) => s.setUser);
  const setSubscription = useAppStore((s) => s.setSubscription);

  // Phase 1: hydrate profile.
  useEffect(() => {
    const profile = readProfile();
    if (profile) setUser(profile);
  }, [setUser]);

  // Phase 2 + 3: react to user changes.
  useEffect(() => {
    let cancelled = false;

    const handleUser = async (email: string) => {
      // Subscription check (cached 24h).
      const cached = readCachedSub();
      if (cached && cached.email === email && Date.now() - cached.cachedAt < SUB_TTL_MS) {
        setSubscription(cached.status);
      } else {
        try {
          const res = await fetch(`/api/subscription?email=${encodeURIComponent(email)}`);
          if (res.ok) {
            const data = (await res.json()) as { status: "free" | "pro" };
            if (!cancelled) setSubscription(data.status);
            writeCachedSub({ status: data.status, cachedAt: Date.now(), email });
          }
        } catch {
          /* leave default */
        }
      }

      // Wait for PersistenceHydrator to settle before deciding what
      // to do about cloud state. Without this, a slow IDB read can
      // race AuthHydrator into the "no local data → switchToReal +
      // upload empty" branch and silently wipe a returning user's
      // backup. PersistenceHydrator marks `hydrated: true` regardless
      // of whether IDB actually had data, so this just settles the
      // ordering without blocking new users.
      const hydrationStart = Date.now();
      while (
        !useAppStore.getState().hydrated &&
        Date.now() - hydrationStart < WAIT_HYDRATED_MAX_MS
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cancelled) return;

      // Cloud sync — auto-switch to real with cloud data if cloud has any.
      useAppStore.getState().setGoogleSyncState({
        googleSyncing: true,
        googleSyncError: null,
      });
      try {
        const token = await getAccessToken();
        const existing = await findBackupFile(token);
        if (cancelled) return;
        const s = useAppStore.getState();
        if (existing) {
          // Route through the canonical `pullFromDrive` helper. It
          // handles ciphertext detection, encryption-requires-
          // passphrase signaling, parse coercion, AND the inbound
          // shrinkage guard that refuses to overwrite a populated
          // local collection with a smaller Drive one. The earlier
          // inline download/decrypt/import block silently bypassed
          // that guard — a first sign-in on a device that already
          // had local-only scenarios/goals/budget items could silent-
          // wipe them. `pullFromDrive` is the single source of truth
          // for safe Drive ingestion; AuthHydrator must use it too.
          //
          // `silent: true` keeps the SignInOutcomeBanner from
          // double-flashing on initial sign-in (the dedicated
          // shrinkage / encryption banners take over their own UX).
          const outcome = await pullFromDrive(useAppStore, { silent: true });
          if (cancelled) return;
          if (outcome === "ok") {
            useAppStore.getState().setGoogleSyncState({
              googleLastSyncAt: Date.now(),
              googleSyncError: null,
              googleSyncBlockedReason: null,
              lastSyncOutcome: "imported",
            });
          }
          // For "encrypted" / "shrinkage-blocked" / "error", the
          // dedicated banners (EncryptionUnlockBanner /
          // SyncShrinkageBanner / GlobalSyncBanner) own the recovery
          // UX via the state pullFromDrive already set.
        } else if (
          s.mode === "real" &&
          s.household.accounts.length > 0
        ) {
          // Local has real-mode data; Drive has no backup. Two sub-
          // branches keyed on whether the household tree is still the
          // verbatim demo seed.
          //
          // Layer 3: if strict-demo, the user has been auto-promoted
          // by some non-household edit (assumptions, budget, goals)
          // but hasn't claimed the demo members/accounts as their
          // own. Defer the initial sync silently — no push, no modal.
          // Once the user renames a member or edits an account, the
          // household becomes non-strict-demo and CloudSyncer's
          // auto-debounce will push it via the normal path.
          //
          // Layer 2: if non-strict-demo, the user has customized
          // data. We could push it, but the rare case where Drive
          // actually has data but findBackupFile returned null
          // (stale index, scope quirk) would silently overwrite the
          // user's real Drive backup. Surface a confirmation modal
          // instead. The modal sets `pendingInitialSyncConfirm` and
          // either calls pushToDrive on Confirm or defers on Cancel.
          //
          // The previous unconditional pushToDrive call (post-Audit-
          // R3) was the regression-fix-that-introduced-its-own-
          // regression: it solved "edits destroyed on sign-in" by
          // pushing everything, which then opens "real Drive data
          // overwritten on stale-index race." The strict-demo gate
          // closes the most common case (assumptions-only edits);
          // the modal handles the legitimately-ambiguous case.
          if (isDemoHouseholdStrict(s.household)) {
            // Mark initial sync as "completed" so CloudSyncer's
            // initial-sync gate releases. The user's next edit (one
            // that customizes the household tree) will trigger the
            // normal debounce-push path. Without setting
            // googleLastSyncAt, manual "Sync now" clicks would be
            // permanently blocked-by-initial-sync.
            s.setGoogleSyncState({
              googleSyncing: false,
              googleSyncError: null,
              googleSyncBlockedReason: null,
              googleLastSyncAt: Date.now(),
              lastSyncOutcome: null,
            });
          } else {
            // Non-strict-demo: ask the user before pushing.
            s.setGoogleSyncState({
              googleSyncing: false,
              googleSyncError: null,
              googleSyncBlockedReason: null,
              pendingInitialSyncConfirm: true,
            });
          }
        } else if (s.mode !== "real") {
          // Signed-in user starting fresh — drop them into empty real mode.
          s.switchToReal();
          // Round-2 audit fix: include snapshots even on the
          // fresh-install upload path. Typically empty for a new
          // user but a returning user could land here too (e.g.
          // they had local IDB snapshots from a prior signed-out
          // session, then signed in for the first time — those
          // pre-signin snapshots must reach Drive).
          const snapshotsForUpload = await (
            await import("@/lib/persistence/persistence")
          ).loadSnapshots();
          const json = exportData({
            household: useAppStore.getState().household,
            assumptions: useAppStore.getState().assumptions,
            scenarios: useAppStore.getState().scenarios,
            memberAssumptions: useAppStore.getState().memberAssumptions,
            preferredMemberId: useAppStore.getState().preferredMemberId,
            targetAllocation: useAppStore.getState().targetAllocation,
            glidePath: useAppStore.getState().glidePath,
            householdAnnualIncomeUSD: useAppStore.getState().householdAnnualIncomeUSD,
            goals: useAppStore.getState().goals,
            budgetItems: useAppStore.getState().budgetItems,
            incomeStreams: useAppStore.getState().incomeStreams,
            healthPlans: useAppStore.getState().healthPlans,
            healthImportanceWeights: useAppStore.getState().healthImportanceWeights,
            snapshots: snapshotsForUpload,
          });
          const passphrase =
            useAppStore.getState().encryptionPassphrase;
          const sealed = passphrase
            ? await (
                await import("@/lib/sync/crypto")
              ).encryptString(json, passphrase)
            : json;
          await uploadBackup(token, sealed);
          if (cancelled) return;
          s.setGoogleSyncState({
            googleLastSyncAt: Date.now(),
            googleSyncError: null,
            googleSyncBlockedReason: null,
            lastSyncOutcome: "uploaded-fresh",
          });
        }
      } catch (e) {
        useAppStore.getState().setGoogleSyncState({
          googleSyncError: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!cancelled) {
          useAppStore.getState().setGoogleSyncState({ googleSyncing: false });
        }
      }

      // Single-active-session validation. Compare local sessionId to
      // the marker on Drive — mismatch means another device claimed
      // and we should sign out. Decision matrix:
      //
      //   local set, remote set, match     → we're active. ✓
      //   local set, remote set, mismatch  → displaced. Sign out.
      //   local set, remote null           → marker deleted (or first
      //                                      sync hadn't landed); leave
      //                                      alone.
      //   local null, remote set           → another device owns the
      //                                      session. Sign out (we're
      //                                      the displaced legacy tab).
      //   local null, remote null          → fresh — claim now so the
      //                                      enforcement loop has
      //                                      something to validate.
      //
      // CRITICAL: only claim if BOTH local AND remote are null.
      // Claiming when remote already exists would overwrite a
      // legitimate sign-in elsewhere, displacing the user from the
      // device they actually meant to use.
      try {
        const token = await getAccessToken();
        const local = readLocalSessionId();
        const remote = await loadActiveSession(token);
        if (cancelled) return;

        // Grace period after fresh claim — Drive read-after-write is
        // not strictly consistent, and historical duplicate session
        // files can return a stale sid for a few seconds. Within the
        // grace window we trust our local claim and do not kick.
        const inGrace = isWithinClaimGrace();

        if (local && remote && remote.sessionId === local) {
          return; // active
        }
        if (local && remote && remote.sessionId !== local) {
          if (inGrace) {
            // We just claimed; remote is stale (or duplicate-file
            // race) — re-write our claim to nail down the marker.
            try {
              await claimActiveSession(token, local);
            } catch {
              /* best-effort */
            }
            return;
          }
          useAppStore.getState().setLastSignOutReason("other-device");
          writeLocalSessionId(null);
          signOut();
          useAppStore.getState().setUser(null);
          return;
        }
        if (local && !remote) {
          // Marker deleted (or never landed). Within grace, re-claim
          // to restore it. Outside grace, leave alone.
          if (inGrace) {
            try {
              await claimActiveSession(token, local);
            } catch {
              /* best-effort */
            }
          }
          return;
        }
        if (!local && remote) {
          // Another device has claimed the session — we're the
          // legacy / displaced tab.
          useAppStore.getState().setLastSignOutReason("other-device");
          signOut();
          useAppStore.getState().setUser(null);
          return;
        }
        // !local && !remote: fresh state, claim it.
        try {
          const sid = generateSessionId();
          await claimActiveSession(token, sid);
          writeLocalSessionId(sid);
        } catch {
          // Drive write failed — leave local null so we don't
          // self-kick on a transient hiccup. Next mount or
          // SessionEnforcer poll will retry.
        }
      } catch {
        // Token / Drive errors during validation: silently continue.
        // SessionEnforcer will retry on the next interval / focus.
      }
    };

    // Trigger once on mount if user already exists (post-profile-hydrate).
    const cur = useAppStore.getState();
    if (cur.user) void handleUser(cur.user.email);

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.user === prev.user) return;
      if (!state.user) {
        writeCachedSub(null);
        setSubscription("free");
        return;
      }
      void handleUser(state.user.email);
    });

    // Auto-resync on tab resume. When the tab is backgrounded and
    // returns to the foreground, no React lifecycle re-fires — so
    // the original on-mount sync (above) never runs again. The
    // shared pullFromDrive helper (lib/cloudSync) handles the
    // throttled, silent re-pull and also sets googleSyncBlockedReason
    // when an encrypted backup needs a passphrase, so the unlock
    // banner can react.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void pullFromDrive(useAppStore, {
        silent: true,
        throttle: true,
        throttleMs: RESYNC_MIN_INTERVAL_MS,
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    // Also re-pull on window focus — covers desktop browser cases
    // where visibilitychange may not fire (e.g. tab is "visible"
    // throughout but the user was on a different window).
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [setSubscription]);

  return null;
}
