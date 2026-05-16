/**
 * Public surface of the store layer.
 *
 * Components should import from this index, not from individual
 * slice files. The slice files are an implementation detail;
 * the only stable contract is:
 *
 *   import { useAppStore, type AppState } from "@/lib/store";
 *
 * Slice-internal types (XSliceState, XSliceActions, *Context,
 * createXSliceActions) stay in their per-slice files because
 * only the store composition root and tests use them.
 *
 * For new code, prefer importing only what you need rather than
 * destructuring the full state — Zustand's selector pattern is
 * what makes per-field re-render isolation work:
 *
 *   const household = useAppStore((s) => s.household);   // good
 *   const everything = useAppStore();                    // re-renders on every change
 */

export { useAppStore } from "@/lib/store";
export type {
  AllocClassTab,
  AllocGeoScope,
  AppState,
  PageId,
  ViewBasis,
} from "@/lib/store";

// Per-entity branded id types — re-exported so consumers can
// type their props/state with the right brand without a deep
// import path.
export type {
  AccountId,
  HoldingId,
  HouseholdId,
  LiabilityId,
  MemberId,
  ScenarioId,
} from "@/lib/entityIds";
