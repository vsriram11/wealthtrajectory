// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "@/lib/store";

beforeEach(() => {
  useAppStore.getState().resetToDemo();
});

describe("addMember / removeMember", () => {
  it("adds a member with a unique id", () => {
    const id = useAppStore.getState().addMember("Kid 1");
    const members = useAppStore.getState().household.members;
    expect(members.find((m) => m.id === id)?.displayName).toBe("Kid 1");
  });

  it("blocks deleting a member that owns accounts", () => {
    const ownerId = useAppStore.getState().household.accounts[0].ownerId;
    const result = useAppStore.getState().removeMember(ownerId);
    expect(result).toBe(false);
  });

  it("removes a member that owns nothing", () => {
    const id = useAppStore.getState().addMember("Solo");
    expect(useAppStore.getState().removeMember(id)).toBe(true);
    expect(
      useAppStore.getState().household.members.find((m) => m.id === id),
    ).toBeUndefined();
  });
});

describe("setMemberIncome / setMemberAge", () => {
  it("sets income on a member", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberIncome(id, 75_000);
    const m = useAppStore
      .getState()
      .household.members.find((x) => x.id === id);
    expect(m?.incomeUSD).toBe(75_000);
  });

  it("clears income when passed null", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberIncome(id, 75_000);
    useAppStore.getState().setMemberIncome(id, null);
    const m = useAppStore
      .getState()
      .household.members.find((x) => x.id === id);
    expect(m?.incomeUSD).toBeNull();
  });

  it("clamps negative income to 0 (valid earner state)", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberIncome(id, -1000);
    const m = useAppStore
      .getState()
      .household.members.find((x) => x.id === id);
    expect(m?.incomeUSD).toBe(0);
  });

  it("sets age on a member", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberAge(id, 38);
    const m = useAppStore
      .getState()
      .household.members.find((x) => x.id === id);
    expect(m?.age).toBe(38);
  });

  it("rounds non-integer age", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberAge(id, 38.7);
    const m = useAppStore
      .getState()
      .household.members.find((x) => x.id === id);
    expect(m?.age).toBe(39);
  });

  it("clears age when passed null / 0 / negative", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberAge(id, 38);
    useAppStore.getState().setMemberAge(id, 0);
    expect(
      useAppStore
        .getState()
        .household.members.find((x) => x.id === id)?.age,
    ).toBeNull();
  });
});

describe("bond leverage auto-derivation from duration", () => {
  function makeBondAccount(symbol: string, valueUSD = 100_000): string {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: `${symbol} account`,
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "bond",
      symbol,
      valueUSD,
    });
    // createHolding doesn't return the holding id; fetch it from the
    // account we just created.
    const acc = useAppStore
      .getState()
      .household.accounts.find((a) => a.id === accId);
    const h = acc?.holdings[acc.holdings.length - 1];
    if (!h) throw new Error("no holding created");
    return h.id;
  }
  function getBond(id: string) {
    const h = useAppStore
      .getState()
      .household.accounts.flatMap((a) => a.holdings)
      .find((h) => h.id === id);
    if (!h || h.kind !== "bond") throw new Error("not a bond");
    return h;
  }

  it("BND (6.5y) gets auto leverage of 0.75, marked auto", () => {
    const id = makeBondAccount("BND");
    const h = getBond(id);
    expect(h.leverage).toBeCloseTo(0.75, 2);
    expect(h.bondLeverageIsManual).toBe(false);
  });

  it("SHY (2y) gets auto leverage near 0.17, marked auto", () => {
    const id = makeBondAccount("SHY");
    const h = getBond(id);
    expect(h.leverage).toBeCloseTo(0.17, 1);
    expect(h.bondLeverageIsManual).toBe(false);
  });

  it("TLT (17y) gets auto leverage 1, marked auto", () => {
    const id = makeBondAccount("TLT");
    const h = getBond(id);
    expect(h.leverage).toBe(1);
    expect(h.bondLeverageIsManual).toBe(false);
  });

  it("TMF (3x leveraged) keeps preset 3x leverage, marked MANUAL", () => {
    const id = makeBondAccount("TMF");
    const h = getBond(id);
    expect(h.leverage).toBe(3);
    expect(h.bondLeverageIsManual).toBe(true);
  });

  it("changing duration on auto bond recomputes leverage", () => {
    const id = makeBondAccount("BND"); // starts auto at 6.5y / 0.75
    useAppStore.getState().setHoldingDuration(id, 2); // SHY-like
    const h = getBond(id);
    expect(h.averageDurationYears).toBe(2);
    expect(h.leverage).toBeCloseTo(0.167, 2);
    expect(h.bondLeverageIsManual).toBe(false);
  });

  it("changing duration on manual bond preserves leverage", () => {
    const id = makeBondAccount("TMF"); // manual at 3x
    useAppStore.getState().setHoldingDuration(id, 30);
    const h = getBond(id);
    expect(h.averageDurationYears).toBe(30);
    expect(h.leverage).toBe(3); // unchanged
    expect(h.bondLeverageIsManual).toBe(true);
  });

  it("setHoldingLeverage on a bond flips to manual", () => {
    const id = makeBondAccount("BND"); // auto at 0.75
    useAppStore.getState().setHoldingLeverage(id, 1.5);
    const h = getBond(id);
    expect(h.leverage).toBe(1.5);
    expect(h.bondLeverageIsManual).toBe(true);
  });

  it("resetBondLeverageToAuto re-derives from current duration", () => {
    const id = makeBondAccount("BND");
    useAppStore.getState().setHoldingLeverage(id, 1.5); // → manual
    useAppStore.getState().setHoldingDuration(id, 8); // → 1.5 frozen
    expect(getBond(id).leverage).toBe(1.5);
    useAppStore.getState().resetBondLeverageToAuto(id);
    const h = getBond(id);
    expect(h.leverage).toBe(1); // 8y derives to 1
    expect(h.bondLeverageIsManual).toBe(false);
  });
});

