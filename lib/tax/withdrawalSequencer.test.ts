import { describe, expect, it } from "vitest";
import {
  runWithdrawalSequence,
  type WithdrawalSequencerInputs,
} from "@/lib/tax/withdrawalSequencer";

function baseInputs(
  overrides: Partial<WithdrawalSequencerInputs> = {},
): WithdrawalSequencerInputs {
  return {
    startingBalances: {
      taxable: 500_000,
      pretax: 1_000_000,
      roth: 300_000,
      hsa: 50_000,
    },
    annualRealSpendUSD: 80_000,
    realCAGRByBucket: {
      taxable: 0.04,
      pretax: 0.04,
      roth: 0.04,
      hsa: 0.04,
    },
    startingAge: 60,
    retirementTaxRate: 0.2,
    years: 30,
    ...overrides,
  };
}

describe("runWithdrawalSequence — sequencing", () => {
  it("drains taxable first before touching pretax", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 100_000,
          pretax: 1_000_000,
          roth: 0,
          hsa: 0,
        },
        annualRealSpendUSD: 60_000,
        realCAGRByBucket: {
          taxable: 0,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        years: 3,
      }),
    );
    // Round-5 audit fix: taxable bucket is now taxed at LTCG rate
    // (= ordinaryRate × 0.5 = 10% with rate 0.2), not the full
    // ordinary rate. So gross needed = 60k / 0.9 = 66.67k from
    // taxable. The bucket has 100k, so it covers; pretax untouched.
    expect(r.rows[0].withdrawalsByBucket.taxable).toBeCloseTo(66_666.67, 0);
    expect(r.rows[0].withdrawalsByBucket.pretax).toBe(0);
    expect(r.rows[0].endingBalances.taxable).toBeCloseTo(33_333.33, 0);

    // Year 1: taxable=33.33k available. LTCG-grossed need = 66.67k;
    // taxable can only deliver 33.33k (netting 30k after 10% LTCG).
    // Remaining net = 30k from pretax at ordinary 20% → gross 37.5k.
    expect(r.rows[1].withdrawalsByBucket.taxable).toBeCloseTo(33_333.33, 0);
    expect(r.rows[1].withdrawalsByBucket.pretax).toBeCloseTo(37_500, 0);

    // Year 2: taxable=0. All net 60k from pretax → gross 75k.
    expect(r.rows[2].withdrawalsByBucket.taxable).toBe(0);
    expect(r.rows[2].withdrawalsByBucket.pretax).toBeCloseTo(75_000, 0);
  });

  it("preserves Roth until last (after taxable + pretax exhausted)", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 0,
          pretax: 30_000,
          roth: 500_000,
          hsa: 0,
        },
        annualRealSpendUSD: 60_000,
        realCAGRByBucket: {
          taxable: 0,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        years: 2,
        startingAge: 50, // no RMD
      }),
    );
    // Year 0: target NET 60k at t=0.2. Pretax has 30k available.
    // Drain it fully: gross 30k contributes 24k net (taxed at 20%).
    // Remaining net needed: 60k − 24k = 36k. Roth is untaxed →
    // draw 36k literally. Total withdrawn: 30k pretax + 36k Roth
    // = 66k gross, 24k tax → 42k... wait, that doesn't work.
    // Pretax 30k × 0.8 = 24k net. Roth 36k = 36k net. Total
    // net = 24 + 36 = 60k = target. ✓
    //
    // The PRIOR over-grossed math drew 45k from Roth (was: $75k
    // gross / target / regardless of bucket tax). That was a bug:
    // Roth doesn't need grossing. Now the math is correct.
    expect(r.rows[0].withdrawalsByBucket.pretax).toBeCloseTo(30_000, 0);
    expect(r.rows[0].withdrawalsByBucket.roth).toBeCloseTo(36_000, 0);
  });
});

