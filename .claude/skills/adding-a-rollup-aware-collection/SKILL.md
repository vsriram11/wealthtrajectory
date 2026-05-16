---
name: adding-a-rollup-aware-collection
description: Use when the user wants to add a new household-level collection that has owner-keyed members (e.g. life insurance policies, future trust distributions, custodial accounts, side businesses). The include-in-rollup flag must cascade through the new collection just like it does for accounts, liabilities, budget items, and income streams. There's a failure-driven checklist test (lib/rollupContract.test.ts) that catches new collections that ignore the flag — this skill walks through adding to it.
---

# Adding a rollup-aware collection

The rollup-include flag (`Member.includeInRollup`) is the system's single switch for "include this member in household-aggregate views." Setting it to `false` cascades through every collection keyed by `ownerId`: accounts, liabilities, budget items, income streams.

Any NEW collection you add that's similarly owner-keyed MUST cascade too. Otherwise the flag has an invisible blind spot.

`lib/rollupContract.test.ts` is the failure-driven checklist that catches this. **Add an assertion there for every new collection.**

## What "rollup-aware" means

A collection is rollup-aware if:
- Each entry has an `ownerId` pointing to a `Member`
- Household-level rollups (NW, projection, MC, savings rate, etc.) include the entry's contribution

If both are true, the collection MUST honor the include-in-rollup flag.

## The composition pattern

Existing rollup-aware collections follow ONE pattern. Mirror it for the new collection:

1. **Add the data type** in `lib/<subsystem>/<collection>.ts` with an `ownerId: MemberId` field.
2. **Add a filter helper** alongside it:
   ```ts
   export function filter<Collection>ForRollups(
     items: readonly Item[],
     memberId: MemberId | null,
     activeOwnerIds: ReadonlySet<string>,
   ): Item[] {
     if (memberId) return items.filter((i) => i.ownerId === memberId);
     return items.filter((i) => activeOwnerIds.has(i.ownerId));
   }
   ```
   The signature is consistent across collections — explicit memberId pick wins; null memberId falls through to active-owner-ids set.

3. **Wire the filter into every consumer.** Search for `filterBudgetForRollups` / `filterIncomeStreamsForRollups` to find existing call sites; the new one should be invoked the same places.

4. **Add the new collection's slice** in `lib/store/<collection>Slice.ts` following the budget/incomeStreams pattern. Plumb through:
   - `lib/store.ts` composition root
   - `lib/persistence/persistence.ts` save + load
   - `lib/persistence/dataIO.ts` export + import
   - `lib/sync/syncSafety.ts` TRACKED_COLLECTIONS for shrinkage guard
   - `lib/sync/cloudSync.ts` pull + push payloads
   - `lib/store/lifecycleSlice.ts` `hydrateFromPersisted` + `importPayload`
   - `app/_components/infra/PersistenceHydrator.tsx` change-detection diff
   - `app/_components/infra/CloudSyncer.tsx` change-detection diff
   - `app/_components/data/GoogleSyncCard.tsx` + `app/_components/data/DataIO.tsx` import paths

5. **Add the assertion to `lib/rollupContract.test.ts`.** This is the failure-driven checklist — if you don't add a line here, future contributors won't know the collection needs to cascade. The pattern:

   ```ts
   // (8) <New collection> drops items owned by an excluded member.
   const newCollFiltered = filter<Collection>ForRollups(
     s.<collection>,
     null,
     activeIds,
   );
   expect(newCollFiltered.length).toBeLessThan(before.<collection>.length);
   ```

   Add this to BOTH the "exclude a member" test AND the "re-include restores" test.

## Verification

- `npm test` — full suite + the contract test you just added
- `npx tsc --noEmit` + `npm run lint` clean

## Reference

- `lib/types.ts:activeMembers`, `householdForRollups`, `activeMemberIds` — the helper trio that every rollup filter uses
- `lib/budget/incomeStreams.ts:filterIncomeStreamsForRollups` — canonical example to copy from
- `lib/rollupContract.test.ts` — the failure-driven checklist test you must extend
