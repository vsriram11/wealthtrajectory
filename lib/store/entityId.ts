/**
 * Branded entity-id generators.
 *
 * Type-only definitions of the brands live in `../entityIds` so
 * they can be referenced from `../types` without creating a
 * dependency on the store layer. This file owns the runtime
 * constructors — `crypto.randomUUID()` wrapped with a debug-
 * readable prefix and the right brand.
 */

import type {
  AccountId,
  HoldingId,
  LiabilityId,
  MemberId,
} from "@/lib/entityIds";

export type EntityIdPrefix = "mem" | "acc" | "liab" | "hld";

function makeId<B extends string>(prefix: EntityIdPrefix): B {
  return `${prefix}-${crypto.randomUUID()}` as unknown as B;
}

export const newHoldingId = (): HoldingId => makeId<HoldingId>("hld");
export const newAccountId = (): AccountId => makeId<AccountId>("acc");
export const newLiabilityId = (): LiabilityId => makeId<LiabilityId>("liab");
export const newMemberId = (): MemberId => makeId<MemberId>("mem");

/**
 * Legacy generic generator returning a bare string. Kept for
 * places that don't yet thread the branded type through (e.g.
 * the `goal-` / `bud-` / `health-` / `sc-` ids generated in
 * collection slices). New entity ids should use the per-kind
 * generators above.
 *
 * @deprecated for the four household-entity kinds — prefer
 *   `newHoldingId` / `newAccountId` / `newLiabilityId` /
 *   `newMemberId`.
 */
export function makeEntityId(prefix: EntityIdPrefix): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
