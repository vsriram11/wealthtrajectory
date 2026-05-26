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
    // Year 0: taxable=100k, gross needed = 60k/0.8 = 75k. taxable
    // covers 75k (only 100k there). So taxable drains to 25k, pretax
    // untouched.
    expect(r.rows[0].withdrawalsByBucket.taxable).toBeCloseTo(75_000, 0);
    expect(r.rows[0].withdrawalsByBucket.pretax).toBe(0);
    expect(r.rows[0].endingBalances.taxable).toBeCloseTo(25_000, 0);

    // Year 1: taxable=25k, gross 75k. Taxable covers 25k, pretax covers 50k.
    expect(r.rows[1].withdrawalsByBucket.taxable).toBeCloseTo(25_000, 0);
    expect(r.rows[1].withdrawalsByBucket.pretax).toBeCloseTo(50_000, 0);

    // Year 2: taxable=0, gross 75k. All from pretax.
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
    // gross/year = 40k/0.8 = 50k; tax/year = 50k × 0.2 = 10k
    expect(r.totalTaxesPaidUSD).toBeCloseTo(50_000, -2);
  });
});
