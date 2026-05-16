import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  BUDGET_SLICE_INITIAL,
  createBudgetSliceActions,
  type BudgetSliceState,
} from "./budgetSlice";
import type { BudgetItem } from "@/lib/budget/budget";

/**
 * Budget-slice tests. Pin the CRUD contract:
 *
 *   1. add returns a new id with the `bud-` prefix; stamps
 *      createdAt at the time of the action (not lazy-deferred).
 *   2. update applies a partial patch — untouched fields keep
 *      their values (and ideally their identity, so memoized
 *      consumers downstream don't re-render).
 *   3. update on an unknown id is a no-op (no errors, no
 *      silent insertion).
 *   4. remove filters by id, leaves other items intact
 *      (including their identity), no-ops on unknown id.
 *
 * The slice deliberately does NOT validate fields like
 * monthlyUSD; that validation lives at the UI form layer and
 * the math helpers (which are NaN-safe) absorb anything that
 * gets through. These tests pin the slice's narrow contract;
 * they don't masquerade as field-validation tests.
 */

const SYSTEM_TIME = new Date("2026-05-15T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SYSTEM_TIME);
});
afterEach(() => {
  vi.useRealTimers();
});

function makeFakeStore() {
  let state: BudgetSliceState = { ...BUDGET_SLICE_INITIAL };
  return {
    get state() {
      return state;
    },
    set: (fn: (s: BudgetSliceState) => Partial<BudgetSliceState>) => {
      state = { ...state, ...fn(state) };
    },
  };
}

/**
 * Test fixture for an Omit<BudgetItem, "id" | "createdAt"> input.
 * Using the real type — not `as never` — so the slice's input
 * contract is statically checked in test code too. A future field
 * addition to BudgetItem will surface here, not in production at
 * runtime.
 */
function input(
  overrides: Partial<Omit<BudgetItem, "id" | "createdAt">> = {},
): Omit<BudgetItem, "id" | "createdAt"> {
  return {
    name: "Rent",
    ownerId: "m1",
    category: "housing",
    type: "fixed",
    monthlyUSD: 3_000,
    endsAtRetirement: false,
    ...overrides,
  };
}

describe("addBudgetItem", () => {
  it("returns a bud- prefixed id and inserts the item with createdAt = now", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id = a.addBudgetItem(input({ name: "Rent" }));
    expect(id).toMatch(/^bud-/);
    expect(s.state.budgetItems).toHaveLength(1);
    expect(s.state.budgetItems[0].id).toBe(id);
    // createdAt is stamped at action time (not lazily on next
    // render or async tick) — pin so a future refactor that
    // moves the timestamp into a useEffect breaks loudly.
    expect(s.state.budgetItems[0].createdAt).toBe(SYSTEM_TIME.getTime());
  });

  it("each add produces a unique id even when called rapidly", () => {
    // The id generator uses crypto.randomUUID under the hood;
    // a collision would be cosmically unlikely. But pinning
    // uniqueness across rapid sequential adds catches a
    // regression where someone caches the id between calls
    // (which has happened in real codebases — usually after a
    // misguided "performance" refactor).
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(a.addBudgetItem(input({ name: `Item ${i}` })));
    }
    expect(ids.size).toBe(20);
  });

  it("preserves the order items are added (push to tail)", () => {
    // Order matters for the UI (the user mental-models their
    // list as "what I added in what sequence"). Push-to-tail
    // semantics are an implicit guarantee callers may rely on.
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    a.addBudgetItem(input({ name: "First" }));
    a.addBudgetItem(input({ name: "Second" }));
    a.addBudgetItem(input({ name: "Third" }));
    expect(s.state.budgetItems.map((b) => b.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });
});

