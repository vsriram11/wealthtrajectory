// @vitest-environment jsdom
/**
 * EnterTimeTravelModal — confirmation modal that begins a
 * time-travel backdating session. Pins the date-validation
 * logic, focus behavior, and the underlying enterTimeTravel
 * slice action it dispatches.
 *
 * Heavy on input-validation coverage because the date input
 * is the user's only entry point to the time-travel mode,
 * and a malformed/future date that leaked past validation
 * would land the app in an invalid session state.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnterTimeTravelModal } from "./EnterTimeTravelModal";
import { useAppStore } from "@/lib/store";

function resetStore() {
  useAppStore.setState({
    mode: "real",
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
  });
}

beforeEach(() => {
  resetStore();
  // Fixed clock so the "max date = today" + "future-date refuse"
  // tests are deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetStore();
});

describe("EnterTimeTravelModal — gated rendering", () => {
  it("renders null when open=false", () => {
    const { container } = render(
      <EnterTimeTravelModal open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog when open=true with sensible defaults", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: /Backdate snapshot/i }),
    ).toBeTruthy();
    // Date input defaults to today.
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    expect(input.value).toBe("2024-06-15");
    // Confirm button is enabled (today's date is valid).
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("EnterTimeTravelModal — date validation (audit fix UI#5)", () => {
  it("disables Confirm for a future date (DevTools / keyboard bypass of max= attribute)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2099-01-01" } });
    });
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("disables Confirm for an invalid calendar date (Feb 31 silently normalizes)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2024-02-31" } });
    });
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("disables Confirm for a malformed date string (wrong shape)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      // Browsers normally prevent this via type=date, but
      // some setups allow it. Defense in depth.
      fireEvent.change(input, { target: { value: "abcd" } });
    });
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("enables Confirm for a valid past date", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2020-01-15" } });
    });
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("enables Confirm for TODAY's date even when current wall clock is BEFORE noon UTC (audit fix — user-reported button no-op)", () => {
    // CRITICAL bug surfaced by user: "Pressing 'enter time travel
    // mode' for snapshots does not work; button is a no-op."
    // Root cause: isValidISO compared the parsed t (anchored to
    // noon UTC) against Date.now() at moment-precision. For a
    // user clicking the modal before noon UTC, today's default
    // date parsed to today-noon-UTC which was IN THE FUTURE,
    // returning false → Confirm permanently disabled → no-op.
    // Fix: lexicographic date-string comparison against
    // today's UTC date. Today is always valid.
    vi.setSystemTime(new Date("2024-06-15T03:00:00Z")); // 3am UTC
    const { rerender } = render(
      <EnterTimeTravelModal open onClose={() => {}} />,
    );
    // Default input value is today (2024-06-15). Confirm must be
    // enabled even though current wall clock is hours before noon.
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    expect(input.value).toBe("2024-06-15");
    expect(
      (
        screen.getByRole("button", { name: /Enter time-travel/i }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    rerender(<EnterTimeTravelModal open={false} onClose={() => {}} />);
  });
});

describe("EnterTimeTravelModal — flow control", () => {
  it("Confirm dispatches enterTimeTravel + closes the modal", () => {
    const onClose = vi.fn();
    render(<EnterTimeTravelModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2023-06-15" } });
    });
    const confirmBtn = screen.getByRole("button", {
      name: /Enter time-travel/i,
    });
    act(() => {
      fireEvent.click(confirmBtn);
    });
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    expect(useAppStore.getState().timeTravelDate).toBe("2023-06-15");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Confirm with future date is a no-op (defense in depth — button disabled, but if styles bypass it)", () => {
    const onClose = vi.fn();
    render(<EnterTimeTravelModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2099-01-01" } });
    });
    const confirmBtn = screen.getByRole("button", {
      name: /Enter time-travel/i,
    });
    // Even if we force-click a disabled button (shouldn't be
    // possible normally, but a styling bug could allow it), the
    // handleConfirm internally re-checks isValidISO and refuses.
    act(() => {
      fireEvent.click(confirmBtn);
    });
    expect(useAppStore.getState().timeTravelActive).toBe(false);
    // onClose may or may not have been called by the click — the
    // session state is the load-bearing assertion.
  });

  it("Cancel closes without dispatching enterTimeTravel", () => {
    const onClose = vi.fn();
    render(<EnterTimeTravelModal open onClose={onClose} />);
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    act(() => {
      fireEvent.click(cancelBtn);
    });
    expect(useAppStore.getState().timeTravelActive).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key closes the modal", () => {
    const onClose = vi.fn();
    const { container } = render(
      <EnterTimeTravelModal open onClose={onClose} />,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    act(() => {
      fireEvent.keyDown(dialog!, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });
});

describe("EnterTimeTravelModal — entry works in any mode (slice gate removed)", () => {
  it("Confirm in DEMO mode also succeeds (UI gate is load-bearing, not the slice)", () => {
    // The slice-level mode gate was removed after a user-reported
    // no-op bug; SnapshotsManager's UI gate (render-null in demo)
    // is the load-bearing protection. The slice now accepts entry
    // regardless of mode — which is the correct behavior given the
    // upstream gate keeps the modal from opening in demo.
    useAppStore.setState({ mode: "demo" });
    render(<EnterTimeTravelModal open onClose={vi.fn()} />);
    const confirmBtn = screen.getByRole("button", {
      name: /Enter time-travel/i,
    });
    act(() => {
      fireEvent.click(confirmBtn);
    });
    expect(useAppStore.getState().timeTravelActive).toBe(true);
  });
});
