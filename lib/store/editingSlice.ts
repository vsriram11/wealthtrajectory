/**
 * Modal / editor state. Tracks which (if any) entity is currently
 * being edited or created, plus the "managing members" sheet flag.
 *
 * Every action is a thin setter. The slightly-richer ones are the
 * account-editor toggles, which preserve the invariant
 *   editingAccountId ≠ null   ⇒   creatingAccount === false
 * because the same modal hosts both flows.
 *
 * No cross-slice writes — these fields exist purely to drive the
 * presence of the relevant modal/sheet component.
 */

import type {
  AccountId,
  HoldingId,
  LiabilityId,
} from "@/lib/entityIds";

export type EditingSliceState = {
  /** ID of the holding open in the editor, or null. */
  editingHoldingId: HoldingId | null;
  /** ID of the liability open in the editor, or null. */
  editingLiabilityId: LiabilityId | null;
  /** ID of the account open in the editor, or null. */
  editingAccountId: AccountId | null;
  /** True when the "add account" modal is open. */
  creatingAccount: boolean;
  /** ID of the account whose "add holding" modal is open, or null. */
  creatingHoldingForAccountId: AccountId | null;
  /** True when the manage-household-members sheet is open. */
  managingMembers: boolean;
};

export type EditingSliceActions = {
  beginEditingHolding: (id: HoldingId) => void;
  closeHoldingEditor: () => void;
  beginEditingLiability: (id: LiabilityId) => void;
  closeLiabilityEditor: () => void;
  beginEditingAccount: (id: AccountId) => void;
  beginCreatingAccount: () => void;
  closeAccountEditor: () => void;
  beginCreatingHolding: (accountId: AccountId) => void;
  closeHoldingCreator: () => void;
  openMembersSheet: () => void;
  closeMembersSheet: () => void;
};

export const EDITING_SLICE_INITIAL: EditingSliceState = {
  editingHoldingId: null,
  editingLiabilityId: null,
  editingAccountId: null,
  creatingAccount: false,
  creatingHoldingForAccountId: null,
  managingMembers: false,
};

export function createEditingSliceActions(
  set: (patch: Partial<EditingSliceState>) => void,
): EditingSliceActions {
  return {
    beginEditingHolding: (id) => set({ editingHoldingId: id }),
    closeHoldingEditor: () => set({ editingHoldingId: null }),
    beginEditingLiability: (id) => set({ editingLiabilityId: id }),
    closeLiabilityEditor: () => set({ editingLiabilityId: null }),
    beginEditingAccount: (id) =>
      set({ editingAccountId: id, creatingAccount: false }),
    beginCreatingAccount: () =>
      set({ creatingAccount: true, editingAccountId: null }),
    closeAccountEditor: () =>
      set({ editingAccountId: null, creatingAccount: false }),
    beginCreatingHolding: (accountId) =>
      set({ creatingHoldingForAccountId: accountId }),
    closeHoldingCreator: () => set({ creatingHoldingForAccountId: null }),
    openMembersSheet: () => set({ managingMembers: true }),
    closeMembersSheet: () => set({ managingMembers: false }),
  };
}
