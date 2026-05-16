"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { signOut, getAccessToken } from "@/lib/sync/googleAuth";
import { loadActiveSession } from "@/lib/sync/googleDrive";
import {
  isWithinClaimGrace,
  readLocalSessionId,
  writeLocalSessionId,
} from "@/lib/sync/sessionLocal";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 30 * 1000; // check every 30s
// Re-validate the active-session marker every 30 seconds. The marker
// is ~50 bytes — even at this cadence we're using ~4 Drive requests
// per minute, well under the 1000-per-100-second per-user quota. The
// shorter interval keeps "I just signed in elsewhere, why am I still
// signed in here?" lag under half a minute.
const SESSION_POLL_INTERVAL_MS = 30 * 1000;
const ACTIVITY_THROTTLE_MS = 5 * 1000; // record activity at most every 5s

/**
 * Enforces two session policies:
 *
 *   1. Idle timeout — signs the user out after 30 minutes without
 *      meaningful input (mousedown / keydown / touchstart / scroll).
 *
 *   2. Single active session — periodically reads the active-session
 *      marker on Drive and signs out if a different device has
 *      claimed the session. Also re-checks on tab focus so a user
 *      returning to a stale tab gets bumped quickly.
 *
 * Both reasons surface in `lastSignOutReason`, picked up by
 * SignInOutcomeBanner so the user understands what happened.
 */
export function SessionEnforcer() {
  const user = useAppStore((s) => s.user);
  const recordActivity = useAppStore((s) => s.recordActivity);
  const setLastSignOutReason = useAppStore((s) => s.setLastSignOutReason);
  const setUser = useAppStore((s) => s.setUser);
  const lastRecordedAtRef = useRef(0);

  // Activity listeners: throttle to once per 5s so a user dragging the
  // mouse doesn't churn the store.
  useEffect(() => {
    if (!user) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastRecordedAtRef.current < ACTIVITY_THROTTLE_MS) return;
      lastRecordedAtRef.current = now;
      recordActivity();
    };
    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "wheel",
    ];
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [user, recordActivity]);

  // Idle-timeout poller.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      const { lastActivityAt, user: u } = useAppStore.getState();
      if (!u) return;
      if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) return;
      setLastSignOutReason("inactivity");
      writeLocalSessionId(null);
      signOut();
      setUser(null);
    }, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [user, setLastSignOutReason, setUser]);

  // Session-marker validator. Polls Drive to detect "another device
  // signed in" — that device claimed a fresh sessionId, so when ours
  // doesn't match we know we've been displaced.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const check = async () => {
      // Pure validator. AuthHydrator handles all claiming on mount;
      // the periodic poll only checks "are we still the active
      // session" and signs out if not. Auto-claiming on poll would
      // fight with a legitimate sign-in elsewhere — claiming when
      // remote already exists overwrites the active device's marker
      // and ends up displacing the very session the user just
      // intentionally created.
      const local = readLocalSessionId();
      if (!local) return; // never claimed; nothing to enforce against
      // Grace window after a fresh claim: skip kicks. Drive eventual-
      // consistency and historical duplicate-file artifacts can make
      // the remote marker briefly appear stale right after sign-in.
      if (isWithinClaimGrace()) return;
      try {
        const token = await getAccessToken();
        const remote = await loadActiveSession(token);
        if (cancelled) return;
        if (!remote) return; // marker missing; leave alone
        if (remote.sessionId === local) return; // active
        // Displaced.
        setLastSignOutReason("other-device");
        writeLocalSessionId(null);
        signOut();
        setUser(null);
      } catch {
        // Network / token errors — don't kick on a transient hiccup;
        // we'll retry on the next interval / visibility change.
      }
    };

    const poll = setInterval(check, SESSION_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Initial check shortly after mount, after AuthHydrator has had a
    // chance to claim our session.
    const initial = setTimeout(check, 8 * 1000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, setLastSignOutReason, setUser]);

  return null;
}
