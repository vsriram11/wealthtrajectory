import { describe, expect, it } from "vitest";
import {
  budgetTotals,
  clampHaircut,
  defaultEndsAtRetirement,
  effectiveExcessInflation,
  DEFAULT_VARIABLE_SHARE,
  HISTORICAL_DOWN_YEAR_FREQUENCY,
  effectiveHaircut,
  effectiveVariableShare,
  filterBudgetByMember,
  filterBudgetForRollups,
  variableRetirementMonthly,
  nextBillingDate,
  perCycleAmountUSD,
  realExcessCorpusDrag,
  realExcessGrowthMultiplier,
  retirementMonthlyAfterHaircut,
  subscriptionItems,
  suggestedIndependenceCorpus,
  weightedRealExcess,
  type BudgetItem,
} from "@/lib/budget/budget";

function item(overrides: Partial<BudgetItem> = {}): BudgetItem {
  // Default `excessInflationOverride: 0` so legacy tests that focus
  // on tax + haircut composition see the naive A/SWR math. The new
  // real-excess-specific tests use `itemWithDefaults` below to let
  // category defaults flow through, or pass an explicit override.
  return {
    id: "b1",
    name: "Test",
    ownerId: "m1",
    category: "housing",
    monthlyUSD: 1_000,
    type: "fixed",
    endsAtRetirement: false,
    excessInflationOverride: 0,
    createdAt: 0,
    ...overrides,
  };
}

/** Like `item`, but omits excessInflationOverride so the
 *  category default flows through. */
function itemWithDefaults(
  overrides: Partial<BudgetItem> = {},
): BudgetItem {
  const base: BudgetItem = {
    id: "b1",
    name: "Test",
    ownerId: "m1",
    category: "housing",
    monthlyUSD: 1_000,
    type: "fixed",
    endsAtRetirement: false,
    createdAt: 0,
  };
  return { ...base, ...overrides };
}

describe("budgetTotals", () => {
  it("returns zeros for empty list", () => {
    const t = budgetTotals([]);
    expect(t.monthlyUSD).toBe(0);
    expect(t.annualUSD).toBe(0);
    expect(t.retirementMonthlyUSD).toBe(0);
    expect(t.retirementAnnualUSD).toBe(0);
  });

  it("sums monthly and annual", () => {
    const t = budgetTotals([
      item({ monthlyUSD: 3_000, category: "housing" }),
      item({ monthlyUSD: 800, category: "food" }),
    ]);
    expect(t.monthlyUSD).toBe(3_800);
    expect(t.annualUSD).toBe(45_600);
  });

  it("groups by category", () => {
    const t = budgetTotals([
      item({ monthlyUSD: 3_000, category: "housing" }),
      item({ monthlyUSD: 800, category: "food" }),
      item({ monthlyUSD: 200, category: "food" }),
    ]);
    expect(t.byCategory.housing).toBe(3_000);
    expect(t.byCategory.food).toBe(1_000);
    expect(t.byCategory.lifestyle).toBe(0);
  });

  it("excludes savings from retirement spend", () => {
    const t = budgetTotals([
      item({ monthlyUSD: 3_000, category: "housing" }),
      item({ monthlyUSD: 1_500, category: "savings" }),
    ]);
    expect(t.monthlyUSD).toBe(4_500);
    expect(t.retirementMonthlyUSD).toBe(3_000);
  });

  it("excludes endsAtRetirement items from retirement spend", () => {
    const t = budgetTotals([
      item({ monthlyUSD: 3_000, category: "housing" }),
      item({
        monthlyUSD: 2_000,
        category: "housing",
        endsAtRetirement: true,
      }),
    ]);
    expect(t.monthlyUSD).toBe(5_000);
    expect(t.retirementMonthlyUSD).toBe(3_000);
  });

  it("ignores negative / non-finite amounts", () => {
    const t = budgetTotals([
      item({ monthlyUSD: 3_000 }),
      item({ monthlyUSD: -500 }),
      item({ monthlyUSD: NaN }),
    ]);
    expect(t.monthlyUSD).toBe(3_000);
  });
});

