/**
 * Roth conversion ladder estimator.
 *
 * The classic financial-independence-community move: after early retirement, when
 * ordinary income drops to ~0, "ladder" Traditional 401k / IRA
 * dollars into a Roth account each year by paying conversion tax
 * at the lowest bracket. After 5 years (the IRS seasoning rule),
 * each rung becomes accessible as principal-not-earnings, which
 * means it can be withdrawn pre-59½ without the 10% penalty.
 *
 * This estimator answers two questions:
 *   1. "If I aim to convert $X/year to fill the 0% / 12% bracket,
 *      how many years to convert my whole pre-tax balance?"
 *   2. "What's the lifetime tax savings vs withdrawing pre-tax
 *      at ordinary income (and possibly bumping into higher
 *      brackets due to RMDs)?"
 *
 * Bracket math is intentionally simplified — we don't model
 * standard deduction precisely, state tax, or the interaction
 * with Social Security / dividends / cap gains. The output is a
 * directional estimate, not tax advice. Surfaces the *structure*
 * so users understand the strategy before consulting a CPA.
 */

import { accountValue, TAX_TREATMENT_BY_CATEGORY, type Household } from "@/lib/types";

/** Simplified 2024-ish federal MFJ brackets (real-dollar). */
const BRACKETS_MFJ: Array<{ upTo: number; rate: number }> = [
  { upTo: 23_200, rate: 0.1 },
  { upTo: 94_300, rate: 0.12 },
  { upTo: 201_050, rate: 0.22 },
  { upTo: 383_900, rate: 0.24 },
  { upTo: 487_450, rate: 0.32 },
  { upTo: 731_200, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

const STANDARD_DEDUCTION_MFJ = 29_200;

export type RothLadderInput = {
  household: Household;
  /**
   * Other ordinary income in the post-Independence conversion years.
   * Default 0 — the canonical "no W-2, no SS yet" early-retiree
   * case where conversions can fill the lowest brackets cheaply.
   */
  otherIncomeUSD?: number;
  /**
   * Total $ to convert per year. Default fills standard
   * deduction + 12% bracket (~$94K total income at 0 baseline).
   */
  annualConversionUSD?: number;
  /**
   * Optional comparison: what bracket the user expects to be in
   * if they DON'T ladder and instead draw from pre-tax in
   * retirement (default 22% — typical retiree marginal).
   */
  retireeOrdinaryRate?: number;
};

export type RothLadderResult = {
  preTaxBalanceUSD: number;
  annualConversionUSD: number;
  /** Years to convert entire pre-tax balance. */
  yearsToConvert: number | null;
  /** Estimated annual federal tax cost of one conversion year. */
  conversionTaxUSD: number;
  /** Effective marginal rate on the conversion bucket. */
  effectiveConversionRate: number;
  /** Estimated lifetime tax savings vs straight drawdown at retireeOrdinaryRate. */
  lifetimeSavingsUSD: number;
  /** Description of what bracket each conversion year fills. */
  bracketFillNotes: string[];
};

function federalTaxMFJ(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  let owed = 0;
  let lastUpTo = 0;
  for (const b of BRACKETS_MFJ) {
    if (taxableIncome <= b.upTo) {
      owed += (taxableIncome - lastUpTo) * b.rate;
      return owed;
    }
    owed += (b.upTo - lastUpTo) * b.rate;
    lastUpTo = b.upTo;
  }
  return owed;
}

export function rothLadder(input: RothLadderInput): RothLadderResult {
  const otherIncome = Math.max(0, input.otherIncomeUSD ?? 0);
  // Default conversion: fill std deduction + 12% bracket from 0
  // baseline; if user has other income, fill the same gross ceiling.
  const defaultCeiling = 94_300 + STANDARD_DEDUCTION_MFJ;
  const annualConversion = Math.max(
    0,
    input.annualConversionUSD ?? Math.max(0, defaultCeiling - otherIncome),
  );

  let preTaxBalance = 0;
  for (const a of input.household.accounts) {
    if (TAX_TREATMENT_BY_CATEGORY[a.category] === "PRE_TAX") {
      preTaxBalance += accountValue(a);
    }
  }

  const yearsToConvert =
    annualConversion > 0 && preTaxBalance > 0
      ? Math.ceil(preTaxBalance / annualConversion)
      : null;

  // Tax owed on one conversion year (delta vs baseline w/o conversion).
  const baselineTax = federalTaxMFJ(otherIncome - STANDARD_DEDUCTION_MFJ);
  const withConversionTaxableIncome =
    otherIncome + annualConversion - STANDARD_DEDUCTION_MFJ;
  const withConversionTax = federalTaxMFJ(withConversionTaxableIncome);
  const conversionTax = Math.max(0, withConversionTax - baselineTax);
  const effectiveRate =
    annualConversion > 0 ? conversionTax / annualConversion : 0;

  // Comparison: what the same dollars would have cost if drawn down
  // at retireeOrdinaryRate (ordinary income) over the whole balance.
  const retireeRate = input.retireeOrdinaryRate ?? 0.22;
  const lifetimeStraightTax = preTaxBalance * retireeRate;
  const lifetimeLadderTax =
    yearsToConvert != null ? conversionTax * yearsToConvert : preTaxBalance * effectiveRate;
  const lifetimeSavings = Math.max(0, lifetimeStraightTax - lifetimeLadderTax);

  const bracketFillNotes: string[] = [];
  if (annualConversion > 0) {
    const ceiling = otherIncome + annualConversion;
    bracketFillNotes.push(
      `Fills income up to about $${Math.round(ceiling).toLocaleString()} per year`,
    );
    if (otherIncome === 0 && annualConversion <= defaultCeiling) {
      bracketFillNotes.push(
        "Stays inside the 12% federal bracket — the Independence sweet-spot.",
      );
    }
    if (effectiveRate <= 0.12) {
      bracketFillNotes.push(
        `Effective conversion rate ~${(effectiveRate * 100).toFixed(1)}% — meaningfully below the 22% retiree default.`,
      );
    }
  }

  return {
    preTaxBalanceUSD: preTaxBalance,
    annualConversionUSD: annualConversion,
    yearsToConvert,
    conversionTaxUSD: conversionTax,
    effectiveConversionRate: effectiveRate,
    lifetimeSavingsUSD: lifetimeSavings,
    bracketFillNotes,
  };
}
