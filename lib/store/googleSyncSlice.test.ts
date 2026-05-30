import { describe, expect, it } from "vitest";
import {
  GOOGLE_SYNC_SLICE_INITIAL,
  createGoogleSyncSliceActions,
  type GoogleSyncSliceState,
} from "./googleSyncSlice";

function makeFakeStore() {
  let state: GoogleSyncSliceState = { ...GOOGLE_SYNC_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<GoogleSyncSliceState>) => {
      state = { ...state, ...patch };
    },
    get: () => state,
  };
}

describe("GOOGLE_SYNC_SLICE_INITIAL", () => {
  it("starts with all sync flags off", () => {
    expect(GOOGLE_SYNC_SLICE_INITIAL.googleSyncing).toBe(false);
    expect(GOOGLE_SYNC_SLICE_INITIAL.googleSyncError).toBeNull();
    expect(GOOGLE_SYNC_SLICE_INITIAL.googleLastSyncAt).toBeNull();
    expect(GOOGLE_SYNC_SLICE_INITIAL.googleSyncBlockedReason).toBeNull();
    expect(GOOGLE_SYNC_SLICE_INITIAL.googleUploadScheduled).toBe(false);
    expect(GOOGLE_SYNC_SLICE_INITIAL.lastSyncOutcome).toBeNull();
  });
});

describe("setGoogleSyncState", () => {
  it("accepts a partial patch and writes multiple fields atomically", () => {
    const s = makeFakeStore();
    const a = createGoogleSyncSliceActions(s.set, s.get);
    a.setGoogleSyncState({
      googleSyncing: true,
      googleLastSyncAt: 1_700_000_000_000,
      googleSyncError: null,
    });
    expect(s.state.googleSyncing).toBe(true);
    expect(s.state.googleLastSyncAt).toBe(1_700_000_000_000);
    expect(s.state.googleSyncError).toBeNull();
  });

  it("fields not in the patch are preserved", () => {
    const s = makeFakeStore();
    const a = createGoogleSyncSliceActions(s.set, s.get);
    a.setGoogleSyncState({ googleSyncing: true });
    a.setGoogleSyncState({ googleSyncError: "boom" });
    expect(s.state.googleSyncing).toBe(true); // preserved
    expect(s.state.googleSyncError).toBe("boom");
  });
});

describe("dismissSyncOutcome", () => {
  it("clears lastSyncOutcome to null", () => {
    const s = makeFakeStore();
    const a = createGoogleSyncSliceActions(s.set, s.get);
    a.setGoogleSyncState({ lastSyncOutcome: "imported" });
    expect(s.state.lastSyncOutcome).toBe("imported");
    a.dismissSyncOutcome();
    expect(s.state.lastSyncOutcome).toBeNull();
  });
});

describe("bumpSnapshotsRevision (R1-D3 audit pin)", () => {
  it("starts at 0", () => {
    expect(GOOGLE_SYNC_SLICE_INITIAL.snapshotsRevision).toBe(0);
  });

  it("increments by 1 each call (monotonic)", () => {
    const s = makeFakeStore();
    const a = createGoogleSyncSliceActions(s.set, s.get);
    expect(s.state.snapshotsRevision).toBe(0);
    a.bumpSnapshotsRevision();
    expect(s.state.snapshotsRevision).toBe(1);
    a.bumpSnapshotsRevision();
    a.bumpSnapshotsRevision();
    expect(s.state.snapshotsRevision).toBe(3);
  });

  it("each bump produces a fresh-reference state patch (Zustand subscribe semantics)", () => {
    // CloudSyncer compares `state.snapshotsRevision === prev.snapshotsRevision`
    // — primitive identity works for numbers, so bumping the
    // counter to a new value MUST cause that strict-equality check
    // to fail. This test pins the contract that bumpSnapshotsRevision
    // always increases the counter (it's not idempotent or stateful).
    const s = makeFakeStore();
    const a = createGoogleSyncSliceActions(s.set, s.get);
    const before = s.state.snapshotsRevision;
    a.bumpSnapshotsRevision();
    expect(s.state.snapshotsRevision).not.toBe(before);
  });
});
