// @vitest-environment jsdom
/**
 * AccountEditor — focused tests for the category dropdown's hint copy.
 *
 * What's pinned here:
 *   1. Selecting "Trump Account" surfaces the explanatory hint
 *      beneath the category dropdown ("Launched July 4, 2026 — every
 *      American newborn child gets a free $1,000…").
 *   2. Categories that have no hint don't render a stray empty
 *      element (Brokerage is the regression case — without the
 *      truthy-check on CATEGORY_HINTS[category], a bare <div /> would
 *      have leaked into the DOM).
 *   3. "Trump Account" sits directly below "529" in the dropdown
 *      order — the user-visible category order is part of the
 *      contract.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { AccountEditor } from "./AccountEditor";
import { DEMO_HOUSEHOLD } from "@/lib/demo";

function seedCreatingAccount() {
  // Editor renders in "creating new account" mode when creatingAccount
  // is true and household + members are populated.
  useAppStore.setState({
    household: DEMO_HOUSEHOLD,
    creatingAccount: true,
    editingAccountId: null,
  });
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ creatingAccount: false, editingAccountId: null });
});

describe("AccountEditor · category dropdown", () => {
  it("renders 'Trump Account' directly after '529' in the dropdown order", () => {
    seedCreatingAccount();
    render(<AccountEditor />);
    const options = Array.from(
      screen.getByRole("combobox", {
        name: /category/i,
      }) as HTMLSelectElement,
    ) as unknown as HTMLOptionElement[];
    // getByRole on a <select> returns the element itself; iterate via
    // its options list for ordering checks.
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    const idx529 = labels.indexOf("529");
    const idxTrump = labels.indexOf("Trump Account");
    expect(idx529).toBeGreaterThan(-1);
    expect(idxTrump).toBe(idx529 + 1);
    // Reference `options` so the unused-locals lint doesn't fire on
    // the typed-cast above (kept for documentation-of-intent value).
    void options;
  });

  it("surfaces the launch / opt-in hint when 'Trump Account' is selected", () => {
    seedCreatingAccount();
    render(<AccountEditor />);
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "TRUMP_ACCOUNT" } });
    const hint = screen.getByTestId("category-hint-TRUMP_ACCOUNT");
    expect(hint.textContent).toMatch(/Launched July 4, 2026/);
    expect(hint.textContent).toMatch(/\$1,000/);
    expect(hint.textContent).toMatch(/opt-in/i);
  });

  it("does not render a hint element for categories without one", () => {
    seedCreatingAccount();
    render(<AccountEditor />);
    // Default is Brokerage — no hint configured.
    expect(screen.queryByTestId("category-hint-BROKERAGE")).toBeNull();
    expect(screen.queryByTestId(/^category-hint-/)).toBeNull();
  });
});
