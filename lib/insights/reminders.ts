export type ReminderCadence = "off" | "daily" | "weekly";

const STORAGE_KEY = "wealthtrajectory-reminder";

type StoredReminder = {
  cadence: ReminderCadence;
  nextAt: number;
};

function intervalMs(cadence: ReminderCadence): number {
  switch (cadence) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    case "off":
      return 0;
  }
}

export function loadReminder(): StoredReminder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReminder;
    if (parsed.cadence !== "off" && parsed.cadence !== "daily" && parsed.cadence !== "weekly") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveReminder(cadence: ReminderCadence, now = Date.now()): StoredReminder {
  const next: StoredReminder = {
    cadence,
    nextAt: cadence === "off" ? 0 : now + intervalMs(cadence),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

/**
 * Fire a check-in notification if one is due and reschedule. Caller invokes
 * this on app open / focus; the function is a no-op when reminders are off
 * or not yet due.
 */
export function maybeIndependenceDueReminder(now = Date.now()): boolean {
  const stored = loadReminder();
  if (!stored || stored.cadence === "off") return false;
  if (now < stored.nextAt) return false;
  if (notificationPermission() !== "granted") return false;
  try {
    new Notification("Independence check-in", {
      body: "Quick peek at your Independence date — any new contributions or balance changes?",
      tag: "wealthtrajectory-checkin",
    });
  } catch {
    // Some browsers throw if invoked outside a user gesture; that's fine.
  }
  saveReminder(stored.cadence, now);
  return true;
}
