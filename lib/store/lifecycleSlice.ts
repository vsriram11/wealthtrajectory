/**
 * Lifecycle slice — owns the actions that transition the AppStore
 * between "fresh demo", "real-mode empty", "real-mode hydrated
 * from IndexedDB", and "real-mode imported from a Drive backup".
 *
 * The `hydrated` flag pairs with PersistenceHydrator: it flips to
 * true after the first successful hydrateFromPersisted call. The
 * top-level app uses it to suppress flashes of demo content
 * during the initial load.
 *
 * `switchToReal` and `resetToDemo` are "reset everything that's
 * not auth/sync" — they spread every slice's INITIAL constant
 * to wipe scratch state, then write the canonical mode +
 * household. Auth + sync session state is preserved so toggling
 * modes doesn't sign the user out.
 *
 * `hydrateFromPersisted` is called by PersistenceHydrator on app
 * boot when an IndexedDB snapshot exists. It migrates the
 * persisted household through `migrateHousehold` +
 * `migrateLegacyHouseholdIncome` so older saves stay compatible.
 *
 * `importPayload` is the cloud-sync counterpart: it merges fresher
 * in-memory prices via `mergeFresherPrices` so an unlock-from-
 * Drive doesn't clobber recent live-price updates.
 */

import type { GoogleProfile } from "@/lib/sync/googleAuth";
import {
  filterMemberAssumptionsToHousehold,
  mergeFresherPrices,
  resolvePreferredMemberId,
} from "@/lib/persistence/storeHelpers";
import {
  migrateBudgetItems,
  migrateHousehold,
  migrateLegacyHouseholdIncome,
} from "@/lib/persistence/storeMigrations";
import type { BudgetItem } from "@/lib/budget/budget";
import type { Assumptions, Household, Scenario } from "@/lib/types";

import { createAssumptionsSliceInitial } from "./assumptionsSlice";
import { BUDGET_SLICE_INITIAL } from "./budgetSlice";
import { EDITING_SLICE_INITIAL } from "./editingSlice";
import { GOALS_SLICE_INITIAL } from "./goalsSlice";
import { HEALTH_SLICE_INITIAL } from "./healthSlice";
import type { HouseholdSliceState } from "./householdSlice";
import { MEMBER_VIEW_SLICE_INITIAL } from "./memberViewSlice";
import { SCENARIOS_SLICE_INITIAL } from "./scenariosSlice";
import { TARGET_ALLOCATION_SLICE_INITIAL } from "./targetAllocationSlice";
import { TIME_TRAVEL_SLICE_INITIAL } from "./timeTravelSlice";
import { UI_SLICE_INITIAL } from "./uiSlice";

export type LifecycleSliceState = {
  /** True after the first successful PersistenceHydrator call. */
  hydrated: boolean;
};

export type LifecycleSliceActions = {
  /**
   * Replace the in-memory store with a payload that came in from
   * IndexedDB (real-mode resume). Migrates the household + legacy
   * income field; preserves in-memory fields the payload doesn't
   * carry (scenarios from Drive, encryption flag, etc.).
   */
  hydrateFromPersisted: (input: {
    household: Household;
    assumptions: Assumptions;
    memberAssumptions?: Record<string, Partial<Assumptions>>;
    preferredMemberId?: string | null;
    targetAllocation?: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
    glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
    householdAnnualIncomeUSD?: number | null;
    goals?: import("@/lib/insights/goals").Goal[];
    budgetItems?: BudgetItem[];
    incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
    scenarios?: Scenario[];
    driveEncryptionEnabled?: boolean;
    healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
    healthImportanceWeights?: Record<
      string,
      import("@/lib/health/healthPlans").HealthImportanceWeights
    >;
  }) => void;

  /**
   * Replace the in-memory store with a payload that came in from
   * a Google Drive backup. Merges fresher in-memory live-price
   * timestamps so a backup unlock doesn't clobber recent prices.
   */
  importPayload: (payload: {
    household: Household;
    assumptions: Assumptions;
    memberAssumptions?: Record<string, Partial<Assumptions>>;
    preferredMemberId?: string | null;
    targetAllocation?: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
    glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
    householdAnnualIncomeUSD?: number | null;
    goals?: import("@/lib/insights/goals").Goal[];
    budgetItems?: BudgetItem[];
    incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
    scenarios?: Scenario[];
    healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
    healthImportanceWeights?: Record<
      string,
      import("@/lib/health/healthPlans").HealthImportanceWeights
    >;
  }) => void;

  /** Drop into real mode with an empty household. Preserves auth. */
  switchToReal: () => void;
  /** Drop back to the demo household + assumptions. Preserves auth. */
  resetToDemo: () => void;
  /**
   * Promote demo → real WITHOUT wiping the user's current state.
   *
   * Different from `switchToReal()` (which blanks the household to
   * empty for the "Start Fresh" onboarding flow). This action is
   * fired automatically by the persistence layer on the user's
   * first edit: the demo data they were just looking at IS the
   * starting point of THEIR data now. Flipping the flag lets the
   * downstream gates (CloudSyncer drive-upload, hide-on-demo UI
   * cues) start treating this as a real session without losing
   * what the user has been building.
   *
   * No-op when already in real mode.
   */
  promoteToReal: () => void;
};