describe("updateBudgetItem", () => {
  it("applies a partial patch without disturbing untouched fields", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id = a.addBudgetItem(
      input({ name: "Rent", category: "housing", monthlyUSD: 3_000 }),
    );
    const original = s.state.budgetItems[0];
    a.updateBudgetItem(id, { monthlyUSD: 3_200 });
    const updated = s.state.budgetItems[0];
    expect(updated.monthlyUSD).toBe(3_200);
    // Every other field survives the patch.
    expect(updated.name).toBe(original.name);
    expect(updated.category).toBe(original.category);
    expect(updated.type).toBe(original.type);
    expect(updated.endsAtRetirement).toBe(original.endsAtRetirement);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.ownerId).toBe(original.ownerId);
    expect(updated.id).toBe(id);
  });

  it("creates a fresh array reference (persistence-diff invariant)", () => {
    // The PersistenceHydrator + CloudSyncer subscribers diff
    // state by reference equality (state.budgetItems ===
    // prev.budgetItems). The setter must shallow-copy or no
    // save/sync will fire.
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id = a.addBudgetItem(input());
    const before = s.state.budgetItems;
    a.updateBudgetItem(id, { monthlyUSD: 5_000 });
    expect(s.state.budgetItems).not.toBe(before);
  });

  it("is a no-op on unknown id — no insert, no error", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    a.addBudgetItem(input({ name: "Rent" }));
    const before = s.state.budgetItems;
    a.updateBudgetItem("bud-nope", { monthlyUSD: 999 });
    // Item count unchanged.
    expect(s.state.budgetItems).toHaveLength(1);
    // No phantom item was synthesized from the patch.
    expect(s.state.budgetItems[0].name).toBe("Rent");
    expect(s.state.budgetItems[0].monthlyUSD).toBe(3_000);
    // Array reference may or may not be new (the setter's
    // .map always returns a new array even when no row
    // matched); we don't pin that direction since either is
    // a defensible implementation. We DO pin that no row was
    // mutated in-place by checking values above.
    void before;
  });

  it("does not bleed updates across items (independence of unrelated rows)", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id1 = a.addBudgetItem(input({ name: "Rent", monthlyUSD: 3_000 }));
    const id2 = a.addBudgetItem(input({ name: "Groceries", monthlyUSD: 800 }));
    a.updateBudgetItem(id1, { monthlyUSD: 3_500 });
    expect(s.state.budgetItems.find((b) => b.id === id1)!.monthlyUSD).toBe(3_500);
    expect(s.state.budgetItems.find((b) => b.id === id2)!.monthlyUSD).toBe(800);
  });
});

describe("removeBudgetItem", () => {
  it("filters out the matching id, preserves the others (including their identity)", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id1 = a.addBudgetItem(input({ name: "A", monthlyUSD: 100 }));
    const id2 = a.addBudgetItem(input({ name: "B", monthlyUSD: 200 }));
    const id3 = a.addBudgetItem(input({ name: "C", monthlyUSD: 300 }));
    const b = s.state.budgetItems.find((x) => x.id === id2)!;
    a.removeBudgetItem(id1);
    expect(s.state.budgetItems).toHaveLength(2);
    expect(s.state.budgetItems.map((x) => x.id)).toEqual([id2, id3]);
    // Object identity preserved — downstream memoized consumers
    // (e.g. useMemo dep on a specific budget item) shouldn't
    // recompute just because someone else was deleted.
    expect(s.state.budgetItems.find((x) => x.id === id2)).toBe(b);
  });

  it("is a no-op on unknown id (no errors, list unchanged)", () => {
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    a.addBudgetItem(input({ name: "Only one" }));
    a.removeBudgetItem("bud-ghost");
    expect(s.state.budgetItems).toHaveLength(1);
  });

  it("removing the last item leaves an empty array (not undefined)", () => {
    // Defensive: a consumer that runs .map / .reduce on the
    // collection must always see an array, never undefined.
    // Catches a regression where a "smart" refactor returns
    // undefined for the empty case.
    const s = makeFakeStore();
    const a = createBudgetSliceActions(s.set);
    const id = a.addBudgetItem(input({ name: "Only one" }));
    a.removeBudgetItem(id);
    expect(Array.isArray(s.state.budgetItems)).toBe(true);
    expect(s.state.budgetItems).toHaveLength(0);
  });
});
