/**
 * Pure helper functions for the AppStore. Each is independent of
 * the store itself (no `set`/`get` calls) — they take state slices
 * as inputs and return new state slices. Splitting them out keeps
 * `store.ts` focused on the wiring (state shape + action handlers)
 * and lets each helper be unit-tested in isolation.
 */

import type { Assumptions, Holding, Household, Scenario } from "@/lib/types";

/**
 * Returns `pref` if it refers to a member that still exists in
 * `household`, otherwise null. Used to defensively re-resolve the
 * "preferred member" id after any household mutation that could
 * remove the referenced member.
 */
export function resolvePreferredMemberId(
  preferredId: string | null | undefined,
  household: Household,
): string | null {
  if (preferredId == null) return null;
  return household.members.some((m) => m.id === preferredId)
    ? preferredId
    : null;
}

/**
 * Drop any memberAssumptions entries whose memberId no longer
 * exists in the imported household — protects against stale
 * entries that could leak in if a user removed a member
 * out-of-band (e.g. via a Drive import that doesn't include them).
 */
export function filterMemberAssumptionsToHousehold(
  memberAssumptions: Record<string, Partial<Assumptions>>,
  household: Household,
): Record<string, Partial<Assumptions>> {
  const valid = new Set(household.members.map((m) => m.id));
  const filtered: Record<string, Partial<Assumptions>> = {};
  for (const [id, entry] of Object.entries(memberAssumptions)) {
    if (valid.has(id) && Object.keys(entry).length > 0) {
      filtered[id] = entry;
    }
  }
  return filtered;
}

/**
 * Strip stale entity references out of every scenario's overrides.
 * Called after holding / account deletion so a deleted entity ID
 * doesn't linger in `holdingCAGRs[id]` or `accountContributions[id]`
 * (where it would silently distort projections without warning).
 *
 * Returns the same array reference when nothing changed — keeps
 * the CloudSyncer / PersistenceHydrator diff checks from over-firing.
 */
export function stripScenarioRefs(
  scenarios: Scenario[],
  refs: { holdingIds?: string[]; accountIds?: string[] },
): Scenario[] {
  const holdingSet = new Set(refs.holdingIds ?? []);
  const accountSet = new Set(refs.accountIds ?? []);
  if (holdingSet.size === 0 && accountSet.size === 0) return scenarios;

  let arrayMutated = false;
  const next = scenarios.map((sc) => {
    let touched = false;
    let nextOverrides = sc.overrides;

    if (holdingSet.size > 0 && nextOverrides.holdingCAGRs) {
      const filtered: Record<string, number> = {};
      let dropped = 0;
      for (const [id, v] of Object.entries(nextOverrides.holdingCAGRs)) {
        if (holdingSet.has(id)) dropped += 1;
        else filtered[id] = v;
      }
      if (dropped > 0) {
        nextOverrides = { ...nextOverrides, holdingCAGRs: filtered };
        touched = true;
      }
    }

    if (accountSet.size > 0 && nextOverrides.accountContributions) {
      const filtered: Record<string, number> = {};
      let dropped = 0;
      for (const [id, v] of Object.entries(
        nextOverrides.accountContributions,
      )) {
        if (accountSet.has(id)) dropped += 1;
        else filtered[id] = v;
      }
      if (dropped > 0) {
        nextOverrides = {
          ...nextOverrides,
          accountContributions: filtered,
        };
        touched = true;
      }
    }

    if (!touched) return sc;
    arrayMutated = true;
    return { ...sc, overrides: nextOverrides };
  });
  return arrayMutated ? next : scenarios;
}

/**
 * Merge fresher live-price timestamps from the current in-memory
 * household into an incoming-from-import household.
 *
 * Why: PriceRefresher fetches live quotes in the background and
 * stamps each holding with `lastPricedAt`. A Drive backup written
 * earlier carries older timestamps. When the user unlocks Drive
 * and pullFromDrive triggers importPayload, the wholesale household
 * replace would clobber the fresh local prices. This merge prevents
 * that.
 *
 * For each incoming holding, if a same-id holding exists locally
 * with a strictly newer `lastPricedAt` AND a positive price/value,
 * use the local pricing fields. Otherwise keep the incoming values.
 * Shares always come from incoming (it's the canonical structural
 * state); only the price snapshot is being conditionally replaced.
 *
 * Only touches equity / bond / crypto / commodity / private_stock —
 * the holding kinds that have live-price fields. cash + real_estate
 * + other don't carry lastPricedAt and pass through untouched.
 */
export function mergeFresherPrices(
  incoming: Household,
  current: Household,
): Household {
  type Pricing = {
    lastPriceUSD: number;
    lastPricedAt: number | null;
    isManualPrice: boolean;
    valueUSD: number;
    shares: number;
  };

  const PRICED_KINDS = new Set([
    "equity",
    "bond",
    "crypto",
    "commodity",
    "private_stock",
  ]);

  const localById = new Map<string, Holding>();
  for (const account of current.accounts) {
    for (const holding of account.holdings) {
      localById.set(holding.id, holding);
    }
  }

  return {
    ...incoming,
    accounts: incoming.accounts.map((account) => ({
      ...account,
      holdings: account.holdings.map((incomingHolding) => {
        if (!PRICED_KINDS.has(incomingHolding.kind)) return incomingHolding;
        const localHolding = localById.get(incomingHolding.id);
        if (!localHolding) return incomingHolding;
        if (!PRICED_KINDS.has(localHolding.kind)) return incomingHolding;

        const incomingPricing = incomingHolding as Holding & Partial<Pricing>;
        const localPricing = localHolding as Holding & Partial<Pricing>;
        const incomingTs = incomingPricing.lastPricedAt ?? 0;
        const localTs = localPricing.lastPricedAt ?? 0;

        const localIsNewer =
          localTs > incomingTs &&
          (localPricing.lastPriceUSD ?? 0) > 0 &&
          (localPricing.valueUSD ?? 0) > 0;
        if (!localIsNewer) return incomingHolding;

        return {
          ...incomingHolding,
          lastPriceUSD: localPricing.lastPriceUSD,
          lastPricedAt: localPricing.lastPricedAt,
          isManualPrice: localPricing.isManualPrice ?? false,
          valueUSD: localPricing.valueUSD,
        } as Holding;
      }),
    })),
  };
}
