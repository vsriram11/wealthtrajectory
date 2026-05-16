import { projectIndependence } from "@/lib/projection/independence";
import { applyScenario } from "@/lib/insights/scenarios";
import type { Assumptions, Household } from "@/lib/types";

/**
 * Sensitivity analysis: how does Independence date shift as we vary one
 * assumption? Returns a series of (delta, monthsToIndependence) points so
 * the UI can plot a sensitivity curve or pick discrete labels.
 *
 * Pure function — reuses applyScenario's cagrDelta semantics for the
 * CAGR sweep so results are consistent with the Scenarios panel.
 */
export type SensitivityPoint = {
  delta: number;
  monthsToIndependence: number | null;
};

export function cagrSensitivity(
  household: Household,
  assumptions: Assumptions,
  deltasPct: number[] = [-2, -1, -0.5, 0, 0.5, 1, 2],
): SensitivityPoint[] {
  return deltasPct.map((d) => {
    const { household: h, assumptions: a } = applyScenario(
      household,
      assumptions,
      { cagrDelta: d / 100 },
    );
    const p = projectIndependence(h, a);
    return { delta: d, monthsToIndependence: p.monthsToIndependence };
  });
}

export function savingsRateSensitivity(
  household: Household,
  assumptions: Assumptions,
  multipliers: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2],
): SensitivityPoint[] {
  return multipliers.map((m) => {
    const { household: h, assumptions: a } = applyScenario(
      household,
      assumptions,
      { contributionMultiplier: m },
    );
    const p = projectIndependence(h, a);
    return { delta: m, monthsToIndependence: p.monthsToIndependence };
  });
}
