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

describe("EnterTimeTravelModal — inline validation (no disabled-button no-op)", () => {
  it("shows an inline error for a future date (DevTools / keyboard bypass of max= attribute)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2099-01-01" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /today or earlier/i,
    );
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });

  it("shows an inline error for an invalid calendar date (Feb 31 silently normalizes)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2024-02-31" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /valid date|YYYY-MM-DD/i,
    );
    expect(useAppStore.getState().timeTravelActive).toBe(false);
  });

  it("shows an inline error for a malformed date string (wrong shape)", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "abcd" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(screen.getByRole("alert").textContent).toMatch(/YYYY-MM-DD/i);
  });

  it("succeeds for a valid past date (button always firing, no disabled trap)", () => {
    const onClose = vi.fn();
    render(<EnterTimeTravelModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2020-01-15" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    expect(useAppStore.getState().timeTravelDate).toBe("2020-01-15");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("succeeds for TODAY's date at 3am UTC (user-reported no-op regression pin)", () => {
    // The button-no-op symptom: prior implementation disabled
    // the button when the parsed-noon-UTC of today was greater
    // than Date.now() (i.e. user clicking before noon UTC).
    // With the new flow: button is always clickable, validation
    // is lexicographic on date strings, today is always valid.
    vi.setSystemTime(new Date("2024-06-15T03:00:00Z"));
    const onClose = vi.fn();
    const { rerender } = render(
      <EnterTimeTravelModal open onClose={onClose} />,
    );
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(useAppStore.getState().timeTravelActive).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<EnterTimeTravelModal open={false} onClose={onClose} />);
  });

  it("error message clears when user picks a new (valid) date", () => {
    render(<EnterTimeTravelModal open onClose={() => {}} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2099-01-01" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    // Pick a valid date — error should clear via useEffect.
    act(() => {
      fireEvent.change(input, { target: { value: "2020-01-01" } });
    });
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("Confirm with future date surfaces inline error (button always clickable)", () => {
    const onClose = vi.fn();
    render(<EnterTimeTravelModal open onClose={onClose} />);
    const input = screen.getByLabelText(/Date to backdate to/i) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "2099-01-01" } });
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /Enter time-travel/i }),
      );
    });
    expect(useAppStore.getState().timeTravelActive).toBe(false);
    expect(screen.getByRole("alert")).toBeTruthy();
    // onClose NOT called because validation failed.
    expect(onClose).not.toHaveBeenCalled();
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
