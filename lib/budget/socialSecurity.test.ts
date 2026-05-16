import { describe, expect, it } from "vitest";
import {
  SS_BEND_POINT_1_2025,
  SS_BEND_POINT_2_2025,
  SS_FRA,
  SS_TAXABLE_MAX_MONTHLY_2025,
  estimateSocialSecurityAtFRA,
} from "@/lib/budget/socialSecurity";

describe("estimateSocialSecurityAtFRA — PIA formula tiers", () => {
  // These tests pin the SSA bend-point math against hand-
  // computed values. If the bend points get updated for a new
  // SSA tax year, the expected numbers update too — that's
  // the right shape (we'd want the test to fail loudly so we
  // know the constants were touched).

  it("hits tier 1 only (low AIME)", () => {
    // Working a full 35y window at $1,000/month income —
    // AIME = $1,000/mo, all in tier 1 (90% accrual).
    // PIA = $1000 × 0.9 = $900/mo → $10,800/yr.
    // Currently entering at 22, working until 57 (35 years).
    const { annualUSDAtFRA } = estimateSocialSecurityAtFRA(
      12_000, // $1000/mo
      22,
      57,
      2026,
    );
    expect(annualUSDAtFRA).toBeCloseTo(10_800, 0);
  });

  it("spans tiers 1 + 2", () => {
    // AIME in tier 2: between BEND_1 ($1,226) and BEND_2 ($7,391).
    // 35y at $4,000/mo = AIME $4,000.
    // PIA = $1,226 × 0.9 + ($4,000 − $1,226) × 0.32
    //     = $1,103.40 + $887.68 = $1,991.08/mo
    // Annual = $23,892.96
    const { annualUSDAtFRA } = estimateSocialSecurityAtFRA(
      48_000, // $4,000/mo
      22,
      57,
      2026,
    );
    expect(annualUSDAtFRA).toBeCloseTo(23_892.96, 0);
  });

  it("spans tiers 1 + 2 + 3 (high earner, full 35y)", () => {
    // AIME above BEND_2 → all three tiers fire.
    // 35y at $10,000/mo = AIME $10,000.
    // PIA = $1,226 × 0.9 + $6,165 × 0.32 + ($10,000 - $7,391) × 0.15
    //     = $1,103.40 + $1,972.80 + $391.35 = $3,467.55/mo
    // Annual = $41,610.60
    const { annualUSDAtFRA } = estimateSocialSecurityAtFRA(
      120_000, // $10,000/mo
      22,
      57,
      2026,
    );
    expect(annualUSDAtFRA).toBeCloseTo(41_610.6, 0);
  });

  it("caps contribution at the SS taxable max", () => {
    // A $1M earner contributes the same as a $176,100 earner
    // (the 2025 SS taxable max). The capped AIME is the same.
    const a = estimateSocialSecurityAtFRA(176_100, 22, 57, 2026);
    const b = estimateSocialSecurityAtFRA(1_000_000, 22, 57, 2026);
    expect(a.annualUSDAtFRA).toBeCloseTo(b.annualUSDAtFRA, 1);
  });

  it("averages in zeros for years below the 35-year window", () => {
    // The "early retiree" scenario the demo cares about. Same
    // capped income, but only 26 working years → AIME is
    // (cap × 26) / 35 instead of (cap × 35) / 35.
    const careerLength = estimateSocialSecurityAtFRA(200_000, 22, 57, 2026);
    const earlyRetire = estimateSocialSecurityAtFRA(200_000, 22, 48, 2026);
    // Early retiree's benefit is meaningfully lower —
    // 26/35 × the capped-AIME contribution, before bend
    // points. Should be a clear delta, not a rounding artifact.
    expect(earlyRetire.annualUSDAtFRA).toBeLessThan(careerLength.annualUSDAtFRA);
    expect(careerLength.annualUSDAtFRA - earlyRetire.annualUSDAtFRA).toBeGreaterThan(
      5_000,
    );
  });
});

