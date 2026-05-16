import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { GoogleProfile } from "@/lib/sync/googleAuth";
import {
  AUTH_SLICE_INITIAL,
  createAuthSliceActions,
  type AuthSliceState,
} from "./authSlice";

// Sync-teardown fields that setUser writes when u is null. Defined
// inline here to mirror the slice's internal SyncTeardownPatch.
type Combined = AuthSliceState & {
  googleLastSyncAt: number | null;
  googleSyncError: string | null;
  googleSyncBlockedReason: "encrypted" | "import-shrinkage" | null;
  googleUploadScheduled: boolean;
};

function makeFakeStore(seed: Partial<Combined> = {}) {
  let state: Combined = {
    ...AUTH_SLICE_INITIAL,
    googleLastSyncAt: null,
    googleSyncError: null,
    googleSyncBlockedReason: null,
    googleUploadScheduled: false,
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<Combined>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("setUser", () => {
  it("non-null user flips googleConnected on and leaves sync state alone", () => {
    const s = makeFakeStore({
      googleLastSyncAt: 1234,
      googleSyncError: "boom",
    });
    const a = createAuthSliceActions(s.set);
    a.setUser({ email: "a@b.com" } as GoogleProfile);
    expect(s.state.user).toEqual({ email: "a@b.com" });
    expect(s.state.googleConnected).toBe(true);
    expect(s.state.googleLastSyncAt).toBe(1234);
    expect(s.state.googleSyncError).toBe("boom");
  });

  it("null user (sign-out) tears down sync session state", () => {
    const s = makeFakeStore({
      user: { email: "a@b.com" } as GoogleProfile,
      googleConnected: true,
      googleLastSyncAt: 5000,
      googleSyncError: "previously errored",
      googleSyncBlockedReason: "encrypted",
      googleUploadScheduled: true,
    });
    const a = createAuthSliceActions(s.set);
    a.setUser(null);
    expect(s.state.user).toBeNull();
    expect(s.state.googleConnected).toBe(false);
    expect(s.state.googleLastSyncAt).toBeNull();
    expect(s.state.googleSyncError).toBeNull();
    expect(s.state.googleSyncBlockedReason).toBeNull();
    expect(s.state.googleUploadScheduled).toBe(false);
  });
});

describe("setSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets the tier + stamps subscriptionCheckedAt with the current wall clock", () => {
    const s = makeFakeStore();
    const a = createAuthSliceActions(s.set);
    a.setSubscription("pro");
    expect(s.state.subscription).toBe("pro");
    expect(s.state.subscriptionCheckedAt).toBe(
      Date.parse("2026-05-15T12:00:00Z"),
    );
  });
});

describe("setGoogleConnected", () => {
  it("flips the flag without touching user", () => {
    const s = makeFakeStore({
      user: { email: "a@b.com" } as GoogleProfile,
    });
    const a = createAuthSliceActions(s.set);
    a.setGoogleConnected(false);
    expect(s.state.googleConnected).toBe(false);
    // Setting googleConnected:false does NOT clear user — that's
    // setUser(null)'s job. Disconnection without sign-out is a
    // valid intermediate state during e.g. token-refresh failure.
    expect(s.state.user).toEqual({ email: "a@b.com" });
  });
});
