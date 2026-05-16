import { describe, expect, it } from "vitest";
import {
  plansForMember,
  rollupHealthPlans,
  scorePlan,
  type HealthPlan,
} from "@/lib/health/healthPlans";

function makePlan(p: Partial<HealthPlan> & { id: string }): HealthPlan {
  return {
    id: p.id,
    name: p.name ?? "Test plan",
    ownerId: p.ownerId ?? "m1",
    coveredMemberIds: p.coveredMemberIds ?? [p.ownerId ?? "m1"],
    source: p.source ?? "template",
    category: p.category ?? "aca_marketplace",
    monthlyPremiumUSD: p.monthlyPremiumUSD ?? 500,
    annualDeductibleUSD: p.annualDeductibleUSD ?? 3000,
    annualOutOfPocketMaxUSD: p.annualOutOfPocketMaxUSD ?? 8000,
    factorScores: p.factorScores ?? {},
    createdAt: p.createdAt ?? Date.now(),
    notes: p.notes,
    templateId: p.templateId,
  };
}

describe("rollupHealthPlans — no-double-count invariant", () => {
  it("counts a family plan exactly once even though it covers many members", () => {
    const familyPlan = makePlan({
      id: "p1",
      ownerId: "m1",
      coveredMemberIds: ["m1", "m2", "m3", "m4"],
      monthlyPremiumUSD: 1800,
    });
    const r = rollupHealthPlans([familyPlan], ["m1", "m2", "m3", "m4"]);
    expect(r.totalMonthlyUSD).toBe(1800);
    expect(r.planCount).toBe(1);
    expect(r.coveredMemberIds.sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(r.uncoveredMemberIds).toEqual([]);
  });

  it("sums multiple distinct plans", () => {
    const r = rollupHealthPlans(
      [
        makePlan({ id: "a", ownerId: "m1", monthlyPremiumUSD: 600 }),
        makePlan({ id: "b", ownerId: "m2", monthlyPremiumUSD: 450 }),
      ],
      ["m1", "m2"],
    );
    expect(r.totalMonthlyUSD).toBe(1050);
    expect(r.planCount).toBe(2);
  });

  it("dedupes if the same plan id sneaks in twice (defensive)", () => {
    const p = makePlan({ id: "dup", monthlyPremiumUSD: 700 });
    const r = rollupHealthPlans([p, p], ["m1"]);
    expect(r.totalMonthlyUSD).toBe(700);
    expect(r.planCount).toBe(1);
  });

  it("identifies uncovered members so the UI can prompt them", () => {
    const r = rollupHealthPlans(
      [
        makePlan({
          id: "a",
          ownerId: "m1",
          coveredMemberIds: ["m1", "m2"],
        }),
      ],
      ["m1", "m2", "m3"],
    );
    expect(r.uncoveredMemberIds).toEqual(["m3"]);
  });

  it("clamps a negative premium to zero (defensive against bad templates)", () => {
    const r = rollupHealthPlans(
      [makePlan({ id: "a", monthlyPremiumUSD: -100 })],
      ["m1"],
    );
    expect(r.totalMonthlyUSD).toBe(0);
  });

  it("skips phantom plans with empty coveredMemberIds (premium + plan count both 0)", () => {
    // A plan with no covered members is a data-corruption shape:
    // the rollup should NOT charge its premium to the household
    // while also marking nobody as covered. The store enforces the
    // ownerId-in-coverage invariant on add/update, so a well-formed
    // plan always has at least the owner in coveredMemberIds.
    const r = rollupHealthPlans(
      [
        makePlan({
          id: "phantom",
          ownerId: "m1",
          coveredMemberIds: [],
          monthlyPremiumUSD: 800,
        }),
      ],
      ["m1", "m2"],
    );
    expect(r.totalMonthlyUSD).toBe(0);
    expect(r.planCount).toBe(0);
    expect(r.coveredMemberIds).toEqual([]);
    expect(r.uncoveredMemberIds.sort()).toEqual(["m1", "m2"]);
  });
});

describe("plansForMember — subscribed vs covered-as-dependent split", () => {
  it("splits plans correctly across the family", () => {
    const plans: HealthPlan[] = [
      makePlan({
        id: "family",
        ownerId: "alice",
        coveredMemberIds: ["alice", "bob", "kid1"],
      }),
      makePlan({
        id: "selfemp",
        ownerId: "bob",
        coveredMemberIds: ["bob"],
      }),
    ];
    const alice = plansForMember(plans, "alice");
    expect(alice.subscribed.map((p) => p.id)).toEqual(["family"]);
    expect(alice.coveredAsDependent).toEqual([]);

    // Bob OWNS his self-employed plan AND is covered by Alice's family plan.
    const bob = plansForMember(plans, "bob");
    expect(bob.subscribed.map((p) => p.id)).toEqual(["selfemp"]);
    expect(bob.coveredAsDependent.map((p) => p.id)).toEqual(["family"]);

    const kid = plansForMember(plans, "kid1");
    expect(kid.subscribed).toEqual([]);
    expect(kid.coveredAsDependent.map((p) => p.id)).toEqual(["family"]);
  });
});

describe("scorePlan — importance-weighted composite", () => {
  const plan = makePlan({
    id: "p",
    factorScores: {
      premiumAffordability: 90,
      deductible: 40,
      mentalHealth: 70,
    },
  });

  it("returns null when no factor has positive importance", () => {
    expect(scorePlan(plan, {})).toBeNull();
    expect(scorePlan(plan, { premiumAffordability: 0 })).toBeNull();
  });

  it("returns the single factor's score when only one factor is weighted", () => {
    expect(scorePlan(plan, { premiumAffordability: 0.5 })).toBe(90);
  });

  it("renormalizes weights — relative ratio is what matters", () => {
    // Weights 0.8 + 0.2 sum to 1 → premium 0.8 × 90 + deductible 0.2 × 40 = 72 + 8 = 80
    expect(
      scorePlan(plan, { premiumAffordability: 0.8, deductible: 0.2 }),
    ).toBeCloseTo(80, 5);

    // Doubling both weights gives the same composite (renormalized to the same ratio)
    expect(
      scorePlan(plan, { premiumAffordability: 1.6, deductible: 0.4 }),
    ).toBeCloseTo(80, 5);
  });

  it("defaults missing factor scores to 50 (neutral) so weighting an un-rated factor is safe", () => {
    // Only premium scored (90); weight vision (un-rated → 50) equal to premium → average is 70
    expect(
      scorePlan(plan, { premiumAffordability: 0.5, vision: 0.5 }),
    ).toBeCloseTo(70, 5);
  });

  it("clamps result to [0,100]", () => {
    const wild = makePlan({
      id: "w",
      factorScores: { premiumAffordability: 999 },
    });
    expect(scorePlan(wild, { premiumAffordability: 1 })).toBe(100);
  });
});
