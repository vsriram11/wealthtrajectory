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
const { recordSnapshotMock, loadSnapshotsMock } = vi.hoisted(() => ({
  // Typed to the real recordSnapshot signature so .mock.calls[0][0]
  // has the right shape for assertions below.
  recordSnapshotMock: vi.fn(async (_: unknown) => {}),
  // loadSnapshots is now called from handleSave for collision
  // detection — mock it so tests don't depend on fake-indexeddb
  // state, and so we can drive the collision branch explicitly.
  loadSnapshotsMock: vi.fn(async () => [] as Array<unknown>),
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
    loadSnapshots: loadSnapshotsMock,
  };
});

import { TimeTravelBanner } from "./TimeTravelBanner";
import { useAppStore } from "@/lib/store";

function resetStore() {
  // Reset the time-travel slice + bump counter to a known state.
  // Force mode="real" since the slice's enterTimeTravel gate
  // refuses demo-mode entry (audit fix); the store's default
  // initial state is demo, so without this override every
  // enterTimeTravel call in tests would be a silent no-op.
  useAppStore.setState({
    mode: "real",
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    editingSnapshotT: null,
    snapshotsRevision: 0,
  });
}

beforeEach(() => {
  recordSnapshotMock.mockClear();
  loadSnapshotsMock.mockClear();
  loadSnapshotsMock.mockResolvedValue([]);
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
      // handleSave is async with an awaited loadSnapshots() call —
      // need to flush enough microtasks for both the load and the
      // recordSnapshot call to settle. waitFor would be cleaner
      // but works against the fake-timers we installed at the top.
      for (let i = 0; i < 8; i++) await Promise.resolve();
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

  it("Exit flow: discards without writing (two-stage confirm)", () => {
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    const startRev = useAppStore.getState().snapshotsRevision;
    render(<TimeTravelBanner />);
    // R5 audit BLOCK: Exit is now two-stage. First click ARMS the
    // confirmation (button flips to "Confirm discard?"); second
    // click within 4s actually exits. Single-click no longer
    // discards an entire session's edits accidentally.
    const exitBtn = screen.getByRole("button", {
      name: /Discard all time-travel edits/i,
    });
    act(() => {
      fireEvent.click(exitBtn);
    });
    // After first click, still active — confirmation pending.
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    const confirmBtn = screen.getByRole("button", {
      name: /Confirm: discard all time-travel edits/i,
    });
    act(() => {
      fireEvent.click(confirmBtn);
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

  it("beforeunload listener registered while active, removed on exit (audit UI#7 regression pin)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    const { unmount } = render(<TimeTravelBanner />);
    // beforeunload registered when active.
    expect(
      addSpy.mock.calls.some((args) => args[0] === "beforeunload"),
    ).toBe(true);
    // Exit and check removal.
    act(() => {
      useAppStore.getState().exitTimeTravelDiscard();
    });
    expect(
      removeSpy.mock.calls.some((args) => args[0] === "beforeunload"),
    ).toBe(true);
    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("Collision: detects existing snapshot at t and shows overwrite prompt (audit fix #3)", async () => {
    // When the user backdates to a date that already has a
    // snapshot (auto OR manual), the banner must NOT silently
    // overwrite — it shows an inline confirmation prompt with
    // the existing row's metadata.
    loadSnapshotsMock.mockResolvedValue([
      {
        t: Date.UTC(2023, 5, 15, 12),
        netWorthUSD: 100_000,
        source: "auto",
      },
    ] as never);
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    render(<TimeTravelBanner />);
    const saveBtn = screen.getByRole("button", {
      name: /Save the current state/i,
    });
    await act(async () => {
      fireEvent.click(saveBtn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    // No write yet — overwrite prompt instead.
    expect(recordSnapshotMock).not.toHaveBeenCalled();
    // Prompt visible with "monthly auto" classification + Overwrite + Keep buttons.
    expect(screen.getByText(/monthly auto/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Confirm overwrite/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Cancel overwrite/i }),
    ).toBeTruthy();
    // Click "Overwrite" to confirm.
    const overwriteBtn = screen.getByRole("button", {
      name: /Confirm overwrite/i,
    });
    await act(async () => {
      fireEvent.click(overwriteBtn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(recordSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("EditingSnapshotT: bypasses collision dialog and overwrites the existing row directly (user-reported)", async () => {
    // When the user entered via "Time-travel edit" on an existing
    // snapshot, the banner SKIPS the collision prompt (they
    // explicitly chose to overwrite) and saves directly to the
    // snapshot's primary key.
    loadSnapshotsMock.mockResolvedValue([
      {
        t: Date.UTC(2023, 5, 15, 12),
        netWorthUSD: 100_000,
        source: "manual",
        label: "Original",
      },
    ] as never);
    act(() => {
      // Simulate entering via enterTimeTravelEditingSnapshot:
      // editingSnapshotT is set to the snapshot's primary key.
      useAppStore.setState({
        timeTravelActive: true,
        timeTravelDate: "2023-06-15",
        editingSnapshotT: Date.UTC(2023, 5, 15, 12),
        baselineHousehold: useAppStore.getState().household,
        baselineAssumptions: useAppStore.getState().assumptions,
      });
    });
    render(<TimeTravelBanner />);
    const saveBtn = screen.getByRole("button", {
      name: /Save changes to the existing snapshot/i,
    });
    await act(async () => {
      fireEvent.click(saveBtn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    // Recorded once — straight overwrite, no collision prompt.
    expect(recordSnapshotMock).toHaveBeenCalledTimes(1);
    const arg = recordSnapshotMock.mock.calls[0][0] as { t: number };
    // Uses the existing snapshot's primary key (editingSnapshotT)
    // — NOT the parsed-from-string date.
    expect(arg.t).toBe(Date.UTC(2023, 5, 15, 12));
    // Session exited.
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });

  it("EditingSnapshotT: button label changes to 'Save changes' (UX cue)", () => {
    act(() => {
      useAppStore.setState({
        timeTravelActive: true,
        timeTravelDate: "2023-06-15",
        editingSnapshotT: Date.UTC(2023, 5, 15, 12),
        baselineHousehold: useAppStore.getState().household,
        baselineAssumptions: useAppStore.getState().assumptions,
      });
    });
    render(<TimeTravelBanner />);
    expect(
      screen.queryByRole("button", { name: /Save the current state/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Save changes to the existing snapshot/i,
      }),
    ).toBeTruthy();
    // Banner copy is "EDITING SNAPSHOT" not "BACKDATING".
    expect(screen.getByText(/EDITING SNAPSHOT/i)).toBeTruthy();
  });

  it("Collision: 'Keep existing' cancels without writing and stays in session", async () => {
    loadSnapshotsMock.mockResolvedValue([
      {
        t: Date.UTC(2023, 5, 15, 12),
        netWorthUSD: 100_000,
        source: "manual",
        label: "Pre-promotion",
      },
    ] as never);
    act(() => {
      useAppStore.getState().enterTimeTravel("2023-06-15");
    });
    render(<TimeTravelBanner />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Save the current state/i }),
      );
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    // Existing-snapshot label surfaced in the prompt copy.
    expect(screen.getByText(/Pre-promotion/i)).toBeTruthy();
    // Click "Keep existing".
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Cancel overwrite/i }),
      );
    });
    expect(recordSnapshotMock).not.toHaveBeenCalled();
    // Session still active so the user can pick a different date.
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    // Save button visible again.
    expect(
      screen.getByRole("button", { name: /Save the current state/i }),
    ).toBeTruthy();
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
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(recordSnapshotMock).not.toHaveBeenCalled();
    // Session still active (no exit on malformed parse).
    expect(useAppStore.getState().timeTravelActive).toBe(true);
  });
});
