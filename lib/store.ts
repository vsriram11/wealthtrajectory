"use client";

import { create } from "zustand";

import {
  DEMO_ASSUMPTIONS,
  DEMO_BUDGET,
  DEMO_HOUSEHOLD,
  DEMO_INCOME_STREAMS,
  EMPTY_ASSUMPTIONS,
  EMPTY_HOUSEHOLD,
} from "@/lib/demo";
import { clearRealState } from "@/lib/persistence/persistence";
import type { Household } from "@/lib/types";
import {
  UI_SLICE_INITIAL,
  createUISliceActions,
  type LiquidityView,
  type UISliceActions,
  type UISliceState,
} from "./store/uiSlice";
import {
  EDITING_SLICE_INITIAL,
  createEditingSliceActions,
  type EditingSliceActions,
  type EditingSliceState,
} from "./store/editingSlice";
import {
  ENCRYPTION_SLICE_INITIAL,
  createEncryptionSliceActions,
  type EncryptionSliceActions,
  type EncryptionSliceState,
} from "./store/encryptionSlice";
import {
  createActivitySliceActions,
  createActivitySliceInitial,
  type ActivitySliceActions,
  type ActivitySliceState,
} from "./store/activitySlice";
import {
  AUTH_SLICE_INITIAL,
  createAuthSliceActions,
  type AuthSliceActions,
  type AuthSliceState,
} from "./store/authSlice";
import {
  GOOGLE_SYNC_SLICE_INITIAL,
  createGoogleSyncSliceActions,
  type GoogleSyncSliceActions,
  type GoogleSyncSliceState,
} from "./store/googleSyncSlice";
import {
  MEMBER_VIEW_SLICE_INITIAL,
  createMemberViewSliceActions,
  type MemberViewSliceActions,
  type MemberViewSliceState,
} from "./store/memberViewSlice";
import {
  TARGET_ALLOCATION_SLICE_INITIAL,
  createTargetAllocationSliceActions,
  type TargetAllocationSliceActions,
  type TargetAllocationSliceState,
} from "./store/targetAllocationSlice";
import {
  createAssumptionsSliceActions,
  createAssumptionsSliceInitial,
  type AssumptionsSliceActions,
  type AssumptionsSliceState,
} from "./store/assumptionsSlice";
import {
  GOALS_SLICE_INITIAL,
  createGoalsSliceActions,
  type GoalsSliceActions,
  type GoalsSliceState,
} from "./store/goalsSlice";
import {
  BUDGET_SLICE_INITIAL,
  createBudgetSliceActions,
  type BudgetSliceActions,
  type BudgetSliceState,
} from "./store/budgetSlice";
import {
  createIncomeStreamsSliceActions,
  type IncomeStreamsSliceActions,
  type IncomeStreamsSliceState,
} from "./store/incomeStreamsSlice";
import {
  HEALTH_SLICE_INITIAL,
  createHealthSliceActions,
  type HealthSliceActions,
  type HealthSliceState,
} from "./store/healthSlice";
import {
  SCENARIOS_SLICE_INITIAL,
  createScenariosSliceActions,
  type ScenariosSliceActions,
  type ScenariosSliceState,
} from "./store/scenariosSlice";
import {
  HOUSEHOLD_SLICE_INITIAL_DEMO,
  createHouseholdSliceActions,
  type HouseholdSliceActions,
  type HouseholdSliceState,
} from "./store/householdSlice";
import {
  createHoldingsActions,
  type HoldingsActions,
} from "./store/holdingsActions";
import {
  createAccountsActions,
  type AccountsActions,
} from "./store/accountsActions";
import {
  createLiabilitiesActions,
  type LiabilitiesActions,
} from "./store/liabilitiesActions";
import {
  createMembersActions,
  type MembersActions,
} from "./store/membersActions";
import {
  LIFECYCLE_SLICE_INITIAL,
  createLifecycleSliceActions,
  type LifecycleSliceActions,
  type LifecycleSliceState,
} from "./store/lifecycleSlice";

// UI-state types live in `./store/uiTypes`. Re-exported here so
// existing consumers that imported them from `@/lib/store` continue
// to compile without a downstream migration.
export type {
  AllocClassTab,
  AllocGeoScope,
  PageId,
  ViewBasis,
} from "./store/uiTypes";

type Mode = "demo" | "real";

export type AppState =
  UISliceState & UISliceActions &
  EditingSliceState & EditingSliceActions &
  EncryptionSliceState & EncryptionSliceActions &
  ActivitySliceState & ActivitySliceActions &
  AuthSliceState & AuthSliceActions &
  GoogleSyncSliceState & GoogleSyncSliceActions &
  MemberViewSliceState & MemberViewSliceActions &
  TargetAllocationSliceState & TargetAllocationSliceActions &
  AssumptionsSliceState & AssumptionsSliceActions &
  GoalsSliceState & GoalsSliceActions &
  BudgetSliceState & BudgetSliceActions &
  IncomeStreamsSliceState & IncomeStreamsSliceActions &
  HealthSliceState & HealthSliceActions &
  ScenariosSliceState & ScenariosSliceActions &
  HouseholdSliceState & HouseholdSliceActions &
  HoldingsActions & AccountsActions & LiabilitiesActions & MembersActions &
  LifecycleSliceState & LifecycleSliceActions & {
  // Every field and action that used to live inline on AppState
  // is now owned by one of the slice intersections above. See
  // lib/store/*Slice.ts for per-slice ownership, including:
  //   - UI                        UISliceState / UISliceActions
  //   - Editing modals            EditingSliceState / Actions
  //   - Encryption                EncryptionSliceState / Actions
  //   - Activity / signout        ActivitySliceState / Actions
  //   - Auth + subscription       AuthSliceState / Actions
  //   - Google Drive sync         GoogleSyncSliceState / Actions
  //   - Member-filter view        MemberViewSliceState / Actions
  //   - Target alloc + glide      TargetAllocationSliceState / Actions
  //   - Plan assumptions          AssumptionsSliceState / Actions
  //   - Goals                     GoalsSliceState / Actions
  //   - Budget ledger             BudgetSliceState / Actions
  //   - Health plans              HealthSliceState / Actions
  //   - Scenarios                 ScenariosSliceState / Actions
  //   - Household + entity actions  HouseholdSliceState / Actions
  //   - Lifecycle (hydrate/import/switchToReal/resetToDemo) →
  //                                LifecycleSliceState / Actions
  //
  // No fields or actions are declared here directly — the intent
  // is that every piece of state has exactly one slice that owns
  // it. Adding state to the store means picking the right slice
  // (or creating a new one) rather than dropping a field on this
  // intersection.
};

