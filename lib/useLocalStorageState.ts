"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * React 19 binding for a single localStorage slot.
 *
 * Uses `useSyncExternalStore` so:
 *   - SSR snapshot returns the fallback → no hydration mismatch
 *   - Cross-tab writes propagate via the `storage` event
 *   - There's no `useEffect → setState` dance on mount
 *
 * Pass `parse` (string → T) and `serialize` (T → string) so the
 * call site stays type-safe. Returns the value plus a setter that
 * writes to localStorage and dispatches a synthetic storage event
 * so same-tab consumers re-render too (the native event fires
 * only for *other* tabs).
 *
 * Pass stable `parse` / `serialize` references (defined at module
 * scope or wrapped in `useCallback`) to keep the snapshot stable
 * across renders.
 */
export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === "undefined") return () => {};
      const handler = (e: StorageEvent) => {
        // Same-tab synthetic events have key === null when dispatched
        // via dispatchEvent(new StorageEvent("storage")); we still
        // notify in that case so the writing tab also re-renders.
        if (e.key === null || e.key === key) notify();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return fallback;
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return fallback;
    }
  }, [key, parse, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, serialize(next));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      } catch {
        /* localStorage unavailable (private mode / quota) */
      }
    },
    [key, serialize],
  );

  return [value, set];
}
