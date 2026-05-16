import { describe, expect, it } from "vitest";
import {
  activeMemberIds,
  activeMembers,
  householdAverageAge,
  householdForRollups,
  householdIncomeSum,
  householdNetWorth,
  householdRollupCounts,
  householdYoungestAge,
  type Account,
  type Household,
  type Liability,
} from "@/lib/types";

function hh(members: Household["members"]): Household {
  return { id: "hh", members, accounts: [], liabilities: [] };
}

describe("householdIncomeSum", () => {
  it("returns null when no member has income", () => {
    expect(householdIncomeSum(hh([{ id: "m1", displayName: "A" }]))).toBeNull();
    expect(
      householdIncomeSum(
        hh([
          { id: "m1", displayName: "A", incomeUSD: null },
          { id: "m2", displayName: "B", incomeUSD: null },
        ]),
      ),
    ).toBeNull();
  });

  it("sums set member incomes", () => {
    expect(
      householdIncomeSum(
        hh([
          { id: "m1", displayName: "A", incomeUSD: 150_000 },
          { id: "m2", displayName: "B", incomeUSD: 50_000 },
        ]),
      ),
    ).toBe(200_000);
  });

  it("treats a 0-income member as set (not skipped)", () => {
    // 0 is a valid earner state (e.g. retired); sum should include it.
    expect(
      householdIncomeSum(
        hh([
          { id: "m1", displayName: "A", incomeUSD: 100_000 },
          { id: "m2", displayName: "B", incomeUSD: 0 },
        ]),
      ),
    ).toBe(100_000);
  });

  it("ignores non-finite / negative incomes", () => {
    expect(
      householdIncomeSum(
        hh([
          { id: "m1", displayName: "A", incomeUSD: 150_000 },
          { id: "m2", displayName: "B", incomeUSD: -50_000 },
          { id: "m3", displayName: "C", incomeUSD: NaN },
        ]),
      ),
    ).toBe(150_000);
  });
});

describe("householdAverageAge", () => {
  it("returns null when no member has age", () => {
    expect(householdAverageAge(hh([{ id: "m1", displayName: "A" }]))).toBeNull();
  });

  it("averages set ages", () => {
    expect(
      householdAverageAge(
        hh([
          { id: "m1", displayName: "A", age: 38 },
          { id: "m2", displayName: "B", age: 42 },
        ]),
      ),
    ).toBe(40);
  });

  it("ignores members without an age", () => {
    expect(
      householdAverageAge(
        hh([
          { id: "m1", displayName: "A", age: 38 },
          { id: "m2", displayName: "B" }, // kid, no age
          { id: "m3", displayName: "C", age: 42 },
        ]),
      ),
    ).toBe(40);
  });

  it("ignores zero / negative / non-finite ages", () => {
    expect(
      householdAverageAge(
        hh([
          { id: "m1", displayName: "A", age: 38 },
          { id: "m2", displayName: "B", age: 0 },
          { id: "m3", displayName: "C", age: -5 },
          { id: "m4", displayName: "D", age: NaN },
        ]),
      ),
    ).toBe(38);
  });
});