describe("health plans: ownerId-in-coverage invariant + addPlanToBudget idempotency", () => {
  it("addHealthPlan auto-includes ownerId in coveredMemberIds if the caller forgets", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const id = useAppStore.getState().addHealthPlan({
      name: "Test",
      ownerId: memberId,
      coveredMemberIds: [], // caller "forgot" — invariant should fix it up
      source: "custom",
      category: "other",
      monthlyPremiumUSD: 400,
      annualDeductibleUSD: 1000,
      annualOutOfPocketMaxUSD: 5000,
      factorScores: {},
    });
    const plan = useAppStore.getState().healthPlans.find((p) => p.id === id);
    expect(plan?.coveredMemberIds).toEqual([memberId]);
  });

  it("updateHealthPlan re-enforces the ownerId-in-coverage invariant", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const id = useAppStore.getState().addHealthPlan({
      name: "Test",
      ownerId: memberId,
      coveredMemberIds: [memberId],
      source: "custom",
      category: "other",
      monthlyPremiumUSD: 400,
      annualDeductibleUSD: 1000,
      annualOutOfPocketMaxUSD: 5000,
      factorScores: {},
    });
    // Try to patch coveredMemberIds in a way that drops the owner.
    useAppStore.getState().updateHealthPlan(id, {
      coveredMemberIds: ["other-member-id"],
    });
    const plan = useAppStore.getState().healthPlans.find((p) => p.id === id);
    // ownerId is auto-prepended back.
    expect(plan?.coveredMemberIds).toContain(memberId);
  });

  it("addPlanToBudget creates a healthcare budget item; second call is idempotent", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const planId = useAppStore.getState().addHealthPlan({
      name: "ACA Silver",
      ownerId: memberId,
      coveredMemberIds: [memberId],
      source: "template",
      category: "aca_marketplace",
      monthlyPremiumUSD: 450,
      annualDeductibleUSD: 4500,
      annualOutOfPocketMaxUSD: 9000,
      factorScores: {},
    });
    const budgetCountBefore = useAppStore.getState().budgetItems.length;
    const itemId1 = useAppStore.getState().addPlanToBudget(planId);
    expect(itemId1).not.toBeNull();
    const budgetCountAfter = useAppStore.getState().budgetItems.length;
    expect(budgetCountAfter).toBe(budgetCountBefore + 1);

    // Call twice — should update in place, NOT create a duplicate.
    const itemId2 = useAppStore.getState().addPlanToBudget(planId);
    expect(itemId2).toBe(itemId1);
    expect(useAppStore.getState().budgetItems.length).toBe(budgetCountAfter);

    // The created item carries the plan name, owner, and category.
    const item = useAppStore.getState().budgetItems.find((b) => b.id === itemId1);
    expect(item?.name).toBe("ACA Silver");
    expect(item?.ownerId).toBe(memberId);
    expect(item?.category).toBe("healthcare");
    expect(item?.subcategory).toBe("Health insurance");
    expect(item?.monthlyUSD).toBe(450);
  });

  it("addPlanToBudget reflects premium changes — re-clicking updates monthlyUSD in place", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const planId = useAppStore.getState().addHealthPlan({
      name: "Plan X",
      ownerId: memberId,
      coveredMemberIds: [memberId],
      source: "custom",
      category: "other",
      monthlyPremiumUSD: 300,
      annualDeductibleUSD: 1000,
      annualOutOfPocketMaxUSD: 5000,
      factorScores: {},
    });
    const itemId = useAppStore.getState().addPlanToBudget(planId);
    expect(itemId).not.toBeNull();
    useAppStore.getState().updateHealthPlan(planId, { monthlyPremiumUSD: 500 });
    useAppStore.getState().addPlanToBudget(planId);
    const item = useAppStore
      .getState()
      .budgetItems.find((b) => b.id === itemId);
    expect(item?.monthlyUSD).toBe(500);
  });

  it("setHealthImportanceWeight clamps to [0,1] and deletes the entry on zero", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore
      .getState()
      .setHealthImportanceWeight(memberId, "premiumAffordability", 5); // out-of-range
    expect(
      useAppStore.getState().healthImportanceWeights[memberId]
        ?.premiumAffordability,
    ).toBe(1);

    useAppStore
      .getState()
      .setHealthImportanceWeight(memberId, "premiumAffordability", -3);
    expect(
      useAppStore.getState().healthImportanceWeights[memberId]
        ?.premiumAffordability,
    ).toBeUndefined();
  });

  it("removeHealthPlan removes only the targeted plan", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const a = useAppStore.getState().addHealthPlan({
      name: "A",
      ownerId: memberId,
      coveredMemberIds: [memberId],
      source: "custom",
      category: "other",
      monthlyPremiumUSD: 100,
      annualDeductibleUSD: 0,
      annualOutOfPocketMaxUSD: 0,
      factorScores: {},
    });
    const b = useAppStore.getState().addHealthPlan({
      name: "B",
      ownerId: memberId,
      coveredMemberIds: [memberId],
      source: "custom",
      category: "other",
      monthlyPremiumUSD: 200,
      annualDeductibleUSD: 0,
      annualOutOfPocketMaxUSD: 0,
      factorScores: {},
    });
    useAppStore.getState().removeHealthPlan(a);
    const remaining = useAppStore
      .getState()
      .healthPlans.map((p) => p.id);
    expect(remaining).not.toContain(a);
    expect(remaining).toContain(b);
  });
});

describe("driveEncryptionEnabled persists across passphrase clears", () => {
  it("defaults to false; setEncryptionPassphrase(non-null) flips it true", () => {
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(false);
    useAppStore.getState().setEncryptionPassphrase("hunter22");
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(true);
    expect(useAppStore.getState().encryptionPassphrase).toBe("hunter22");
  });

  it("setEncryptionPassphrase(null) clears the passphrase but keeps the flag (tab-close = passphrase wipe, not opt-out)", () => {
    useAppStore.getState().setEncryptionPassphrase("hunter22");
    useAppStore.getState().setEncryptionPassphrase(null);
    expect(useAppStore.getState().encryptionPassphrase).toBeNull();
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(true);
  });

  it("disableDriveEncryption clears both passphrase and the persisted flag", () => {
    useAppStore.getState().setEncryptionPassphrase("hunter22");
    useAppStore.getState().disableDriveEncryption();
    expect(useAppStore.getState().encryptionPassphrase).toBeNull();
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(false);
  });

  it("empty string passphrase is treated as null (no flag flip)", () => {
    useAppStore.getState().setEncryptionPassphrase("");
    expect(useAppStore.getState().encryptionPassphrase).toBeNull();
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(false);
  });
});

describe("budget items: per-member ownership", () => {
  it("addBudgetItem requires ownerId; round-trips through state", () => {
    const ownerId = useAppStore.getState().household.accounts[0].ownerId;
    const id = useAppStore.getState().addBudgetItem({
      name: "Rent",
      ownerId,
      category: "housing",
      monthlyUSD: 3_100,
      type: "fixed",
      endsAtRetirement: false,
    });
    const item = useAppStore
      .getState()
      .budgetItems.find((b) => b.id === id);
    expect(item?.ownerId).toBe(ownerId);
  });

  it("removeMember refuses when a member owns budget items", () => {
    const ownerId = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().addBudgetItem({
      name: "Spouse phone",
      ownerId,
      category: "housing",
      monthlyUSD: 80,
      type: "fixed",
      endsAtRetirement: false,
    });
    expect(useAppStore.getState().removeMember(ownerId)).toBe(false);
  });

  it("removeMember succeeds after their budget items are cleared", () => {
    const ownerId = useAppStore.getState().addMember("Spouse");
    const id = useAppStore.getState().addBudgetItem({
      name: "Spouse phone",
      ownerId,
      category: "housing",
      monthlyUSD: 80,
      type: "fixed",
      endsAtRetirement: false,
    });
    useAppStore.getState().removeBudgetItem(id);
    expect(useAppStore.getState().removeMember(ownerId)).toBe(true);
  });

  it("legacy items without ownerId get backfilled on hydrate", () => {
    const before = useAppStore.getState();
    const legacyItem = {
      id: "legacy",
      name: "Old expense",
      // ownerId intentionally missing — simulating pre-feature payload
      category: "housing",
      monthlyUSD: 100,
      type: "fixed",
      endsAtRetirement: false,
      createdAt: 0,
    } as unknown as import("@/lib/budget/budget").BudgetItem;
    useAppStore.getState().hydrateFromPersisted({
      household: before.household,
      assumptions: before.assumptions,
      budgetItems: [legacyItem],
    });
    const after = useAppStore.getState().budgetItems[0];
    // Backfilled to the first member's id (DEMO_HOUSEHOLD's member).
    expect(after.ownerId).toBe(before.household.members[0].id);
  });

  it("items owned by deleted members get reattributed on hydrate", () => {
    const before = useAppStore.getState();
    const orphan = {
      id: "orphan",
      name: "Ghost expense",
      ownerId: "ghost-member-id-that-doesnt-exist",
      category: "housing",
      monthlyUSD: 100,
      type: "fixed",
      endsAtRetirement: false,
      createdAt: 0,
    } as unknown as import("@/lib/budget/budget").BudgetItem;
    useAppStore.getState().hydrateFromPersisted({
      household: before.household,
      assumptions: before.assumptions,
      budgetItems: [orphan],
    });
    const after = useAppStore.getState().budgetItems[0];
    expect(after.ownerId).toBe(before.household.members[0].id);
  });
});

