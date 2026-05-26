/**
 * Future-income-stream ledger.
 *
 * Owns the array + CRUD actions for `incomeStreams[]` (top-level
 * in the store, not nested in Household — same pattern as
 * `budgetItems`). Synced via Drive + IndexedDB by the
 * persistence layer, which reads/writes the slice directly.
 *
 * The slice deliberately stops at the data shape — projections
 * + Monte Carlo consume the streams via the helpers in
 * lib/incomeStreams.ts. New rollup surfaces should call those
 * helpers, not iterate the slice's array.
 *
 * Validation is at the action boundary:
 *
 *   - empty / whitespace-only `label`         → falls back to "Income"
 *   - non-finite `annualUSD`                  → 0 (sign preserved)
 *   - non-finite `realGrowthRate`             → 0
 *   - `endYear < startYear`                   → endYear coerced to startYear
 *
 * The principle: never write garbage into the store. Math
 * helpers downstream are NaN-safe but we'd rather not rely on
 * that as the only defense — a polluted store leaks into Drive
 * sync, export/import, debug snapshots, etc.
 */

import {
  newIncomeStreamId,
  type IncomeStream,
  type IncomeStreamId,
} from "@/lib/budget/incomeStreams";

export type IncomeStreamsSliceState = {
  incomeStreams: IncomeStream[];
};

export type IncomeStreamsSliceActions = {
  /**
   * Add a new income stream. Returns the assigned id so the
   * caller can scroll/focus the new row in the UI.
   */
  addIncomeStream: (input: Omit<IncomeStream, "id">) => IncomeStreamId;
  /**
   * Partial-update a stream. Same validation rules as add — a
   * patch that would write garbage is silently coerced.
   */
  updateIncomeStream: (
    id: IncomeStreamId,
    patch: Partial<Omit<IncomeStream, "id">>,
  ) => void;
  /**
   * Remove a stream. No-op when the id doesn't exist.
   */
  removeIncomeStream: (id: IncomeStreamId) => void;
};

export const INCOME_STREAMS_SLICE_INITIAL: IncomeStreamsSliceState = {
  incomeStreams: [],
};

/**
 * Validate + coerce a stream's writable fields. Pure — returns
 * a fresh stream object that's safe to put in the store. Used
 * by both `addIncomeStream` and `updateIncomeStream` so the
 * rules don't drift between the two paths.
 */
function coerceWritableFields(
  input: Omit<IncomeStream, "id">,
): Omit<IncomeStream, "id"> {
  const trimmedLabel = input.label.trim();
  // Signed: positive = income, negative = distribution (partial-
  // coast / sabbatical pattern). Only non-finite values are
  // stripped — see IncomeStream's file-level docstring for the
  // engine semantics in each phase.
  const annual = Number.isFinite(input.annualUSD) ? input.annualUSD : 0;
  const growth = Number.isFinite(input.realGrowthRate)
    ? input.realGrowthRate
    : 0;
  const start = Number.isFinite(input.startYear)
    ? Math.round(input.startYear)
    : new Date().getFullYear();
  const endRaw = Number.isFinite(input.endYear)
    ? Math.round(input.endYear)
    : start;
  // Coerce end < start to start (a one-year stream). We could
  // alternatively swap, but coercing is the principle-of-least-
  // surprise option — the user's intent is clearer about
  // startYear (they typed it first in most UIs).
  const end = endRaw < start ? start : endRaw;
  return {
    label: trimmedLabel || "Income",
    startYear: start,
    endYear: end,
    annualUSD: annual,
    realGrowthRate: growth,
    ownerId: input.ownerId,
  };
}

export function createIncomeStreamsSliceActions(
  set: (
    fn: (s: IncomeStreamsSliceState) => Partial<IncomeStreamsSliceState>,
  ) => void,
): IncomeStreamsSliceActions {
  return {
    addIncomeStream: (input) => {
      const id = newIncomeStreamId();
      const coerced = coerceWritableFields(input);
      const stream: IncomeStream = { ...coerced, id };
      set((s) => ({ incomeStreams: [...s.incomeStreams, stream] }));
      return id;
    },

    updateIncomeStream: (id, patch) =>
      set((s) => ({
        incomeStreams: s.incomeStreams.map((stream) => {
          if (stream.id !== id) return stream;
          // Merge patch onto current, then coerce the result.
          // This lets the UI send a partial patch (just startYear
          // for example) without re-sending every field.
          const merged = { ...stream, ...patch };
          // Strip the id so coerceWritableFields' signature lines
          // up; we re-attach below.
          const { id: _id, ...writable } = merged;
          void _id;
          return { ...coerceWritableFields(writable), id };
        }),
      })),

    removeIncomeStream: (id) =>
      set((s) => ({
        incomeStreams: s.incomeStreams.filter((stream) => stream.id !== id),
      })),
  };
}
