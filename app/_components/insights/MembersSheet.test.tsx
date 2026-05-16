// @vitest-environment jsdom
/**
 * MembersSheet — focused tests for the include-in-rollup toggle.
 *
 * What's pinned here:
 *   1. Each row renders a switch (role="switch") whose
 *      aria-checked tracks the persisted flag.
 *   2. The accessible name of the switch comes from the visible
 *      label "Include in household rollups" — sighted + SR users
 *      hear/see the same words. (Regression guard against a
 *      future refactor swapping the labeled-button pattern for
 *      an unlabeled icon toggle.)
 *   3. Helper copy reflects state — "rolls up..." when on,
 *      "Set aside..." when off, "At least one member must
 *      stay..." when locked. Mobile users can't see tooltips,
 *      so the explanation has to be in the visible UI.
 *   4. Clicking the switch dispatches `setMemberIncludeInRollup`
 *      with the inverted value.
 *   5. The switch is DOM-disabled on the last active member (so
 *      the rollup can never be emptied via the UI), AND the
 *      copy explains WHY rather than going silent.
 *   6. The "{N of M} members included in rollups" subtitle on
 *      the sheet header appears only when at least one member
 *      is excluded — the steady-state header stays uncluttered.
 *   7. Income / age inputs do NOT dim when a member is excluded
 *      — the user still needs to read + edit those values, and
 *      the labeled toggle row already communicates the state.
 *      (Regression guard against bringing back the opacity dim
 *      that made inputs hard to read.)
 *
 * These tests drive the real Zustand store via `setState` rather
 * than mocking it — the wiring between selectors and actions is
 * part of what we want to validate, and a mock would let
 * regressions slip through (wrong selector key, action renamed,
 * subscription path broken).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { MembersSheet } from "./MembersSheet";
import type { Household } from "@/lib/types";

function seed(household: Household) {
  useAppStore.setState({
    household,
    managingMembers: true,
  });
}

afterEach(() => {
  cleanup();
  useAppStore.setState({ managingMembers: false });
});

describe("MembersSheet · include-in-rollup toggle", () => {
  it("renders one switch per member with aria-checked tracking the flag", () => {
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" }, // implicit included
        { id: "m2", displayName: "Bob", includeInRollup: true },
        { id: "m3", displayName: "Cara", includeInRollup: false },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    expect(switches[1]).toHaveAttribute("aria-checked", "true");
    expect(switches[2]).toHaveAttribute("aria-checked", "false");
  });

  it("each switch carries the visible 'Include in household rollups' label", () => {
    // Name-from-contents pattern: the role="switch" button wraps
    // its visible label, so the accessible name is computed from
    // the label text. Sighted + SR users get the same words —
    // no parallel aria-label string to drift out of sync.
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);

    const switches = screen.getAllByRole("switch", {
      name: /include in household rollups/i,
    });
    expect(switches).toHaveLength(2);
  });

  it("helper copy reflects the included state", () => {
    // Two members so neither is the "last active" — that branch
    // is exercised by its own test below; this one pins the
    // steady-state included copy.
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);
    // Two rows, two switches → matched twice.
    expect(
      screen.getAllByText(
        /Income, age, and blended assumptions roll up to household totals/i,
      ),
    ).toHaveLength(2);
  });

  it("helper copy reflects the excluded state", () => {
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob", includeInRollup: false },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);
    expect(
      screen.getByText(
        /Set aside — not counted in household rollups\. Underlying data is preserved\./i,
      ),
    ).toBeInTheDocument();
  });

  it("helper copy explains WHY the switch is locked on the last active member", () => {
    // Bob is the only active member; flipping him off would
    // empty the rollup. Disabled toggles that go silent are bad
    // UX — the user shouldn't have to guess why the control
    // doesn't respond. Helper copy explains the rule.
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex", includeInRollup: false },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);
    expect(
      screen.getByText(
        /At least one member must stay in rollups\. Enable another to switch off\./i,
      ),
    ).toBeInTheDocument();
  });

  it("clicking a switch flips includeInRollup in the store", () => {
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]); // toggle Bob off

    const members = useAppStore.getState().household.members;
    expect(members[1].includeInRollup).toBe(false);
  });

  it("disables the switch on the last active member", () => {
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex", includeInRollup: false },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);

    const switches = screen.getAllByRole("switch");
    // m1 is OFF — its switch must remain ENABLED so the user can
    // turn them back on.
    expect(switches[0]).not.toBeDisabled();
    // m2 is the last active — its switch must be DISABLED so the
    // user can't accidentally empty the rollup.
    expect(switches[1]).toBeDisabled();
  });

  it("shows the '{N of M} included' subtitle only when some are excluded", () => {
    // All-included → no subtitle (steady-state header stays clean).
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [],
      liabilities: [],
    });
    const { rerender } = render(<MembersSheet />);
    expect(screen.queryByText(/included in rollups$/i)).toBeNull();

    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        { id: "m2", displayName: "Bob", includeInRollup: false },
      ],
      accounts: [],
      liabilities: [],
    });
    rerender(<MembersSheet />);
    expect(
      screen.getByText(/1 of 2 members included in rollups/i),
    ).toBeInTheDocument();
  });

  it("does NOT dim the income / age inputs when a member is excluded", () => {
    // Regression guard: a previous version dimmed the inputs to
    // opacity-50 when the row was excluded, which made them hard
    // to read AND to edit. The new design conveys exclusion via
    // the labeled toggle row, not by visually muting unrelated
    // controls.
    seed({
      id: "h",
      members: [
        { id: "m1", displayName: "Alex" },
        {
          id: "m2",
          displayName: "Bob",
          incomeUSD: 100_000,
          age: 40,
          includeInRollup: false,
        },
      ],
      accounts: [],
      liabilities: [],
    });
    render(<MembersSheet />);

    // Find Bob's income / age inputs and assert no opacity class
    // is applied to them or to their containing grid.
    const incomeInputs = screen.getAllByDisplayValue("100000");
    expect(incomeInputs.length).toBeGreaterThan(0);
    for (const el of incomeInputs) {
      // Walk up two levels (input → label-span → grid) checking
      // none carry an opacity-* utility class. We assert against
      // the literal substring rather than reading computed styles
      // because Tailwind classes are what we control directly.
      let node: HTMLElement | null = el;
      for (let i = 0; node && i < 3; i++) {
        expect(node.className).not.toMatch(/opacity-(?!100\b)\d/);
        node = node.parentElement;
      }
    }
  });
});
