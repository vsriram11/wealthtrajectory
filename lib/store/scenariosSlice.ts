/**
 * Saved scenarios — alternate sets of contribution multipliers,
 * CAGR overrides, and other plan-shape tweaks the user wants to
 * compare side-by-side against the baseline.
 *
 * Each scenario has a name + color + the override map. The active
 * scenario (if any) is applied on top of the baseline when
 * useActiveProjection resolves the effective plan; the user can
 * stack scenarios by activating them one at a time.
 *
 * removeScenario cascades to clear activeScenarioId if the
 * removed scenario was active (otherwise the UI would point at
 * a ghost id).
 */

import { nextScenarioColor } from "@/lib/insights/scenarios";
import type { Scenario, ScenarioOverrides } from "@/lib/types";

export type ScenariosSliceState = {
  scenarios: Scenario[];
  activeScenarioId: string | null;
};

export type ScenariosSliceActions = {
  addScenario: (input: {
    name: string;
    overrides: ScenarioOverrides;
  }) => string;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  removeScenario: (id: string) => void;
  setActiveScenario: (id: string | null) => void;
};

export const SCENARIOS_SLICE_INITIAL: ScenariosSliceState = {
  scenarios: [],
  activeScenarioId: null,
};

function makeScenarioId(): string {
  return `sc-${crypto.randomUUID()}`;
}

export function createScenariosSliceActions(
  set: (
    fn: (s: ScenariosSliceState) => Partial<ScenariosSliceState>,
  ) => void,
  get: () => ScenariosSliceState,
): ScenariosSliceActions {
  return {
    addScenario: (input) => {
      const current = get();
      const id = makeScenarioId();
      const scenario: Scenario = {
        id,
        name: input.name.trim() || "Scenario",
        color: nextScenarioColor(current.scenarios),
        overrides: input.overrides,
        createdAt: Date.now(),
      };
      set((s) => ({ scenarios: [...s.scenarios, scenario] }));
      return id;
    },

    updateScenario: (id, patch) =>
      set((s) => ({
        scenarios: s.scenarios.map((sc) =>
          sc.id === id ? { ...sc, ...patch } : sc,
        ),
      })),

    removeScenario: (id) =>
      set((s) => ({
        scenarios: s.scenarios.filter((sc) => sc.id !== id),
        // Clear the active id if the removed scenario was the active
        // one — otherwise consumers see a ghost activeScenarioId
        // that no longer resolves to a scenario.
        activeScenarioId:
          s.activeScenarioId === id ? null : s.activeScenarioId,
      })),

    setActiveScenario: (id) => set(() => ({ activeScenarioId: id })),
  };
}
