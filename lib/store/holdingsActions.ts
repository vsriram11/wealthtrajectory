/**
 * Per-holding mutation actions.
 *
 * All actions write to the shared `household` field (owned by
 * HouseholdSliceState) plus optionally to cross-slice fields:
 *
 *   - `createHolding` clears `creatingHoldingForAccountId` on
 *     the editing slice so the modal closes on submit.
 *   - `removeHolding` strips scenario overrides keyed off the
 *     deleted holding (cascade) and clears `editingHoldingId`
 *     if that holding was being edited.
 *
 * Pure-presentation helpers (mapHolding, updateHolding, etc.)
 * live in `./_householdInternals` so accounts / liabilities /
 * member slices can reuse them.
 */

import { bondLeverageFromDuration } from "@/lib/portfolio/bondLeverage";
import { buildHolding, type HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { stripScenarioRefs } from "@/lib/persistence/storeHelpers";
import {
  blendedCAGRFromLegs,
  isLivePriceable,
  type AccountId,
  type BondTypeAllocation,
  type CommodityBreakdown,
  type CompositionLeg,
  type GeographyAllocation,
  type HoldingId,
  type Household,
  type Scenario,
  type StyleBoxAllocation,
} from "@/lib/types";
import { newHoldingId } from "./entityId";
import {
  applyLivePriceTo,
  mapHolding,
  updateHolding,
  updateHoldingPrice,
  updateHoldingShares,
  updateHoldingValue,
} from "./_householdInternals";

export type HoldingsActions = {
  createHolding: (accountId: AccountId, input: HoldingCreateInput) => void;
  removeHolding: (holdingId: HoldingId) => void;
  setHoldingCAGR: (holdingId: HoldingId, value: number) => void;
  setHoldingLeverage: (holdingId: HoldingId, value: number) => void;
  setHoldingValue: (holdingId: HoldingId, value: number) => void;
  setHoldingShares: (holdingId: HoldingId, shares: number) => void;
  setHoldingPrice: (
    holdingId: HoldingId,
    priceUSD: number,
    opts?: { manual?: boolean },
  ) => void;
  applyLivePrice: (
    symbol: string,
    priceUSD: number,
    pricedAt: number,
    mode?: "live" | "historical",
  ) => void;
  convertHoldingToLive: (
    holdingId: HoldingId,
    livePrice: number,
    pricedAt: number,
  ) => void;
  /**
   * Inverse of convertHoldingToLive: switch a live-priceable
   * holding to manual price tracking, freezing its current dollar
   * value. The user is saying "stop auto-refreshing this; I'll
   * maintain it myself." The PriceRefresher loop honors
   * `isManualPrice=true` and skips the holding from then on.
   *
   * UX motivation: previously the only way to stop a holding from
   * live-updating was to delete + re-add it. A user editing
   * historical values during time-travel had no way to make those
   * values stick across reloads (the next live-refresh would
   * overwrite shares × livePrice on whatever values IDB held).
   */
  convertHoldingToManual: (holdingId: HoldingId) => void;
  setHoldingStyleBox: (
    holdingId: HoldingId,
    styleBox: StyleBoxAllocation,
  ) => void;
  setHoldingGeography: (
    holdingId: HoldingId,
    geography: GeographyAllocation,
  ) => void;
  setHoldingBondType: (
    holdingId: HoldingId,
    bondType: BondTypeAllocation,
  ) => void;
  setHoldingDuration: (holdingId: HoldingId, years: number) => void;
  resetBondLeverageToAuto: (holdingId: HoldingId) => void;
  setHoldingAcquiredAt: (
    holdingId: HoldingId,
    timestamp: number | null,
  ) => void;
  setHoldingComposition: (
    holdingId: HoldingId,
    composition: CompositionLeg[] | null,
  ) => void;
  setHoldingCommodityBreakdown: (
    holdingId: HoldingId,
    breakdown: CommodityBreakdown | null,
  ) => void;
  setHoldingIsPrimaryResidence: (holdingId: HoldingId, value: boolean) => void;
  setHoldingIsIlliquid: (holdingId: HoldingId, value: boolean) => void;
  setHoldingExcludeFromCashBucketSale: (
    holdingId: HoldingId,
    value: boolean,
  ) => void;
};

/** Cross-slice fields the holdings actions write to. */
export type HoldingsActionsContext = {
  household: Household;
  scenarios: Scenario[];
  editingHoldingId: string | null;
  creatingHoldingForAccountId: string | null;
};

export function createHoldingsActions(
  set: (
    fn: (s: HoldingsActionsContext) => Partial<HoldingsActionsContext>,
  ) => void,
): HoldingsActions {
  return {
    createHolding: (accountId, input) => {
      const id = newHoldingId();
      const holding = buildHolding(id, input);
      if (!holding) return;
      set((s) => ({
        household: {
          ...s.household,
          accounts: s.household.accounts.map((a) =>
            a.id === accountId
              ? { ...a, holdings: [...a.holdings, holding] }
              : a,
          ),
        },
        // Close the creator modal once the holding is added.
        creatingHoldingForAccountId: null,
      }));
    },

    removeHolding: (holdingId) =>
      set((s) => ({
        household: {
          ...s.household,
          accounts: s.household.accounts.map((a) => ({
            ...a,
            holdings: a.holdings.filter((h) => h.id !== holdingId),
          })),
        },
        // Cascade: strip any scenario overrides keyed off this
        // holding so a deleted holding doesn't leave dangling
        // cagrOverrides that would silently distort scenario
        // projections.
        scenarios: stripScenarioRefs(s.scenarios, {
          holdingIds: [holdingId],
        }),
        editingHoldingId:
          s.editingHoldingId === holdingId ? null : s.editingHoldingId,
      })),

    setHoldingCAGR: (id, value) =>
      set((s) => updateHolding(s, id, { expectedRealCAGR: value })),

    setHoldingLeverage: (id, value) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          // For bonds, an explicit leverage edit means the user
          // wants this value frozen — flip the manual flag so
          // subsequent duration changes don't silently overwrite.
          if (h.kind === "bond") {
            return { ...h, leverage: value, bondLeverageIsManual: true };
          }
          return { ...h, leverage: value };
        }),
      ),

    setHoldingValue: (id, value) =>
      set((s) => updateHoldingValue(s, id, value)),

    setHoldingShares: (id, shares) =>
      set((s) => updateHoldingShares(s, id, shares)),

    setHoldingPrice: (id, priceUSD, opts) =>
      set((s) =>
        updateHoldingPrice(s, id, priceUSD, opts?.manual ?? true, Date.now()),
      ),

    applyLivePrice: (symbol, priceUSD, pricedAt, mode) =>
      set((s) => applyLivePriceTo(s, symbol, priceUSD, pricedAt, mode)),

    convertHoldingToLive: (id, livePrice, pricedAt) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          if (!isLivePriceable(h)) return h;
          if (livePrice <= 0) return h;
          // PRESERVE SHARES, not value. User-reported MAJOR bug:
          // previously this recomputed `shares = value / livePrice`
          // which destroyed the user's share count when they
          // resumed live tracking from a manual price. For TQQQ
          // owned at 100 shares × $52 manual = $5,200, switching
          // to live ($84) used to give shares = $5,200/$84 = 61.9
          // — silently dropped 38 shares.
          //
          // The user owns a position MEASURED IN SHARES (for any
          // live-priceable instrument — ETFs, stocks, bonds).
          // Resuming live tracking should update the PRICE while
          // keeping the share count intact. Value floats to the
          // new shares × live price.
          return {
            ...h,
            shares: h.shares,
            lastPriceUSD: livePrice,
            lastPricedAt: pricedAt,
            isManualPrice: false,
            valueUSD: h.shares * livePrice,
          };
        }),
      ),

    convertHoldingToManual: (id) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          if (!isLivePriceable(h)) return h;
          // Just flip the manual flag — value, shares, lastPriceUSD
          // are all preserved at whatever they are right now. The
          // PriceRefresher will skip this holding from now on.
          return { ...h, isManualPrice: true };
        }),
      ),

    setHoldingStyleBox: (id, styleBox) =>
      set((s) => updateHolding(s, id, { styleBox })),
    setHoldingGeography: (id, geography) =>
      set((s) => updateHolding(s, id, { geography })),
    setHoldingBondType: (id, bondType) =>
      set((s) => updateHolding(s, id, { bondType })),

    setHoldingDuration: (id, years) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          // Duration only applies to bonds — silently no-op on
          // any other kind (the editor only surfaces duration for
          // bonds anyway, but guard defensively).
          if (h.kind !== "bond") return h;
          // Holdings predating this flag default to manual —
          // preserves existing leverage values across the upgrade.
          const isManual = h.bondLeverageIsManual ?? true;
          return {
            ...h,
            averageDurationYears: years,
            leverage: isManual
              ? h.leverage
              : bondLeverageFromDuration(years),
          };
        }),
      ),

    resetBondLeverageToAuto: (id) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          if (h.kind !== "bond") return h;
          return {
            ...h,
            bondLeverageIsManual: false,
            leverage: bondLeverageFromDuration(h.averageDurationYears),
          };
        }),
      ),

    setHoldingAcquiredAt: (id, timestamp) =>
      set((s) => updateHolding(s, id, { acquiredAt: timestamp })),

    setHoldingCommodityBreakdown: (id, breakdown) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          if (h.kind !== "commodity") return h;
          if (breakdown === null) {
            const { breakdown: _drop, ...rest } = h;
            return rest as typeof h;
          }
          return { ...h, breakdown };
        }),
      ),

    setHoldingComposition: (id, composition) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          // Composition is supported on all priced multi-asset
          // wrappers: equity (NTSX, GDE, RSST), bond, crypto, and
          // commodity. Cash / real-estate / private-stock / other
          // are atomic and don't carry composition.
          if (
            h.kind !== "equity" &&
            h.kind !== "bond" &&
            h.kind !== "crypto" &&
            h.kind !== "commodity"
          ) {
            return h;
          }
          if (composition === null) {
            const { composition: _drop, ...rest } = h;
            return rest as typeof h;
          }
          // Re-derive the wrapper's expectedRealCAGR from the legs
          // so every consumer that reads the scalar
          // (projectIndependence, accountWeightedCAGR,
          // futureAllocation) stays consistent with the leg-driven
          // computePortfolio.weightedRealCAGR. Pure sum-of-weights
          // × leg-rate — for NTSX [E 0.9 @ 7%, B 0.6 @ 1.5%] this
          // lands at 7.2%, matching the preset.
          return {
            ...h,
            composition,
            expectedRealCAGR: blendedCAGRFromLegs(composition),
          };
        }),
      ),

    setHoldingIsPrimaryResidence: (id, value) =>
      set((s) =>
        mapHolding(s, id, (h) =>
          h.kind === "real_estate"
            ? { ...h, isPrimaryResidence: value }
            : h,
        ),
      ),

    setHoldingIsIlliquid: (id, value) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          // private_stock is always illiquid (the kind itself
          // encodes that). The rest carry the optional isIlliquid
          // override; real-estate also has isPrimaryResidence (a
          // more specific flag). Both are honored by isLiquid().
          if (h.kind === "private_stock") return h;
          return { ...h, isIlliquid: value };
        }),
      ),

    setHoldingExcludeFromCashBucketSale: (id, value) =>
      set((s) =>
        mapHolding(s, id, (h) => {
          // private_stock is already excluded structurally (illiquid
          // → not in the cash-bucket sale candidates). Flagging is
          // a no-op there; preserve the existing shape.
          if (h.kind === "private_stock") return h;
          return { ...h, excludeFromCashBucketSale: value };
        }),
      ),
  };
}
