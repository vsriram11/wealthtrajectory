/**
 * Per-member mutation actions.
 *
 * Cross-slice writes:
 *   - `removeMember` reads `budgetItems` to enforce the "no
 *     dependents" precondition (a member with budget items still
 *     attributed to them can't be removed). It also clears
 *     matching entries from `memberAssumptions`, `selectedMemberId`,
 *     and `preferredMemberId` so those don't reference a removed id.
 */

import type {
  Assumptions,
  Household,
  Member,
  MemberId,
} from "@/lib/types";
import type { BudgetItem } from "@/lib/budget/budget";
import { newMemberId } from "./entityId";

export type MembersActions = {
  addMember: (displayName: string) => MemberId;
  renameMember: (id: MemberId, displayName: string) => void;
  /**
   * Remove a member. Returns false (no-op) when the member still
   * owns accounts / liabilities / budget items, or when removing
   * would leave the household empty. Otherwise removes the member
   * + cascades to clear referencing fields across slices.
   */
  removeMember: (id: MemberId) => boolean;
  setMemberIncome: (id: MemberId, incomeUSD: number | null) => void;
  setMemberAge: (id: MemberId, age: number | null) => void;
  /**
   * Toggle whether a member feeds household-level rollups.
   *
   * Returns false (no-op) when setting `value=false` would leave
   * the household with zero rollup-active members — household
   * income / age helpers would then have no input and downstream
   * surfaces (Fed-SCF percentile band, projection horizon) would
   * fall back to "no data". We mirror the `removeMember` ≥1-member
   * floor here so the rollup is never empty by construction.
   *
   * Otherwise returns true after writing the flag.
   */
  setMemberIncludeInRollup: (id: MemberId, value: boolean) => boolean;
  reorderMembers: (orderedIds: MemberId[]) => void;
};

export type MembersActionsContext = {
  household: Household;
  memberAssumptions: Record<string, Partial<Assumptions>>;
  selectedMemberId: MemberId | null;
  preferredMemberId: MemberId | null;
  budgetItems: BudgetItem[];
};

export function createMembersActions(
  set: (
    fn: (s: MembersActionsContext) => Partial<MembersActionsContext>,
  ) => void,
  get: () => MembersActionsContext,
): MembersActions {
  return {
    addMember: (displayName) => {
      const trimmed = displayName.trim() || "Member";
      const id = newMemberId();
      const m: Member = { id, displayName: trimmed };
      set((s) => ({
        household: {
          ...s.household,
          members: [...s.household.members, m],
        },
      }));
      return id;
    },

    renameMember: (id, displayName) => {
      const trimmed = displayName.trim();
      if (!trimmed) return;
      set((s) => ({
        household: {
          ...s.household,
          members: s.household.members.map((m) =>
            m.id === id ? { ...m, displayName: trimmed } : m,
          ),
        },
      }));
    },

    setMemberIncome: (id, incomeUSD) => {
      // Coerce to null when null / non-finite. 0 is a valid earner
      // state (between jobs / retired) and reserves null for "not
      // entered yet"; negative numbers clamp to 0.
      const next =
        incomeUSD == null || !Number.isFinite(incomeUSD)
          ? null
          : Math.max(0, incomeUSD);
      set((s) => ({
        household: {
          ...s.household,
          members: s.household.members.map((m) =>
            m.id === id ? { ...m, incomeUSD: next } : m,
          ),
        },
      }));
    },

    setMemberAge: (id, age) => {
      const next =
        age == null || !Number.isFinite(age) || age <= 0
          ? null
          : Math.round(age);
      set((s) => ({
        household: {
          ...s.household,
          members: s.household.members.map((m) =>
            m.id === id ? { ...m, age: next } : m,
          ),
        },
      }));
    },

    setMemberIncludeInRollup: (id, value) => {
      const s = get();
      const target = s.household.members.find((m) => m.id === id);
      // No-op when the member isn't in the household, or the value
      // already matches (cheap precondition that avoids a wasteful
      // re-render).
      const current = target?.includeInRollup !== false;
      if (!target || current === value) return false;
      if (!value) {
        // Refuse to flip the last active member off — keeps the
        // rollup non-empty by construction so downstream surfaces
        // never have to handle a zero-active-member fallback.
        const activeCount = s.household.members.filter(
          (m) => m.includeInRollup !== false,
        ).length;
        if (activeCount <= 1) return false;
      }
      set((cur) => ({
        household: {
          ...cur.household,
          members: cur.household.members.map((m) =>
            m.id === id ? { ...m, includeInRollup: value } : m,
          ),
        },
      }));
      return true;
    },

    removeMember: (id) => {
      const s = get();
      const hasAccts = s.household.accounts.some((a) => a.ownerId === id);
      const hasLiab = s.household.liabilities.some((l) => l.ownerId === id);
      const hasBudget = s.budgetItems.some((b) => b.ownerId === id);
      if (hasAccts || hasLiab || hasBudget) return false;
      if (s.household.members.length <= 1) return false;
      set((cur) => {
        const nextMA = { ...cur.memberAssumptions };
        delete nextMA[id];
        return {
          household: {
            ...cur.household,
            members: cur.household.members.filter((m) => m.id !== id),
          },
          memberAssumptions: nextMA,
          selectedMemberId:
            cur.selectedMemberId === id ? null : cur.selectedMemberId,
          // If the removed member was the persistent default, fall
          // back to Household so the next refresh doesn't load a
          // ghost id.
          preferredMemberId:
            cur.preferredMemberId === id ? null : cur.preferredMemberId,
        };
      });
      return true;
    },

    reorderMembers: (orderedIds) =>
      set((s) => {
        const byId = new Map(s.household.members.map((m) => [m.id, m]));
        const seen = new Set<string>();
        const reordered: Member[] = [];
        for (const id of orderedIds) {
          const m = byId.get(id);
          if (m && !seen.has(id)) {
            reordered.push(m);
            seen.add(id);
          }
        }
        // Safety net: any member missing from the input list keeps
        // its current relative position at the tail.
        for (const m of s.household.members) {
          if (!seen.has(m.id)) reordered.push(m);
        }
        return {
          household: { ...s.household, members: reordered },
        };
      }),
  };
}