describe("runWithdrawalSequence — RMD math", () => {
  it("does not impose RMD before startingAge=73", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingAge: 60,
        years: 5,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
      }),
    );
    for (const row of r.rows) {
      expect(row.rmdAmountUSD).toBe(0);
    }
  });

  it("starts RMD at age 73", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingAge: 72,
        years: 3,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        annualRealSpendUSD: 1, // negligible spend so RMD dominates
      }),
    );
    expect(r.rows[0].rmdAmountUSD).toBe(0); // age 72
    expect(r.rows[1].rmdAmountUSD).toBeGreaterThan(0); // age 73
    // RMD ≈ 1M / 26.5 ≈ 37.7k
    expect(r.rows[1].rmdAmountUSD).toBeCloseTo(37_736, -1);
  });

  it("RMD as a fraction of remaining balance grows monotonically with age", () => {
    // The IRS uniform-lifetime table shrinks the divisor every
    // year past 72, so RMD/remaining-balance must be strictly
    // increasing year-over-year. This is the contract the
    // drawdown sequencer relies on to escalate withdrawals as
    // the retiree ages — a regression that kept the divisor flat
    // would under-withdraw and miss tax-bracket optimization.
    const r = runWithdrawalSequence(
      baseInputs({
        startingAge: 80,
        years: 5,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        annualRealSpendUSD: 0,
      }),
    );
    // Age 80 divisor is 20.2 per the IRS table.
    const ratio0 = r.rows[0].rmdAmountUSD / 1_000_000;
    expect(ratio0).toBeCloseTo(1 / 20.2, 3);
    // Each subsequent year the RMD-to-remaining-balance ratio
    // must be strictly higher than the prior year's. Compute
    // ratios relative to the per-year starting balance — that's
    // the value the divisor is applied to.
    let prevRatio = ratio0;
    for (let i = 1; i < r.rows.length; i++) {
      const balance = r.rows[i].startingBalances.pretax;
      if (balance <= 0) break;
      const ratio = r.rows[i].rmdAmountUSD / balance;
      expect(ratio).toBeGreaterThan(prevRatio);
      prevRatio = ratio;
    }
  });
});

describe("runWithdrawalSequence — depletion + survival", () => {
  it("flags depleted when buckets fully drained", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 100_000,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        annualRealSpendUSD: 200_000,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        years: 2,
      }),
    );
    expect(r.depletedYear).toBe(0);
    expect(r.rows[0].depleted).toBe(true);
  });

  it("survives when spend < returns + buckets", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 2_000_000,
          pretax: 1_000_000,
          roth: 500_000,
          hsa: 50_000,
        },
        annualRealSpendUSD: 80_000,
        realCAGRByBucket: {
          taxable: 0.05,
          pretax: 0.05,
          roth: 0.05,
          hsa: 0.05,
        },
        years: 30,
        startingAge: 65,
      }),
    );
    expect(r.depletedYear).toBe(-1);
    expect(r.endingTotalUSD).toBeGreaterThan(0);
  });
});

describe("runWithdrawalSequence — tax math", () => {
  it("Roth withdrawals incur no tax", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 0,
          pretax: 0,
          roth: 1_000_000,
          hsa: 0,
        },
        annualRealSpendUSD: 50_000,
        retirementTaxRate: 0.3,
        years: 1,
        startingAge: 60,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
      }),
    );
    // With Roth-only assets, the engine should NOT gross-up the
    // withdrawal — Roth contributes its literal value as net spend.
    // For a $50k net target with 100% Roth assets: draw exactly $50k,
    // pay $0 tax. The PRIOR bug grossed up uniformly (regardless of
    // bucket) and drew $71.4k — silently over-depleting Roth.
    expect(r.rows[0].taxesPaidUSD).toBeCloseTo(0, 1);
    expect(r.rows[0].withdrawalsByBucket.roth).toBeCloseTo(50_000, 0);
    // Sanity: net spend achieved exactly hits target (no over-draw).
    expect(r.rows[0].netSpendAchievedUSD).toBeCloseTo(50_000, 0);
  });

  it("totalTaxesPaidUSD accumulates correctly across years", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 500_000,
          pretax: 500_000,
          roth: 0,
          hsa: 0,
        },
        annualRealSpendUSD: 40_000,
        retirementTaxRate: 0.2,
        years: 5,
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
      }),
    );
    // Round-5 audit: taxable at LTCG 10% (= 0.2 × 0.5), pretax at
    // ordinary 20%. Starting balances: $500k taxable + $500k pretax.
    // Year 1-5: $40k net spend each. Taxable drained first.
    // Year 1: $40k/0.9 = $44.44k from taxable → $4.44k LTCG tax.
    // After 5 years, taxable depletes (500/44.44 ≈ 11 yrs but we
    // only run 5), so all 5 years come from taxable. Total tax ≈
    // $44.44k × 5 × 0.1 = $22.22k.
    expect(r.totalTaxesPaidUSD).toBeCloseTo(22_222, -2);
  });
});

