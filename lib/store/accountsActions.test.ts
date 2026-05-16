import { describe, expect, it } from "vitest";
import {
  createAccountsActions,
  type AccountsActionsContext,
} from "./accountsActions";

function makeFakeStore(seed: Partial<AccountsActionsContext> = {}) {
  let state: AccountsActionsContext = {
    household: {
      id: "h1",
      members: [{ id: "m1", displayName: "Alex" }],
      accounts: [],
      liabilities: [],
    },
    scenarios: [],
    editingAccountId: null,
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: AccountsActionsContext) => Partial<AccountsActionsContext>,
    ) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("createAccount", () => {
  it("appends + returns a fresh acc- prefixed id", () => {
    const s = makeFakeStore();
    const a = createAccountsActions(s.set);
    const id = a.createAccount({
      displayName: "401k",
      category: "401K",
      ownerId: "m1",
      monthlyContributionUSD: 1000,
    });
    expect(typeof id).toBe("string");
    expect(id.startsWith("acc-")).toBe(true);
    expect(s.state.household.accounts).toHaveLength(1);
    expect(s.state.household.accounts[0].id).toBe(id);
    expect(s.state.household.accounts[0].monthlyContributionUSD).toBe(1000);
  });
});

describe("removeAccount", () => {
  it("cascades: account gone + scenarios stripped + editor cleared", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 100,
            holdings: [
              {
                kind: "cash",
                id: "h-inside",
                valueUSD: 1000,
                expectedRealCAGR: 0.005,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
      scenarios: [
        {
          id: "sc1",
          name: "x",
          color: "#fff",
          createdAt: 0,
          overrides: {
            holdingCAGRs: { "h-inside": 0.1 },
            accountContributions: { acc1: 1500 },
          },
        },
      ],
      editingAccountId: "acc1",
    });
    const a = createAccountsActions(s.set);
    a.removeAccount("acc1");
    expect(s.state.household.accounts).toHaveLength(0);
    expect(s.state.scenarios[0].overrides.holdingCAGRs).toEqual({});
    expect(s.state.scenarios[0].overrides.accountContributions).toEqual({});
    expect(s.state.editingAccountId).toBeNull();
  });
});

describe("reorderAccounts", () => {
  it("honors orderedIds + tail-pads missing ids", () => {
    const acct = (id: string) => ({
      id,
      displayName: id,
      category: "ROTH_IRA" as const,
      ownerId: "m1",
      monthlyContributionUSD: 0,
      holdings: [],
    });
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [acct("a"), acct("b"), acct("c")],
        liabilities: [],
      },
    });
    const a = createAccountsActions(s.set);
    a.reorderAccounts(["c", "a"]);
    expect(s.state.household.accounts.map((x) => x.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("updateAccount / setAccountContribution", () => {
  it("updateAccount applies a partial patch", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "Old",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 100,
            holdings: [],
          },
        ],
        liabilities: [],
      },
    });
    const a = createAccountsActions(s.set);
    a.updateAccount("acc1", { displayName: "Renamed" });
    expect(s.state.household.accounts[0].displayName).toBe("Renamed");
    expect(s.state.household.accounts[0].monthlyContributionUSD).toBe(100);
  });

  it("setAccountContribution writes only the contribution field", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "401k",
            category: "401K",
            ownerId: "m1",
            monthlyContributionUSD: 500,
            holdings: [],
          },
        ],
        liabilities: [],
      },
    });
    const a = createAccountsActions(s.set);
    a.setAccountContribution("acc1", 1500);
    expect(s.state.household.accounts[0].monthlyContributionUSD).toBe(1500);
  });
});
