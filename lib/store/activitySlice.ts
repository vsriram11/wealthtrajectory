/**
 * Session-activity tracker for the idle-timeout enforcer.
 *
 * `lastActivityAt` is touched on every meaningful user input
 * (typing, tapping, scrolling); SessionEnforcer compares it
 * against the wall clock to decide whether to enforce the
 * 30-minute idle timeout.
 *
 * `lastSignOutReason` is set when the user is forcibly signed
 * out (idle timeout or another-device session takeover) so the
 * landing surface can show a contextual banner. Cleared on
 * the next successful sign-in.
 */

export type SignOutReason = "inactivity" | "other-device";

export type ActivitySliceState = {
  /** Wall-clock ms of the last meaningful interaction. */
  lastActivityAt: number;
  /** Why the user was forcibly signed out, or null. */
  lastSignOutReason: SignOutReason | null;
};

export type ActivitySliceActions = {
  /** Mark "now" as the most recent user interaction. */
  recordActivity: () => void;
  setLastSignOutReason: (reason: SignOutReason | null) => void;
};

/**
 * Factory for the initial-state object. Uses a function instead
 * of a constant because `lastActivityAt` should reflect the
 * moment the store is constructed, not module-load time.
 */
export function createActivitySliceInitial(): ActivitySliceState {
  return {
    lastActivityAt: Date.now(),
    lastSignOutReason: null,
  };
}

export function createActivitySliceActions(
  set: (patch: Partial<ActivitySliceState>) => void,
): ActivitySliceActions {
  return {
    recordActivity: () => set({ lastActivityAt: Date.now() }),
    setLastSignOutReason: (reason) => set({ lastSignOutReason: reason }),
  };
}
