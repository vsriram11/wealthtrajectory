/**
 * Schema migrations for state coming in from older persistence
 * formats — IndexedDB rehydration on app start AND Google Drive
 * backup imports. Each migration is idempotent: running it against
 * already-current data is a no-op.
 *
 * The data layer doesn't carry an explicit schema version because
 * net-new shapes are easier to detect by "is this field missing?"
 * than by managing a version-number coupling between every commit
 * and every persisted payload. Each migration documents its own
 * upgrade signal.
 */

import type { BudgetItem } from "@/lib/budget/budget";
import type { Household } from "@/lib/types";

/**
 * Backfill fields added in later versions onto deserialized data.
 *
 * Currently:
 *   - private_stock.leverage (new in v15) defaults to 1×
 *
 * Run from importPayload (Drive backup) and hydrateFromPersisted
 * (IndexedDB) so any older payload is normalized before it reaches
 * the rest of the engine. New writes always include the field.
 */
export function migrateHousehold(household: Household): Household {
  let touched = false;
  const accounts = household.accounts.map((account) => {
    let accountTouched = false;
    const holdings = account.holdings.map((holding) => {
      if (
        holding.kind === "private_stock" &&
        (holding as { leverage?: number }).leverage == null
      ) {
        accountTouched = true;
        return { ...holding, leverage: 1 };
      }
      return holding;
    });
    if (accountTouched) {
      touched = true;
      return { ...account, holdings };
    }
    return account;
  });
  return touched ? { ...household, accounts } : household;
}

/**
 * One-shot migration: if legacy `householdAnnualIncomeUSD` is set
 * but no member has an individual income, attribute the legacy
 * total to the first member. Per-member income is the new source
 * of truth; the household-level field becomes a back-compat shim
 * that's cleared after migration.
 *
 * Idempotent: re-running with a household that already has
 * member-level income leaves it untouched.
 */
export function migrateLegacyHouseholdIncome(
  household: Household,
  legacyIncomeUSD: number | null | undefined,
): Household {
  if (
    legacyIncomeUSD == null ||
    !Number.isFinite(legacyIncomeUSD) ||
    legacyIncomeUSD <= 0
  ) {
    return household;
  }
  if (household.members.length === 0) return household;
  const someMemberHasIncome = household.members.some(
    (m) => m.incomeUSD != null && m.incomeUSD > 0,
  );
  if (someMemberHasIncome) return household;
  const [first, ...rest] = household.members;
  return {
    ...household,
    members: [{ ...first, incomeUSD: legacyIncomeUSD }, ...rest],
  };
}

/**
 * Backfill ownerId on legacy BudgetItem records that predate
 * per-member budget. Assigns each unattributed item to the first
 * member of the household. Also strips items whose ownerId points
 * to a member that no longer exists (orphan cleanup).
 *
 * Also migrates the brief-lived `inflationOverride` (nominal
 * annual) field into the current `excessInflationOverride`
 * (real-excess above CPI). The shift was a clean rename + units
 * change — subtracting the 3% CPI baseline keeps the user's
 * semantic intent stable across the migration.
 *
 * Idempotent: items with valid ownerId + current shape pass through.
 */
export function migrateBudgetItems(
  items: BudgetItem[] | undefined,
  household: Household,
): BudgetItem[] {
  if (!items || items.length === 0) return items ?? [];
  if (household.members.length === 0) return items;
  const validMemberIds = new Set(household.members.map((m) => m.id));
  const fallbackOwner = household.members[0].id;
  const migrated: BudgetItem[] = [];
  for (const raw of items) {
    let item = raw;
    if (!item.ownerId || !validMemberIds.has(item.ownerId)) {
      item = { ...item, ownerId: fallbackOwner };
    }
    // Migrate the brief-lived `inflationOverride` (nominal annual)
    // shape into the current `excessInflationOverride` (real-excess
    // above CPI). Safe to run idempotently: if both fields exist,
    // the existing excessInflationOverride wins.
    const legacy = (item as unknown as { inflationOverride?: number | null })
      .inflationOverride;
    if (
      item.excessInflationOverride == null &&
      typeof legacy === "number" &&
      Number.isFinite(legacy)
    ) {
      item = {
        ...item,
        excessInflationOverride: Math.max(-0.1, Math.min(0.5, legacy - 0.03)),
      };
    }
    if ("inflationOverride" in item) {
      const { inflationOverride: _drop, ...rest } = item as BudgetItem & {
        inflationOverride?: unknown;
      };
      item = rest;
    }
    migrated.push(item);
  }
  return migrated;
}