describe("scenario override cascade on entity delete", () => {
  it("removeHolding strips the deleted holding from scenarios.holdingCAGRs", () => {
    const s = useAppStore.getState();
    const holding = s.household.accounts[0].holdings[0];
    // Create a scenario with an override on this holding
    const scId = useAppStore.getState().addScenario({
      name: "test-sc",
      overrides: { holdingCAGRs: { [holding.id]: 0.05 } },
    });
    expect(
      useAppStore
        .getState()
        .scenarios.find((sc) => sc.id === scId)?.overrides.holdingCAGRs?.[
        holding.id
      ],
    ).toBe(0.05);

    useAppStore.getState().removeHolding(holding.id);

    const after = useAppStore.getState().scenarios.find((sc) => sc.id === scId);
    expect(after?.overrides.holdingCAGRs?.[holding.id]).toBeUndefined();
  });

  it("removeAccount strips the deleted account + its holdings from scenarios", () => {
    const s = useAppStore.getState();
    const account = s.household.accounts[0];
    const holdingIds = account.holdings.map((h) => h.id);
    // Demo fixture invariant — guards the test from being run
    // against a fixture that doesn't actually exercise the
    // holdings-cleanup branch.
    if (holdingIds.length === 0) {
      throw new Error(
        "demo fixture changed: expected account[0] to have holdings",
      );
    }

    // Scenario with overrides on the account AND on its holdings
    const scId = useAppStore.getState().addScenario({
      name: "wipe-test",
      overrides: {
        accountContributions: { [account.id]: 5_000 },
        holdingCAGRs: Object.fromEntries(holdingIds.map((id) => [id, 0.06])),
      },
    });

    useAppStore.getState().removeAccount(account.id);

    const after = useAppStore.getState().scenarios.find((sc) => sc.id === scId);
    expect(after?.overrides.accountContributions?.[account.id]).toBeUndefined();
    for (const id of holdingIds) {
      expect(after?.overrides.holdingCAGRs?.[id]).toBeUndefined();
    }
  });

  it("scenario overrides for OTHER entities are preserved", () => {
    const s = useAppStore.getState();
    const target = s.household.accounts[0].holdings[0];
    const other = s.household.accounts[0].holdings[1];

    const scId = useAppStore.getState().addScenario({
      name: "preserve-test",
      overrides: {
        holdingCAGRs: {
          [target.id]: 0.07,
          [other.id]: 0.04,
        },
      },
    });

    useAppStore.getState().removeHolding(target.id);

    const after = useAppStore.getState().scenarios.find((sc) => sc.id === scId);
    expect(after?.overrides.holdingCAGRs?.[target.id]).toBeUndefined();
    expect(after?.overrides.holdingCAGRs?.[other.id]).toBe(0.04);
  });
});

describe("per-member assumption overrides survive setMemberAssumption", () => {
  it("setMemberAssumption keeps household defaults intact", () => {
    const before = useAppStore.getState();
    // Member who exists in the demo household.
    const memberId = before.household.members[0].id;
    const householdTarget = before.assumptions.targetNetWorthUSD;

    useAppStore.getState().setMemberAssumption(
      memberId,
      "targetNetWorthUSD",
      20_000_000,
    );

    const after = useAppStore.getState();
    // Per-member override stored.
    expect(after.memberAssumptions[memberId]?.targetNetWorthUSD).toBe(
      20_000_000,
    );
    // Household default unchanged — this is the assertion that
    // BudgetPanel's old code was violating: it called setAssumption,
    // which would have flipped this value.
    expect(after.assumptions.targetNetWorthUSD).toBe(householdTarget);
  });

  it("setMemberAssumption works for retirementTaxRate too", () => {
    const before = useAppStore.getState();
    const memberId = before.household.members[0].id;

    useAppStore.getState().setMemberAssumption(
      memberId,
      "retirementTaxRate",
      0.35,
    );

    const after = useAppStore.getState();
    expect(after.memberAssumptions[memberId]?.retirementTaxRate).toBe(0.35);
    // Household default untouched.
    expect(after.assumptions.retirementTaxRate).toBe(
      before.assumptions.retirementTaxRate,
    );
  });

  it("setMemberAssumption works for retirementVariableHaircut too", () => {
    const before = useAppStore.getState();
    const memberId = before.household.members[0].id;

    useAppStore.getState().setMemberAssumption(
      memberId,
      "retirementVariableHaircut",
      0.5,
    );

    expect(
      useAppStore.getState().memberAssumptions[memberId]
        ?.retirementVariableHaircut,
    ).toBe(0.5);
    expect(useAppStore.getState().assumptions.retirementVariableHaircut).toBe(
      before.assumptions.retirementVariableHaircut,
    );
  });
});

describe("legacy household-income migration on hydrate", () => {
  // Strip member income off the demo baseline so each test starts
  // from a clean "no member has income" state. The richer demo
  // ships with per-member incomes (which is realistic), but these
  // tests pin the LEGACY-data migration path specifically.
  const baseHousehold = () => {
    const before = useAppStore.getState();
    return {
      ...before.household,
      members: before.household.members.map((m) => ({
        ...m,
        incomeUSD: undefined,
      })),
    };
  };

  it("attributes legacy householdAnnualIncomeUSD to first member when none have income", () => {
    const before = useAppStore.getState();
    useAppStore.getState().hydrateFromPersisted({
      household: baseHousehold(),
      assumptions: before.assumptions,
      householdAnnualIncomeUSD: 120_000,
    });
    const after = useAppStore.getState();
    expect(after.household.members[0].incomeUSD).toBe(120_000);
    // Legacy field cleared after migration.
    expect(after.householdAnnualIncomeUSD).toBeNull();
  });

  it("does not overwrite when a member already has income", () => {
    const before = useAppStore.getState();
    const seeded = {
      ...baseHousehold(),
      members: baseHousehold().members.map((m, i) =>
        i === 0 ? { ...m, incomeUSD: 200_000 } : m,
      ),
    };
    useAppStore.getState().hydrateFromPersisted({
      household: seeded,
      assumptions: before.assumptions,
      householdAnnualIncomeUSD: 999_000,
    });
    expect(
      useAppStore.getState().household.members[0].incomeUSD,
    ).toBe(200_000);
  });

  it("noop when legacy income is null / 0", () => {
    const before = useAppStore.getState();
    useAppStore.getState().hydrateFromPersisted({
      household: baseHousehold(),
      assumptions: before.assumptions,
      householdAnnualIncomeUSD: 0,
    });
    expect(
      useAppStore.getState().household.members[0].incomeUSD,
    ).toBeUndefined();
  });
});

describe("reorderAccounts", () => {
  it("reorders household.accounts to match the given ID list", () => {
    const before = useAppStore.getState().household.accounts;
    expect(before.length).toBeGreaterThan(1);
    const newOrder = [...before].reverse().map((a) => a.id);
    useAppStore.getState().reorderAccounts(newOrder);
    const after = useAppStore.getState().household.accounts;
    expect(after.map((a) => a.id)).toEqual(newOrder);
  });

  it("appends omitted accounts to the tail (no data loss on partial input)", () => {
    const before = useAppStore.getState().household.accounts;
    expect(before.length).toBeGreaterThan(2);
    // Only pass the first two IDs; the rest must stay attached.
    const partial = [before[1].id, before[0].id];
    useAppStore.getState().reorderAccounts(partial);
    const after = useAppStore.getState().household.accounts;
    expect(after.map((a) => a.id).slice(0, 2)).toEqual(partial);
    // Same set of accounts, no losses.
    expect(after.map((a) => a.id).sort()).toEqual(
      before.map((a) => a.id).sort(),
    );
  });

  it("ignores unknown IDs in the input list", () => {
    const before = useAppStore.getState().household.accounts;
    const ids = [...before.map((a) => a.id), "ghost-id"];
    useAppStore.getState().reorderAccounts(ids);
    const after = useAppStore.getState().household.accounts;
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id));
  });
});