describe("budgetTotals: fixed vs variable split", () => {
  it("splits monthlyUSD into fixed + variable totals", () => {
    const t = budgetTotals([
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "fixed", monthlyUSD: 200 }),
      item({ type: "variable", monthlyUSD: 800 }),
      item({ type: "variable", monthlyUSD: 100 }),
    ]);
    expect(t.fixedMonthlyUSD).toBe(3_200);
    expect(t.variableMonthlyUSD).toBe(900);
    expect(t.monthlyUSD).toBe(4_100);
  });

  it("savings items still split by type (even though excluded from retirement spend)", () => {
    const t = budgetTotals([
      item({ category: "savings", type: "fixed", monthlyUSD: 500 }),
      item({ category: "savings", type: "variable", monthlyUSD: 200 }),
    ]);
    // Type split is independent of category — both should still
    // accumulate by their type for the fixed/variable view.
    expect(t.fixedMonthlyUSD).toBe(500);
    expect(t.variableMonthlyUSD).toBe(200);
    // Retirement math correctly excludes savings.
    expect(t.retirementMonthlyUSD).toBe(0);
  });
});

describe("retirementMonthlyAfterHaircut", () => {
  it("haircut = 0 matches retirementMonthlyUSD baseline", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 1_000 }),
    ];
    const baseline = budgetTotals(items).retirementMonthlyUSD;
    expect(retirementMonthlyAfterHaircut(items, 0)).toBe(baseline);
  });

  it("haircut = 0.5 cuts variable by half, fixed untouched", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 1_000 }),
    ];
    // 3000 + 1000 * (1 - 0.5) = 3500
    expect(retirementMonthlyAfterHaircut(items, 0.5)).toBe(3_500);
  });

  it("haircut = 1 drops variable entirely (only fixed survives)", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 1_000 }),
    ];
    expect(retirementMonthlyAfterHaircut(items, 1)).toBe(3_000);
  });

  it("haircut clamps above 1", () => {
    const items = [item({ type: "variable", monthlyUSD: 1_000 })];
    expect(retirementMonthlyAfterHaircut(items, 1.5)).toBe(0);
  });

  it("haircut clamps below 0", () => {
    const items = [item({ type: "variable", monthlyUSD: 1_000 })];
    // -0.5 clamps to 0 → variable spend unchanged
    expect(retirementMonthlyAfterHaircut(items, -0.5)).toBe(1_000);
  });

  it("non-finite haircut treated as 0", () => {
    const items = [item({ type: "variable", monthlyUSD: 1_000 })];
    expect(retirementMonthlyAfterHaircut(items, NaN)).toBe(1_000);
  });

  it("excludes savings + endsAtRetirement items regardless of type", () => {
    const items = [
      item({ category: "savings", type: "fixed", monthlyUSD: 500 }),
      item({
        type: "fixed",
        monthlyUSD: 1_000,
        endsAtRetirement: true,
      }),
      item({ type: "variable", monthlyUSD: 2_000 }),
    ];
    // Only the $2K variable counts; 50% haircut → $1K
    expect(retirementMonthlyAfterHaircut(items, 0.5)).toBe(1_000);
  });
});

describe("clampHaircut", () => {
  it("clamps to [0,1] and treats non-finite as 0", () => {
    expect(clampHaircut(0)).toBe(0);
    expect(clampHaircut(0.5)).toBe(0.5);
    expect(clampHaircut(1)).toBe(1);
    expect(clampHaircut(-0.2)).toBe(0);
    expect(clampHaircut(2)).toBe(1);
    expect(clampHaircut(NaN)).toBe(0);
    expect(clampHaircut(null)).toBe(0);
    expect(clampHaircut(undefined)).toBe(0);
  });
});

describe("suggestedIndependenceCorpus with haircut", () => {
  // Tests below pass taxRate=0 explicitly so they verify the pure
  // (haircut-only) math. Tax-gross-up has its own block below.
  it("haircut = 0, tax = 0 matches naive annual / SWR", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 1_000 }),
    ];
    // 4000 * 12 / 0.04 = 1.2M
    expect(suggestedIndependenceCorpus(items, 0.04, 0, 0)).toBe(1_200_000);
  });

  it("haircut reduces the required corpus proportionally", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 1_000 }),
    ];
    // Haircut 50%: 3000 + 500 = 3500/mo = 42K/yr / 0.04 = 1.05M
    expect(suggestedIndependenceCorpus(items, 0.04, 0.5, 0)).toBe(1_050_000);
  });

  it("100% haircut floors to fixed-only corpus", () => {
    const items = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 2_000 }),
    ];
    // Only fixed counts: 3000 * 12 / 0.04 = 900K
    expect(suggestedIndependenceCorpus(items, 0.04, 1, 0)).toBe(900_000);
  });
});