export const LIFECYCLE_SLICE_INITIAL: LifecycleSliceState = {
  hydrated: false,
};

/**
 * Cross-slice context: lifecycle actions write almost every other
 * slice's state, so the context type is the union of fields they
 * touch. Typed structurally to keep this slice file independent
 * of the full AppState declaration.
 */
export type LifecycleSliceContext = LifecycleSliceState &
  HouseholdSliceState & {
    assumptions: Assumptions;
    memberAssumptions: Record<string, Partial<Assumptions>>;
    preferredMemberId: string | null;
    selectedMemberId: string | null;
    editingHoldingId: string | null;
    editingLiabilityId: string | null;
    editingAccountId: string | null;
    creatingAccount: boolean;
    creatingHoldingForAccountId: string | null;
    managingMembers: boolean;
    targetAllocation: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
    glidePath: import("@/lib/portfolio/glidePath").GlidePath | null;
    goals: import("@/lib/insights/goals").Goal[];
    budgetItems: BudgetItem[];
    incomeStreams: import("@/lib/budget/incomeStreams").IncomeStream[];
    scenarios: Scenario[];
    activeScenarioId: string | null;
    healthPlans: import("@/lib/health/healthPlans").HealthPlan[];
    healthImportanceWeights: Record<
      string,
      import("@/lib/health/healthPlans").HealthImportanceWeights
    >;
    driveEncryptionEnabled: boolean;
    googleConnected: boolean;
    googleSyncing: boolean;
    googleSyncError: string | null;
    googleLastSyncAt: number | null;
    /**
     * Layer 2 (Audit R5): included so lifecycle resets can clear
     * the modal-backing flag. Without the explicit clear, a user
     * clicking "Use mock data" while the InitialSyncConfirmModal is
     * open would reset every other slice to demo BUT leave the
     * modal mounted (rendering "Push current data to Drive?" over
     * demo-seed state). Clicking Push would then surface a
     * confusing "Household is still the demo seed" error.
     */
    pendingInitialSyncConfirm: boolean;
    user: GoogleProfile | null;
    subscription: "free" | "pro";
    subscriptionCheckedAt: number | null;
    viewBasis: import("./uiTypes").ViewBasis;
    // Time-travel fields — included so the freshSlate spread of
    // TIME_TRAVEL_SLICE_INITIAL type-checks AND so the hydrate
    // paths can explicitly clear the session-scoped fields without
    // an `as never` cast.
    timeTravelActive: boolean;
    timeTravelDate: string | null;
    baselineHousehold: Household | null;
    baselineAssumptions: Assumptions | null;
    editingSnapshotT: number | null;
  };

/**
 * Build a "fresh slate" patch for the given household + assumptions.
 * Used by switchToReal and resetToDemo to ensure both reset paths
 * are exactly equivalent to a freshly-constructed store. The single
 * source of truth means changing a default in any slice's INITIAL
 * propagates everywhere automatically.
 */
function freshSlate(
  mode: "real" | "demo",
  household: Household,
  assumptions: Assumptions,
  incomeStreams: import("@/lib/budget/incomeStreams").IncomeStream[] = [],
  budgetItems: BudgetItem[] = [],
): Partial<LifecycleSliceContext> {
  return {
    ...UI_SLICE_INITIAL,
    ...EDITING_SLICE_INITIAL,
    ...MEMBER_VIEW_SLICE_INITIAL,
    ...createAssumptionsSliceInitial(assumptions),
    ...GOALS_SLICE_INITIAL,
    ...BUDGET_SLICE_INITIAL,
    // Demo mode injects DEMO_BUDGET so the budget panel and the plan
    // tell a consistent story from the first load — items totalling
    // ~$11,700/mo continuing (≈ target NW × SWR), plus the demo's
    // subscription tab is populated so the user can see that view.
    // Real mode passes [] — the user enters their own.
    // switchToReal() blanks; resetToDemo() re-seeds.
    budgetItems,
    // Demo mode injects DEMO_INCOME_STREAMS so the showcase plan
    // includes realistic Social Security from the start. Real
    // mode passes [] — the user enters their own. switchToReal()
    // will use the empty default; resetToDemo() will re-seed.
    incomeStreams,
    ...HEALTH_SLICE_INITIAL,
    ...SCENARIOS_SLICE_INITIAL,
    ...TARGET_ALLOCATION_SLICE_INITIAL,
    // Time-travel session resets on EVERY lifecycle transition.
    // Audit fix (round-2): without this, switchToReal /
    // resetToDemo with timeTravelActive=true left the banner
    // showing with stale baselines from the prior mode.
    ...TIME_TRAVEL_SLICE_INITIAL,
    mode,
    household,
  };
}