describe("createAccount + createHolding", () => {
  it("creates an account; new account has no holdings", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const id = useAppStore.getState().createAccount({
      displayName: "Test 401k",
      category: "401K",
      ownerId: memberId,
      monthlyContributionUSD: 1000,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((acc) => acc.id === id);
    expect(a?.holdings.length).toBe(0);
    expect(a?.monthlyContributionUSD).toBe(1000);
  });

  it("creates an equity holding from preset, computing shares", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Brokerage X",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 50_000,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    expect(a.holdings.length).toBe(1);
    const h = a.holdings[0];
    if (h.kind !== "equity") throw new Error("expected equity");
    expect(h.shares).toBeGreaterThan(0);
    expect(h.lastPriceUSD).toBeGreaterThan(0);
    expect(h.shares * h.lastPriceUSD).toBeCloseTo(50_000, 2);
    expect(h.isManualPrice).toBe(false);
  });

  it("falls back to manual mode for unknown tickers", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Brokerage Y",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "ZZZZ-NOPE",
      valueUSD: 12_345,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    const h = a.holdings[0];
    if (h.kind !== "equity") throw new Error("expected equity");
    expect(h.isManualPrice).toBe(true);
    expect(h.shares).toBe(1);
    expect(h.lastPriceUSD).toBe(12_345);
    expect(h.valueUSD).toBe(12_345);
  });
});

describe("setHoldingValue / setHoldingShares / setHoldingPrice", () => {
  function firstEquityId(): string {
    const acct = useAppStore
      .getState()
      .household.accounts.find((a) =>
        a.holdings.some((h) => h.kind === "equity"),
      )!;
    return acct.holdings.find((h) => h.kind === "equity")!.id;
  }

  it("setHoldingValue recomputes shares using current price for live holdings", () => {
    const id = firstEquityId();
    const original = findHolding(id);
    if (original?.kind !== "equity") throw new Error("expected equity");
    const newValue = 99_000;
    useAppStore.getState().setHoldingValue(id, newValue);
    const after = findHolding(id);
    if (after?.kind !== "equity") throw new Error("expected equity");
    expect(after.valueUSD).toBe(newValue);
    expect(after.lastPriceUSD).toBe(original.lastPriceUSD);
    expect(after.shares).toBeCloseTo(newValue / original.lastPriceUSD, 6);
  });

  it("setHoldingShares scales value at the current price", () => {
    const id = firstEquityId();
    const before = findHolding(id);
    if (before?.kind !== "equity") throw new Error("expected equity");
    useAppStore.getState().setHoldingShares(id, before.shares * 2);
    const after = findHolding(id);
    if (after?.kind !== "equity") throw new Error("expected equity");
    expect(after.shares).toBeCloseTo(before.shares * 2, 6);
    expect(after.valueUSD).toBeCloseTo(before.valueUSD * 2, 2);
  });

  it("setHoldingShares preserves fractional precision (no integer rounding)", () => {
    const id = firstEquityId();
    // Pick a value with several decimal places that can't be a
    // round-trip artifact of integer rounding.
    useAppStore.getState().setHoldingShares(id, 0.12345);
    const after = findHolding(id);
    if (after?.kind !== "equity") throw new Error("expected equity");
    expect(after.shares).toBeCloseTo(0.12345, 6);
    // Sanity: not silently coerced to an integer.
    expect(Number.isInteger(after.shares)).toBe(false);
  });

  it("setHoldingPrice flips a holding into manual mode and recomputes value", () => {
    const id = firstEquityId();
    const before = findHolding(id);
    if (before?.kind !== "equity") throw new Error("expected equity");
    useAppStore.getState().setHoldingPrice(id, 100, { manual: true });
    const after = findHolding(id);
    if (after?.kind !== "equity") throw new Error("expected equity");
    expect(after.isManualPrice).toBe(true);
    expect(after.lastPriceUSD).toBe(100);
    expect(after.valueUSD).toBeCloseTo(before.shares * 100, 4);
  });
});

describe("applyLivePrice", () => {
  it("first-time fetch preserves the entered dollar value", () => {
    // Demo holdings start with lastPricedAt === null. The first live
    // price should recompute shares so valueUSD stays put.
    const accId = useAppStore
      .getState()
      .household.accounts.find((a) =>
        a.holdings.some((h) => h.kind === "equity" && h.symbol === "VOO"),
      )!.id;
    const before = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!
      .holdings.find((h) => h.kind === "equity" && h.symbol === "VOO")!;
    useAppStore.getState().applyLivePrice("VOO", 999, Date.now());
    const after = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!
      .holdings.find((h) => h.kind === "equity" && h.symbol === "VOO")!;
    if (after.kind !== "equity") throw new Error("expected equity");
    expect(after.lastPriceUSD).toBe(999);
    expect(after.valueUSD).toBeCloseTo(before.valueUSD, 2);
  });

  it("subsequent fetches hold shares fixed and float valueUSD", () => {
    const accId = useAppStore
      .getState()
      .household.accounts.find((a) =>
        a.holdings.some((h) => h.kind === "equity" && h.symbol === "VOO"),
      )!.id;
    useAppStore.getState().applyLivePrice("VOO", 100, Date.now());
    const after1 = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!
      .holdings.find((h) => h.kind === "equity" && h.symbol === "VOO")!;
    if (after1.kind !== "equity") throw new Error("expected equity");
    useAppStore.getState().applyLivePrice("VOO", 200, Date.now());
    const after2 = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!
      .holdings.find((h) => h.kind === "equity" && h.symbol === "VOO")!;
    if (after2.kind !== "equity") throw new Error("expected equity");
    expect(after2.shares).toBeCloseTo(after1.shares, 6);
    expect(after2.valueUSD).toBeCloseTo(after1.valueUSD * 2, 2);
  });

  it("leaves manual-price holdings untouched", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Manual",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "ZZZZ-NOPE",
      valueUSD: 12_345,
    });
    useAppStore.getState().applyLivePrice("ZZZZ-NOPE", 1, Date.now());
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    const h = a.holdings[0];
    if (h.kind !== "equity") throw new Error("expected equity");
    expect(h.isManualPrice).toBe(true);
    expect(h.valueUSD).toBe(12_345);
  });
});

describe("addScenario / removeScenario", () => {
  it("scenarios start empty and round-trip", () => {
    expect(useAppStore.getState().scenarios.length).toBe(0);
    const id = useAppStore.getState().addScenario({
      name: "Aggressive",
      overrides: { contributionMultiplier: 1.5 },
    });
    expect(useAppStore.getState().scenarios.length).toBe(1);
    useAppStore.getState().removeScenario(id);
    expect(useAppStore.getState().scenarios.length).toBe(0);
  });
});

function findHolding(id: string) {
  for (const a of useAppStore.getState().household.accounts) {
    for (const h of a.holdings) if (h.id === id) return h;
  }
  return null;
}

describe("crypto holdings", () => {
  it("creates a crypto holding from shares + per-unit price", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Coinbase",
      category: "CRYPTO",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "BTC",
      shares: 0.5,
      pricePerUnit: 70_000,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    expect(a.holdings.length).toBe(1);
    const h = a.holdings[0];
    if (h.kind !== "crypto") throw new Error("expected crypto");
    expect(h.symbol).toBe("BTC");
    expect(h.shares).toBeCloseTo(0.5);
    expect(h.lastPriceUSD).toBeCloseTo(70_000);
    expect(h.valueUSD).toBeCloseTo(35_000);
    expect(h.isManualPrice).toBe(true);
  });
});