describe("estimateSocialSecurityAtFRA — fraYear", () => {
  it("returns the calendar year the worker reaches FRA (= 67)", () => {
    // Alex: age 38 in 2026 → reaches FRA in 2055.
    const { fraYear } = estimateSocialSecurityAtFRA(220_000, 38, 48, 2026);
    expect(fraYear).toBe(2026 + (SS_FRA - 38));
    expect(fraYear).toBe(2055);
  });

  it("uses the passed currentYear for the FRA year computation", () => {
    // If the user is 30 in 2030, FRA hits in 2030 + (67−30) = 2067.
    const { fraYear } = estimateSocialSecurityAtFRA(100_000, 30, 60, 2030);
    expect(fraYear).toBe(2067);
  });
});

describe("estimateSocialSecurityAtFRA — defensive guards", () => {
  it("returns 0 for non-finite or non-positive income", () => {
    expect(
      estimateSocialSecurityAtFRA(NaN, 38, 48, 2026).annualUSDAtFRA,
    ).toBe(0);
    expect(
      estimateSocialSecurityAtFRA(-1_000, 38, 48, 2026).annualUSDAtFRA,
    ).toBe(0);
    expect(
      estimateSocialSecurityAtFRA(0, 38, 48, 2026).annualUSDAtFRA,
    ).toBe(0);
  });

  it("returns 0 when retirement age <= current age (already retired)", () => {
    // An already-retired user shouldn't be auto-seeded — they'd
    // have a Social Security number from the SSA estimator, not
    // a planning heuristic.
    expect(
      estimateSocialSecurityAtFRA(220_000, 50, 50, 2026).annualUSDAtFRA,
    ).toBe(0);
    expect(
      estimateSocialSecurityAtFRA(220_000, 50, 45, 2026).annualUSDAtFRA,
    ).toBe(0);
  });

  it("returns 0 for non-finite ages", () => {
    expect(
      estimateSocialSecurityAtFRA(220_000, NaN, 48, 2026).annualUSDAtFRA,
    ).toBe(0);
    expect(
      estimateSocialSecurityAtFRA(220_000, 38, NaN, 2026).annualUSDAtFRA,
    ).toBe(0);
  });
});

describe("estimateSocialSecurityAtFRA — demo household sanity", () => {
  // The actual numbers that flow into the demo seed. If these
  // assertions change, the demo's SS streams change too —
  // worth pinning so the demo data stays the same shape across
  // refactors of the estimator.

  it("Alex demo seed (age 38, $220k, retires at 48): ~$40k-$45k/yr at FRA", () => {
    const r = estimateSocialSecurityAtFRA(220_000, 38, 48, 2026);
    // Within a few thousand of the expected value (computed
    // value is ~$43,232). The band is wide enough to absorb
    // small refinements to the working-years math without
    // breaking the test.
    expect(r.annualUSDAtFRA).toBeGreaterThan(40_000);
    expect(r.annualUSDAtFRA).toBeLessThan(46_000);
    expect(r.fraYear).toBe(2055);
  });

  it("Jordan demo seed (age 36, $165k, retires at 46): ~$38k-$43k/yr at FRA", () => {
    const r = estimateSocialSecurityAtFRA(165_000, 36, 46, 2026);
    // Computed value is ~$40,582. Lower income but younger →
    // similar working years means a similar benefit.
    expect(r.annualUSDAtFRA).toBeGreaterThan(38_000);
    expect(r.annualUSDAtFRA).toBeLessThan(43_000);
    expect(r.fraYear).toBe(2057);
  });
});

describe("module-level constants are exported", () => {
  // Regression guard: external callers (the demo seed,
  // potential future "estimate my SS" affordance for users
  // who enter their income) depend on these. Removing them
  // silently would be a breaking change.
  it("exports the 2025 bend points + taxable cap + FRA", () => {
    expect(SS_BEND_POINT_1_2025).toBe(1_226);
    expect(SS_BEND_POINT_2_2025).toBe(7_391);
    expect(SS_TAXABLE_MAX_MONTHLY_2025).toBeCloseTo(176_100 / 12, 2);
    expect(SS_FRA).toBe(67);
  });
});
