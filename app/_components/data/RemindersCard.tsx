"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  maybeIndependenceDueReminder,
  notificationPermission,
  requestNotificationPermission,
  saveReminder,
  type ReminderCadence,
} from "@/lib/insights/reminders";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

const CADENCES: { id: ReminderCadence; label: string; sub: string }[] = [
  { id: "off", label: "Off", sub: "No reminders" },
  { id: "daily", label: "Daily", sub: "Quick check-in" },
  { id: "weekly", label: "Weekly", sub: "Sunday-style review" },
];

// Storage key + parsers mirror lib/reminders.ts. Defined at module
// scope so their identities stay stable across renders (the
// localStorage hook keys its snapshot memoization on them).
const STORAGE_KEY = "wealthtrajectory-reminder";

function parseCadence(raw: string | null): ReminderCadence {
  if (!raw) return "off";
  try {
    const parsed = JSON.parse(raw) as { cadence?: string };
    if (
      parsed.cadence === "off" ||
      parsed.cadence === "daily" ||
      parsed.cadence === "weekly"
    ) {
      return parsed.cadence;
    }
  } catch {
    /* malformed payload */
  }
  return "off";
}

// `saveReminder` already serializes + writes the full record, so the
// serialize callback for the read hook is a passthrough — set() goes
// through saveReminder() to preserve the `nextAt` schedule.
function passthrough(): string {
  return "";
}

// Module-local event bus for Notification.permission changes.
// The Permissions API has no universal `change` event for
// notifications, so we manually nudge subscribers after each call
// to requestNotificationPermission(). Using useSyncExternalStore
// keeps the SSR snapshot stable ("unsupported") so there's no
// hydration mismatch when the client knows the actual value.
const permListeners = new Set<() => void>();
function permSubscribe(cb: () => void) {
  permListeners.add(cb);
  return () => {
    permListeners.delete(cb);
  };
}
function permSnapshot(): NotificationPermission | "unsupported" {
  return notificationPermission();
}
function permServerSnapshot(): "unsupported" {
  return "unsupported";
}
function notifyPermChanged() {
  permListeners.forEach((cb) => cb());
}

export function RemindersCard() {
  const [cadence] = useLocalStorageState<ReminderCadence>(
    STORAGE_KEY,
    "off",
    parseCadence,
    passthrough,
  );
  const perm = useSyncExternalStore(
    permSubscribe,
    permSnapshot,
    permServerSnapshot,
  );

  // Fire any due reminder once when the card mounts. Doesn't touch
  // component state, so it doesn't trip set-state-in-effect.
  useEffect(() => {
    void maybeIndependenceDueReminder();
  }, []);

  const onChoose = async (next: ReminderCadence) => {
    saveReminder(next);
    // Dispatch a synthetic storage event so the useLocalStorageState
    // subscriber re-snapshots in this tab (the native event only
    // fires in OTHER tabs).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    }
    if (next !== "off") {
      await requestNotificationPermission();
      notifyPermChanged();
    }
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-text">Reminders</div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Browser notifications nudge you to check in. Local-only — no
              push servers.
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {CADENCES.map((c) => {
            const active = cadence === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChoose(c.id)}
                className={`rounded-lg border px-2.5 py-2 text-left transition active:opacity-70 ${
                  active
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-bg-elevated"
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    active ? "text-accent" : "text-text"
                  }`}
                >
                  {c.label}
                </div>
                <div className="mt-0.5 text-[10px] text-text-dim">{c.sub}</div>
              </button>
            );
          })}
        </div>
        {cadence !== "off" && (
          <div className="mt-2 text-[11px] text-text-dim">
            {perm === "unsupported" &&
              "This browser doesn't support notifications — reminders won't fire."}
            {perm === "denied" &&
              "Notifications are blocked. Enable them in browser settings to receive nudges."}
            {perm === "default" &&
              "Tap a cadence above to grant notification permission."}
            {perm === "granted" &&
              `You'll get a ${cadence} nudge the next time you open the app after the interval elapses.`}
          </div>
        )}
      </div>
    </section>
  );
}
