/**
 * Member-filter view state.
 *
 * `selectedMemberId`  Current filter scope. null = household
 *                     rollup view; a member id = filter every
 *                     projection / chart to that member's slice.
 * `preferredMemberId` Persistent default applied on sign-in /
 *                     app open. Synced to Drive + IDB. If it
 *                     references a member that no longer exists,
 *                     the resolver collapses to null (Household).
 *
 * Reordering members is a household-shape mutation and lives in
 * the households / members domain, NOT here — this slice only
 * owns the per-user *filter* preference.
 */

import type { MemberId } from "@/lib/entityIds";

export type MemberViewSliceState = {
  selectedMemberId: MemberId | null;
  preferredMemberId: MemberId | null;
};

export type MemberViewSliceActions = {
  setSelectedMember: (memberId: MemberId | null) => void;
  setPreferredMemberId: (memberId: MemberId | null) => void;
};

export const MEMBER_VIEW_SLICE_INITIAL: MemberViewSliceState = {
  selectedMemberId: null,
  preferredMemberId: null,
};

export function createMemberViewSliceActions(
  set: (patch: Partial<MemberViewSliceState>) => void,
): MemberViewSliceActions {
  return {
    setSelectedMember: (id) => set({ selectedMemberId: id }),
    setPreferredMemberId: (id) => set({ preferredMemberId: id }),
  };
}
