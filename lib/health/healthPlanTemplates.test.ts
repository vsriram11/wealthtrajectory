/**
 * healthPlanTemplates pins two surfaces:
 *
 *   1. The HEALTH_PLAN_TEMPLATES registry shape — every entry
 *      must have the required fields populated with sensible
 *      values, ids must be unique + stable (they persist on
 *      user-instantiated plans via `templateId`), and factor
 *      scores must be in the [0, 100] band the UI expects.
 *
 *   2. instantiateTemplate(template, ownerId, coveredMemberIds)
 *      — the entry point the editor calls when the user picks
 *      a template. Tests pin the family/single premium switch,
 *      the owner-self-inclusion guard, and the templateId
 *      backlink.
 */

import { describe, expect, it } from "vitest";
import {
  HEALTH_PLAN_TEMPLATES,
  instantiateTemplate,
  type HealthPlanTemplate,
} from "@/lib/health/healthPlanTemplates";

describe("HEALTH_PLAN_TEMPLATES registry", () => {
  it("is non-empty (UI dropdown would be empty otherwise)", () => {
    expect(HEALTH_PLAN_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("has unique ids across every template (load-bearing for templateId references)", () => {
    // Templates persist on user-instantiated HealthPlans via the
    // `templateId` backlink — a duplicate id would silently
    // associate plans to the wrong template after a schema
    // migration. Pin uniqueness.
    const ids = HEALTH_PLAN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("populates every required string field on every template", () => {
    for (const t of HEALTH_PLAN_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.caveat.length).toBeGreaterThan(0);
      expect(t.category.length).toBeGreaterThan(0);
    }
  });

  it("uses realistic premium / deductible / OOP-max values", () => {
    // Sanity bounds — premiums should be in the $0-$3000/mo
    // range, deductibles $0-$25k, OOP max $0-$25k. Anything
    // outside that almost certainly means a typo (e.g. a
    // missing decimal). Catches the canonical class of bug
    // "I edited a template and accidentally typed 50000 not
    // 5000 for the premium."
    for (const t of HEALTH_PLAN_TEMPLATES) {
      expect(t.defaultMonthlyPremiumUSD).toBeGreaterThanOrEqual(0);
      expect(t.defaultMonthlyPremiumUSD).toBeLessThan(3_000);
      expect(t.defaultFamilyMonthlyPremiumUSD).toBeGreaterThanOrEqual(0);
      expect(t.defaultFamilyMonthlyPremiumUSD).toBeLessThan(5_000);
      expect(t.defaultAnnualDeductibleUSD).toBeGreaterThanOrEqual(0);
      expect(t.defaultAnnualDeductibleUSD).toBeLessThan(25_000);
      expect(t.defaultAnnualOutOfPocketMaxUSD).toBeGreaterThanOrEqual(0);
      expect(t.defaultAnnualOutOfPocketMaxUSD).toBeLessThan(25_000);
    }
  });

  it("family premium is always >= single premium (family cohorts cost more)", () => {
    // A regression that flipped these would surface as users
    // adding family members and seeing their premium DROP.
    for (const t of HEALTH_PLAN_TEMPLATES) {
      expect(t.defaultFamilyMonthlyPremiumUSD).toBeGreaterThanOrEqual(
        t.defaultMonthlyPremiumUSD,
      );
    }
  });

  it("deductible never exceeds OOP max — except when OOP=0 sentinel (uncapped)", () => {
    // Healthcare contract: OOP max is the upper bound on
    // out-of-pocket spend, including the deductible. EXCEPTION:
    // Original Medicare without Medigap has no OOP cap by
    // design — encoded as `defaultAnnualOutOfPocketMaxUSD: 0`
    // as a "no cap" sentinel. Any other template with
    // deductible > OOP max would break the cost-calculator.
    for (const t of HEALTH_PLAN_TEMPLATES) {
      if (t.defaultAnnualOutOfPocketMaxUSD === 0) continue;
      expect(t.defaultAnnualDeductibleUSD).toBeLessThanOrEqual(
        t.defaultAnnualOutOfPocketMaxUSD,
      );
    }
  });

  it("factor scores are all integers in [0, 100] across every template", () => {
    // The UI renders these as a 0-100 gauge — out-of-range
    // values would clip or display incorrectly. Integer-only
    // is for stable display (no "73.2 / 100" tooltips).
    for (const t of HEALTH_PLAN_TEMPLATES) {
      for (const [, score] of Object.entries(t.factorScores)) {
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("includes at least one ACA marketplace + one employer + one self-employed template", () => {
    // Coverage of the three major health-plan archetypes.
    // Picker UX would degrade if any category went empty.
    const categories = new Set(HEALTH_PLAN_TEMPLATES.map((t) => t.category));
    expect(categories.has("aca_marketplace")).toBe(true);
    expect(categories.has("employer")).toBe(true);
    expect(categories.has("self_employed")).toBe(true);
  });

  it("stable canonical ids exist (templateId is persisted on plans)", () => {
    // The IDs below are referenced by user-instantiated plans
    // through `templateId`. Renaming them silently would break
    // the "originated-from-template" backlink for every existing
    // user's saved health plan. Pin them as a renaming guard.
    const ids = new Set(HEALTH_PLAN_TEMPLATES.map((t) => t.id));
    for (const required of [
      "aca-bronze",
      "aca-silver",
      "aca-gold",
      "aca-platinum",
      "employer-hdhp-hsa",
      "employer-ppo",
      "employer-hmo",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });
});

describe("instantiateTemplate", () => {
  function fakeTemplate(overrides: Partial<HealthPlanTemplate> = {}): HealthPlanTemplate {
    return {
      id: "test-template",
      name: "Test Template",
      category: "employer",
      description: "...",
      caveat: "...",
      defaultMonthlyPremiumUSD: 200,
      defaultFamilyMonthlyPremiumUSD: 1_200,
      defaultAnnualDeductibleUSD: 1_500,
      defaultAnnualOutOfPocketMaxUSD: 6_000,
      factorScores: { hsaEligible: 100 },
      ...overrides,
    };
  }

  it("uses the single-coverage premium when only the owner is covered", () => {
    const plan = instantiateTemplate(fakeTemplate(), "m-owner", ["m-owner"]);
    expect(plan.monthlyPremiumUSD).toBe(200);
  });

  it("uses the family-coverage premium when a non-owner is included", () => {
    const plan = instantiateTemplate(fakeTemplate(), "m-owner", [
      "m-owner",
      "m-child",
    ]);
    // Auto-detected family because there's a non-owner in
    // coveredMemberIds. Catches a regression that forgot to
    // detect dependents and silently undercharged the user's
    // budget by the difference.
    expect(plan.monthlyPremiumUSD).toBe(1_200);
  });

  it("isFamily override forces family pricing even when only owner is covered", () => {
    const plan = instantiateTemplate(
      fakeTemplate(),
      "m-owner",
      ["m-owner"],
      { isFamily: true },
    );
    expect(plan.monthlyPremiumUSD).toBe(1_200);
  });

  it("isFamily=false override forces single pricing even when dependents are covered", () => {
    const plan = instantiateTemplate(
      fakeTemplate(),
      "m-owner",
      ["m-owner", "m-child"],
      { isFamily: false },
    );
    expect(plan.monthlyPremiumUSD).toBe(200);
  });

  it("auto-includes the owner in coveredMemberIds when missing", () => {
    // Defensive: a caller that passed only the spouse's id
    // would otherwise produce a plan where the policy holder
    // (owner) isn't even on the covered list. Prepend owner.
    const plan = instantiateTemplate(fakeTemplate(), "m-owner", ["m-spouse"]);
    expect(plan.coveredMemberIds).toEqual(["m-owner", "m-spouse"]);
  });

  it("preserves the existing coveredMemberIds order when owner is already present", () => {
    const plan = instantiateTemplate(fakeTemplate(), "m-owner", [
      "m-spouse",
      "m-owner",
      "m-child",
    ]);
    // Owner present → list passed through unchanged.
    expect(plan.coveredMemberIds).toEqual(["m-spouse", "m-owner", "m-child"]);
  });

  it("backlinks templateId so the editor can show 'originated from <template>'", () => {
    const tmpl = fakeTemplate({ id: "my-template-id" });
    const plan = instantiateTemplate(tmpl, "m-owner", ["m-owner"]);
    expect(plan.templateId).toBe("my-template-id");
    expect(plan.source).toBe("template");
  });

  it("clones factor scores so the user can mutate without affecting the template", () => {
    const tmpl = fakeTemplate({
      factorScores: { hsaEligible: 100 },
    });
    const plan = instantiateTemplate(tmpl, "m-owner", ["m-owner"]);
    // Mutating the plan's scores must NOT bleed into the
    // template registry. A shallow-reference bug would let a
    // user's "I edited this plan" change all future
    // instantiations of the same template.
    (plan.factorScores as Record<string, number>).hsaEligible = 0;
    expect(tmpl.factorScores.hsaEligible).toBe(100);
  });

  it("copies the registry premium / deductible / OOP-max values verbatim", () => {
    const tmpl = fakeTemplate({
      defaultMonthlyPremiumUSD: 333,
      defaultAnnualDeductibleUSD: 2_500,
      defaultAnnualOutOfPocketMaxUSD: 7_500,
    });
    const plan = instantiateTemplate(tmpl, "m-owner", ["m-owner"]);
    expect(plan.monthlyPremiumUSD).toBe(333);
    expect(plan.annualDeductibleUSD).toBe(2_500);
    expect(plan.annualOutOfPocketMaxUSD).toBe(7_500);
  });
});
