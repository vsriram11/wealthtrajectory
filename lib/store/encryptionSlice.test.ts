import { describe, expect, it } from "vitest";
import {
  ENCRYPTION_SLICE_INITIAL,
  createEncryptionSliceActions,
  type EncryptionSliceState,
} from "./encryptionSlice";

function makeFakeStore() {
  let state: EncryptionSliceState = { ...ENCRYPTION_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: EncryptionSliceState) => Partial<EncryptionSliceState>) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("EncryptionSliceState — initial", () => {
  it("starts with no passphrase and encryption disabled", () => {
    expect(ENCRYPTION_SLICE_INITIAL.encryptionPassphrase).toBeNull();
    expect(ENCRYPTION_SLICE_INITIAL.driveEncryptionEnabled).toBe(false);
  });
});

describe("setEncryptionPassphrase", () => {
  it("sets a non-empty passphrase and turns encryption on", () => {
    const s = makeFakeStore();
    const a = createEncryptionSliceActions(s.set);
    a.setEncryptionPassphrase("hunter2");
    expect(s.state.encryptionPassphrase).toBe("hunter2");
    expect(s.state.driveEncryptionEnabled).toBe(true);
  });

  it("empty string is normalized to null + does NOT flip the flag", () => {
    const s = makeFakeStore();
    const a = createEncryptionSliceActions(s.set);
    a.setEncryptionPassphrase("");
    expect(s.state.encryptionPassphrase).toBeNull();
    expect(s.state.driveEncryptionEnabled).toBe(false);
  });

  it("null passphrase clears the passphrase but preserves the flag", () => {
    const s = makeFakeStore();
    const a = createEncryptionSliceActions(s.set);
    a.setEncryptionPassphrase("hunter2");
    expect(s.state.driveEncryptionEnabled).toBe(true);
    a.setEncryptionPassphrase(null);
    expect(s.state.encryptionPassphrase).toBeNull();
    // Flag stays on so the next session knows to prompt for unlock.
    expect(s.state.driveEncryptionEnabled).toBe(true);
  });
});

describe("disableDriveEncryption", () => {
  it("clears both passphrase and flag", () => {
    const s = makeFakeStore();
    const a = createEncryptionSliceActions(s.set);
    a.setEncryptionPassphrase("hunter2");
    a.disableDriveEncryption();
    expect(s.state.encryptionPassphrase).toBeNull();
    expect(s.state.driveEncryptionEnabled).toBe(false);
  });
});
