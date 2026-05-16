// @vitest-environment jsdom
/**
 * NormalizedSliderGroup is the generic "n sliders that sum to
 * 100%" editor used by bond-type / geography / commodity
 * sub-editors. The tests pin the user-visible contracts:
 *
 *   1. Each entry renders with its label + value-as-percent
 *      pre-filled in the visible spinner.
 *   2. Moving a slider dispatches `onChange` with the next
 *      allocation, preserving siblings.
 *   3. The "Sum: X%" indicator reflects the current allocation
 *      total and colors itself based on the normalized check.
 *   4. The "Normalize" button is disabled when sum is 0 or
 *      already 1; clicking it rescales every entry so the sum
 *      becomes exactly 1.
 *   5. Negative slider inputs are clamped to 0 (the engine
 *      assumes non-negative weights).
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NormalizedSliderGroup } from "./NormalizedSliderGroup";

type BondKey = "government" | "corporate";
const BOND_ENTRIES = [
  { key: "government" as const, label: "Government" },
  { key: "corporate" as const, label: "Corporate" },
];

describe("NormalizedSliderGroup", () => {
  it("renders one row per entry with the label visible", () => {
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.5, corporate: 0.5 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Government")).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
  });

  it("shows the current sum as a percentage", () => {
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.4, corporate: 0.3 }}
        onChange={() => {}}
      />,
    );
    // 0.4 + 0.3 = 0.7 → "Sum: 70.0%"
    expect(screen.getByText(/Sum: 70\.0%/)).toBeInTheDocument();
  });

  it("disables the Normalize button when the sum is already 100%", () => {
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.6, corporate: 0.4 }}
        onChange={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /Normalize/i });
    expect(btn).toBeDisabled();
  });

  it("disables the Normalize button when the sum is 0 (no signal to rescale)", () => {
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0, corporate: 0 }}
        onChange={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /Normalize/i });
    // Sum = 0 → dividing-by-zero rescale would be nonsense; the
    // button must stay disabled until the user provides some
    // signal to scale.
    expect(btn).toBeDisabled();
  });

  it("enables the Normalize button when sum is positive but not 100%", () => {
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.3, corporate: 0.4 }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Normalize/i }),
    ).not.toBeDisabled();
  });

  it("clicking Normalize dispatches a rescaled allocation that sums to ~1", () => {
    const onChange = vi.fn();
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.3, corporate: 0.6 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Normalize/i }));
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as Record<BondKey, number>;
    // Rescaled: 0.3/0.9 = 0.333, 0.6/0.9 = 0.667
    expect(next.government).toBeCloseTo(0.3 / 0.9, 6);
    expect(next.corporate).toBeCloseTo(0.6 / 0.9, 6);
    // The whole point: post-normalize sum is exactly 1.0
    // (modulo float noise). Engine consumers depend on this.
    expect(next.government + next.corporate).toBeCloseTo(1, 6);
  });

  it("moving a slider lifts the new allocation up via onChange (with sibling preserved)", () => {
    const onChange = vi.fn();
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.5, corporate: 0.5 }}
        onChange={onChange}
      />,
    );
    // Each row has 2 inputs (range slider + number spinner).
    // Grab the range inputs in order.
    const ranges = screen.getAllByRole("slider");
    fireEvent.change(ranges[0], { target: { value: "80" } });
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as Record<BondKey, number>;
    // 80% → 0.8 on the changed slot; sibling unchanged.
    expect(next.government).toBeCloseTo(0.8, 6);
    expect(next.corporate).toBe(0.5);
  });

  it("clamps negative slider input to 0", () => {
    // The setKey helper clamps negative inputs via Math.max(0, …).
    // The slider's min=0 prevents the UI from reaching negatives,
    // but a synthetic value can still drive it. Pin the clamp.
    const onChange = vi.fn();
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.5, corporate: 0.5 }}
        onChange={onChange}
      />,
    );
    const ranges = screen.getAllByRole("slider");
    fireEvent.change(ranges[0], { target: { value: "-25" } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as Record<BondKey, number>;
    expect(next.government).toBe(0);
  });

  it("Normalize on a single non-zero entry produces 100% on that entry", () => {
    const onChange = vi.fn();
    render(
      <NormalizedSliderGroup<BondKey>
        entries={BOND_ENTRIES}
        allocation={{ government: 0.5, corporate: 0 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Normalize/i }));
    const next = onChange.mock.calls[0][0] as Record<BondKey, number>;
    expect(next.government).toBeCloseTo(1, 6);
    expect(next.corporate).toBe(0);
  });
});