/**
 * Override of {@link MemberViewSliceActions.setPreferredMemberId}
 * that validates the supplied id against the current household.
 * The slice's default setter is a no-validation setter; we wrap it
 * here because the validation needs `household` (which lives in a
 * different slice). Cleaner than threading household into the slice
 * itself.
 */
function createSetPreferredMemberIdWithValidation(
  set: (
    fn: (s: { household: Household; preferredMemberId: string | null }) =>
      Partial<{ preferredMemberId: string | null }>,
  ) => void,
) {
  return (memberId: string | null) =>
    set((s) => {
      if (memberId == null) return { preferredMemberId: null };
      const exists = s.household.members.some((m) => m.id === memberId);
      return { preferredMemberId: exists ? memberId : null };
    });
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Slice composition ─────────────────────────────────────
  // Every slice spreads its initial-state object and its action
  // factory into the store body. The factories accept the typed
  // `set` (and `get` where they need cross-slice reads); each
  // slice file declares its own structural context type so it
  // doesn't import the full AppState (avoiding circular type
  // imports).

  // Presentation / interaction state
  ...UI_SLICE_INITIAL,
  ...createUISliceActions(set),
  ...EDITING_SLICE_INITIAL,
  ...createEditingSliceActions(set),
  ...MEMBER_VIEW_SLICE_INITIAL,
  ...createMemberViewSliceActions(set),

  // Session / auth / sync
  ...AUTH_SLICE_INITIAL,
  ...createAuthSliceActions(set),
  ...GOOGLE_SYNC_SLICE_INITIAL,
  ...createGoogleSyncSliceActions(set),
  ...ENCRYPTION_SLICE_INITIAL,
  ...createEncryptionSliceActions(set),
  ...createActivitySliceInitial(),
  ...createActivitySliceActions(set),

  // Plan settings
  ...createAssumptionsSliceInitial(DEMO_ASSUMPTIONS),
  ...createAssumptionsSliceActions(set),
  ...TARGET_ALLOCATION_SLICE_INITIAL,
  ...createTargetAllocationSliceActions(set, get),

  // Collections
  ...GOALS_SLICE_INITIAL,
  ...createGoalsSliceActions(set),
  ...BUDGET_SLICE_INITIAL,
  // Store starts in DEMO mode by default — seed budgetItems with the
  // demo budget so the Plan/Budget panel shows realistic items + the
  // Subscriptions tab is populated from the first load. switchToReal()
  // blanks this; resetToDemo() re-seeds via the lifecycle slice config.
  budgetItems: DEMO_BUDGET,
  ...createBudgetSliceActions(set),
  // The store starts in DEMO mode by default — seed
  // incomeStreams with the demo SS data so the projection +
  // Monte Carlo run-of-the-mill demo views show realistic
  // benefits from the start (rather than the user having to
  // open Plan → Income and add them manually before seeing the
  // feature affect anything).
  //
  // switchToReal() blanks this to []; resetToDemo() re-seeds.
  incomeStreams: DEMO_INCOME_STREAMS,
  ...createIncomeStreamsSliceActions(set),
  ...HEALTH_SLICE_INITIAL,
  ...createHealthSliceActions(set, get),
  ...SCENARIOS_SLICE_INITIAL,
  ...createScenariosSliceActions(set, get),

  // Household tree (data + the legacy income setter)
  ...HOUSEHOLD_SLICE_INITIAL_DEMO(DEMO_HOUSEHOLD),
  ...createHouseholdSliceActions(set),
  // Per-entity mutation slices — each writes to the household
  // tree above plus its own narrow cross-slice fields (scenarios
  // cascade, editing flag clears, member-assumption pruning).
  ...createHoldingsActions(set),
  ...createAccountsActions(set),
  ...createLiabilitiesActions(set),
  ...createMembersActions(set, get),

  // Lifecycle (hydrate / import / switch modes)
  ...LIFECYCLE_SLICE_INITIAL,
  ...createLifecycleSliceActions(set, get, {
    clearRealState,
    demoHousehold: DEMO_HOUSEHOLD,
    demoAssumptions: DEMO_ASSUMPTIONS,
    demoIncomeStreams: DEMO_INCOME_STREAMS,
    demoBudget: DEMO_BUDGET,
    emptyHousehold: EMPTY_HOUSEHOLD,
    emptyAssumptions: EMPTY_ASSUMPTIONS,
  }),

  // Cross-slice overrides — small surface that needs awareness of
  // multiple slices. The MemberView slice provides a base
  // setPreferredMemberId; we replace it with a household-aware
  // version that drops stale ids (member removed in another tab).
  setPreferredMemberId: createSetPreferredMemberIdWithValidation(set),
}));
