// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadReminder,
  maybeIndependenceDueReminder,
  notificationPermission,
  requestNotificationPermission,
  saveReminder,
} from "@/lib/insights/reminders";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveReminder / loadReminder round-trip", () => {
  it("returns null when no reminder is stored", () => {
    expect(loadReminder()).toBeNull();
  });

  it("persists 'daily' with a next-fire ~24h from now", () => {
    const now = 1_700_000_000_000;
    const r = saveReminder("daily", now);
    expect(r.nextAt - now).toBe(24 * 60 * 60 * 1000);
    expect(loadReminder()).toEqual(r);
  });

  it("'off' clears the future fire time", () => {
    const r = saveReminder("off", 1_700_000_000_000);
    expect(r.nextAt).toBe(0);
  });

  it("rejects malformed storage", () => {
    window.localStorage.setItem("wealthtrajectory-reminder", "{not json");
    expect(loadReminder()).toBeNull();
  });
});

describe("saveReminder / loadReminder edge cases", () => {
  it("weekly cadence sets next-fire ~7 days out", () => {
    const now = 1_700_000_000_000;
    const r = saveReminder("weekly", now);
    expect(r.nextAt - now).toBe(7 * 24 * 60 * 60 * 1000);
    expect(loadReminder()).toEqual(r);
  });

  it("rejects a stored cadence outside the allowed set", () => {
    // Forged storage with an unsupported cadence value. The
    // loader must refuse to surface it — otherwise a malicious
    // sync from another browser tab could install an unexpected
    // cadence the UI doesn't know how to render.
    window.localStorage.setItem(
      "wealthtrajectory-reminder",
      JSON.stringify({ cadence: "hourly", nextAt: Date.now() }),
    );
    expect(loadReminder()).toBeNull();
  });
});

describe("notificationPermission", () => {
  it("returns 'unsupported' when Notification is undefined", () => {
    // jsdom doesn't ship Notification by default; explicitly
    // remove it in case a previous test installed a mock.
    Reflect.deleteProperty(window, "Notification");
    expect(notificationPermission()).toBe("unsupported");
  });

  it("returns the browser's permission value when Notification exists", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), { permission: "granted" }),
    });
    expect(notificationPermission()).toBe("granted");
  });
});

describe("requestNotificationPermission", () => {
  it("returns 'unsupported' when Notification is undefined", async () => {
    Reflect.deleteProperty(window, "Notification");
    await expect(requestNotificationPermission()).resolves.toBe("unsupported");
  });

  it("short-circuits to existing 'granted' without re-prompting", async () => {
    const requestSpy = vi.fn();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), {
        permission: "granted",
        requestPermission: requestSpy,
      }),
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    // Crucial: re-prompting a granted permission is at best a
    // wasted call, at worst a UX regression that re-shows the
    // permission UI in some browsers.
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("short-circuits to existing 'denied' without re-prompting", async () => {
    const requestSpy = vi.fn();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), {
        permission: "denied",
        requestPermission: requestSpy,
      }),
    });
    await expect(requestNotificationPermission()).resolves.toBe("denied");
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("calls requestPermission when status is 'default'", async () => {
    const requestSpy = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), {
        permission: "default",
        requestPermission: requestSpy,
      }),
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });
});

describe("maybeIndependenceDueReminder", () => {
  it("no-op when no reminder is configured", () => {
    expect(maybeIndependenceDueReminder()).toBe(false);
  });

  it("no-op when reminder is off", () => {
    saveReminder("off");
    expect(maybeIndependenceDueReminder()).toBe(false);
  });

  it("no-op before the next-fire time, even if permission is granted", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), { permission: "granted" }),
    });
    const now = 1_700_000_000_000;
    saveReminder("daily", now);
    expect(maybeIndependenceDueReminder(now + 1000)).toBe(false);
  });

  it("no-op when due-but-permission-not-granted", () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), { permission: "default" }),
    });
    const now = 1_700_000_000_000;
    saveReminder("daily", now);
    // Fast-forward past the due time — but permission isn't
    // granted, so the function must NOT silently fire the
    // notification. Firing without explicit user consent would
    // be a UX violation.
    expect(maybeIndependenceDueReminder(now + 25 * 60 * 60 * 1000)).toBe(false);
  });

  it("fires + reschedules when due and permission is granted", () => {
    const notificationCtor = vi.fn();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(notificationCtor, { permission: "granted" }),
    });
    const now = 1_700_000_000_000;
    saveReminder("daily", now);
    const dueAt = now + 25 * 60 * 60 * 1000;
    expect(maybeIndependenceDueReminder(dueAt)).toBe(true);
    expect(notificationCtor).toHaveBeenCalledTimes(1);
    // Reschedule contract: nextAt advances exactly 24h from the
    // firing time, not from the original next-fire time. (If we
    // rolled from the original, a user who opened the app after
    // a week off would get hammered with backlogged reminders.)
    const after = loadReminder();
    expect(after!.nextAt).toBe(dueAt + 24 * 60 * 60 * 1000);
  });

  it("swallows Notification constructor errors gracefully", () => {
    // Some browsers throw if Notification is invoked outside a
    // user gesture. We swallow that and still return true (the
    // reminder is considered "fired" for scheduling purposes).
    const throwingCtor = vi.fn(() => {
      throw new Error("not a user gesture");
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(throwingCtor, { permission: "granted" }),
    });
    const now = 1_700_000_000_000;
    saveReminder("daily", now);
    const dueAt = now + 25 * 60 * 60 * 1000;
    // Must not throw — gracefully handled inside the function.
    expect(() => maybeIndependenceDueReminder(dueAt)).not.toThrow();
  });
});
