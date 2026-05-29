// @vitest-environment jsdom
/**
 * TimeTravelBanner — high-risk surface area pinning.
 *
 * The banner is the user's confirmation that they're in time-
 * travel mode + the single button that materializes a backdated
 * snapshot. Pins:
 *
 *   1. Render is null when not active.
 *   2. Active banner shows the chosen date + Save / Exit buttons.
 *   3. Save flow: calls recordSnapshot, bumps revision, exits
 *      the session, shows the success flash. Order matters
 *      because CloudSyncer can't see the write until the
 *      revision bump fires.
 *   4. Exit flow: discards without writing.
 *   5. The success flash auto-dismisses (audit fix — the
 *      previous version had an unreachable flash branch).
 *
 * Direct IDB writes via `recordSnapshot` (a module-level Dexie
 * call) are mocked at the module boundary so we can assert on
 * arguments without spinning up fake-indexeddb. The slice
 * actions enterTimeTravel / exitTimeTravelDiscard are real —
 * we want the actual state-mutation contract.
 */

import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IDB-touching recordSnapshot so we can spy on calls
// without writing to fake-indexeddb (which has its own quirks
// around reset between tests in this codebase). vi.hoisted is
// required because vi.mock is hoisted to the top of the module
// and ordinary `const` declarations aren't available yet.
const { recordSnapshotMock } = vi.hoisted(() => ({
  // Typed to the real recordSnapshot signature so .mock.calls[0][0]
  // has the right shape for assertions below.
  recordSnapshotMock: vi.fn(async (_: unknown) => {}),
}));
// Partial mock — keep everything else (clearRealState, loadRealState,
// etc) intact since lib/store imports from this module.
vi.mock("@/lib/persistence/persistence", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/persistence/persistence")
  >();
  return {
    ...actual,
    recordSnapshot: recordSnapshotMock,
  };
});

import { TimeTravelBanner } from "./TimeTravelBanner";
import { useAppStore } from "@/lib/store";

function resetStore() {
  // Reset the time-travel slice + bump counter to a known state.
  useAppStore.setState({
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    snapshotsRevision: 0,
  });
}

beforeEach(() => {
  recordSnapshotMock.mockClear();
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetStore();
});

describe("TimeTravelBanner", () => {
  it("renders null when not active (default state)", () => {
    const { container } = render(<TimeTravelBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the date + Save / Exit buttons when active", () => {
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    render(<TimeTravelBanner />);
    expect(screen.getByText(/2023-06-15/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Save the current state/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Discard all time-travel edits/i }),
    ).toBeTruthy();
  });

  it("Save flow: records snapshot, bumps revision, exits time-travel", async () => {
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    const startRev = useAppStore.getState().snapshotsRevision;
    render(<TimeTravelBanner />);
    const saveBtn = screen.getByRole("button", {
      name: /Save the current state/i,
    });
    await act(async () => {
      fireEvent.click(saveBtn);
      // Let the promise microtasks settle (handleSave is async).
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(recordSnapshotMock).toHaveBeenCalledTimes(1);
    const callArg = recordSnapshotMock.mock.calls[0][0] as {
      t: number;
      household?: unknown;
      appState?: unknown;
    };
    // Anchored to noon UTC of the chosen date.
    expect(callArg.t).toBe(Date.UTC(2023, 5, 15, 12));
    expect(callArg.household).toBeDefined();
    // Audit fix: appState must travel with the snapshot.
    expect(callArg.appState).toBeDefined();
    // Revision bumped so CloudSyncer notices.
    expect(useAppStore.getState().snapshotsRevision).toBe(startRev + 1);
    // Session exited.
    expect(useAppStore.getState().timeTravelActive).toBe(false);
    expect(useAppStore.getState().timeTravelDate).toBeNull();
  });

  it("Exit flow: discards without writing", () => {
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    const startRev = useAppStore.getState().snapshotsRevision;
    render(<TimeTravelBanner />);
    const exitBtn = screen.getByRole("button", {
      name: /Discard all time-travel edits/i,
    });
    act(() => {
      fireEvent.click(exitBtn);
    });
    expect(recordSnapshotMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshotsRevision).toBe(startRev);
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });

  it("Save flow: success flash auto-dismisses after ~2.5s (audit fix — was unreachable)", async () => {
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    render(<TimeTravelBanner />);
    const saveBtn = screen.getByRole("button", {
      name: /Save the current state/i,
    });
    await act(async () => {
      fireEvent.click(saveBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    // After save: active=false but savedFlash=true → flash visible.
    expect(screen.getByText(/Snapshot saved/i)).toBeTruthy();
    // Auto-dismiss after 2500ms.
    await act(async () => {
      vi.advanceTimersByTime(2600);
      await Promise.resolve();
    });
    expect(screen.queryByText(/Snapshot saved/i)).toBeNull();
  });

  it("Save flow: malformed parseISO is a no-op (defense against URL/DevTools manipulation)", async () => {
    // Force a malformed date directly into the slice (skipping the
    // modal's validation) to verify the banner's own parseISO
    // refuses to write.
    act(() => {
      useAppStore.setState({
        timeTravelActive: true,
        timeTravelDate: "not-a-date",
        baselineHousehold: useAppStore.getState().household,
        baselineAssumptions: useAppStore.getState().assumptions,
      });
    });
    render(<TimeTravelBanner />);
    const saveBtn = screen.getByRole("button", {
      name: /Save the current state/i,
    });
    await act(async () => {
      fireEvent.click(saveBtn);
      await Promise.resolve();
    });
    expect(recordSnapshotMock).not.toHaveBeenCalled();
    // Session still active (no exit on malformed parse).
    expect(useAppStore.getState().timeTravelActive).toBe(true);
  });
});