describe("real-estate holdings", () => {
  it("creates a real-estate holding with name + leverage", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Primary residence",
      category: "REAL_ESTATE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "real_estate",
      name: "123 Main St",
      valueUSD: 100_000,
      expectedRealCAGR: 0.02,
      leverage: 5,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    const h = a.holdings[0];
    if (h.kind !== "real_estate") throw new Error("expected real_estate");
    expect(h.name).toBe("123 Main St");
    expect(h.valueUSD).toBeCloseTo(100_000);
    expect(h.leverage).toBe(5);
    expect(h.expectedRealCAGR).toBeCloseTo(0.02);
  });

  it("real-estate leverage flows into the portfolio exposure", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "House",
      category: "REAL_ESTATE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "real_estate",
      name: "House",
      valueUSD: 100_000,
      expectedRealCAGR: 0.02,
      leverage: 5,
    });
    const before = computePortfolio(useAppStore.getState().household);
    expect(before.classes.realEstateUSD).toBeGreaterThanOrEqual(100_000);
    expect(before.effectiveExposureUSD).toBeGreaterThanOrEqual(
      before.classes.realEstateUSD * 0.99,
    );
  });
});

describe("'other' generic holdings", () => {
  it("creates an 'other' holding with arbitrary name + value + CAGR", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Misc",
      category: "OTHER",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "other",
      name: "Watch collection",
      valueUSD: 25_000,
      expectedRealCAGR: 0,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    const h = a.holdings[0];
    if (h.kind !== "other") throw new Error("expected other");
    expect(h.name).toBe("Watch collection");
    expect(h.valueUSD).toBe(25_000);
    expect(h.expectedRealCAGR).toBe(0);
  });
});

describe("private-stock holdings", () => {
  it("creates a private-stock holding from shares × 409A FMV", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Acme equity",
      category: "OTHER",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "private_stock",
      company: "Acme Inc.",
      shares: 10_000,
      fmvPricePerShareUSD: 1.5,
      preferredRoundPricePerShareUSD: 10,
      expectedRealCAGR: 0,
    });
    const a = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!;
    const h = a.holdings[0];
    if (h.kind !== "private_stock") throw new Error("expected private_stock");
    expect(h.symbol).toBe("Acme Inc.");
    expect(h.shares).toBe(10_000);
    expect(h.lastPriceUSD).toBe(1.5);
    expect(h.valueUSD).toBe(15_000);
    expect(h.preferredRoundPricePerShareUSD).toBe(10);
    expect(h.isManualPrice).toBe(true);
    // Leverage defaults to 1× when not specified.
    expect(h.leverage).toBe(1);
  });

  it("accepts a leverage > 1 on private_stock creation", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Levered PS",
      category: "OTHER",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "private_stock",
      company: "Acme",
      shares: 1000,
      fmvPricePerShareUSD: 10,
      leverage: 2,
    });
    const h = useAppStore
      .getState()
      .household.accounts.find((x) => x.id === accId)!.holdings[0];
    if (h.kind !== "private_stock") throw new Error("expected private_stock");
    expect(h.leverage).toBe(2);
  });

  it("PS leverage flows into the portfolio's effective leverage without double-count", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const memberId = useAppStore.getState().household.members[0].id;
    // Isolated household: drop default demo accounts so the math is
    // easy to reason about.
    useAppStore.getState().importPayload({
      household: {
        id: "real-household",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "Acme",
      category: "OTHER",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    // 1× lever: ratio should be exactly 1 (was 2 with the old
    // double-count bug).
    useAppStore.getState().createHolding(accId, {
      kind: "private_stock",
      company: "Acme",
      shares: 1000,
      fmvPricePerShareUSD: 10,
      leverage: 1,
    });
    let m = computePortfolio(useAppStore.getState().household);
    expect(m.effectiveLeverage).toBeCloseTo(1, 6);
    expect(m.effectiveExposureUSD).toBeCloseTo(m.netWorthUSD, 2);

    // Bump to 2× — effective leverage should match.
    const hid = useAppStore.getState().household.accounts[0].holdings[0].id;
    useAppStore.getState().setHoldingLeverage(hid, 2);
    m = computePortfolio(useAppStore.getState().household);
    expect(m.effectiveLeverage).toBeCloseTo(2, 6);
  });
});

describe("setHoldingComposition", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("attaches a composition to a plain equity holding", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "test",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore
      .getState()
      .createHolding(accId, { kind: "equity", symbol: "VOO", valueUSD: 100_000 });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("expected equity");
    expect(h.composition).toBeUndefined();

    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "equity") throw new Error("expected equity");
    expect(h2.composition).toHaveLength(2);
    expect(h2.composition?.[0].weight).toBe(0.9);
  });

  it("clears composition when passed null (returns to plain equity)", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "test",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    // NTSX presets auto-populate composition. NTSX is a 2-leg
    // wrapper: ~90% equity + ~60% bond exposure (1.5x effective
    // leverage). The store's preset table should fill both legs
    // when the user types NTSX as the symbol.
    useAppStore
      .getState()
      .createHolding(accId, { kind: "equity", symbol: "NTSX", valueUSD: 100_000 });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("expected equity");
    expect(h.composition).toBeDefined();
    expect(h.composition).toHaveLength(2);
    const classes = (h.composition ?? []).map((leg) => leg.kind).sort();
    expect(classes).toEqual(["bond", "equity"]);

    useAppStore.getState().setHoldingComposition(h.id, null);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "equity") throw new Error("expected equity");
    expect(h2.composition).toBeUndefined();
  });

  it("is a no-op on non-equity holdings", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "test",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "C",
      category: "CHECKING",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore
      .getState()
      .createHolding(accId, { kind: "cash", valueUSD: 50_000, expectedRealCAGR: 0 });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h.kind).toBe("cash");
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "equity", weight: 1 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h2.kind).toBe("cash");
    expect((h2 as { composition?: unknown }).composition).toBeUndefined();
  });
});

describe("commodity holdings", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("creates a ticker-based commodity holding from preset (GLD)", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "Brokerage",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "GLD",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h.kind).toBe("commodity");
    if (h.kind !== "commodity") return;
    expect(h.symbol).toBe("GLD");
    expect(h.valueUSD).toBeCloseTo(10_000, 0);
    expect(h.isManualPrice).toBe(false);
  });

  it("creates a custom-name commodity ('Gold jewelry') with manual pricing", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "Safe",
      category: "OTHER",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "Gold jewelry",
      valueUSD: 8_000,
      isCustom: true,
      isIlliquid: true,
      expectedRealCAGR: 0.005,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h.kind).toBe("commodity");
    if (h.kind !== "commodity") return;
    expect(h.symbol).toBe("Gold jewelry"); // not uppercased — it's a name
    expect(h.isManualPrice).toBe(true);
    expect(h.isIlliquid).toBe(true);
    expect(h.valueUSD).toBe(8_000);
  });

  it("commodity holding contributes to portfolio.classes.commodityUSD", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "IAU",
      valueUSD: 5_000,
    });
    const m = computePortfolio(useAppStore.getState().household);
    expect(m.classes.commodityUSD).toBeCloseTo(5_000, 1);
    expect(m.classes.otherUSD).toBe(0);
  });
});

