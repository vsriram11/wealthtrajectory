/**
 * Per-liability mutation actions.
 *
 * No cross-slice writes — liabilities don't participate in
 * scenarios or have an editor modal of their own (yet).
 * `updateLiability` is a flat partial-patch.
 *
 * Mortgages are intentionally NOT modeled as liabilities — they
 * live on the corresponding real-estate holding's `leverage`
 * field so net worth subtracts the mortgage automatically and
 * stress tests apply the leverage multiplier correctly. Use this
 * slice only for non-mortgage debts: credit cards, student loans,
 * auto loans, personal loans, HELOCs not tied to real estate.
 */

import type { Household, Liability, LiabilityId, MemberId } from "@/lib/types";
import { newLiabilityId } from "./entityId";

export type LiabilitiesActions = {
  updateLiability: (id: LiabilityId, patch: Partial<Liability>) => void;
  addLiability: (input: {
    name: string;
    balanceUSD: number;
    annualInterestRate: number;
    monthlyPaymentUSD: number;
    ownerId: MemberId;
  }) => LiabilityId;
  removeLiability: (id: LiabilityId) => void;
};

export type LiabilitiesActionsContext = {
  household: Household;
};

export function createLiabilitiesActions(
  set: (
    fn: (s: LiabilitiesActionsContext) => Partial<LiabilitiesActionsContext>,
  ) => void,
): LiabilitiesActions {
  return {
    updateLiability: (id, patch) =>
      set((s) => ({
        household: {
          ...s.household,
          liabilities: s.household.liabilities.map((l) =>
            l.id === id ? { ...l, ...patch } : l,
          ),
        },
      })),

    addLiability: (input) => {
      const id = newLiabilityId();
      const liab: Liability = {
        id,
        name: input.name.trim() || "Liability",
        balanceUSD: Math.max(0, input.balanceUSD),
        annualInterestRate: Math.max(0, input.annualInterestRate),
        monthlyPaymentUSD: Math.max(0, input.monthlyPaymentUSD),
        ownerId: input.ownerId,
      };
      set((s) => ({
        household: {
          ...s.household,
          liabilities: [...s.household.liabilities, liab],
        },
      }));
      return id;
    },

    removeLiability: (id) =>
      set((s) => ({
        household: {
          ...s.household,
          liabilities: s.household.liabilities.filter((l) => l.id !== id),
        },
      })),
  };
}
