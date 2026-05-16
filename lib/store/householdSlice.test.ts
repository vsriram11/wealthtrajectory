import { describe, expect, it } from "vitest";
import {
  HOUSEHOLD_SLICE_INITIAL_DEMO,
  createHouseholdSliceActions,
  type HouseholdSliceState,
} from "./householdSlice";

function makeFakeStore() {
  let state: HouseholdSliceState = HOUSEHOLD_SLICE_INITIAL_DEMO({
    id: "h1",
    members: [{ id: "m1", displayName: "Alex" }],
    accounts: [],
    liabilities: [],
  });
  return {
    get state() {
      return state;
    },
    set: (patch: Partial<HouseholdSliceState>) => {
      state = { ...state, ...patch };
    },
  };
}

describe("HouseholdSlice — data slice", () => {
  it("starts in demo mode with the seeded household and null income", () => {
    const init = HOUSEHOLD_SLICE_INITIAL_DEMO({
      id: "x",
      members: [{ id: "a", displayName: "A" }],
      accounts: [],
      liabilities: [],
    });
    expect(init.mode).toBe("demo");
    expect(init.household.id).toBe("x");
    expect(init.householdAnnualIncomeUSD).toBeNull();
  });
});

describe("setHouseholdAnnualIncome", () => {
  it("stores positive finite numbers; coerces null / zero / negative / NaN to null", () => {
    const s = makeFakeStore();
    const a = createHouseholdSliceActions(s.set);

    a.setHouseholdAnnualIncome(150_000);
    expect(s.state.householdAnnualIncomeUSD).toBe(150_000);

    a.setHouseholdAnnualIncome(0);
    expect(s.state.householdAnnualIncomeUSD).toBeNull();

    a.setHouseholdAnnualIncome(-100);
    expect(s.state.householdAnnualIncomeUSD).toBeNull();

    a.setHouseholdAnnualIncome(NaN);
    expect(s.state.householdAnnualIncomeUSD).toBeNull();

    a.setHouseholdAnnualIncome(null);
    expect(s.state.householdAnnualIncomeUSD).toBeNull();
  });
});
