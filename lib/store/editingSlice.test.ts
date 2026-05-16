import { describe, expect, it } from "vitest";
import {
  EDITING_SLICE_INITIAL,
  createEditingSliceActions,
  type EditingSliceState,
} from "./editingSlice";

function makeFakeStore() {
  let state: EditingSliceState = { ...EDITING_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<EditingSliceState>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("EditingSliceState — initial", () => {
  it("starts with no editor open", () => {
    expect(EDITING_SLICE_INITIAL.editingHoldingId).toBeNull();
    expect(EDITING_SLICE_INITIAL.editingLiabilityId).toBeNull();
    expect(EDITING_SLICE_INITIAL.editingAccountId).toBeNull();
    expect(EDITING_SLICE_INITIAL.creatingAccount).toBe(false);
    expect(EDITING_SLICE_INITIAL.creatingHoldingForAccountId).toBeNull();
    expect(EDITING_SLICE_INITIAL.managingMembers).toBe(false);
  });
});

describe("holding editor", () => {
  it("begin sets id; close clears", () => {
    const s = makeFakeStore();
    const a = createEditingSliceActions(s.set);
    a.beginEditingHolding("hld-1");
    expect(s.state.editingHoldingId).toBe("hld-1");
    a.closeHoldingEditor();
    expect(s.state.editingHoldingId).toBeNull();
  });
});

describe("liability editor", () => {
  it("begin sets id; close clears", () => {
    const s = makeFakeStore();
    const a = createEditingSliceActions(s.set);
    a.beginEditingLiability("liab-1");
    expect(s.state.editingLiabilityId).toBe("liab-1");
    a.closeLiabilityEditor();
    expect(s.state.editingLiabilityId).toBeNull();
  });
});

describe("account editor / creator — mutually exclusive", () => {
  it("editing closes creating, and vice versa", () => {
    const s = makeFakeStore();
    const a = createEditingSliceActions(s.set);

    a.beginCreatingAccount();
    expect(s.state.creatingAccount).toBe(true);
    expect(s.state.editingAccountId).toBeNull();

    // Opening the editor must clear the creating flag — same modal,
    // mutually exclusive modes.
    a.beginEditingAccount("acc-1");
    expect(s.state.editingAccountId).toBe("acc-1");
    expect(s.state.creatingAccount).toBe(false);

    // And opening the creator must clear the editing id.
    a.beginCreatingAccount();
    expect(s.state.creatingAccount).toBe(true);
    expect(s.state.editingAccountId).toBeNull();

    // Close clears both.
    a.closeAccountEditor();
    expect(s.state.editingAccountId).toBeNull();
    expect(s.state.creatingAccount).toBe(false);
  });
});

describe("holding creator", () => {
  it("begin sets accountId; close clears", () => {
    const s = makeFakeStore();
    const a = createEditingSliceActions(s.set);
    a.beginCreatingHolding("acc-42");
    expect(s.state.creatingHoldingForAccountId).toBe("acc-42");
    a.closeHoldingCreator();
    expect(s.state.creatingHoldingForAccountId).toBeNull();
  });
});

describe("members sheet", () => {
  it("opens and closes the sheet flag", () => {
    const s = makeFakeStore();
    const a = createEditingSliceActions(s.set);
    a.openMembersSheet();
    expect(s.state.managingMembers).toBe(true);
    a.closeMembersSheet();
    expect(s.state.managingMembers).toBe(false);
  });
});
