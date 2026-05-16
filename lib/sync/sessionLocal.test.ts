// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  generateSessionId,
  isWithinClaimGrace,
  readLocalSession,
  readLocalSessionId,
  writeLocalSessionId,
  SESSION_CLAIM_GRACE_MS,
} from "@/lib/sync/sessionLocal";

beforeEach(() => {
  localStorage.clear();
});

describe("sessionLocal storage", () => {
  it("writes a sid + claimedAt and reads them back", () => {
    const before = Date.now();
    const id = generateSessionId();
    writeLocalSessionId(id);
    const s = readLocalSession();
    expect(s?.sid).toBe(id);
    // claimedAt must be a real wall-clock timestamp captured at
    // write time. The "active session" checks elsewhere compare
    // this against Date.now() to age out stale claims; a
    // placeholder of 1 or a stale value would mistake a fresh
    // session for an ancient one.
    expect(s?.claimedAt).toBeGreaterThanOrEqual(before);
    expect(s?.claimedAt).toBeLessThanOrEqual(Date.now());
    expect(readLocalSessionId()).toBe(id);
  });

  it("clears with null", () => {
    writeLocalSessionId("x");
    writeLocalSessionId(null);
    expect(readLocalSession()).toBeNull();
    expect(readLocalSessionId()).toBeNull();
  });

  it("falls back to v1 sid-only key for back-compat", () => {
    localStorage.setItem("wealthtrajectory.sessionId.v1", "legacy-sid");
    const s = readLocalSession();
    expect(s?.sid).toBe("legacy-sid");
    // Legacy sessions report claimedAt=0 so the grace window doesn't
    // apply to them — they need to validate normally.
    expect(s?.claimedAt).toBe(0);
    expect(isWithinClaimGrace()).toBe(false);
  });
});

describe("claim grace window", () => {
  it("isWithinClaimGrace returns true immediately after write", () => {
    writeLocalSessionId("fresh");
    expect(isWithinClaimGrace()).toBe(true);
  });

  it("isWithinClaimGrace returns false past the grace cutoff", () => {
    writeLocalSessionId("fresh");
    const fakeNow = Date.now() + SESSION_CLAIM_GRACE_MS + 1000;
    expect(isWithinClaimGrace(fakeNow)).toBe(false);
  });

  it("isWithinClaimGrace returns false when no session is stored", () => {
    expect(isWithinClaimGrace()).toBe(false);
  });
});
