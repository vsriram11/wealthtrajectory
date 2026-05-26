import { describe, expect, it } from "vitest";
import {
  INCOME_STREAMS_SLICE_INITIAL,
  createIncomeStreamsSliceActions,
  type IncomeStreamsSliceState,
} from "./incomeStreamsSlice";

function makeFakeStore(
  seed: Partial<IncomeStreamsSliceState> = {},
): {
  state: IncomeStreamsSliceState;
  actions: ReturnType<typeof createIncomeStreamsSliceActions>;
} {
  let state: IncomeStreamsSliceState = {
    ...INCOME_STREAMS_SLICE_INITIAL,
    ...seed,
  };
  const set: (
    fn: (s: IncomeStreamsSliceState) => Partial<IncomeStreamsSliceState>,
  ) => void = (fn) => {
    state = { ...state, ...fn(state) };
  };
  const actions = createIncomeStreamsSliceActions(set);
  return {
    get state() {
      return state;
    },
    actions,
  } as unknown as {
    state: IncomeStreamsSliceState;
    actions: ReturnType<typeof createIncomeStreamsSliceActions>;
  };
}

describe("addIncomeStream", () => {
  it("assigns an inc- prefixed id and returns it", () => {
    const s = makeFakeStore();
    const id = s.actions.addIncomeStream({
      label: "Consulting",
      startYear: 2032,
      endYear: 2037,
      annualUSD: 80_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    expect(id).toMatch(/^inc-/);
    expect(s.state.incomeStreams).toHaveLength(1);
    expect(s.state.incomeStreams[0].id).toBe(id);
  });

  it("trims label + falls back to 'Income' when empty", () => {
    const s = makeFakeStore();
    s.actions.addIncomeStream({
      label: "  Consulting  ",
      startYear: 2032,
      endYear: 2037,
      annualUSD: 80_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    s.actions.addIncomeStream({
      label: "   ",
      startYear: 2032,
      endYear: 2037,
      annualUSD: 80_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    expect(s.state.incomeStreams[0].label).toBe("Consulting");
    expect(s.state.incomeStreams[1].label).toBe("Income");
  });

  it("coerces non-finite annualUSD to 0; preserves negatives (distribution semantics)", () => {
    // Issue #6: negatives are first-class now — they model
    // partial-coast distributions (recurring portfolio
    // withdrawals during a sabbatical / step-down window before
    // formal retirement). Only NaN / Infinity are stripped.
    const s = makeFakeStore();
    s.actions.addIncomeStream({
      label: "bad amount",
      startYear: 2030,
      endYear: 2030,
      annualUSD: NaN,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    s.actions.addIncomeStream({
      label: "partial-coast bridge",
      startYear: 2030,
      endYear: 2034,
      annualUSD: -50_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    expect(s.state.incomeStreams[0].annualUSD).toBe(0);
    expect(s.state.incomeStreams[1].annualUSD).toBe(-50_000);
  });

  it("coerces non-finite realGrowthRate to 0 (preserves valid negatives)", () => {
    const s = makeFakeStore();
    s.actions.addIncomeStream({
      label: "nan growth",
      startYear: 2030,
      endYear: 2032,
      annualUSD: 1_000,
      realGrowthRate: NaN,
      ownerId: "m1",
    });
    s.actions.addIncomeStream({
      label: "negative growth (pension)",
      startYear: 2030,
      endYear: 2032,
      annualUSD: 1_000,
      realGrowthRate: -0.02,
      ownerId: "m1",
    });
    expect(s.state.incomeStreams[0].realGrowthRate).toBe(0);
    expect(s.state.incomeStreams[1].realGrowthRate).toBe(-0.02);
  });

  it("rounds fractional years (UI may pass a slider mid-step)", () => {
    const s = makeFakeStore();
    s.actions.addIncomeStream({
      label: "fractional years",
      startYear: 2030.7,
      endYear: 2035.2,
      annualUSD: 50_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    expect(s.state.incomeStreams[0].startYear).toBe(2031);
    expect(s.state.incomeStreams[0].endYear).toBe(2035);
  });

  it("coerces endYear < startYear to startYear (one-year stream)", () => {
    // Principle-of-least-surprise: when the user types end <
    // start, treat it as a one-year stream rather than swapping
    // or rejecting. The slice's job is to never write garbage —
    // the UI can also validate at edit time for a better
    // experience.
    const s = makeFakeStore();
    s.actions.addIncomeStream({
      label: "backwards",
      startYear: 2035,
      endYear: 2030,
      annualUSD: 50_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
    expect(s.state.incomeStreams[0].startYear).toBe(2035);
    expect(s.state.incomeStreams[0].endYear).toBe(2035);
  });
});

describe("updateIncomeStream", () => {
  function seeded() {
    return makeFakeStore({
      incomeStreams: [
        {
          id: "inc-1",
          label: "Consulting",
          startYear: 2032,
          endYear: 2037,
          annualUSD: 80_000,
          realGrowthRate: 0,
          ownerId: "m1",
        },
      ],
    });
  }

  it("partial-updates a single field, leaving others alone", () => {
    const s = seeded();
    s.actions.updateIncomeStream("inc-1", { annualUSD: 100_000 });
    expect(s.state.incomeStreams[0]).toEqual({
      id: "inc-1",
      label: "Consulting",
      startYear: 2032,
      endYear: 2037,
      annualUSD: 100_000,
      realGrowthRate: 0,
      ownerId: "m1",
    });
  });

  it("applies same coercion as addIncomeStream", () => {
    const s = seeded();
    s.actions.updateIncomeStream("inc-1", {
      annualUSD: NaN,
      realGrowthRate: NaN,
    });
    expect(s.state.incomeStreams[0].annualUSD).toBe(0);
    expect(s.state.incomeStreams[0].realGrowthRate).toBe(0);
  });

  it("preserves the id (never overwrite)", () => {
    const s = seeded();
    s.actions.updateIncomeStream("inc-1", {
      // @ts-expect-error: id isn't in the patch type, but we
      // simulate a malicious / broken caller smuggling it in.
      id: "spoofed",
    });
    expect(s.state.incomeStreams[0].id).toBe("inc-1");
  });

  it("no-ops on unknown id", () => {
    const s = seeded();
    const before = s.state.incomeStreams;
    s.actions.updateIncomeStream("inc-nope", { annualUSD: 999 });
    expect(s.state.incomeStreams).toEqual(before);
  });
});

describe("removeIncomeStream", () => {
  it("removes the matching stream, leaves others alone", () => {
    const s = makeFakeStore({
      incomeStreams: [
        {
          id: "inc-1",
          label: "A",
          startYear: 2030,
          endYear: 2030,
          annualUSD: 1,
          realGrowthRate: 0,
          ownerId: "m1",
        },
        {
          id: "inc-2",
          label: "B",
          startYear: 2030,
          endYear: 2030,
          annualUSD: 2,
          realGrowthRate: 0,
          ownerId: "m1",
        },
        {
          id: "inc-3",
          label: "C",
          startYear: 2030,
          endYear: 2030,
          annualUSD: 3,
          realGrowthRate: 0,
          ownerId: "m1",
        },
      ],
    });
    s.actions.removeIncomeStream("inc-2");
    expect(s.state.incomeStreams.map((x) => x.id)).toEqual([
      "inc-1",
      "inc-3",
    ]);
  });

  it("no-ops on unknown id", () => {
    const s = makeFakeStore({
      incomeStreams: [
        {
          id: "inc-1",
          label: "A",
          startYear: 2030,
          endYear: 2030,
          annualUSD: 1,
          realGrowthRate: 0,
          ownerId: "m1",
        },
      ],
    });
    s.actions.removeIncomeStream("inc-nope");
    expect(s.state.incomeStreams).toHaveLength(1);
  });
});
