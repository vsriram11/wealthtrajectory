/**
 * Household-data slice — the canonical home for the `household`
 * tree, the demo-vs-real `mode` flag, and the legacy
 * `householdAnnualIncomeUSD` field.
 *
 * The mutation actions for the entities INSIDE the household
 * (holdings / accounts / liabilities / members) live in their
 * own per-entity files so each domain is independently testable:
 *
 *   - lib/store/holdingsActions.ts     19 actions
 *   - lib/store/accountsActions.ts      5 actions
 *   - lib/store/liabilitiesActions.ts   3 actions
 *   - lib/store/membersActions.ts       6 actions
 *
 * All four touch the `household` field defined here, plus their
 * own narrow cross-slice writes. Shared helpers (mapHolding,
 * updateHolding, etc.) live in lib/store/_householdInternals.ts.
 */

import type { Household } from "@/lib/types";

export type HouseholdMode = "demo" | "real";

export type HouseholdSliceState = {
  mode: HouseholdMode;
  household: Household;
  /**
   * Optional household-level annual gross income (real, post-tax-
   * agnostic). When set, the app derives a savings rate from the
   * sum of monthly contributions. Null = not provided (the
   * insight stays hidden).
   *
   * Per-member `incomeUSD` on each Member is the source of truth
   * after the v15 migration; this field stays on the AppState as
   * a legacy back-compat path for pre-v15 saves. New writes go
   * through Members via `setMemberIncome`.
   */
  householdAnnualIncomeUSD: number | null;
};

export type HouseholdSliceActions = {
  setHouseholdAnnualIncome: (income: number | null) => void;
};

/**
 * Seed the household slice with the demo household. Real-mode
 * (post-onboarding) callers pass EMPTY_HOUSEHOLD via switchToReal
 * in the lifecycle slice.
 */
export const HOUSEHOLD_SLICE_INITIAL_DEMO = (
  demoHousehold: Household,
): HouseholdSliceState => ({
  mode: "demo",
  household: demoHousehold,
  householdAnnualIncomeUSD: null,
});

export function createHouseholdSliceActions(
  set: (patch: Partial<HouseholdSliceState>) => void,
): HouseholdSliceActions {
  return {
    setHouseholdAnnualIncome: (income) =>
      set({
        householdAnnualIncomeUSD:
          income != null && Number.isFinite(income) && income > 0
            ? income
            : null,
      }),
  };
}
