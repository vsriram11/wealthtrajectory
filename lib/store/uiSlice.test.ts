import { describe, expect, it } from "vitest";
import {
  UI_SLICE_INITIAL,
  createUISliceActions,
  type UISliceState,
} from "./uiSlice";

/**
 * Tiny in-memory "set" emulator for tests — mimics the Zustand
 * set signature without pulling in the store. Stores the latest
 * state and exposes a snapshot accessor.
 */
function makeFakeStore(): {
  state: UISliceState;
  set: (patch: Partial<UISliceState>) => void;
} {
  let state: UISliceState = { ...UI_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (patch) => {
      state = { ...state, ...patch };
    },
  };
}

describe("UISliceState — initial values", () => {
  it("home is the landing page", () => {
    expect(UI_SLICE_INITIAL.currentPage).toBe("home");
  });

  it("nav drawer starts closed", () => {
    expect(UI_SLICE_INITIAL.navOpen).toBe(false);
  });

  it("allocation defaults to all-classes / all-geos", () => {
    expect(UI_SLICE_INITIAL.allocClassTab).toBe("ALL");
    expect(UI_SLICE_INITIAL.allocGeoScope).toBe("ALL");
  });

  it("liquidity view defaults to total (matches legacy behavior)", () => {
    expect(UI_SLICE_INITIAL.liquidityView).toBe("total");
  });

  it("appliedFutureYears starts null (no future-projection overlay)", () => {
    expect(UI_SLICE_INITIAL.appliedFutureYears).toBeNull();
  });

  it("viewBasis defaults to face value (not leverage-adjusted)", () => {
    expect(UI_SLICE_INITIAL.viewBasis).toBe("face");
  });
});

describe("createUISliceActions — basic setters", () => {
  it("setNavOpen toggles the drawer", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    actions.setNavOpen(true);
    expect(store.state.navOpen).toBe(true);
    actions.setNavOpen(false);
    expect(store.state.navOpen).toBe(false);
  });

  it("setViewBasis updates basis", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    actions.setViewBasis("exposure");
    expect(store.state.viewBasis).toBe("exposure");
    actions.setViewBasis("face");
    expect(store.state.viewBasis).toBe("face");
  });

  it("setAllocClassTab + setAllocGeoScope update allocation filters independently", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    actions.setAllocClassTab("equity");
    actions.setAllocGeoScope("US");
    expect(store.state.allocClassTab).toBe("equity");
    expect(store.state.allocGeoScope).toBe("US");
    // The two are independent — changing class doesn't reset geo.
    actions.setAllocClassTab("bond");
    expect(store.state.allocGeoScope).toBe("US");
  });

  it("setLiquidityView toggles between total and liquid", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    actions.setLiquidityView("liquid");
    expect(store.state.liquidityView).toBe("liquid");
    actions.setLiquidityView("total");
    expect(store.state.liquidityView).toBe("total");
  });

  it("setAppliedFutureYears accepts numbers and null", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    actions.setAppliedFutureYears(15);
    expect(store.state.appliedFutureYears).toBe(15);
    actions.setAppliedFutureYears(null);
    expect(store.state.appliedFutureYears).toBeNull();
  });
});

describe("createUISliceActions — setCurrentPage side effects", () => {
  it("setting current page also closes the nav drawer", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);

    // Open the drawer to start.
    actions.setNavOpen(true);
    expect(store.state.navOpen).toBe(true);

    // Navigating closes it.
    actions.setCurrentPage("allocation");
    expect(store.state.currentPage).toBe("allocation");
    expect(store.state.navOpen).toBe(false);
  });

  it("preserves unrelated slice fields when paginating", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);

    actions.setAllocClassTab("crypto");
    actions.setLiquidityView("liquid");
    actions.setAppliedFutureYears(10);
    actions.setCurrentPage("plan");

    // Page changed, drawer closed, but other state intact.
    expect(store.state.currentPage).toBe("plan");
    expect(store.state.navOpen).toBe(false);
    expect(store.state.allocClassTab).toBe("crypto");
    expect(store.state.liquidityView).toBe("liquid");
    expect(store.state.appliedFutureYears).toBe(10);
  });
});

describe("createUISliceActions — side-effect free across actions", () => {
  it("no setter mutates state outside its declared field (except setCurrentPage's drawer-close)", () => {
    const store = makeFakeStore();
    const actions = createUISliceActions(store.set);
    const baseline = { ...store.state };

    actions.setAllocClassTab("equity");
    // Only allocClassTab should change.
    const expected = { ...baseline, allocClassTab: "equity" as const };
    expect(store.state).toEqual(expected);
  });
});