describe("suggestedIndependenceCorpus with tax gross-up", () => {
  const items = () => [item({ type: "fixed", monthlyUSD: 4_000 })];

  it("taxRate = 0 leaves corpus unchanged from net", () => {
    // 4000 * 12 / 0.04 = 1.2M
    expect(suggestedIndependenceCorpus(items(), 0.04, 0, 0)).toBe(1_200_000);
  });

  it("taxRate = 0.20 grosses up corpus by 1/(1-0.20) = 1.25x", () => {
    // Net annual = 48K; gross = 60K; corpus = 60K / 0.04 = 1.5M
    expect(suggestedIndependenceCorpus(items(), 0.04, 0, 0.2)).toBe(1_500_000);
  });

  it("taxRate = 0.40 grosses up by 1/0.6 ≈ 1.667x", () => {
    // Net annual = 48K; gross = 80K; corpus = 2M
    const c = suggestedIndependenceCorpus(items(), 0.04, 0, 0.4)!;
    expect(c).toBeCloseTo(2_000_000, 0);
  });

  it("taxRate = 1 (or >1) clamps to 0.99 (no divide by zero)", () => {
    // 1-0.99 = 0.01 → gross factor 100x → corpus = 48K / 0.01 / 0.04 = 120M
    const c = suggestedIndependenceCorpus(items(), 0.04, 0, 1)!;
    expect(c).toBeCloseTo(120_000_000, 0);
  });

  it("taxRate undefined defaults to 20% (the staff-set default)", () => {
    const withDefault = suggestedIndependenceCorpus(items(), 0.04, 0);
    const explicit20 = suggestedIndependenceCorpus(items(), 0.04, 0, 0.2);
    expect(withDefault).toBe(explicit20);
  });

  it("haircut and tax compose: 50% haircut + 20% tax on a fixed+variable split", () => {
    const its = [
      item({ type: "fixed", monthlyUSD: 3_000 }),
      item({ type: "variable", monthlyUSD: 2_000 }),
    ];
    // Net after haircut = 3000 + 2000*0.5 = 4000/mo = 48K/yr
    // Gross = 48K / 0.8 = 60K/yr → corpus = 60K / 0.04 = 1.5M
    expect(suggestedIndependenceCorpus(its, 0.04, 0.5, 0.2)).toBe(1_500_000);
  });
});

describe("suggestedIndependenceCorpus", () => {
  it("returns null when expenses zero", () => {
    expect(suggestedIndependenceCorpus([], 0.04)).toBeNull();
  });

  it("returns null when withdrawal rate non-positive", () => {
    expect(
      suggestedIndependenceCorpus([item({ monthlyUSD: 3_000 })], 0),
    ).toBeNull();
    expect(
      suggestedIndependenceCorpus([item({ monthlyUSD: 3_000 })], -0.04),
    ).toBeNull();
  });

  it("computes corpus = annual / SWR (no tax, no haircut)", () => {
    // $3,000/mo × 12 = $36,000/yr at 4% SWR → $900K corpus
    const c = suggestedIndependenceCorpus(
      [item({ monthlyUSD: 3_000, category: "housing" })],
      0.04,
      0, // no haircut
      0, // no tax gross-up
    );
    expect(c).toBe(900_000);
  });

  it("uses retirement-relevant subtotal (excludes savings)", () => {
    const items = [
      item({ monthlyUSD: 3_000, category: "housing" }),
      item({ monthlyUSD: 1_000, category: "savings" }),
    ];
    // Total monthly = $4K, but retirement-relevant = $3K → $36K/yr
    // → $900K corpus, not $1.2M
    expect(suggestedIndependenceCorpus(items, 0.04, 0, 0)).toBe(900_000);
  });
});