describe("live-priceable crypto ETFs (IBIT, BITX)", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("creates IBIT as a live-priceable crypto holding from value entry", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "IBIT",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h.kind).toBe("crypto");
    if (h.kind !== "crypto") return;
    expect(h.symbol).toBe("IBIT");
    expect(h.isManualPrice).toBe(false); // live-priceable
    expect(h.valueUSD).toBe(10_000);
  });

  it("creates BITX with leverage=2 from value entry", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "BITX",
      valueUSD: 5_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h.kind).toBe("crypto");
    if (h.kind !== "crypto") return;
    expect(h.leverage).toBe(2);
    expect(h.isManualPrice).toBe(false);
  });

  it("BITX leverage flows into portfolio effective leverage (2×)", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "BITX",
      valueUSD: 10_000,
    });
    const m = computePortfolio(useAppStore.getState().household);
    expect(m.effectiveLeverage).toBeCloseTo(2, 3);
    expect(m.effectiveExposureUSD).toBeCloseTo(20_000, 0);
  });

  it("BTC (native) still creates as manual-priced with units + price", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "CRYPTO",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "BTC",
      shares: 0.1,
      pricePerUnit: 70_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "crypto") return;
    expect(h.isManualPrice).toBe(true);
    expect(h.valueUSD).toBeCloseTo(7_000, 0);
  });
});

describe("composition supported on bond/crypto/commodity wrappers", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  function isolated(): string {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    return useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
  }

  it("setHoldingComposition attaches to a bond holding", () => {
    const accId = isolated();
    useAppStore.getState().createHolding(accId, {
      kind: "bond",
      symbol: "BND",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "bond") throw new Error("expected bond");
    expect(h.composition).toBeUndefined();
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "bond", weight: 0.85 },
      { kind: "crypto", weight: 0.1 },
      { kind: "commodity", weight: 0.05 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "bond") throw new Error("expected bond");
    expect(h2.composition).toHaveLength(3);
  });

  it("setHoldingComposition attaches to a commodity holding", () => {
    const accId = isolated();
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "GLD",
      valueUSD: 5_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "commodity") throw new Error("expected commodity");
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "commodity", weight: 1 },
      { kind: "bond", weight: 0.3 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "commodity") throw new Error("expected commodity");
    expect(h2.composition).toHaveLength(2);
  });

  it("setHoldingComposition attaches to a crypto holding", () => {
    const accId = isolated();
    useAppStore.getState().createHolding(accId, {
      kind: "crypto",
      symbol: "IBIT",
      valueUSD: 5_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "crypto") throw new Error("expected crypto");
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "crypto", weight: 0.8 },
      { kind: "equity", weight: 0.2 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "crypto") throw new Error("expected crypto");
    expect(h2.composition).toHaveLength(2);
  });
});

describe("commodity breakdown", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  function isolatedAccount(): string {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    return useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
  }

  it("GLD holding auto-populates 100% gold breakdown from preset", () => {
    const accId = isolatedAccount();
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "GLD",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "commodity") throw new Error("expected commodity");
    expect(h.breakdown).toBeDefined();
    expect(h.breakdown!.metalsShare).toBe(1);
    expect(h.breakdown!.metals.GOLD).toBe(1);
  });

  it("DBC holding auto-populates broad mix breakdown from preset", () => {
    const accId = isolatedAccount();
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "DBC",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "commodity") throw new Error("expected commodity");
    expect(h.breakdown).toBeDefined();
    expect(h.breakdown!.metalsShare).toBeCloseTo(0.2, 2);
    expect(h.breakdown!.energyAg.CRUDE_OIL).toBeGreaterThan(0);
  });

  it("custom-name commodity defaults to 100% gold (Gold jewelry mental model)", () => {
    const accId = isolatedAccount();
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "Gold jewelry",
      valueUSD: 5_000,
      isCustom: true,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    if (h.kind !== "commodity") throw new Error("expected commodity");
    expect(h.breakdown).toBeDefined();
    expect(h.breakdown!.metalsShare).toBe(1);
    expect(h.breakdown!.metals.GOLD).toBe(1);
  });

  it("setHoldingCommodityBreakdown updates and clears", async () => {
    const { EMPTY_METAL, EMPTY_ENERGY_AG } = await import("@/lib/types");
    const accId = isolatedAccount();
    useAppStore.getState().createHolding(accId, {
      kind: "commodity",
      symbol: "GLD",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    // Replace breakdown
    useAppStore.getState().setHoldingCommodityBreakdown(h.id, {
      metalsShare: 0.5,
      metals: { ...EMPTY_METAL, COPPER: 1 },
      energyAg: { ...EMPTY_ENERGY_AG, CRUDE_OIL: 1 },
    });
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h2.kind !== "commodity") throw new Error("expected commodity");
    expect(h2.breakdown!.metalsShare).toBe(0.5);
    expect(h2.breakdown!.metals.COPPER).toBe(1);
    expect(h2.breakdown!.metals.GOLD).toBe(0);
    // Clear breakdown
    useAppStore.getState().setHoldingCommodityBreakdown(h.id, null);
    const h3 = useAppStore.getState().household.accounts[0].holdings[0];
    if (h3.kind !== "commodity") throw new Error("expected commodity");
    expect(h3.breakdown).toBeUndefined();
  });

  it("setHoldingCommodityBreakdown is a no-op on non-commodity holdings", async () => {
    const { EMPTY_METAL, EMPTY_ENERGY_AG } = await import("@/lib/types");
    const accId = isolatedAccount();
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 10_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];
    useAppStore.getState().setHoldingCommodityBreakdown(h.id, {
      metalsShare: 1,
      metals: { ...EMPTY_METAL, GOLD: 1 },
      energyAg: { ...EMPTY_ENERGY_AG },
    });
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h2.kind).toBe("equity");
    expect((h2 as { breakdown?: unknown }).breakdown).toBeUndefined();
  });
});

describe("liability add/remove", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("addLiability persists a new liability", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const before = useAppStore.getState().household.liabilities.length;
    const id = useAppStore.getState().addLiability({
      name: "Chase Sapphire",
      balanceUSD: 5_000,
      annualInterestRate: 0.21,
      monthlyPaymentUSD: 150,
      ownerId: memberId,
    });
    const liabs = useAppStore.getState().household.liabilities;
    expect(liabs.length).toBe(before + 1);
    const added = liabs.find((l) => l.id === id);
    expect(added?.name).toBe("Chase Sapphire");
    expect(added?.balanceUSD).toBe(5_000);
    expect(added?.annualInterestRate).toBeCloseTo(0.21, 6);
    expect(added?.ownerId).toBe(memberId);
  });

  it("removeLiability drops the liability", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const id = useAppStore.getState().addLiability({
      name: "Test",
      balanceUSD: 1_000,
      annualInterestRate: 0.1,
      monthlyPaymentUSD: 50,
      ownerId: memberId,
    });
    expect(
      useAppStore.getState().household.liabilities.find((l) => l.id === id),
    ).toBeTruthy();
    useAppStore.getState().removeLiability(id);
    expect(
      useAppStore.getState().household.liabilities.find((l) => l.id === id),
    ).toBeUndefined();
  });

  it("addLiability clamps negative inputs to zero (defensive)", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const id = useAppStore.getState().addLiability({
      name: "Bad input",
      balanceUSD: -100,
      annualInterestRate: -0.05,
      monthlyPaymentUSD: -10,
      ownerId: memberId,
    });
    const l = useAppStore
      .getState()
      .household.liabilities.find((x) => x.id === id);
    expect(l?.balanceUSD).toBe(0);
    expect(l?.annualInterestRate).toBe(0);
    expect(l?.monthlyPaymentUSD).toBe(0);
  });

  it("liability flows into householdNetWorth (NW = assets - liabilities)", async () => {
    const { householdNetWorth } = await import("@/lib/types");
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 100_000,
    });
    expect(householdNetWorth(useAppStore.getState().household)).toBeCloseTo(
      100_000,
      0,
    );
    useAppStore.getState().addLiability({
      name: "Test debt",
      balanceUSD: 15_000,
      annualInterestRate: 0.07,
      monthlyPaymentUSD: 250,
      ownerId: memberId,
    });
    expect(householdNetWorth(useAppStore.getState().household)).toBeCloseTo(
      85_000,
      0,
    );
  });
});