describe("runWithdrawalSequence — Round 5 audit fixes", () => {
  it("RMD uses PRIOR-YEAR-END (start-of-year) balance per IRS Pub 590-B", () => {
    // Round-5 LOW fix: prior code used grown.pretax / divisor,
    // over-stating RMD by one year of growth. Pin the correct
    // base.
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 0, pretax: 1_000_000, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0.1, roth: 0, hsa: 0 }, // 10% growth
        startingAge: 73,
        years: 1,
        annualRealSpendUSD: 0, // ignore spend; just check RMD
      }),
    );
    // IRS: RMD = prior-year-end FMV / divisor (age 73 = 26.5).
    // Prior-year-end = startingBalance = $1M (NOT the grown $1.1M).
    // Correct RMD = $1M / 26.5 = $37,735.85
    expect(r.rows[0].rmdAmountUSD).toBeCloseTo(37_735.85, 0);
  });

  it("longTermCapGainsRate parameter applies to taxable bucket separately from ordinary", () => {
    // Round-5 HIGH fix: prior code applied retirementTaxRate
    // (ordinary) to taxable bucket too. New: separate ltcgRate
    // parameter (default = ordinary × 0.5).
    const explicit = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 500_000, pretax: 0, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: 1,
        annualRealSpendUSD: 40_000,
        retirementTaxRate: 0.32, // ordinary
        longTermCapGainsRate: 0.15, // explicit LTCG
      }),
    );
    // gross from taxable = 40k / (1 - 0.15) = $47,059
    // tax = $47,059 × 0.15 = $7,059
    expect(explicit.rows[0].withdrawalsByBucket.taxable).toBeCloseTo(
      47_058.82,
      0,
    );
    expect(explicit.rows[0].taxesPaidUSD).toBeCloseTo(7_058.82, 0);

    // Default ltcg = ordinaryRate × 0.5 = 0.16
    const defaultLTCG = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 500_000, pretax: 0, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: 1,
        annualRealSpendUSD: 40_000,
        retirementTaxRate: 0.32,
        // no explicit longTermCapGainsRate
      }),
    );
    // gross = 40k / (1 - 0.16) = $47,619
    // tax = $47,619 × 0.16 = $7,619
    expect(defaultLTCG.rows[0].taxesPaidUSD).toBeCloseTo(7_619.05, 0);
  });

  it("Round 11: years=Infinity is clamped (no infinite loop)", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 100_000, pretax: 0, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: Number.POSITIVE_INFINITY,
        annualRealSpendUSD: 10_000,
      }),
    );
    // Clamped to ≤ 200 years per the safety bound.
    expect(r.rows.length).toBeLessThanOrEqual(200);
  });

  it("Round 11: NaN years degrades to 0-year simulation", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 100_000, pretax: 0, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: Number.NaN,
        annualRealSpendUSD: 10_000,
      }),
    );
    expect(r.rows).toHaveLength(0);
    expect(r.depletedYear).toBe(-1);
  });

  it("Round 11: NaN CAGR degrades to 0 growth (no NaN propagation)", () => {
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 100_000,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        realCAGRByBucket: {
          taxable: Number.NaN,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        startingAge: 60,
        years: 3,
        annualRealSpendUSD: 10_000,
      }),
    );
    // Balances stay finite throughout — no NaN poisoning.
    expect(Number.isFinite(r.endingTotalUSD)).toBe(true);
    expect(Number.isFinite(r.totalTaxesPaidUSD)).toBe(true);
    for (const row of r.rows) {
      expect(Number.isFinite(row.endingBalances.taxable)).toBe(true);
      expect(Number.isFinite(row.taxesPaidUSD)).toBe(true);
    }
  });

  it("Round 11: ltcgRate > ordinaryRate is clamped to ordinaryRate", () => {
    // A user mis-configuring ltcg=0.40, ordinary=0.20 would invert
    // the bucket priority (taxable more expensive than pretax). The
    // engine now clamps ltcg ≤ ordinary defensively.
    const inverted = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 100_000,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: 1,
        annualRealSpendUSD: 10_000,
        retirementTaxRate: 0.2,
        longTermCapGainsRate: 0.4, // > ordinary
      }),
    );
    const normal = runWithdrawalSequence(
      baseInputs({
        startingBalances: {
          taxable: 100_000,
          pretax: 0,
          roth: 0,
          hsa: 0,
        },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: 1,
        annualRealSpendUSD: 10_000,
        retirementTaxRate: 0.2,
        longTermCapGainsRate: 0.2, // = ordinary
      }),
    );
    // Inverted run should match the normal (clamped) run — not
    // produce a 2× higher tax.
    expect(inverted.totalTaxesPaidUSD).toBeCloseTo(
      normal.totalTaxesPaidUSD,
      0,
    );
  });

  it("pretax bucket continues to use ordinary rate (not LTCG)", () => {
    // Verify the bucket-rate split is correct: only taxable gets
    // LTCG treatment.
    const r = runWithdrawalSequence(
      baseInputs({
        startingBalances: { taxable: 0, pretax: 500_000, roth: 0, hsa: 0 },
        realCAGRByBucket: { taxable: 0, pretax: 0, roth: 0, hsa: 0 },
        startingAge: 60,
        years: 1,
        annualRealSpendUSD: 40_000,
        retirementTaxRate: 0.2,
        longTermCapGainsRate: 0.1, // not used here (no taxable bucket)
      }),
    );
    // gross from pretax = 40k / 0.8 = $50k
    // tax = $50k × 0.2 = $10k (ordinary, not LTCG)
    expect(r.rows[0].withdrawalsByBucket.pretax).toBeCloseTo(50_000, 0);
    expect(r.rows[0].taxesPaidUSD).toBeCloseTo(10_000, 0);
  });
});