describe("subscription helpers", () => {
  it("perCycleAmountUSD: monthly == monthlyUSD", () => {
    const i = item({
      monthlyUSD: 9.99,
      isSubscription: true,
      billingCycle: "monthly",
    });
    expect(perCycleAmountUSD(i)).toBeCloseTo(9.99, 5);
  });

  it("perCycleAmountUSD: yearly = monthlyUSD * 12", () => {
    const i = item({
      monthlyUSD: 8.25,
      isSubscription: true,
      billingCycle: "yearly",
    });
    expect(perCycleAmountUSD(i)).toBeCloseTo(99, 5);
  });

  it("perCycleAmountUSD: quarterly = monthlyUSD * 3", () => {
    const i = item({
      monthlyUSD: 10,
      isSubscription: true,
      billingCycle: "quarterly",
    });
    expect(perCycleAmountUSD(i)).toBeCloseTo(30, 5);
  });

  it("perCycleAmountUSD: defaults to monthly when cycle unset", () => {
    const i = item({ monthlyUSD: 50, isSubscription: true });
    expect(perCycleAmountUSD(i)).toBe(50);
  });

  it("nextBillingDate: returns null for non-subscription", () => {
    const i = item({ isSubscription: false });
    expect(nextBillingDate(i)).toBeNull();
  });

  it("nextBillingDate: monthly subscription started 2 months ago → next is ~1 month away", () => {
    const now = Date.UTC(2025, 4, 15);
    const start = Date.UTC(2025, 2, 15); // March 15, 2025
    const i = item({
      isSubscription: true,
      billingCycle: "monthly",
      startDate: start,
    });
    const next = nextBillingDate(i, now);
    expect(next).not.toBeNull();
    // Anchor steps forward: Mar 15 → Apr 15 → May 15 → Jun 15 (first > May 15)
    expect(next!.getUTCMonth()).toBe(5); // June
    expect(next!.getUTCDate()).toBe(15);
  });

  it("nextBillingDate: yearly subscription started last year → next year", () => {
    const now = Date.UTC(2025, 5, 1);
    const start = Date.UTC(2024, 0, 3); // Jan 3, 2024
    const i = item({
      isSubscription: true,
      billingCycle: "yearly",
      startDate: start,
    });
    const next = nextBillingDate(i, now);
    expect(next).not.toBeNull();
    // Jan 3 2024 → Jan 3 2025 → Jan 3 2026 (first > June 2025)
    expect(next!.getUTCFullYear()).toBe(2026);
    expect(next!.getUTCMonth()).toBe(0);
  });

  it("nextBillingDate: future startDate returns the startDate itself stepped one cycle past it", () => {
    const now = Date.UTC(2025, 4, 1);
    const future = Date.UTC(2025, 11, 1); // Dec 1, 2025
    const i = item({
      isSubscription: true,
      billingCycle: "monthly",
      startDate: future,
    });
    const next = nextBillingDate(i, now);
    // Loop condition is `<= now` — future date is already > now, so
    // we don't step. The function returns the start date as-is.
    expect(next!.getTime()).toBe(future);
  });

  it("subscriptionItems filters", () => {
    const items = [
      item({ id: "a", isSubscription: true }),
      item({ id: "b", isSubscription: false }),
      item({ id: "c" }), // undefined = not subscription
    ];
    expect(subscriptionItems(items)).toHaveLength(1);
    expect(subscriptionItems(items)[0].id).toBe("a");
  });
});

describe("filterBudgetByMember", () => {
  const items: BudgetItem[] = [
    item({ id: "b1", ownerId: "m1", monthlyUSD: 3_000 }),
    item({ id: "b2", ownerId: "m2", monthlyUSD: 1_500 }),
    item({ id: "b3", ownerId: "m1", monthlyUSD: 800 }),
  ];

  it("returns all items when memberId is null", () => {
    expect(filterBudgetByMember(items, null)).toHaveLength(3);
  });

  it("filters to a single member", () => {
    expect(filterBudgetByMember(items, "m1")).toHaveLength(2);
    expect(filterBudgetByMember(items, "m2")).toHaveLength(1);
  });

  it("returns empty when no items belong to member", () => {
    expect(filterBudgetByMember(items, "nobody")).toHaveLength(0);
  });
});

describe("effectiveHaircut — sizing-time conditional adjustment", () => {
  // The sizing helpers (suggestedIndependenceCorpus etc.) take a
  // single haircut number. effectiveHaircut is what callers
  // wrap their raw rate with so corpus sizing reflects how
  // OFTEN the haircut actually applies in the simulator.
  it("returns the raw rate in always-apply mode", () => {
    expect(effectiveHaircut(0.30, false)).toBe(0.30);
    expect(effectiveHaircut(0, false)).toBe(0);
    expect(effectiveHaircut(1, false)).toBe(1);
  });

  it("scales by the historical down-year frequency in conditional mode", () => {
    expect(effectiveHaircut(0.30, true)).toBeCloseTo(
      0.30 * HISTORICAL_DOWN_YEAR_FREQUENCY,
      6,
    );
    expect(effectiveHaircut(1.0, true)).toBeCloseTo(
      HISTORICAL_DOWN_YEAR_FREQUENCY,
      6,
    );
  });

  it("clamps + NaN-safe inputs", () => {
    expect(effectiveHaircut(-0.5, true)).toBe(0);
    expect(effectiveHaircut(1.5, false)).toBe(1);
    expect(effectiveHaircut(NaN, false)).toBe(0);
    expect(effectiveHaircut(null, true)).toBe(0);
    expect(effectiveHaircut(undefined, true)).toBe(0);
  });
});

