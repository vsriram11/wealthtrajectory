// @vitest-environment jsdom
/**
 * CloudSyncer regression tests — pin the subscribe-handler
 * patterns that have caused user-visible bugs.
 *
 * Round-4 user-reported: "Maximum call stack size exceeded"
 * when entering time-travel mode. Root cause: the
 * `if (state.timeTravelActive)` branch in the subscribe handler
 * unconditionally called `setGoogleSyncState({ googleUploadScheduled:
 * false })`, which fired a Zustand commit, which re-triggered the
 * subscribe, which saw `timeTravelActive` still true, which called
 * setGoogleSyncState again — infinite loop. Fix gated the call on
 * `state.googleUploadScheduled` being truthy.
 */

import "fake-indexeddb/auto";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CloudSyncer } from "./CloudSyncer";
import { useAppStore } from "@/lib/store";

function resetStore() {
  // Replace the demo household with a non-demo one. Pre-Frame-B
  // this was needed because CloudSyncer early-returned on
  // `isDemoHousehold` even in real mode. Post-Frame-B that gate
  // has been removed (mode === "real" is the single source of
  // truth), so the replacement is no longer load-bearing — kept
  // for clarity in what the test is exercising.
  useAppStore.setState({
    mode: "real",
    household: {
      id: "real-household",
      members: [{ id: "m-real", displayName: "Real" }],
      accounts: [],
      liabilities: [],
    } as never,
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    googleConnected: false,
    googleSyncing: false,
    googleUploadScheduled: false,
    googleLastSyncAt: null,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("CloudSyncer — subscribe-handler regression pins", () => {
  it("entering time-travel does NOT infinite-loop when googleUploadScheduled is already false (user-reported fix)", () => {
    // Setup: googleConnected=true so the subscribe handler runs
    // past its mode/sign-in gates; googleUploadScheduled=false
    // (which is the default-no-pending-upload state — the most
    // common case when a user enters time-travel).
    useAppStore.setState({
      googleConnected: true,
      googleUploadScheduled: false,
    });
    render(<CloudSyncer />);
    // The bug: enterTimeTravel sets timeTravelActive=true →
    // subscribe fires → sees timeTravelActive=true → called
    // setGoogleSyncState({ googleUploadScheduled: false }) →
    // fires subscribe AGAIN → same path → "Maximum call stack
    // size exceeded". With the fix gating on
    // `state.googleUploadScheduled` being truthy, the setter
    // is skipped entirely.
    expect(() => {
      useAppStore.getState().enterTimeTravel("2024-01-01");
    }).not.toThrow();
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    expect(useAppStore.getState().timeTravelDate).toBe("2024-01-01");
  });

  it("entering time-travel WITH a pending upload clears the scheduled flag (one-shot, no loop)", () => {
    // Verify the happy path: when there IS a pending upload at
    // entry time, the flag gets cleared exactly once.
    useAppStore.setState({
      googleConnected: true,
      googleUploadScheduled: true,
    });
    render(<CloudSyncer />);
    expect(() => {
      useAppStore.getState().enterTimeTravel("2024-01-01");
    }).not.toThrow();
    expect(useAppStore.getState().googleUploadScheduled).toBe(false);
    expect(useAppStore.getState().timeTravelActive).toBe(true);
  });

  it("exiting time-travel does NOT infinite-loop either", () => {
    useAppStore.setState({
      googleConnected: true,
      googleUploadScheduled: false,
    });
    render(<CloudSyncer />);
    useAppStore.getState().enterTimeTravel("2024-01-01");
    expect(() => {
      useAppStore.getState().exitTimeTravelDiscard();
    }).not.toThrow();
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });
});
