// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/lib/store";

beforeEach(() => {
  useAppStore.getState().resetToDemo();
  useAppStore.getState().setSubscription("free");
});

describe("subscription default + toggle", () => {
  it("starts on the free plan after resetToDemo + setSubscription('free')", () => {
    expect(useAppStore.getState().subscription).toBe("free");
  });

  it("flipping to pro stamps subscriptionCheckedAt with a near-now timestamp", () => {
    const before = Date.now();
    useAppStore.getState().setSubscription("pro");
    const after = useAppStore.getState().subscriptionCheckedAt;
    expect(useAppStore.getState().subscription).toBe("pro");
    expect(after).not.toBeNull();
    // The stamp must be a real timestamp captured at the
    // moment of the toggle — not a placeholder constant
    // and not a stale value from a previous session. Bracket it
    // between "just before the call" and "just after". A test
    // for `> 0` alone would silently accept e.g. `42`, which a
    // real-world consumer of the timestamp (recency checks in
    // the UI) would treat as 1970 and behave unpredictably.
    expect(after!).toBeGreaterThanOrEqual(before);
    expect(after!).toBeLessThanOrEqual(Date.now());
  });

  it("flipping back to free is supported", () => {
    useAppStore.getState().setSubscription("pro");
    useAppStore.getState().setSubscription("free");
    expect(useAppStore.getState().subscription).toBe("free");
  });
});

describe("sign-in dependency for export/import", () => {
  it("user is null before setUser; signed-in gates open once a profile is stored", () => {
    expect(useAppStore.getState().user).toBeNull();
    useAppStore.getState().setUser({
      sub: "test",
      email: "t@example.com",
      name: "Test",
      pictureUrl: null,
      emailVerified: true,
    });
    expect(useAppStore.getState().user?.email).toBe("t@example.com");
  });
});

describe("scenarios stay free-state cleanly", () => {
  it("scenarios are empty by default; gating is enforced in the UI", () => {
    expect(useAppStore.getState().scenarios.length).toBe(0);
  });
});
