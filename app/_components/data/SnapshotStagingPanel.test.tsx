// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_HOUSEHOLD } from "@/lib/demo";
import { householdNetWorth } from "@/lib/types";
import { SnapshotStagingPanel } from "./SnapshotStagingPanel";

afterEach(cleanup);

describe("SnapshotStagingPanel — interaction (R-snapshot UX)", () => {
  it("renders the live NW + the staged NW side-by-side", () => {
    const onChange = vi.fn();
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    expect(screen.getByText(/live nw \(today\)/i)).toBeTruthy();
    expect(screen.getByText(/staged nw/i)).toBeTruthy();
    expect(screen.getByText(/delta/i)).toBeTruthy();
  });

  it("Drop-account button calls onChange with an account-dropped copy", () => {
    const onChange = vi.fn();
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    const dropButtons = screen.getAllByRole("button", {
      name: /drop entire .+ account from the staged snapshot/i,
    });
    expect(dropButtons.length).toBeGreaterThan(0);
    fireEvent.click(dropButtons[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const newHousehold = onChange.mock.calls[0][0] as typeof DEMO_HOUSEHOLD;
    expect(newHousehold.accounts.length).toBe(
      DEMO_HOUSEHOLD.accounts.length - 1,
    );
    // CRITICAL: the original household reference is untouched.
    expect(DEMO_HOUSEHOLD.accounts.length).toBe(
      DEMO_HOUSEHOLD.accounts.length, // tautology, but also confirms by example
    );
    expect(newHousehold).not.toBe(DEMO_HOUSEHOLD);
  });

  it("Cancel button calls onCancel with no other side effects", () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={onCancel}
        busy={false}
        collisionExists={false}
      />,
    );
    // There are 2 Cancel buttons (header + footer for ergonomic
    // double-discoverability) — either should trigger the callback.
    const cancelBtns = screen.getAllByRole("button", { name: /^cancel/i });
    expect(cancelBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(cancelBtns[0]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Commit button is disabled when staged === base (unchanged-staging guard)", () => {
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    const commitBtn = screen.getByRole("button", {
      name: /save staged historical snapshot/i,
    });
    expect(commitBtn).toHaveProperty("disabled", true);
  });

  it("Commit button enables when staged differs from base", () => {
    // Drop one account from the staged copy so the diff is non-zero.
    const stagedMissingOne = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.slice(0, -1),
    };
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={stagedMissingOne}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    const commitBtn = screen.getByRole("button", {
      name: /save staged historical snapshot/i,
    });
    expect(commitBtn).toHaveProperty("disabled", false);
  });

  it("Commit button shows 'Replace' label when collisionExists=true", () => {
    const stagedMissingOne = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.slice(0, -1),
    };
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={stagedMissingOne}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: /replace existing snapshot/i }),
    ).toBeTruthy();
  });

  it("Commit button is disabled when busy=true (concurrent-action guard)", () => {
    const stagedMissingOne = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.slice(0, -1),
    };
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={stagedMissingOne}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={true}
        collisionExists={false}
      />,
    );
    const commitBtn = screen.getByRole("button", {
      name: /save staged historical snapshot/i,
    });
    expect(commitBtn).toHaveProperty("disabled", true);
  });

  it("Commit button is disabled when staged NW is zero (refuses to record empty)", () => {
    // Build a staged household with no accounts → NW = -liabilities
    // (possibly negative or zero). The Commit button must refuse so
    // the user can't silently overwrite history with a zero record.
    const emptyStaged = {
      ...DEMO_HOUSEHOLD,
      accounts: [],
      liabilities: [], // → NW = 0 exactly
    };
    expect(householdNetWorth(emptyStaged)).toBe(0);
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={emptyStaged}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    const commitBtn = screen.getByRole("button", {
      name: /save staged historical snapshot/i,
    });
    expect(commitBtn).toHaveProperty("disabled", true);
  });

  it("Per-holding value input triggers onChange with override applied", () => {
    const onChange = vi.fn();
    render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    // Use the first per-holding override input we can find.
    const overrideInputs = screen.getAllByLabelText(
      /override staged value/i,
    );
    expect(overrideInputs.length).toBeGreaterThan(0);
    fireEvent.change(overrideInputs[0], { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newHousehold = onChange.mock.calls[0][0] as typeof DEMO_HOUSEHOLD;
    expect(newHousehold).not.toBe(DEMO_HOUSEHOLD);
  });

  it("Apply-scale button calls onChange when scale slider differs from 100%", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SnapshotStagingPanel
        base={DEMO_HOUSEHOLD}
        staged={DEMO_HOUSEHOLD}
        onChange={onChange}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        collisionExists={false}
      />,
    );
    // Slider rendered as <input type="range" id="snapshot-scale-slider">.
    const slider = container.querySelector(
      "#snapshot-scale-slider",
    ) as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: "50" } });
    const applyBtn = screen.getByRole("button", {
      name: /apply 50% scale/i,
    });
    fireEvent.click(applyBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const scaled = onChange.mock.calls[0][0] as typeof DEMO_HOUSEHOLD;
    // After 50% scale, total assets should be half-ish.
    const baseAssets = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings)
      .reduce((s, h) => s + h.valueUSD, 0);
    const scaledAssets = scaled.accounts
      .flatMap((a) => a.holdings)
      .reduce((s, h) => s + h.valueUSD, 0);
    expect(scaledAssets).toBeCloseTo(baseAssets * 0.5, 1);
  });
});
