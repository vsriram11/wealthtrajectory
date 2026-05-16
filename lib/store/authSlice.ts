/**
 * Authentication + subscription state.
 *
 * `user`              The signed-in Google profile, or null when
 *                     signed out. The Drive sync layer reads this
 *                     to decide whether to attempt sync.
 * `subscription`      Tier (always "pro" in this build; see
 *                     /app/api/subscription/route.ts for why).
 *                     Kept on the AppState because some surfaces
 *                     historically branched on it.
 * `googleConnected`   Mirrors !!user. Held as its own field so
 *                     consumers can subscribe to just the
 *                     connection flag without re-rendering on
 *                     unrelated user-profile updates.
 *
 * setUser is intentionally cross-slice: signing out clears the
 * Google sync flags as well, since they're tied to the connected
 * session. This is the standard "auth slice owns the teardown
 * choreography" pattern.
 */

import type { GoogleProfile } from "@/lib/sync/googleAuth";

export type SubscriptionTier = "free" | "pro";

export type AuthSliceState = {
  user: GoogleProfile | null;
  subscription: SubscriptionTier;
  subscriptionCheckedAt: number | null;
  googleConnected: boolean;
};

export type AuthSliceActions = {
  setUser: (u: GoogleProfile | null) => void;
  setSubscription: (sub: SubscriptionTier) => void;
  setGoogleConnected: (v: boolean) => void;
};

export const AUTH_SLICE_INITIAL: AuthSliceState = {
  user: null,
  subscription: "free",
  subscriptionCheckedAt: null,
  googleConnected: false,
};

/**
 * Sync-teardown fields written when the user signs out. Defined
 * here so the AuthSlice setUser doesn't need to import the entire
 * GoogleSyncSlice. The shape is matched by GoogleSyncSliceState.
 */
type SyncTeardownPatch = {
  googleLastSyncAt: number | null;
  googleSyncError: string | null;
  googleSyncBlockedReason: "encrypted" | "import-shrinkage" | null;
  googleUploadScheduled: boolean;
};

export function createAuthSliceActions(
  set: (patch: Partial<AuthSliceState & SyncTeardownPatch>) => void,
): AuthSliceActions {
  return {
    setUser: (u) =>
      set({
        user: u,
        googleConnected: !!u,
        // Signing out tears down all sync-session state so the
        // next sign-in doesn't see stale sync errors / blocked
        // reasons from the previous session.
        ...(u
          ? {}
          : {
              googleLastSyncAt: null,
              googleSyncError: null,
              googleSyncBlockedReason: null,
              googleUploadScheduled: false,
            }),
      }),
    setSubscription: (sub) =>
      set({ subscription: sub, subscriptionCheckedAt: Date.now() }),
    setGoogleConnected: (v) => set({ googleConnected: v }),
  };
}
