/**
 * Branded id types for household entities.
 *
 * Each entity (holding, account, liability, member, household,
 * scenario) has its own nominally-distinct id type. At runtime
 * every branded id is just a string; at compile time they're
 * structurally incompatible with each other — passing an
 * `AccountId` to an action expecting `HoldingId` fails to compile.
 *
 * Design choice: **soft brands.** The brand field is declared as
 * an OPTIONAL singleton-typed property:
 *   `type HoldingId = string & { readonly __brand?: "holding" }`
 *
 * The optionality matters. With a *required* brand, plain
 * `string` literals would fail to assign to a branded slot (no
 * runtime way to add the brand to a string). Optional means a
 * bare string is structurally compatible — its missing brand
 * field unifies with `"holding" | undefined`. That keeps
 * deserialization seams (JSON parse, IDB read, URL param, test
 * fixtures) ergonomic: no cast helpers required.
 *
 * What's still enforced: two DIFFERENT branded ids are NOT
 * assignable to each other, because their brand singletons
 * conflict (`"holding"` doesn't match `"account"`). That's
 * exactly the bug class branding catches.
 *
 * Convention:
 *   - Producers go through the `new*Id` generators in
 *     `./store/entityId.ts` — those return the correctly-branded
 *     type from a fresh UUID.
 *   - External boundaries (Drive payload, URL param) get an
 *     unbranded string. Just assign it — TypeScript widens
 *     to the branded type automatically. No explicit cast
 *     needed unless you've already typed the value otherwise.
 *
 * Note on equality: branded strings compare exactly like plain
 * strings at runtime, so `m.id === "demo-member-primary"` still
 * works.
 */

type Branded<TBrand extends string> = string & {
  readonly __entityBrand?: TBrand;
};

export type HoldingId = Branded<"holding">;
export type AccountId = Branded<"account">;
export type LiabilityId = Branded<"liability">;
export type MemberId = Branded<"member">;
export type HouseholdId = Branded<"household">;
export type ScenarioId = Branded<"scenario">;

/**
 * Boundary cast: take an unbranded string (from JSON payload,
 * URL param, IDB hydrate) and brand it as the appropriate
 * entity id. With soft brands the cast is rarely strictly
 * required — TS will accept a plain string in a branded slot
 * by widening — but these named helpers document the intent at
 * deserialization seams.
 */
export const castHoldingId = (id: string): HoldingId => id as HoldingId;
export const castAccountId = (id: string): AccountId => id as AccountId;
export const castLiabilityId = (id: string): LiabilityId =>
  id as LiabilityId;
export const castMemberId = (id: string): MemberId => id as MemberId;
export const castHouseholdId = (id: string): HouseholdId =>
  id as HouseholdId;
export const castScenarioId = (id: string): ScenarioId => id as ScenarioId;
