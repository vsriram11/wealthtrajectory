import { describe, expect, it } from "vitest";
import {
  bondLeverageFromDuration,
  leverageMatchesDuration,
} from "@/lib/portfolio/bondLeverage";

describe("bondLeverageFromDuration", () => {
  it("returns 0 for cash-like sub-half-year durations (SGOV ~ 0.3y)", () => {
    expect(bondLeverageFromDuration(0)).toBe(0);
    expect(bondLeverageFromDuration(0.1)).toBe(0);
    expect(bondLeverageFromDuration(0.3)).toBe(0);
    expect(bondLeverageFromDuration(0.5)).toBe(0);
  });

  it("returns 0.5 at the 5y anchor (BND-ish intermediate)", () => {
    expect(bondLeverageFromDuration(5)).toBeCloseTo(0.5, 5);
  });

  it("returns 1 for long bonds (≥ 8y duration)", () => {
    expect(bondLeverageFromDuration(8)).toBe(1);
    expect(bondLeverageFromDuration(17)).toBe(1);
    expect(bondLeverageFromDuration(30)).toBe(1);
  });

  it("interpolates linearly between 0.5y and 5y (0 → 0.5)", () => {
    // Midpoint of 0.5..5 is 2.75 → expected 0.25
    expect(bondLeverageFromDuration(2.75)).toBeCloseTo(0.25, 5);
  });

  it("interpolates linearly between 5y and 8y (0.5 → 1)", () => {
    // BND at 6.5y → 0.75x
    expect(bondLeverageFromDuration(6.5)).toBeCloseTo(0.75, 5);
    // IEF at 7y → ~0.833x
    expect(bondLeverageFromDuration(7)).toBeCloseTo(0.833, 2);
  });

  it("handles non-finite / negative input as 0 (treat as cash-like)", () => {
    expect(bondLeverageFromDuration(NaN)).toBe(0);
    expect(bondLeverageFromDuration(-1)).toBe(0);
    expect(bondLeverageFromDuration(Infinity)).toBe(1);
  });
});

describe("leverageMatchesDuration", () => {
  it("treats TMF's 3x at 17y as a non-auto override (true leverage)", () => {
    // 17y duration auto-derives to 1.0; 3x is far off — marked manual.
    expect(leverageMatchesDuration(3, 17)).toBe(false);
  });

  it("treats BND's preset 1x at 6.5y as a manual override (auto would be 0.75)", () => {
    expect(leverageMatchesDuration(1, 6.5)).toBe(false);
  });

  it("treats an exactly-derived value as auto", () => {
    expect(leverageMatchesDuration(0.75, 6.5)).toBe(true);
    expect(leverageMatchesDuration(1, 17)).toBe(true);
    expect(leverageMatchesDuration(0, 0.3)).toBe(true);
  });

  it("tolerates tiny floating-point drift (within tolerance)", () => {
    expect(leverageMatchesDuration(0.751, 6.5)).toBe(true);
    expect(leverageMatchesDuration(0.74, 6.5)).toBe(true);
    expect(leverageMatchesDuration(0.7, 6.5)).toBe(false);
  });
});
