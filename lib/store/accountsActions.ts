/**
 * Per-account mutation actions.
 *
 * Cross-slice writes:
 *   - `removeAccount` cascades into `scenarios` (strips overrides
 *     keyed by accountId AND by every holdingId nested inside)
 *     and clears `editingAccountId` if the removed account was
 *     being edited.
 */

import { stripScenarioRefs } from "@/lib/persistence/storeHelpers";
import type {
  Account,
  AccountCategory,
  AccountId,
  Household,
  MemberId,
  Scenario,
} from "@/lib/types";
import { newAccountId } from "./entityId";

export type AccountsActions = {
  setAccountContribution: (accountId: AccountId, value: number) => void;
  updateAccount: (id: AccountId, patch: Partial<Account>) => void;
  createAccount: (input: {
    displayName: string;
    category: AccountCategory;
    ownerId: MemberId;
    monthlyContributionUSD: number;
  }) => AccountId;
  removeAccount: (id: AccountId) => void;
  /**
   * Reorder accounts to match the order of the given ID list. IDs
   * not present in the current household are ignored; existing
   * accounts whose ID is missing from the list are appended in
   * their original relative order (safety net so a partial
   * reorder never loses an account).
   */
  reorderAccounts: (orderedIds: AccountId[]) => void;
};

export type AccountsActionsContext = {
  household: Household;
  scenarios: Scenario[];
  editingAccountId: AccountId | null;
};

export function createAccountsActions(
  set: (
    fn: (s: AccountsActionsContext) => Partial<AccountsActionsContext>,
  ) => void,
): AccountsActions {
  return {
    setAccountContribution: (id, value) =>
      set((s) => ({
        household: {
          ...s.household,
          accounts: s.household.accounts.map((a) =>
            a.id === id ? { ...a, monthlyContributionUSD: value } : a,
          ),
        },
      })),

    updateAccount: (id, patch) =>
      set((s) => ({
        household: {
          ...s.household,
          accounts: s.household.accounts.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        },
      })),

    createAccount: (input) => {
      const id = newAccountId();
      const acct: Account = {
        id,
        displayName: input.displayName,
        category: input.category,
        ownerId: input.ownerId,
        monthlyContributionUSD: input.monthlyContributionUSD,
        holdings: [],
      };
      set((s) => ({
        household: {
          ...s.household,
          accounts: [...s.household.accounts, acct],
        },
      }));
      return id;
    },

    removeAccount: (id) =>
      set((s) => {
        // Capture the to-be-deleted account's holding IDs so any
        // scenario overrides keyed off them get cleaned up too —
        // deleting the account would orphan them otherwise.
        const acct = s.household.accounts.find((a) => a.id === id);
        const holdingIds = acct ? acct.holdings.map((h) => h.id) : [];
        return {
          household: {
            ...s.household,
            accounts: s.household.accounts.filter((a) => a.id !== id),
          },
          scenarios: stripScenarioRefs(s.scenarios, {
            accountIds: [id],
            holdingIds,
          }),
          editingAccountId:
            s.editingAccountId === id ? null : s.editingAccountId,
        };
      }),

    reorderAccounts: (orderedIds) =>
      set((s) => {
        const byId = new Map(s.household.accounts.map((a) => [a.id, a]));
        const seen = new Set<string>();
        const reordered: Account[] = [];
        for (const id of orderedIds) {
          const acct = byId.get(id);
          if (acct && !seen.has(id)) {
            reordered.push(acct);
            seen.add(id);
          }
        }
        // Safety net: any account missing from the input list keeps
        // its current relative position at the tail. Prevents a
        // partial call from accidentally dropping accounts.
        for (const a of s.household.accounts) {
          if (!seen.has(a.id)) reordered.push(a);
        }
        return {
          household: { ...s.household, accounts: reordered },
        };
      }),
  };
}
