import { describe, expect, it } from "vitest";
import {
  SCENARIOS_SLICE_INITIAL,
  createScenariosSliceActions,
  type ScenariosSliceState,
} from "./scenariosSlice";

function makeFakeStore(seed: Partial<ScenariosSliceState> = {}) {
  let state: ScenariosSliceState = {
    ...SCENARIOS_SLICE_INITIAL,
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: ScenariosSliceState) => Partial<ScenariosSliceState>) => {
      state = { ...state, ...fn(state) };
    },
    get: () => state,
  };
}

describe("addScenario", () => {
  it("returns a fresh id + appends + assigns a color", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id = a.addScenario({
      name: "Aggressive",
      overrides: { holdingCAGRs: { h1: 0.1 } },
    });
    expect(id.startsWith("sc-")).toBe(true);
    expect(s.state.scenarios).toHaveLength(1);
    expect(s.state.scenarios[0].name).toBe("Aggressive");
    // The color must be a CSS-parseable hex string — the
    // scenario comparison chart paints lines from this value.
    // `toBeTruthy()` would accept e.g. "yes" which the chart
    // would render as transparent.
    expect(s.state.scenarios[0].color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it("empty name falls back to 'Scenario'", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id = a.addScenario({ name: "   ", overrides: {} });
    expect(s.state.scenarios.find((x) => x.id === id)!.name).toBe("Scenario");
  });
});

describe("updateScenario", () => {
  it("applies a partial patch", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id = a.addScenario({ name: "A", overrides: {} });
    a.updateScenario(id, { name: "Renamed" });
    expect(s.state.scenarios[0].name).toBe("Renamed");
  });
});

describe("removeScenario", () => {
  it("cascades activeScenarioId clear when it matches", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id = a.addScenario({ name: "A", overrides: {} });
    a.setActiveScenario(id);
    a.removeScenario(id);
    expect(s.state.scenarios).toHaveLength(0);
    expect(s.state.activeScenarioId).toBeNull();
  });

  it("leaves activeScenarioId alone when it doesn't match", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id1 = a.addScenario({ name: "A", overrides: {} });
    const id2 = a.addScenario({ name: "B", overrides: {} });
    a.setActiveScenario(id2);
    a.removeScenario(id1);
    expect(s.state.activeScenarioId).toBe(id2);
  });
});

describe("setActiveScenario", () => {
  it("accepts null to deactivate", () => {
    const s = makeFakeStore();
    const a = createScenariosSliceActions(s.set, s.get);
    const id = a.addScenario({ name: "A", overrides: {} });
    a.setActiveScenario(id);
    expect(s.state.activeScenarioId).toBe(id);
    a.setActiveScenario(null);
    expect(s.state.activeScenarioId).toBeNull();
  });
});