describe("variableRetirementMonthly — what the haircut may cut", () => {
  // Same exclusion rules as `retirementMonthlyAfterHaircut` —
  // skip savings, skip endsAtRetirement, skip non-finite.
  it("sums variable items only, excluding savings + endsAtRetirement + fixed", () => {
    const items: BudgetItem[] = [
      item({ id: "a", monthlyUSD: 3_000, type: "fixed" }), // excluded (fixed)
      item({ id: "b", monthlyUSD: 1_500, type: "variable" }), // included
      item({ id: "c", monthlyUSD: 800, type: "variable", category: "savings" }), // excluded (savings)
      item({ id: "d", monthlyUSD: 200, type: "variable", endsAtRetirement: true }), // excluded
      item({ id: "e", monthlyUSD: 600, type: "variable" }), // included
    ];
    expect(variableRetirementMonthly(items)).toBe(2_100);
  });

  it("composes with retirementMonthlyAfterHaircut(items, 0) to the no-haircut total", () => {
    // The two helpers should split retirement monthly into
    // (fixed) + (variable) — so calling 'after-haircut' with
    // haircut=0 equals fixed + variable. Pinning this composition
    // keeps refactors honest (e.g. someone changing one but not
    // the other would break the share computation).
    const items: BudgetItem[] = [
      item({ id: "a", monthlyUSD: 3_000, type: "fixed" }),
      item({ id: "b", monthlyUSD: 1_500, type: "variable" }),
      item({ id: "c", monthlyUSD: 600, type: "variable" }),
    ];
    const noHaircut = retirementMonthlyAfterHaircut(items, 0);
    const variable = variableRetirementMonthly(items);
    expect(noHaircut).toBe(5_100);
    expect(variable).toBe(2_100);
  });
});

describe("effectiveVariableShare — resolution chain", () => {
  // The user's mental model: "what fraction of my retirement
  // spend gets cut by the haircut?". The resolver picks the
  // best signal in this priority order:
  //   1. explicit user override (they know best)
  //   2. budget-derived (their actual line items)
  //   3. 0.35 default (BLS median for 65+ households)

  it("uses the explicit override when set + valid", () => {
    const items: BudgetItem[] = [
      item({ id: "a", monthlyUSD: 1_000, type: "fixed" }),
      item({ id: "b", monthlyUSD: 1_000, type: "variable" }),
    ];
    // Budget would say 50%; override says 80%.
    expect(effectiveVariableShare(items, 0.8)).toBe(0.8);
    // Override 0 is valid (user explicitly says "nothing variable").
    expect(effectiveVariableShare(items, 0)).toBe(0);
  });

  it("falls through to budget-derived when override is null/undefined", () => {
    const items: BudgetItem[] = [
      item({ id: "a", monthlyUSD: 3_000, type: "fixed" }),
      item({ id: "b", monthlyUSD: 1_500, type: "variable" }),
    ];
    // 1500 / (3000 + 1500) = 0.333...
    expect(effectiveVariableShare(items, null)).toBeCloseTo(1_500 / 4_500, 6);
    expect(effectiveVariableShare(items, undefined)).toBeCloseTo(
      1_500 / 4_500,
      6,
    );
  });

  it("falls through to 0.35 default when no budget items", () => {
    expect(effectiveVariableShare([], null)).toBe(DEFAULT_VARIABLE_SHARE);
    expect(effectiveVariableShare([], undefined)).toBe(DEFAULT_VARIABLE_SHARE);
  });

  it("clamps + ignores out-of-range overrides (falls through)", () => {
    const items: BudgetItem[] = [
      item({ id: "a", monthlyUSD: 3_000, type: "fixed" }),
      item({ id: "b", monthlyUSD: 1_500, type: "variable" }),
    ];
    // -0.5 isn't a valid share → fall through to budget-derived.
    expect(effectiveVariableShare(items, -0.5)).toBeCloseTo(1_500 / 4_500, 6);
    // 1.5 isn't valid either.
    expect(effectiveVariableShare(items, 1.5)).toBeCloseTo(1_500 / 4_500, 6);
    expect(effectiveVariableShare(items, NaN)).toBeCloseTo(1_500 / 4_500, 6);
  });

  it("handles edge: budget items but all retirement-irrelevant (savings + endsAtRetirement)", () => {
    // No items contribute to retirement total → noHaircutTotal = 0
    // → can't divide. Falls through to default.
    const items: BudgetItem[] = [
      item({ id: "s", monthlyUSD: 2_000, type: "variable", category: "savings" }),
      item({ id: "e", monthlyUSD: 1_000, type: "variable", endsAtRetirement: true }),
    ];
    expect(effectiveVariableShare(items, null)).toBe(DEFAULT_VARIABLE_SHARE);
  });
});

