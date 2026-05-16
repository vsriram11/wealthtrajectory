/**
 * sensitivity.ts pins how Independence date shifts as we vary a
 * single assumption (CAGR delta, or savings-rate multiplier). The
 * UI plots a sensitivity curve from these points; the tests below
 * verify the structural invariants the chart relies on:
 *
 *   1. The output preserves the input delta-axis exactly — the
 *      caller controls the X-axis.
 *   2. delta = 0 / multiplier = 1 reproduces the baseline projection
 *      (zero perturbation must be identity).
 *   3. Higher CAGR or higher savings rate yields an Independence
 *      date that is sooner-or-equal, never later. This is the
 *      monotonicity the curve's downward-left-to-right slope
 *      depends on.
 *   4. Defaults: when called with no explicit deltas, the function
 *      emits the documented default sweep so the chart's tick
 *      labels stay predictable.
 */

import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { projectIndependence } from "@/lib/projection/independence";
import { cagrSensitivity, savingsRateSensitivity } from "@/lib/projection/sensitivity";

describe("cagrSensitivity", () => {
  it("emits one point per input delta, preserving delta order", () => {
    const deltas = [-1.5, 0, 0.5, 2];
    const points = cagrSensitivity(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, deltas);
    expect(points.map((p) => p.delta)).toEqual(deltas);
  });

  it("delta = 0 reproduces the baseline projection exactly", () => {
    const baseline = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const points = cagrSensitivity(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [0]);
    // Zero CAGR delta must not move the answer — otherwise the
    // chart's centre tick would be a lie.
    expect(points).toHaveLength(1);
    expect(points[0].monthsToIndependence).toBe(baseline.monthsToIndependence);
  });

  it("higher CAGR delta makes Independence sooner-or-equal", () => {
    const points = cagrSensitivity(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      [-2, -1, 0, 1, 2],
    );
    const reachable = points.filter((p) => p.monthsToIndependence !== null);
    // Independence must be reachable across this CAGR range for
    // the demo household — otherwise the monotonicity assertion
    // below is vacuous.
    expect(reachable.length).toBe(points.length);
    // Sort by delta ascending → monthsToIndependence must be
    // non-increasing. Compounding more aggressively can only
    // reach the target sooner, never later.
    for (let i = 1; i < reachable.length; i++) {
      expect(reachable[i].monthsToIndependence!).toBeLessThanOrEqual(
        reachable[i - 1].monthsToIndependence!,
      );
    }
  });

  it("uses the documented default sweep when no deltas are supplied", () => {
    // The default series of −2, −1, −0.5, 0, +0.5, +1, +2 percent
    // is what the dashboard tick labels reference. Changing the
    // default silently would break the chart legend.
    const points = cagrSensitivity(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    expect(points.map((p) => p.delta)).toEqual([-2, -1, -0.5, 0, 0.5, 1, 2]);
  });
});

describe("savingsRateSensitivity", () => {
  it("emits one point per multiplier, preserving order", () => {
    const muls = [0.25, 0.5, 1, 2, 3];
    const points = savingsRateSensitivity(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      muls,
    );
    expect(points.map((p) => p.delta)).toEqual(muls);
  });

  it("multiplier = 1 reproduces the baseline projection exactly", () => {
    const baseline = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const points = savingsRateSensitivity(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [
      1,
    ]);
    expect(points[0].monthsToIndependence).toBe(baseline.monthsToIndependence);
  });

  it("higher contribution multiplier makes Independence sooner-or-equal", () => {
    const points = savingsRateSensitivity(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      [0.5, 0.75, 1, 1.5, 2, 3],
    );
    const reachable = points.filter((p) => p.monthsToIndependence !== null);
    expect(reachable.length).toBe(points.length);
    for (let i = 1; i < reachable.length; i++) {
      expect(reachable[i].monthsToIndependence!).toBeLessThanOrEqual(
        reachable[i - 1].monthsToIndependence!,
      );
    }
  });

  it("uses the documented default sweep when no multipliers are supplied", () => {
    const points = savingsRateSensitivity(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    expect(points.map((p) => p.delta)).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it("zero-savings multiplier still returns a defined point (no crash)", () => {
    // Edge: setting the multiplier to 0 kills all contributions.
    // The function must still return a point — the UI shows
    // "unreachable" in that case rather than erroring.
    const points = savingsRateSensitivity(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      [0],
    );
    expect(points).toHaveLength(1);
    expect(points[0].delta).toBe(0);
    // monthsToIndependence may be null (unreachable) or a finite
    // number depending on the demo household's existing NW; both
    // are valid as long as we don't throw.
    const m = points[0].monthsToIndependence;
    expect(m === null || Number.isFinite(m)).toBe(true);
  });
});
