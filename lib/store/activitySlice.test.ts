import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createActivitySliceActions,
  createActivitySliceInitial,
  type ActivitySliceState,
} from "./activitySlice";

function makeFakeStore() {
  let state: ActivitySliceState = createActivitySliceInitial();
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<ActivitySliceState>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("createActivitySliceInitial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses construction-time wall clock for lastActivityAt", () => {
    const init = createActivitySliceInitial();
    expect(init.lastActivityAt).toBe(Date.parse("2026-01-01T12:00:00Z"));
  });

  it("signOutReason starts null", () => {
    expect(createActivitySliceInitial().lastSignOutReason).toBeNull();
  });
});

describe("recordActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances lastActivityAt to current wall clock", () => {
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const s = makeFakeStore();
    const a = createActivitySliceActions(s.set);

    vi.setSystemTime(new Date("2026-01-01T12:05:00Z"));
    a.recordActivity();
    expect(s.state.lastActivityAt).toBe(Date.parse("2026-01-01T12:05:00Z"));
  });
});

describe("setLastSignOutReason", () => {
  it("sets and clears the reason", () => {
    const s = makeFakeStore();
    const a = createActivitySliceActions(s.set);
    a.setLastSignOutReason("inactivity");
    expect(s.state.lastSignOutReason).toBe("inactivity");
    a.setLastSignOutReason("other-device");
    expect(s.state.lastSignOutReason).toBe("other-device");
    a.setLastSignOutReason(null);
    expect(s.state.lastSignOutReason).toBeNull();
  });
});
