import { describe, expect, it } from "vitest";
import {
  MEMBER_VIEW_SLICE_INITIAL,
  createMemberViewSliceActions,
  type MemberViewSliceState,
} from "./memberViewSlice";

function makeFakeStore() {
  let state: MemberViewSliceState = { ...MEMBER_VIEW_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<MemberViewSliceState>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("MemberView slice", () => {
  it("starts with both ids null (Household view + no persistent preference)", () => {
    expect(MEMBER_VIEW_SLICE_INITIAL.selectedMemberId).toBeNull();
    expect(MEMBER_VIEW_SLICE_INITIAL.preferredMemberId).toBeNull();
  });

  it("setSelectedMember updates the field independently", () => {
    const s = makeFakeStore();
    const a = createMemberViewSliceActions(s.set);
    a.setSelectedMember("m1");
    expect(s.state.selectedMemberId).toBe("m1");
    expect(s.state.preferredMemberId).toBeNull();
  });

  it("setPreferredMemberId updates the field independently", () => {
    const s = makeFakeStore();
    const a = createMemberViewSliceActions(s.set);
    a.setPreferredMemberId("m1");
    expect(s.state.preferredMemberId).toBe("m1");
    expect(s.state.selectedMemberId).toBeNull();
  });

  it("either field accepts null (revert to Household / no preference)", () => {
    const s = makeFakeStore();
    const a = createMemberViewSliceActions(s.set);
    a.setSelectedMember("m1");
    a.setSelectedMember(null);
    expect(s.state.selectedMemberId).toBeNull();
    a.setPreferredMemberId("m1");
    a.setPreferredMemberId(null);
    expect(s.state.preferredMemberId).toBeNull();
  });
});