describe("per-member assumption overrides", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("setMemberAssumption stores an override; clearMemberAssumptions wipes it", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore
      .getState()
      .setMemberAssumption(id, "targetNetWorthUSD", 7_500_000);
    expect(
      useAppStore.getState().memberAssumptions[id]?.targetNetWorthUSD,
    ).toBe(7_500_000);

    useAppStore.getState().clearMemberAssumptions(id);
    expect(useAppStore.getState().memberAssumptions[id]).toBeUndefined();
  });

  it("setMemberAssumption with undefined value drops that field's override", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore.getState().setMemberAssumption(id, "withdrawalRate", 0.035);
    useAppStore
      .getState()
      .setMemberAssumption(id, "targetNetWorthUSD", 1_000_000);
    useAppStore.getState().setMemberAssumption(id, "withdrawalRate", undefined);
    expect(
      useAppStore.getState().memberAssumptions[id]?.withdrawalRate,
    ).toBeUndefined();
    expect(
      useAppStore.getState().memberAssumptions[id]?.targetNetWorthUSD,
    ).toBe(1_000_000);
  });

  it("removeMember also drops their assumption overrides", () => {
    const id = useAppStore.getState().addMember("Spouse");
    useAppStore
      .getState()
      .setMemberAssumption(id, "targetNetWorthUSD", 9_999_999);
    const ok = useAppStore.getState().removeMember(id);
    expect(ok).toBe(true);
    expect(useAppStore.getState().memberAssumptions[id]).toBeUndefined();
  });

  it("resolveAssumptionsForMember merges household defaults + member overrides", async () => {
    const { resolveAssumptionsForMember } = await import(
      "@/lib/projection/useActiveProjection"
    );
    const household = {
      targetNetWorthUSD: 2_000_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const overrides = {
      memberA: { targetNetWorthUSD: 5_000_000 },
      memberB: { withdrawalRate: 0.03 },
    };
    // null memberId → household defaults
    expect(resolveAssumptionsForMember(household, overrides, null)).toEqual(
      household,
    );
    // memberA overrides target only
    expect(
      resolveAssumptionsForMember(household, overrides, "memberA"),
    ).toEqual({
      ...household,
      targetNetWorthUSD: 5_000_000,
    });
    // memberB overrides withdrawal only
    expect(
      resolveAssumptionsForMember(household, overrides, "memberB"),
    ).toEqual({
      ...household,
      withdrawalRate: 0.03,
    });
    // member with no override → household defaults
    expect(
      resolveAssumptionsForMember(household, overrides, "memberC"),
    ).toEqual(household);
  });

  it("memberAssumptions round-trips through Drive export/import", async () => {
    const { exportData, parseImport } = await import("@/lib/persistence/dataIO");
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "test-rt",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    useAppStore
      .getState()
      .setMemberAssumption(memberId, "targetNetWorthUSD", 3_200_000);
    useAppStore.getState().setMemberAssumption(memberId, "withdrawalRate", 0.035);

    const json = exportData({
      household: useAppStore.getState().household,
      assumptions: useAppStore.getState().assumptions,
      scenarios: useAppStore.getState().scenarios,
      memberAssumptions: useAppStore.getState().memberAssumptions,
    });

    const parsed = parseImport(json);
    expect(parsed.memberAssumptions?.[memberId]?.targetNetWorthUSD).toBe(
      3_200_000,
    );
    expect(parsed.memberAssumptions?.[memberId]?.withdrawalRate).toBeCloseTo(
      0.035,
      5,
    );

    // Round-trip through importPayload too
    useAppStore.getState().setMemberAssumption(memberId, "targetNetWorthUSD", undefined);
    useAppStore.getState().setMemberAssumption(memberId, "withdrawalRate", undefined);
    useAppStore.getState().importPayload({
      household: parsed.household,
      assumptions: parsed.assumptions,
      scenarios: parsed.scenarios ?? [],
      memberAssumptions: parsed.memberAssumptions,
    });
    expect(
      useAppStore.getState().memberAssumptions[memberId]?.targetNetWorthUSD,
    ).toBe(3_200_000);
  });

  it("importPayload drops memberAssumptions entries for non-existent members (defensive)", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "h",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      memberAssumptions: {
        [memberId]: { targetNetWorthUSD: 100_000 },
        "ghost-member-id": { targetNetWorthUSD: 999_999 },
      },
    });
    const ma = useAppStore.getState().memberAssumptions;
    expect(ma[memberId]?.targetNetWorthUSD).toBe(100_000);
    expect(ma["ghost-member-id"]).toBeUndefined();
  });
});

describe("reorderMembers + preferredMemberId", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("reorderMembers reorders the household.members array", () => {
    const a = useAppStore.getState().addMember("Alice");
    const b = useAppStore.getState().addMember("Bob");
    const ids = useAppStore.getState().household.members.map((m) => m.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    // Reverse order
    useAppStore.getState().reorderMembers([...ids].reverse());
    const after = useAppStore.getState().household.members.map((m) => m.id);
    expect(after).toEqual([...ids].reverse());
  });

  it("reorderMembers preserves members missing from the input list (safety net)", () => {
    const a = useAppStore.getState().addMember("Alice");
    const b = useAppStore.getState().addMember("Bob");
    const before = useAppStore.getState().household.members.map((m) => m.id);
    // Pass only one id — others should still survive at the tail
    useAppStore.getState().reorderMembers([a]);
    const after = useAppStore.getState().household.members.map((m) => m.id);
    expect(after).toHaveLength(before.length);
    expect(after[0]).toBe(a);
    expect(after).toContain(b);
  });

  it("setPreferredMemberId stores valid id; coerces unknown id to null", () => {
    const a = useAppStore.getState().addMember("Alice");
    useAppStore.getState().setPreferredMemberId(a);
    expect(useAppStore.getState().preferredMemberId).toBe(a);
    useAppStore.getState().setPreferredMemberId("ghost-id");
    expect(useAppStore.getState().preferredMemberId).toBeNull();
    useAppStore.getState().setPreferredMemberId(null);
    expect(useAppStore.getState().preferredMemberId).toBeNull();
  });

  it("removeMember clears preferredMemberId if it was that member", () => {
    const a = useAppStore.getState().addMember("Alice");
    useAppStore.getState().setPreferredMemberId(a);
    expect(useAppStore.getState().preferredMemberId).toBe(a);
    const ok = useAppStore.getState().removeMember(a);
    expect(ok).toBe(true);
    expect(useAppStore.getState().preferredMemberId).toBeNull();
  });

  it("importPayload applies preferredMemberId to selectedMemberId on load", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      preferredMemberId: memberId,
    });
    expect(useAppStore.getState().preferredMemberId).toBe(memberId);
    expect(useAppStore.getState().selectedMemberId).toBe(memberId);
  });

  it("importPayload drops preferredMemberId pointing at non-existent member", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      preferredMemberId: "ghost-member-id",
    });
    expect(useAppStore.getState().preferredMemberId).toBeNull();
    expect(useAppStore.getState().selectedMemberId).toBeNull();
  });

  it("preferredMemberId round-trips through Drive export/import", async () => {
    const { exportData, parseImport } = await import("@/lib/persistence/dataIO");
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "rt",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    useAppStore.getState().setPreferredMemberId(memberId);

    const json = exportData({
      household: useAppStore.getState().household,
      assumptions: useAppStore.getState().assumptions,
      scenarios: useAppStore.getState().scenarios,
      memberAssumptions: useAppStore.getState().memberAssumptions,
      preferredMemberId: useAppStore.getState().preferredMemberId,
    });
    const parsed = parseImport(json);
    expect(parsed.preferredMemberId).toBe(memberId);
  });

  it("hydrateFromPersisted applies preferredMemberId to selectedMemberId", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().hydrateFromPersisted({
      household: {
        id: "p",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      preferredMemberId: memberId,
    });
    expect(useAppStore.getState().selectedMemberId).toBe(memberId);
    expect(useAppStore.getState().preferredMemberId).toBe(memberId);
  });
});