describe("activeMembers / includeInRollup flag", () => {
  // Locked-in semantic: undefined is treated as TRUE — members
  // persisted before the flag existed must keep rolling up
  // exactly as they did pre-feature. A change here would silently
  // alter every user's rollup numbers on upgrade, which is the
  // exact bug back-compat is designed to prevent.
  it("treats undefined includeInRollup as included (back-compat)", () => {
    const h = hh([
      { id: "m1", displayName: "A", incomeUSD: 100_000, age: 40 },
      { id: "m2", displayName: "B", incomeUSD: 50_000, age: 38 },
    ]);
    expect(activeMembers(h).map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(householdIncomeSum(h)).toBe(150_000);
    expect(householdAverageAge(h)).toBe(39);
    expect(householdYoungestAge(h)).toBe(38);
  });

  it("explicit true is identical to undefined", () => {
    const h = hh([
      {
        id: "m1",
        displayName: "A",
        incomeUSD: 100_000,
        age: 40,
        includeInRollup: true,
      },
      {
        id: "m2",
        displayName: "B",
        incomeUSD: 50_000,
        age: 38,
        includeInRollup: true,
      },
    ]);
    expect(householdIncomeSum(h)).toBe(150_000);
    expect(householdAverageAge(h)).toBe(39);
    expect(householdYoungestAge(h)).toBe(38);
  });

  it("excludes flagged members from every rollup helper", () => {
    // The "kid temporarily excluded" scenario from the feature
    // brief — kid drags average age down + is the youngest. With
    // includeInRollup: false, the kid disappears from age math
    // entirely; income (which the kid doesn't have) is unchanged.
    const h = hh([
      { id: "m1", displayName: "Parent A", incomeUSD: 220_000, age: 38 },
      { id: "m2", displayName: "Parent B", incomeUSD: 185_000, age: 36 },
      {
        id: "m3",
        displayName: "Kid",
        incomeUSD: null,
        age: 6,
        includeInRollup: false,
      },
    ]);
    expect(activeMembers(h).map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(householdIncomeSum(h)).toBe(405_000);
    expect(householdAverageAge(h)).toBe(37);
    expect(householdYoungestAge(h)).toBe(36);
  });

  it("kid's income (when set) is excluded too — flag isn't field-specific", () => {
    // Edge case: a kid with a custodial brokerage / paper-route
    // income shouldn't sneak into the household sum when the
    // parent has set them to "excluded from rollup". The flag is
    // a member-level switch, not a per-field one.
    const h = hh([
      { id: "m1", displayName: "Parent", incomeUSD: 200_000, age: 40 },
      {
        id: "m2",
        displayName: "Kid",
        incomeUSD: 2_400,
        age: 14,
        includeInRollup: false,
      },
    ]);
    expect(householdIncomeSum(h)).toBe(200_000);
  });

  it("returns null when all members are excluded (defensive)", () => {
    // The store action enforces ≥1 active member, so this state
    // can't be reached through normal UI use. But persisted /
    // imported data could theoretically arrive in this shape
    // (e.g. a Drive sync from a future client version with looser
    // rules) — the helpers must degrade gracefully to the "no
    // data" sentinel rather than throw or return 0/NaN.
    const h = hh([
      {
        id: "m1",
        displayName: "A",
        incomeUSD: 100_000,
        age: 40,
        includeInRollup: false,
      },
    ]);
    expect(activeMembers(h)).toEqual([]);
    expect(householdIncomeSum(h)).toBeNull();
    expect(householdAverageAge(h)).toBeNull();
    expect(householdYoungestAge(h)).toBeNull();
  });
});

describe("householdRollupCounts", () => {
  it("reports active + total", () => {
    const h = hh([
      { id: "m1", displayName: "A" },
      { id: "m2", displayName: "B", includeInRollup: false },
      { id: "m3", displayName: "C", includeInRollup: true },
    ]);
    expect(householdRollupCounts(h)).toEqual({ active: 2, total: 3 });
  });

  it("active == total when no flags set (legacy data)", () => {
    const h = hh([
      { id: "m1", displayName: "A" },
      { id: "m2", displayName: "B" },
    ]);
    expect(householdRollupCounts(h)).toEqual({ active: 2, total: 2 });
  });
});

// Test fixtures for the integration-shaped tests below. Cash
// holdings keep the math obvious (account value == single
// holding's valueUSD) so test arithmetic doesn't depend on the
// quote-pricing pipeline.
function acct(id: string, ownerId: string, valueUSD: number): Account {
  return {
    id,
    displayName: id,
    category: "BROKERAGE",
    ownerId,
    monthlyContributionUSD: 0,
    holdings: [
      {
        kind: "cash",
        id: `${id}-h`,
        valueUSD,
        expectedRealCAGR: 0,
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      },
    ],
  };
}

function liab(id: string, ownerId: string, balanceUSD: number): Liability {
  return {
    id,
    name: id,
    ownerId,
    balanceUSD,
    annualInterestRate: 0.05,
    monthlyPaymentUSD: 0,
  };
}

describe("householdForRollups", () => {
  // The bug this fixes: previously, excluding a member would
  // remove their income/age from rollups but their accounts +
  // liabilities still counted toward household NW. Users
  // reasonably expected "exclude from rollup" to mean exclude
  // EVERYTHING — these tests pin that contract.

  it("returns the same household reference when nothing is excluded", () => {
    // Reference identity matters here — memoized hooks downstream
    // (useActiveProjection's useMemo, NetWorthCard's, etc.) skip
    // re-computation when the household reference doesn't change.
    // The short-circuit in householdForRollups guarantees we don't
    // churn React's render cycle for the steady-state case where
    // every member is included.
    const h: Household = {
      id: "h",
      members: [
        { id: "m1", displayName: "A" },
        { id: "m2", displayName: "B", includeInRollup: true },
      ],
      accounts: [acct("a1", "m1", 100), acct("a2", "m2", 200)],
      liabilities: [liab("l1", "m1", 50)],
    };
    expect(householdForRollups(h)).toBe(h);
  });

  it("drops accounts + liabilities owned by an excluded member", () => {
    const h: Household = {
      id: "h",
      members: [
        { id: "parent", displayName: "Parent" },
        { id: "kid", displayName: "Kid", includeInRollup: false },
      ],
      // Kid has a custodial brokerage AND a small liability — both
      // need to disappear from the rollup view, not just one.
      accounts: [acct("p_brk", "parent", 500_000), acct("k_brk", "kid", 4_000)],
      liabilities: [liab("p_mort", "parent", 200_000), liab("k_loan", "kid", 1_000)],
    };
    const view = householdForRollups(h);
    expect(view.members.map((m) => m.id)).toEqual(["parent"]);
    expect(view.accounts.map((a) => a.id)).toEqual(["p_brk"]);
    expect(view.liabilities.map((l) => l.id)).toEqual(["p_mort"]);
  });

  it("flows through to householdNetWorth — excluding a member with accounts changes NW", () => {
    // The headline integration test for the user's complaint:
    // toggling a member off MUST visibly change the household's
    // total net worth. Pre-fix this assertion would have failed
    // because householdNetWorth ignored the include flag.
    const h: Household = {
      id: "h",
      members: [
        { id: "parent", displayName: "Parent" },
        { id: "kid", displayName: "Kid" },
      ],
      accounts: [acct("p", "parent", 500_000), acct("k", "kid", 25_000)],
      liabilities: [],
    };
    expect(householdNetWorth(h)).toBe(525_000);

    const excluded: Household = {
      ...h,
      members: [
        { id: "parent", displayName: "Parent" },
        { id: "kid", displayName: "Kid", includeInRollup: false },
      ],
    };
    expect(householdNetWorth(householdForRollups(excluded))).toBe(500_000);
  });

  it("net of liabilities composes correctly", () => {
    // Excluded member with only liabilities (e.g. a kid's small
    // loan). Removing them should INCREASE NW since their debt
    // drops out — checks the math composes with negative-side
    // ownership too, not just positive-side accounts.
    const h: Household = {
      id: "h",
      members: [
        { id: "parent", displayName: "Parent" },
        { id: "kid", displayName: "Kid", includeInRollup: false },
      ],
      accounts: [acct("p", "parent", 100_000)],
      liabilities: [liab("kloan", "kid", 30_000)],
    };
    // Raw NW counts the kid's debt: 100k - 30k = 70k
    expect(householdNetWorth(h)).toBe(70_000);
    // Rollup view drops the kid + their debt: 100k
    expect(householdNetWorth(householdForRollups(h))).toBe(100_000);
  });

  it("preserves household.id (downstream references should stay stable)", () => {
    const h: Household = {
      id: "household-uuid-123",
      members: [
        { id: "m1", displayName: "A" },
        { id: "m2", displayName: "B", includeInRollup: false },
      ],
      accounts: [acct("a", "m2", 1_000)],
      liabilities: [],
    };
    expect(householdForRollups(h).id).toBe("household-uuid-123");
  });
});

describe("activeMemberIds", () => {
  it("returns a Set of just the active member ids", () => {
    const h = hh([
      { id: "m1", displayName: "A" },
      { id: "m2", displayName: "B", includeInRollup: false },
      { id: "m3", displayName: "C", includeInRollup: true },
    ]);
    const ids = activeMemberIds(h);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(["m1", "m3"]);
  });
});
