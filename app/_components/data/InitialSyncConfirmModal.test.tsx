// @vitest-environment jsdom
/**
 * InitialSyncConfirmModal — the Layer 2 confirmation modal that
 * asks the user before pushing to Drive on initial sign-in.
 *
 * Pins the contract:
 *   - Modal closes ONLY after a successful push (otherwise the
 *     in-modal error is lost — the user sees nothing actionable).
 *   - Push failure leaves the modal open with the error visible
 *     so the user can retry (or cancel via Skip for now).
 *   - Skip for now defers without pushing AND sets googleLastSyncAt
 *     so the next debounce-push isn't blocked-by-initial-sync.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock pushToDrive BEFORE the component imports it.
vi.mock("@/lib/sync/cloudSync", () => ({
  pushToDrive: vi.fn(),
}));

import { InitialSyncConfirmModal } from "./InitialSyncConfirmModal";
import { useAppStore } from "@/lib/store";
import { pushToDrive } from "@/lib/sync/cloudSync";

const pushToDriveMock = vi.mocked(pushToDrive);

function resetSyncState() {
  useAppStore.setState({
    pendingInitialSyncConfirm: false,
    googleSyncError: null,
    googleSyncBlockedReason: null,
    googleLastSyncAt: null,
    lastSyncOutcome: null,
    googleSyncing: false,
  });
}

beforeEach(() => {
  resetSyncState();
  pushToDriveMock.mockReset();
});

afterEach(() => {
  cleanup();
  resetSyncState();
});

describe("InitialSyncConfirmModal — gated rendering", () => {
  it("renders nothing when pendingInitialSyncConfirm is false", () => {
    const { container } = render(<InitialSyncConfirmModal />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog when pendingInitialSyncConfirm is true", () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    render(<InitialSyncConfirmModal />);
    expect(
      screen.getByRole("dialog", { name: /Push current data to Drive/i }),
    ).toBeTruthy();
  });
});

describe("InitialSyncConfirmModal — Skip for now path", () => {
  it("clears pendingInitialSyncConfirm and sets googleLastSyncAt so debounce-push is unblocked", () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    render(<InitialSyncConfirmModal />);

    const before = useAppStore.getState().googleLastSyncAt;
    expect(before).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Skip the initial Drive sync/i }));
    });

    const after = useAppStore.getState();
    expect(after.pendingInitialSyncConfirm).toBe(false);
    expect(after.googleLastSyncAt).not.toBeNull();
    expect(pushToDriveMock).not.toHaveBeenCalled();
  });
});

describe("InitialSyncConfirmModal — Push success path", () => {
  it("closes the modal and marks lastSyncOutcome on a successful push", async () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    pushToDriveMock.mockResolvedValueOnce("ok");

    render(<InitialSyncConfirmModal />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Push current local data to Drive/i }));
    });

    const s = useAppStore.getState();
    expect(s.pendingInitialSyncConfirm).toBe(false);
    expect(s.lastSyncOutcome).toBe("uploaded-local");
    expect(pushToDriveMock).toHaveBeenCalledWith(useAppStore, {
      bypassInitialSyncGate: true,
    });
  });
});

describe("InitialSyncConfirmModal — Push failure path (the bug under audit)", () => {
  it("keeps the modal OPEN on failed push so the user can see the error and retry", async () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    pushToDriveMock.mockResolvedValueOnce("error");

    render(<InitialSyncConfirmModal />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Push current local data to Drive/i }));
    });

    // Modal MUST remain open so the user sees the inline error
    // text and can retry. The pre-fix code cleared
    // pendingInitialSyncConfirm BEFORE the push, so a failure
    // would unmount the modal and lose the error UX.
    expect(useAppStore.getState().pendingInitialSyncConfirm).toBe(true);
    expect(
      screen.getByRole("dialog", { name: /Push current data to Drive/i }),
    ).toBeTruthy();
    // Inline error is rendered.
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps the modal OPEN when pushToDrive throws unexpectedly", async () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    pushToDriveMock.mockRejectedValueOnce(new Error("network blew up"));

    render(<InitialSyncConfirmModal />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Push current local data to Drive/i }));
    });

    expect(useAppStore.getState().pendingInitialSyncConfirm).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/network blew up/i);
  });

  it("allows the user to retry after a failure (second Push attempt is honored)", async () => {
    act(() => {
      useAppStore.setState({ pendingInitialSyncConfirm: true });
    });
    pushToDriveMock.mockResolvedValueOnce("error");
    pushToDriveMock.mockResolvedValueOnce("ok");

    render(<InitialSyncConfirmModal />);
    const pushButton = screen.getByRole("button", {
      name: /Push current local data to Drive/i,
    });

    await act(async () => {
      fireEvent.click(pushButton);
    });
    expect(useAppStore.getState().pendingInitialSyncConfirm).toBe(true);

    await act(async () => {
      fireEvent.click(pushButton);
    });
    expect(useAppStore.getState().pendingInitialSyncConfirm).toBe(false);
    expect(useAppStore.getState().lastSyncOutcome).toBe("uploaded-local");
    expect(pushToDriveMock).toHaveBeenCalledTimes(2);
  });
});
