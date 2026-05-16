import { describe, expect, it } from "vitest";
import {
  createLiabilitiesActions,
  type LiabilitiesActionsContext,
} from "./liabilitiesActions";

function makeFakeStore(seed: Partial<LiabilitiesActionsContext> = {}) {
  let state: LiabilitiesActionsContext = {
    household: {
      id: "h1",
      members: [{ id: "m1", displayName: "Alex" }],
      accounts: [],
      liabilities: [],
    },
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: LiabilitiesActionsContext) => Partial<LiabilitiesActionsContext>,
    ) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("addLiability", () => {
  it("clamps negative balance / rate / payment to 0", () => {
    const s = makeFakeStore();
    const a = createLiabilitiesActions(s.set);
    const id = a.addLiability({
      name: "  Card  ",
      balanceUSD: -100,
      annualInterestRate: -0.05,
      monthlyPaymentUSD: -50,
      ownerId: "m1",
    });
    const liab = s.state.household.liabilities.find((l) => l.id === id);
    expect(liab).toBeDefined();
    expect(liab!.name).toBe("Card");
    expect(liab!.balanceUSD).toBe(0);
    expect(liab!.annualInterestRate).toBe(0);
    expect(liab!.monthlyPaymentUSD).toBe(0);
  });

  it("empty name falls back to 'Liability'", () => {
    const s = makeFakeStore();
    const a = createLiabilitiesActions(s.set);
    const id = a.addLiability({
      name: "   ",
      balanceUSD: 1000,
      annualInterestRate: 0.05,
      monthlyPaymentUSD: 50,
      ownerId: "m1",
    });
    expect(s.state.household.liabilities.find((l) => l.id === id)!.name).toBe(
      "Liability",
    );
  });

  it("returns a fresh liab- prefixed id", () => {
    const s = makeFakeStore();
    const a = createLiabilitiesActions(s.set);
    const id = a.addLiability({
      name: "Mortgage",
      balanceUSD: 100000,
      annualInterestRate: 0.04,
      monthlyPaymentUSD: 600,
      ownerId: "m1",
    });
    expect(id.startsWith("liab-")).toBe(true);
  });
});

describe("removeLiability / updateLiability", () => {
  it("removeLiability drops the matching id", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [],
        liabilities: [
          {
            id: "l1",
            name: "Mortgage",
            balanceUSD: 100000,
            annualInterestRate: 0.04,
            monthlyPaymentUSD: 600,
            ownerId: "m1",
          },
        ],
      },
    });
    const a = createLiabilitiesActions(s.set);
    a.removeLiability("l1");
    expect(s.state.household.liabilities).toHaveLength(0);
  });

  it("updateLiability applies a partial patch without touching other fields", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [],
        liabilities: [
          {
            id: "l1",
            name: "Card",
            balanceUSD: 1000,
            annualInterestRate: 0.2,
            monthlyPaymentUSD: 50,
            ownerId: "m1",
          },
        ],
      },
    });
    const a = createLiabilitiesActions(s.set);
    a.updateLiability("l1", { balanceUSD: 500 });
    expect(s.state.household.liabilities[0].balanceUSD).toBe(500);
    expect(s.state.household.liabilities[0].annualInterestRate).toBe(0.2);
  });
});
