// @vitest-environment jsdom
/**
 * NumberField is the controlled-by-value number input every form
 * in the app reaches for when the parent state is numeric but the
 * user needs to type incrementally (backspace through digits,
 * type "-", type "." before a fractional). The trickiness is
 * that it keeps its own string buffer alongside the parent's
 * numeric value — these tests pin the contracts that keep them
 * in sync without stomping in-progress edits.
 *
 * Contracts pinned:
 *   1. Initial render shows the formatted parent value.
 *   2. Typing valid digits dispatches the parsed number upward.
 *   3. Pattern guard rejects characters that don't fit the
 *      decimal/integer mask without dispatching.
 *   4. allowNegative=false rejects "-".
 *   5. Empty-string buffer doesn't dispatch (parent stays put).
 *   6. Blur with an unparseable buffer snaps back to the parent
 *      value's formatted form.
 *   7. Parent-controlled value change resyncs the buffer ONLY
 *      when the buffer doesn't already represent that number.
 *   8. readOnly: typing is a no-op.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberField } from "./NumberField";

describe("NumberField", () => {
  it("renders the formatted parent value as initial input text", () => {
    render(
      <NumberField value={1234.5678} onChange={() => {}} ariaLabel="amount" />,
    );
    expect(screen.getByLabelText("amount")).toHaveValue("1234.5678");
  });

  it("trims trailing zeros via toFixed(precision)", () => {
    // value 100.5 with precision 4 → toFixed("100.5000") → toString → "100.5"
    render(
      <NumberField
        value={100.5}
        onChange={() => {}}
        precision={4}
        ariaLabel="amount"
      />,
    );
    expect(screen.getByLabelText("amount")).toHaveValue("100.5");
  });

  it("dispatches the parsed number on each valid digit input", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={0} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "42" } });
    // The contract: every successfully-parsed input fires
    // onChange with the new number. Catches a regression that
    // dropped to onBlur-only updates (would lag every consumer's
    // derived state by one keystroke).
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("dispatches floats correctly (e.g. 1.5)", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={0} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenLastCalledWith(1.5);
  });

  it("rejects non-numeric input via the pattern guard", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={10} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "abc" } });
    // Pattern test fails → no setStr, no onChange. The buffer
    // stays at the original "10" formatted value.
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("10");
  });

  it("allows '-' when allowNegative is true (default)", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={0} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "-" } });
    // Buffer accepts the dash; no onChange because "-" alone
    // isn't a finite number.
    expect(input).toHaveValue("-");
    expect(onChange).not.toHaveBeenCalled();
    // Continuing the typing — now we have a real number.
    fireEvent.change(input, { target: { value: "-5" } });
    expect(onChange).toHaveBeenCalledWith(-5);
  });

  it("rejects '-' when allowNegative is false", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        value={10}
        onChange={onChange}
        allowNegative={false}
        ariaLabel="amount"
      />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "-1" } });
    // Pattern blocks the dash entirely → input stays at "10".
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("10");
  });

  it("allows empty buffer without dispatching", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={5} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "" } });
    // Empty string parses to NaN — must NOT call onChange.
    // Parent state stays at 5 until the user types something valid
    // or blurs (which snaps back).
    expect(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blur on an unparseable buffer snaps back to the formatted parent value", () => {
    const onChange = vi.fn();
    render(
      <NumberField value={42} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "-" } });
    fireEvent.blur(input);
    // "-" isn't parseable → blur restores "42".
    expect(input).toHaveValue("42");
  });

  it("readOnly: typing is a no-op", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        value={42}
        onChange={onChange}
        readOnly
        ariaLabel="amount"
      />,
    );
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "100" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-syncs the buffer when parent value changes and buffer doesn't match", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberField value={10} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    expect(input).toHaveValue("10");

    // Parent pushes a different value (e.g. a Normalize button
    // ran upstream). The buffer must re-sync to that.
    rerender(
      <NumberField value={99} onChange={onChange} ariaLabel="amount" />,
    );
    expect(input).toHaveValue("99");
  });

  it("does NOT re-sync the buffer mid-edit when the buffer's parsed value already equals the new parent value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberField value={1.5} onChange={onChange} ariaLabel="amount" />,
    );
    const input = screen.getByLabelText("amount");
    // User types "1.500" — parses to 1.5, dispatches 1.5 upstream.
    fireEvent.change(input, { target: { value: "1.500" } });
    expect(onChange).toHaveBeenCalledWith(1.5);

    // Parent re-renders with value=1.5 (no change in parsed
    // number). The buffer must stay as "1.500" so the user can
    // keep typing — a re-sync to "1.5" would yank their trailing
    // zeros mid-edit, which is the canonical UX bug this field
    // exists to prevent.
    rerender(
      <NumberField value={1.5} onChange={onChange} ariaLabel="amount" />,
    );
    expect(input).toHaveValue("1.500");
  });

  it("renders Infinity as an empty buffer (non-finite guard)", () => {
    // Note: NaN is NOT tested here because NaN !== NaN, which
    // would trip the prevValue-comparison resync on every
    // render and infinite-loop. NaN is never a legitimate input
    // to this field; consumers always pass finite numbers (the
    // store seeds 0). Infinity exercises the same non-finite
    // branch in the formatted memo without the equality
    // pathology.
    render(
      <NumberField
        value={Number.POSITIVE_INFINITY}
        onChange={() => {}}
        ariaLabel="amount"
      />,
    );
    expect(screen.getByLabelText("amount")).toHaveValue("");
  });
});