describe("filterBudgetForRollups", () => {
  // Mirrors the semantics used everywhere else for rollup
  // scoping: per-member pick wins; otherwise drop owners flagged
  // out of household rollups.
  const items: BudgetItem[] = [
    item({ id: "b1", ownerId: "m1", monthlyUSD: 3_000 }),
    item({ id: "b2", ownerId: "m2", monthlyUSD: 1_500 }),
    item({ id: "b3", ownerId: "m3", monthlyUSD: 200 }),
  ];

  it("scopes to a specific member when one is picked (overrides active set)", () => {
    // Even if m2 is excluded from rollups, picking them
    // explicitly shows their items — the explicit pick wins.
    const result = filterBudgetForRollups(items, "m2", new Set(["m1", "m3"]));
    expect(result.map((it) => it.id)).toEqual(["b2"]);
  });

  it("scopes to active members when no specific member is picked", () => {
    const result = filterBudgetForRollups(items, null, new Set(["m1", "m3"]));
    expect(result.map((it) => it.id)).toEqual(["b1", "b3"]);
  });

  it("returns no items when the active set is empty", () => {
    expect(filterBudgetForRollups(items, null, new Set())).toEqual([]);
  });
});

describe("defaultEndsAtRetirement", () => {
  it("returns true for savings", () => {
    expect(defaultEndsAtRetirement("savings")).toBe(true);
  });

  it("returns false for other categories", () => {
    expect(defaultEndsAtRetirement("housing")).toBe(false);
    expect(defaultEndsAtRetirement("food")).toBe(false);
    expect(defaultEndsAtRetirement("healthcare")).toBe(false);
    expect(defaultEndsAtRetirement("transportation")).toBe(false);
    expect(defaultEndsAtRetirement("lifestyle")).toBe(false);
  });
});

describe("effectiveExcessInflation — per-category real-excess defaults", () => {
  it("food / transportation default to 0% real excess (tracks CPI)", () => {
    expect(
      effectiveExcessInflation(itemWithDefaults({ category: "food" })),
    ).toBe(0);
    expect(
      effectiveExcessInflation(
        itemWithDefaults({ category: "transportation" }),
      ),
    ).toBe(0);
  });

  it("healthcare defaults to 2% real excess (long-run BLS medical care)", () => {
    expect(
      effectiveExcessInflation(itemWithDefaults({ category: "healthcare" })),
    ).toBeCloseTo(0.02, 6);
  });

  it("housing defaults to 0.5% real excess (long-run shelter)", () => {
    expect(
      effectiveExcessInflation(itemWithDefaults({ category: "housing" })),
    ).toBeCloseTo(0.005, 6);
  });

  it("lifestyle defaults to slight deflation (-0.5% real)", () => {
    expect(
      effectiveExcessInflation(itemWithDefaults({ category: "lifestyle" })),
    ).toBeCloseTo(-0.005, 6);
  });

  it("explicit override wins over the category default", () => {
    expect(
      effectiveExcessInflation(
        itemWithDefaults({
          category: "healthcare",
          excessInflationOverride: 0.04,
        }),
      ),
    ).toBe(0.04);
  });

  it("clamps absurd overrides to [-10%, +50%]", () => {
    expect(
      effectiveExcessInflation(
        itemWithDefaults({ excessInflationOverride: -1 }),
      ),
    ).toBe(-0.1);
    expect(
      effectiveExcessInflation(
        itemWithDefaults({ excessInflationOverride: 5 }),
      ),
    ).toBe(0.5);
  });
});

