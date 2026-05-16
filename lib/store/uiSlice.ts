/**
 * UI / navigation state slice.
 *
 * Owns the purely-presentational state that has no cross-domain
 * coupling: which page is active, whether the nav drawer is open,
 * face-vs-exposure basis toggle, allocation tab + geo-scope
 * filters, total-vs-liquid net-worth view, and the
 * "view portfolio N years from now" future-allocation slider.
 *
 * Every action here is a pure setter — no derived calculations,
 * no cross-slice writes, no side effects. That property is what
 * makes this slice safe to extract independently of the bigger
 * household / scenarios / sync surface.
 *
 * Pattern: slice exports three things — the state shape, the
 * actions shape, and a `createUISliceActions(set)` factory. The
 * main store composes `...UI_INITIAL` + `...createUISliceActions(
 * set)` into its `create()` body. Future slices follow the same
 * shape; see lib/store.ts for the composition.
 */

import type { AllocClassTab, AllocGeoScope, PageId, ViewBasis } from "./uiTypes";

export type LiquidityView = "total" | "liquid";

/** Field shape — exactly the keys owned by this slice. */
export type UISliceState = {
  currentPage: PageId;
  navOpen: boolean;
  viewBasis: ViewBasis;
  allocClassTab: AllocClassTab;
  allocGeoScope: AllocGeoScope;
  liquidityView: LiquidityView;
  /** Non-null = age the allocation surface forward N years. */
  appliedFutureYears: number | null;
};

/** Action shape — exactly the setters owned by this slice. */
export type UISliceActions = {
  setCurrentPage: (page: PageId) => void;
  setNavOpen: (open: boolean) => void;
  setViewBasis: (basis: ViewBasis) => void;
  setAllocClassTab: (tab: AllocClassTab) => void;
  setAllocGeoScope: (scope: AllocGeoScope) => void;
  setLiquidityView: (v: LiquidityView) => void;
  setAppliedFutureYears: (v: number | null) => void;
};

/** Initial values. Spread into the main store's create() body. */
export const UI_SLICE_INITIAL: UISliceState = {
  currentPage: "home",
  navOpen: false,
  viewBasis: "face",
  allocClassTab: "ALL",
  allocGeoScope: "ALL",
  liquidityView: "total",
  appliedFutureYears: null,
};

/**
 * Build the action handlers. Takes a typed `set` (the same one
 * Zustand hands the store creator) and returns a flat object of
 * action functions.
 *
 * The set parameter is intentionally typed against
 * `Partial<UISliceState>` rather than the full AppState — the
 * caller is responsible for ensuring slice writes don't collide.
 * In practice the main store passes its own `set` directly; TS
 * accepts this because every key in our writes is a member of
 * AppState too.
 */
export function createUISliceActions(
  set: (patch: Partial<UISliceState>) => void,
): UISliceActions {
  return {
    // Setting the current page also closes the nav drawer. The
    // alternative (separate close-nav call at every consumer) was
    // forgotten in two places in the original code and led to
    // the drawer staying open after navigation — keeping the
    // composite write here makes the side-effect literal.
    setCurrentPage: (page) => set({ currentPage: page, navOpen: false }),
    setNavOpen: (open) => set({ navOpen: open }),
    setViewBasis: (basis) => set({ viewBasis: basis }),
    setAllocClassTab: (tab) => set({ allocClassTab: tab }),
    setAllocGeoScope: (scope) => set({ allocGeoScope: scope }),
    setLiquidityView: (v) => set({ liquidityView: v }),
    setAppliedFutureYears: (v) => set({ appliedFutureYears: v }),
  };
}
