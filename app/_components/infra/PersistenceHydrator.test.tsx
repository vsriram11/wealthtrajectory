// @vitest-environment jsdom
/**
 * PersistenceHydrator regression tests — pin the Frame B auto-
 * promote contract that PR #18 introduced.
 *
 * The state-change subscriber detects a "real user edit" in demo
 * mode and calls promoteToReal() before falling through to the
 * IDB save. Two regressions worth pinning:
 *
 *   1. The noUserEdit filter must include EVERY persisted slice.
 *      Audit R1 caught preferredMemberId missing — a real-mode
 *      edit triggered save fine, but a demo-mode change to that
 *      field hit the filter, was classified "no real edit," and
 *      silently never promoted nor saved.
 *
 *   2. A genuine first edit while mode=demo flips mode to real
 *      synchronously (the user's next read sees mode=real).
 */

import "fake-indexeddb/auto";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PersistenceHydrator } from "./PersistenceHydrator";
import { useAppStore } from "@/lib/store";

function resetStore() {
  // Reset to demo mode. The default Zustand store starts in demo,
  // but tests run sequentially and other tests may have left it
  // in real mode.
  useAppStore.setState({
    mode: "demo",
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    googleConnected: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("PersistenceHydrator — auto-promote on first edit (Frame B)", () => {
  it("a household mutation in demo mode flips mode to real synchronously", () => {
    render(<PersistenceHydrator />);
    expect(useAppStore.getState().mode).toBe("demo");
    // Simulate a user edit by mutating the household reference
    // through setState — same shape as any action setter would
    // produce. The subscriber observes household !== prev.household
    // and routes through the promote branch.
    useAppStore.setState((s) => ({
      household: { ...s.household, /* fresh reference */ },
    }));
    expect(useAppStore.getState().mode).toBe("real");
  });

  it("a preferredMemberId change in demo mode flips mode to real (R1 regression)", () => {
    // Pre-R1: this field was missing from the noUserEdit filter,
    // so the subscriber classified the change as no-op and returned
    // without promoting OR saving. The fix added preferredMemberId
    // to the filter so it matches the diff check field-for-field.
    render(<PersistenceHydrator />);
    expect(useAppStore.getState().mode).toBe("demo");
    const firstMemberId =
      useAppStore.getState().household.members[0]?.id ?? null;
    useAppStore.setState({ preferredMemberId: firstMemberId });
    expect(useAppStore.getState().mode).toBe("real");
  });

  it("a no-op subscription fire (no tracked slice changed) does NOT promote", () => {
    // Confirms the noUserEdit filter actually filters: a setState
    // that touches an UNTRACKED field (e.g. a UI-only flag) must
    // not trip auto-promote.
    render(<PersistenceHydrator />);
    expect(useAppStore.getState().mode).toBe("demo");
    // currentPage is a UI field — not persisted, not in the filter.
    // The subscribe handler fires but the noUserEdit check returns
    // true → early return, no promote.
    useAppStore.setState({ currentPage: "accounts" });
    expect(useAppStore.getState().mode).toBe("demo");
  });

  it("subsequent edits in real mode do NOT re-trigger promoteToReal (idempotency)", () => {
    // promoteToReal is a no-op when already real, but verify the
    // path is taken: real-mode edits skip the auto-promote branch
    // entirely. Defensive — verifies behavior matches the comment
    // "(Filter: skip the no-op fires that happen during initial
    // hydration...)" rather than the alternative interpretation.
    useAppStore.setState({ mode: "real" });
    render(<PersistenceHydrator />);
    useAppStore.setState((s) => ({
      household: { ...s.household },
    }));
    expect(useAppStore.getState().mode).toBe("real");
  });
});