describe("suggestedIndependenceCorpus — real-terms with per-line excess", () => {
  it("collapses to naive A/SWR when every line is at 0% real excess (CPI)", () => {
    // food + transport default to 0; result should be exactly the
    // naive trinity-style calc.
    const items: BudgetItem[] = [
      item({
        id: "a",
        category: "food",
        monthlyUSD: 2_000,
        type: "fixed",
      }),
      item({
        id: "b",
        category: "transportation",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    // Annual = $36k; 4% SWR; no haircut; no tax → $900k.
    expect(suggestedIndependenceCorpus(items, 0.04, 0, 0)).toBeCloseTo(900_000, -2);
  });

  it("healthcare's 2% real excess lifts its corpus contribution by ~35% at 4% SWR (Trinity 30y)", () => {
    // $1000/mo healthcare = $12k/yr. Naive @ 4% SWR = $300k.
    // Real-excess multiplier at g=2%, N=30: ((1.02)^30 - 1) / 0.6
    //   = 0.811 / 0.6 ≈ 1.352
    // Contribution = $12k × 1.352 / 0.04 ≈ $405.6k.
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "h",
        category: "healthcare",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    expect(suggestedIndependenceCorpus(items, 0.04, 0, 0)).toBeCloseTo(405_600, -3);
  });

  it("DOES NOT explode when real-excess equals or exceeds SWR (was the user-visible bug)", () => {
    // Triggers the prior Gordon-perpetuity singularity: with SWR=2%
    // and default 2% real-excess on healthcare, A/(swr-g) collapsed
    // to A/0.001 — a 1000× per-dollar multiplier hidden behind a
    // numerical floor. Finite-horizon multiplier is well-behaved:
    // multiplier ≈ 1.352, contribution ≈ $12k × 1.352 / 0.02 ≈ $811k.
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "h",
        category: "healthcare", // default 2% real excess
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    const corpus = suggestedIndependenceCorpus(items, 0.02, 0, 0);
    expect(corpus).not.toBeNull();
    // Naive would be $600k. The lift should be 35%, not 20× or worse.
    expect(corpus!).toBeGreaterThan(750_000);
    expect(corpus!).toBeLessThan(850_000);
  });

  it("lifestyle's -0.5% real default makes corpus slightly smaller than naive", () => {
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "l",
        category: "lifestyle",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    // multiplier at g=-0.005, N=30: ((0.995)^30 - 1) / -0.15
    //   = -0.140 / -0.15 ≈ 0.929
    // Contribution = $12k × 0.929 / 0.04 ≈ $278.6k (< naive $300k).
    const actual = suggestedIndependenceCorpus(items, 0.04, 0, 0);
    expect(actual).not.toBeNull();
    expect(actual!).toBeLessThan(290_000);
    expect(actual!).toBeGreaterThan(270_000);
  });

  it("respects haircut on variable items", () => {
    const items: BudgetItem[] = [
      item({
        id: "v",
        category: "food", // 0% excess
        monthlyUSD: 1_000,
        type: "variable",
      }),
    ];
    const full = suggestedIndependenceCorpus(items, 0.04, 0, 0);
    const halved = suggestedIndependenceCorpus(items, 0.04, 0.5, 0);
    expect(halved).not.toBeNull();
    expect(full).not.toBeNull();
    expect(Math.abs((halved ?? 0) - (full ?? 0) * 0.5)).toBeLessThan(1);
  });

  it("excludes savings and endsAtRetirement items", () => {
    const items: BudgetItem[] = [
      item({ id: "s", category: "savings", monthlyUSD: 5_000 }),
      item({
        id: "x",
        category: "housing",
        monthlyUSD: 2_000,
        endsAtRetirement: true,
      }),
    ];
    expect(suggestedIndependenceCorpus(items, 0.04)).toBeNull();
  });

  it("stays finite (and sensibly bounded) even when item's real excess exceeds SWR", () => {
    const items: BudgetItem[] = [
      item({
        id: "extreme",
        category: "healthcare",
        monthlyUSD: 1_000,
        excessInflationOverride: 0.08, // 8% real excess; SWR=4%
      }),
    ];
    // multiplier at g=0.08, N=30: ((1.08)^30 - 1) / 2.4
    //   = 9.063 / 2.4 ≈ 3.78. Contribution = $12k × 3.78 / 0.04
    //   ≈ $1.13M. Finite, sensible.
    const c = suggestedIndependenceCorpus(items, 0.04, 0, 0);
    expect(c).not.toBeNull();
    expect(Number.isFinite(c ?? 0)).toBe(true);
    expect(c!).toBeGreaterThan(1_000_000);
    expect(c!).toBeLessThan(1_300_000);
  });

  it("applies retirement tax gross-up at the end", () => {
    const items: BudgetItem[] = [
      item({
        id: "h",
        category: "food", // 0% excess
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    const noTax = suggestedIndependenceCorpus(items, 0.04, 0, 0);
    const taxed = suggestedIndependenceCorpus(items, 0.04, 0, 0.2);
    expect(noTax).not.toBeNull();
    expect(taxed).not.toBeNull();
    expect(Math.abs((taxed ?? 0) - (noTax ?? 0) * 1.25)).toBeLessThan(1);
  });
});

describe("realExcessGrowthMultiplier — bounded, well-behaved at every g", () => {
  it("returns exactly 1 at g = 0 (no growth, multiplier collapses)", () => {
    expect(realExcessGrowthMultiplier(0, 30)).toBe(1);
  });

  it("returns 1 in the numerical-edge near-zero region", () => {
    expect(realExcessGrowthMultiplier(1e-10, 30)).toBe(1);
    expect(realExcessGrowthMultiplier(-1e-10, 30)).toBe(1);
  });

  it("matches the time-weighted average closed form at g = 2%, N = 30", () => {
    // ((1.02)^30 - 1) / (0.02 * 30) ≈ 1.35216
    expect(realExcessGrowthMultiplier(0.02, 30)).toBeCloseTo(1.352, 3);
  });

  it("returns <1 for negative real excess (deflation)", () => {
    // ((0.995)^30 - 1) / (-0.005 * 30) ≈ 0.9308
    expect(realExcessGrowthMultiplier(-0.005, 30)).toBeCloseTo(0.9308, 3);
  });

  it("stays finite at g = swr (was the singularity in the old Gordon formula)", () => {
    // ((1.04)^30 - 1) / (0.04 * 30) ≈ 1.869
    expect(realExcessGrowthMultiplier(0.04, 30)).toBeCloseTo(1.869, 3);
    expect(Number.isFinite(realExcessGrowthMultiplier(0.04, 30))).toBe(true);
  });

  it("stays bounded at the documented cap for absurd inputs", () => {
    // Unbounded: ((1.5)^30 − 1) / (0.5 × 30) ≈ 12,783. The cap
    // kicks in at 50, which is the documented safety ceiling.
    // We assert equality at the cap (not just <= 50) because
    // anything strictly below the cap would mean the cap was
    // applied to a value < 50, which is a regression.
    expect(realExcessGrowthMultiplier(0.5, 30)).toBe(50);
  });

  it("longer horizon increases the multiplier for positive g", () => {
    const at30 = realExcessGrowthMultiplier(0.02, 30);
    const at60 = realExcessGrowthMultiplier(0.02, 60);
    expect(at60).toBeGreaterThan(at30);
  });
});

describe("weightedRealExcess — single user-facing blended rate", () => {
  it("returns 0 when no retirement-relevant spend", () => {
    expect(weightedRealExcess([])).toBe(0);
    expect(weightedRealExcess([item({ category: "savings", monthlyUSD: 5_000 })])).toBe(0);
  });

  it("returns the single line's excess when only one line", () => {
    const items = [
      itemWithDefaults({
        id: "h",
        category: "healthcare",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    expect(weightedRealExcess(items)).toBeCloseTo(0.02, 6);
  });

  it("weights by annual spend (after haircut on variable items)", () => {
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "h",
        category: "healthcare", // 2% real
        monthlyUSD: 1_000,
        type: "fixed",
      }),
      itemWithDefaults({
        id: "f",
        category: "food", // 0% real
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    // (12000 × 0.02 + 12000 × 0) / 24000 = 0.01
    expect(weightedRealExcess(items)).toBeCloseTo(0.01, 6);
  });

  it("haircut shrinks variable-line weight (so haircut shifts the blend)", () => {
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "h",
        category: "healthcare",
        monthlyUSD: 1_000,
        type: "fixed", // 2% real
      }),
      itemWithDefaults({
        id: "l",
        category: "lifestyle",
        monthlyUSD: 1_000,
        type: "variable", // -0.5% real
      }),
    ];
    // No haircut: (12k × 0.02 + 12k × -0.005) / 24k = 0.0075
    expect(weightedRealExcess(items, 0)).toBeCloseTo(0.0075, 6);
    // 100% haircut wipes the variable line: blended = 0.02
    expect(weightedRealExcess(items, 1)).toBeCloseTo(0.02, 6);
  });
});

describe("realExcessCorpusDrag — what does per-line excess actually cost", () => {
  it("is zero when every line tracks CPI", () => {
    const items: BudgetItem[] = [
      item({ id: "a", category: "food", monthlyUSD: 2_000, type: "fixed" }),
      item({ id: "b", category: "transportation", monthlyUSD: 1_000, type: "fixed" }),
    ];
    expect(realExcessCorpusDrag(items, 0.04, 0, 0)).toBeCloseTo(0, 0);
  });

  it("equals (actual - naive) — healthcare at $1k/mo adds ~$106k at 4% SWR (Trinity 30y)", () => {
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "h",
        category: "healthcare",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    // actual ≈ $405.6k; naive = $300k; drag ≈ $105.6k.
    const drag = realExcessCorpusDrag(items, 0.04, 0, 0);
    expect(drag).toBeCloseTo(105_600, -3);
  });

  it("goes negative when net-deflators dominate (lifestyle)", () => {
    const items: BudgetItem[] = [
      itemWithDefaults({
        id: "l",
        category: "lifestyle",
        monthlyUSD: 1_000,
        type: "fixed",
      }),
    ];
    const drag = realExcessCorpusDrag(items, 0.04, 0, 0);
    expect(drag).not.toBeNull();
    expect(drag! < 0).toBe(true);
  });
});