describe("setHoldingComposition auto-derives wrapper CAGR (Round-1 fix)", () => {
  beforeEach(() => {
    useAppStore.getState().resetToDemo();
  });

  it("blends leg CAGRs into wrapper.expectedRealCAGR on every change", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    useAppStore.getState().importPayload({
      household: {
        id: "t",
        members: [{ id: memberId, displayName: "You" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
    });
    const accId = useAppStore.getState().createAccount({
      displayName: "B",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 100_000,
    });
    const h = useAppStore.getState().household.accounts[0].holdings[0];

    // Apply NTSX-style composition; wrapper CAGR should land at 7.2%.
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ]);
    const h2 = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h2.expectedRealCAGR).toBeCloseTo(0.072, 5);

    // Edit bond leg up to 3% — wrapper re-derives to 0.9 × 7% + 0.6 × 3% = 8.1%.
    useAppStore.getState().setHoldingComposition(h.id, [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.03 },
    ]);
    const h3 = useAppStore.getState().household.accounts[0].holdings[0];
    expect(h3.expectedRealCAGR).toBeCloseTo(0.081, 5);
  });
});

describe("legacy inflationOverride → excessInflationOverride migration", () => {
  it("converts the brief-lived nominal inflationOverride into real-excess on hydrate", () => {
    const before = useAppStore.getState();
    const ownerId = before.household.members[0].id;
    // Seed an item carrying the OLD field shape — same as if it
    // came from a Drive backup that was written under the
    // pre-rename code.
    const legacyItem = {
      id: "legacy-h",
      name: "Health insurance (legacy)",
      ownerId,
      category: "healthcare" as const,
      monthlyUSD: 1_000,
      type: "fixed" as const,
      endsAtRetirement: false,
      createdAt: 0,
      // Cast through unknown — the type doesn't expose this field
      // anymore, but the migration has to handle persisted data.
      inflationOverride: 0.05,
    } as unknown as import("@/lib/budget/budget").BudgetItem;
    useAppStore.getState().hydrateFromPersisted({
      household: before.household,
      assumptions: before.assumptions,
      budgetItems: [legacyItem],
    });
    const migrated = useAppStore.getState().budgetItems[0];
    // 0.05 nominal − 0.03 CPI baseline = 0.02 real excess.
    expect(migrated.excessInflationOverride).toBeCloseTo(0.02, 6);
    // Legacy field removed from the persisted shape.
    expect(
      (migrated as unknown as { inflationOverride?: unknown }).inflationOverride,
    ).toBeUndefined();
  });

  it("does not overwrite an existing excessInflationOverride", () => {
    const before = useAppStore.getState();
    const ownerId = before.household.members[0].id;
    const conflictingItem = {
      id: "both",
      name: "Both fields",
      ownerId,
      category: "food" as const,
      monthlyUSD: 500,
      type: "fixed" as const,
      endsAtRetirement: false,
      createdAt: 0,
      excessInflationOverride: 0.01, // already real-excess
      inflationOverride: 0.07, // legacy nominal
    } as unknown as import("@/lib/budget/budget").BudgetItem;
    useAppStore.getState().hydrateFromPersisted({
      household: before.household,
      assumptions: before.assumptions,
      budgetItems: [conflictingItem],
    });
    const migrated = useAppStore.getState().budgetItems[0];
    expect(migrated.excessInflationOverride).toBe(0.01);
  });

  it("clamps absurd legacy values into the safe range", () => {
    const before = useAppStore.getState();
    const ownerId = before.household.members[0].id;
    const wild = {
      id: "wild",
      name: "Wild",
      ownerId,
      category: "food" as const,
      monthlyUSD: 100,
      type: "fixed" as const,
      endsAtRetirement: false,
      createdAt: 0,
      inflationOverride: 0.9, // would imply 0.87 real-excess, clamp to 0.5
    } as unknown as import("@/lib/budget/budget").BudgetItem;
    useAppStore.getState().hydrateFromPersisted({
      household: before.household,
      assumptions: before.assumptions,
      budgetItems: [wild],
    });
    expect(
      useAppStore.getState().budgetItems[0].excessInflationOverride,
    ).toBe(0.5);
  });
});

describe("importPayload preserves fresher local price timestamps", () => {
  it("keeps the local lastPricedAt when local is newer than incoming", () => {
    // Seed local state with a holding via createHolding so it has
    // valid live-price fields, then directly bump its price via the
    // applyLivePrice action to a recent timestamp.
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Test brokerage",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 100_000,
    });
    const localHolding = useAppStore
      .getState()
      .household.accounts.find((a) => a.id === accId)!.holdings[0];
    const freshTimestamp = Date.now();
    useAppStore
      .getState()
      .applyLivePrice("VOO", 600, freshTimestamp);
    // Snapshot the household so we can use it as the "incoming"
    // payload — but with stale price + timestamp.
    const beforeImport = useAppStore.getState().household;
    const staleHousehold = {
      ...beforeImport,
      accounts: beforeImport.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) => {
          if (h.id !== localHolding.id) return h;
          if (h.kind !== "equity") return h;
          return {
            ...h,
            lastPriceUSD: 400, // older price
            lastPricedAt: freshTimestamp - 24 * 60 * 60 * 1000, // 1d ago
            valueUSD: h.shares * 400,
          };
        }),
      })),
    };
    // Import the stale snapshot — simulates the unlock-then-pull
    // flow where Drive content is older than local PriceRefresher state.
    useAppStore.getState().importPayload({
      household: staleHousehold,
      assumptions: useAppStore.getState().assumptions,
    });
    // The merge should have preferred the LOCAL fresher price.
    const after = useAppStore
      .getState()
      .household.accounts.find((a) => a.id === accId)!
      .holdings.find((h) => h.id === localHolding.id)!;
    expect(after.kind).toBe("equity");
    if (after.kind !== "equity") throw new Error("type narrowing");
    expect(after.lastPriceUSD).toBe(600);
    expect(after.lastPricedAt).toBe(freshTimestamp);
  });

  it("uses the incoming price when the local timestamp is older or missing", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Test brokerage",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 100_000,
    });
    const local = useAppStore
      .getState()
      .household.accounts.find((a) => a.id === accId)!.holdings[0];
    if (local.kind !== "equity") throw new Error("type narrowing");
    // Bump LOCAL to an OLDER timestamp.
    useAppStore
      .getState()
      .applyLivePrice("VOO", 400, Date.now() - 7 * 24 * 60 * 60 * 1000);
    const beforeImport = useAppStore.getState().household;
    const freshHousehold = {
      ...beforeImport,
      accounts: beforeImport.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) => {
          if (h.id !== local.id) return h;
          if (h.kind !== "equity") return h;
          return {
            ...h,
            lastPriceUSD: 650, // fresher price
            lastPricedAt: Date.now(), // today
            valueUSD: h.shares * 650,
          };
        }),
      })),
    };
    useAppStore.getState().importPayload({
      household: freshHousehold,
      assumptions: useAppStore.getState().assumptions,
    });
    const after = useAppStore
      .getState()
      .household.accounts.find((a) => a.id === accId)!
      .holdings.find((h) => h.id === local.id)!;
    if (after.kind !== "equity") throw new Error("type narrowing");
    expect(after.lastPriceUSD).toBe(650);
  });
});