export function createLifecycleSliceActions(
  set: (
    fn: (s: LifecycleSliceContext) => Partial<LifecycleSliceContext>,
  ) => void,
  get: () => LifecycleSliceContext,
  config: {
    /** Side effect for resetToDemo: clear the persistent real-mode IDB. */
    clearRealState: () => Promise<void>;
    /** Demo defaults — used by resetToDemo. */
    demoHousehold: Household;
    demoAssumptions: Assumptions;
    /** Demo income streams (SS, etc.) re-seeded on resetToDemo. */
    demoIncomeStreams: import("@/lib/budget/incomeStreams").IncomeStream[];
    /** Demo budget items (recurring expenses + subscriptions)
     *  re-seeded on resetToDemo. */
    demoBudget: BudgetItem[];
    /** Empty real-mode defaults — used by switchToReal. */
    emptyHousehold: Household;
    emptyAssumptions: Assumptions;
  },
): LifecycleSliceActions {
  return {
    switchToReal: () =>
      set((s) => ({
        ...freshSlate("real", config.emptyHousehold, config.emptyAssumptions),
        // Preserve auth + sync session — toggling modes shouldn't
        // sign the user out OR drop the cached last-sync timestamp.
        googleConnected: s.googleConnected,
        googleSyncing: false,
        googleSyncError: null,
        googleLastSyncAt: s.googleLastSyncAt,
        // Audit R5 (Layer 1/2/3): clear the modal-backing flag on
        // mode reset. Without this, a user with the modal open who
        // clicks "Start Fresh" / a code path that calls
        // switchToReal leaves the modal mounted asking to push the
        // (now-blanked) household to Drive. The push would surface
        // a strict-demo refusal but the modal's prompt is misleading.
        pendingInitialSyncConfirm: false,
        user: s.user,
        subscription: s.subscription,
        subscriptionCheckedAt: s.subscriptionCheckedAt,
      })),

    promoteToReal: () => {
      // Skip the `set` entirely in the no-op case. Zustand's setter
      // produces a FRESH state object reference even when the patch
      // is `{}` (Object.assign returns a new object), which fires
      // every subscriber listener with a shallow-equal-but-not-
      // identical state. Harmless under the existing diff-check
      // gates, but wasteful — and R7 now calls promoteToReal()
      // before every snapshot write (Add / Save edit / Delete),
      // amplifying the wasted dispatches. Audit R15.
      if (get().mode === "real") return;
      set(() => ({ mode: "real" }));
    },

    resetToDemo: () => {
      void config.clearRealState();
      set((s) => ({
        ...freshSlate(
          "demo",
          config.demoHousehold,
          config.demoAssumptions,
          config.demoIncomeStreams,
          config.demoBudget,
        ),
        googleConnected: s.googleConnected,
        googleSyncing: false,
        googleSyncError: null,
        googleLastSyncAt: s.googleLastSyncAt,
        // Audit R5 (Layer 1/2/3): clear the modal-backing flag on
        // mode reset to demo. Same reasoning as switchToReal: the
        // modal must not survive a lifecycle reset that no longer
        // matches its prompt ("Push current data to Drive?" when
        // the data is now the demo seed).
        pendingInitialSyncConfirm: false,
        user: s.user,
        subscription: s.subscription,
        subscriptionCheckedAt: s.subscriptionCheckedAt,
      }));
    },

    hydrateFromPersisted: ({
      household,
      assumptions,
      memberAssumptions,
      preferredMemberId,
      targetAllocation,
      glidePath,
      householdAnnualIncomeUSD,
      goals,
      budgetItems,
      incomeStreams,
      scenarios,
      driveEncryptionEnabled,
      healthPlans,
      healthImportanceWeights,
    }) =>
      set((s) => {
        const migrated = migrateLegacyHouseholdIncome(
          migrateHousehold(household),
          householdAnnualIncomeUSD,
        );
        const pref = resolvePreferredMemberId(preferredMemberId, migrated);
        return {
          mode: "real",
          hydrated: true,
          household: migrated,
          assumptions,
          memberAssumptions: memberAssumptions ?? {},
          preferredMemberId: pref,
          targetAllocation: targetAllocation ?? null,
          glidePath: glidePath ?? null,
          // Cleared after migration — per-member incomeUSD on
          // Members is now the source of truth.
          householdAnnualIncomeUSD: null,
          goals: goals ?? [],
          budgetItems: migrateBudgetItems(budgetItems, migrated),
          // Back-compat: pre-feature saves don't have the array
          // — default []. Preserves in-memory if already populated
          // (matches the pattern used by every other late-added
          // collection).
          incomeStreams: incomeStreams ?? s.incomeStreams ?? [],
          // If persisted data predates scenario-IDB persistence
          // (older saves), preserve whatever's in memory rather
          // than clobbering to []. AuthHydrator may have already
          // pulled scenarios from Drive before we got here.
          scenarios: scenarios ?? get().scenarios ?? [],
          // Back-compat: pre-flag saves don't have the field —
          // preserve whatever's already in memory (default false)
          // so we don't clobber a true that another code path just
          // set.
          driveEncryptionEnabled:
            driveEncryptionEnabled ?? s.driveEncryptionEnabled,
          // Back-compat: pre-Health-tab saves omit these. Default
          // to [] / {} but preserve in-memory if already populated.
          healthPlans: healthPlans ?? s.healthPlans ?? [],
          healthImportanceWeights:
            healthImportanceWeights ?? s.healthImportanceWeights ?? {},
          selectedMemberId: pref,
          // Defense-in-depth: explicitly clear time-travel session
          // state on hydrate. Should already be at INITIAL values
          // (false / null) because the slice constructor sets them,
          // but if a future code path (Drive re-sync, manual
          // setState during dev, etc.) ever leaves the flag on
          // across an IDB rehydrate, we'd be locked in a session
          // with a baseline pointing at the just-replaced household
          // — meaning Exit would "restore" the user's freshly-
          // loaded IDB state onto itself. Reset unconditionally.
          timeTravelActive: false,
          timeTravelDate: null,
          baselineHousehold: null,
          baselineAssumptions: null,
          editingSnapshotT: null,
        };
      }),

    importPayload: (payload) =>
      set((s) => {
        const migratedRaw = migrateLegacyHouseholdIncome(
          migrateHousehold(payload.household),
          payload.householdAnnualIncomeUSD,
        );
        // Preserve fresher in-memory live-price timestamps. Without
        // this merge, a user unlocking their Drive backup (e.g. via
        // EncryptionUnlockBanner) sees fresh prices revert to
        // whatever was on Drive — the "Live · 1d ago" reversion
        // bug. The merge prefers the newer `lastPricedAt` per
        // holding, matched by id (round-trips through Drive
        // backups).
        const migrated = mergeFresherPrices(migratedRaw, s.household);
        const pref = resolvePreferredMemberId(
          payload.preferredMemberId,
          migrated,
        );
        return {
          mode: "real",
          household: migrated,
          assumptions: payload.assumptions,
          // Old payloads predate these fields; default empty/null
          // so they round-trip cleanly. Filtered to keep only
          // entries whose memberId still exists in the imported
          // household.
          memberAssumptions: filterMemberAssumptionsToHousehold(
            payload.memberAssumptions ?? {},
            payload.household,
          ),
          preferredMemberId: pref,
          targetAllocation: payload.targetAllocation ?? null,
          glidePath: payload.glidePath ?? null,
          // Legacy household-level income migrated into members
          // above; clear the field going forward.
          householdAnnualIncomeUSD: null,
          goals: payload.goals ?? [],
          budgetItems: migrateBudgetItems(payload.budgetItems, migrated),
          incomeStreams: payload.incomeStreams ?? [],
          healthPlans: payload.healthPlans ?? [],
          healthImportanceWeights: payload.healthImportanceWeights ?? {},
          scenarios: payload.scenarios ?? [],
          activeScenarioId: null,
          editingHoldingId: null,
          editingLiabilityId: null,
          editingAccountId: null,
          creatingAccount: false,
          creatingHoldingForAccountId: null,
          managingMembers: false,
          // Initial member-filter view honors the imported
          // preference.
          selectedMemberId: pref,
          viewBasis: UI_SLICE_INITIAL.viewBasis,
          // Preserve auth.
          user: s.user,
          googleConnected: s.googleConnected,
          subscription: s.subscription,
          subscriptionCheckedAt: s.subscriptionCheckedAt,
          // Mirror hydrateFromPersisted's defensive reset of
          // time-travel session state — a Drive payload re-import
          // should never leave the user in a half-set time-travel
          // session pointing at a now-stale baseline.
          timeTravelActive: false,
          timeTravelDate: null,
          baselineHousehold: null,
          baselineAssumptions: null,
          editingSnapshotT: null,
        };
      }),
  };
}
