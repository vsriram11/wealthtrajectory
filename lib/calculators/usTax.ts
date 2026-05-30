/**
 * US Tax calculator engine (2025 tax year).
 *
 * Static / portfolio-blind: pure function of inputs → result. NOT
 * connected to the household or projection layers. Intended for
 * back-of-envelope "what does my federal + state bill look like?"
 * questions on the Static Calculators page.
 *
 * What's modeled
 *   - Federal ordinary income tax (10/12/22/24/32/35/37% brackets,
 *     filing-status-specific).
 *   - Federal long-term capital gains + qualified dividends at the
 *     preferential 0/15/20% rates, STACKED on top of ordinary
 *     taxable income (this is the IRS-correct "stacking" math —
 *     LTCG fills brackets STARTING from where ordinary income left
 *     off).
 *   - AMT (Alternative Minimum Tax) with the 2025 exemption +
 *     phase-out + 26/28% brackets. LTCG portion of AMTI uses the
 *     full 0/15/20% bracket schedule stacked above the ordinary
 *     AMTI excess (Form 6251 Part III). Triggers most commonly
 *     from ISO bargain element exposure. SALT add-back for
 *     itemizers and prior-year AMT credit (Form 8801) are both
 *     supported as optional inputs (default 0).
 *   - FICA: 6.2% Social Security up to the 2025 wage base ($176,100)
 *     and 1.45% Medicare on all wages.
 *   - Additional Medicare 0.9% above filing-status thresholds.
 *   - Self-employment tax: 15.3% on 92.35% of SE income, half
 *     deductible above-the-line.
 *   - NIIT (3.8%) on lesser of (net investment income, MAGI − threshold).
 *   - Standard deduction by filing status, or an itemized override.
 *   - State income tax (see usStateTaxBrackets.ts) — flat,
 *     progressive, or "no income tax" by state.
 *
 * What's NOT modeled (see disclosures in UI)
 *   - QBI deduction (Section 199A pass-through).
 *   - Credits: CTC, EITC, dependent care, savers, retirement
 *     savings contribution, education credits.
 *   - Dependent exemptions / additional standard deduction for 65+
 *     or blind.
 *   - IRMAA Medicare premium surcharges.
 *   - State-specific quirks: pass-through entity workarounds, local
 *     income tax (NYC / Philadelphia / SF), reciprocity, WA's $270k
 *     LTCG threshold + primary-residence exclusion.
 *   - Phase-outs of itemized deductions or SALT cap.
 *
 * Engine purity (CLAUDE.md):
 *   - No Date.now(), no Math.random(), no I/O, no store reads.
 *   - NaN-safe at boundary: bad input → 0 contribution, never NaN.
 *   - Reproducible: identical inputs → identical outputs.
 */

import {
  STATE_BRACKETS_2025,
  type USState,
  US_STATE_NAMES,
} from "./usStateTaxBrackets";

export type FilingStatus = "single" | "mfj" | "hoh" | "mfs";

export type IncomeBuckets = {
  /** W-2 wages — ordinary income subject to FICA. */
  wagesUSD: number;
  /** Net self-employment income (Schedule C net profit). */
  selfEmploymentUSD: number;
  /** Taxable interest (1099-INT box 1). */
  interestIncomeUSD: number;
  /** Ordinary dividends (1099-DIV box 1a, including the qualified portion). */
  ordinaryDividendsUSD: number;
  /** Short-term capital gains (held ≤ 1 year) — taxed as ordinary. */
  shortTermCapGainsUSD: number;
  /** Qualified dividends (subset of ordinary divs, but taxed at LTCG rates). */
  qualifiedDividendsUSD: number;
  /** Long-term capital gains (held > 1 year). */
  longTermCapGainsUSD: number;
  /** Catch-all: rental net, royalties, other ordinary income. */
  otherOrdinaryUSD: number;
};

export type UsTaxInputs = {
  taxYear: 2025;
  filingStatus: FilingStatus;
  state: USState;
  income: IncomeBuckets;
  /**
   * Pre-tax retirement contributions (traditional 401(k) /
   * traditional IRA / HSA). Reduces wages above-the-line.
   */
  retirementContribUSD: number;
  /**
   * Itemized deduction amount. `null` = use the standard deduction
   * for the filing status. Pass a number to override.
   */
  itemizedDeductionUSD: number | null;
  /**
   * ISO bargain element — the spread between fair market value and
   * exercise price on incentive stock options EXERCISED but not
   * sold in the same year. The #1 AMT preference item post-TCJA.
   * Default 0 (most users have none). Optional for back-compat
   * with callers that don't yet pass it.
   */
  isoBargainElementUSD?: number;
  /**
   * Tax-exempt interest from "private activity bonds." Regular
   * tax treats this as tax-free; AMT adds it back. Rare but
   * material when present.
   */
  privateActivityBondInterestUSD?: number;
  /**
   * State + local income tax portion of the itemized deduction
   * (Form 6251 line 2a add-back). Capped at $10,000 by TCJA but
   * still material for CA/NY/NJ high earners — a $10K SALT
   * add-back at the 28% AMT rate is $2.8K of additional tax.
   * Only relevant when `itemizedDeductionUSD != null` (the user
   * is itemizing); ignored otherwise. Audit round-5 BLOCK.
   */
  stateAndLocalTaxItemizedUSD?: number;
  /**
   * Prior-year Minimum Tax Credit (Form 8801) carried into this
   * year. Refundable credit equal to the AMT you paid in earlier
   * years from "timing" preferences (mostly ISO exercise). When
   * present, the credit reduces regular tax — bounded by the
   * difference (regular − TMT) so the credit can't reduce regular
   * tax below TMT (i.e., you still pay at least TMT). Audit
   * round-5 WARN — material for ISO holders in the year after
   * exercise.
   */
  priorYearAMTCreditUSD?: number;
};

export type BracketBreakdownRow = {
  rate: number;
  floor: number;
  ceiling: number; // Number.POSITIVE_INFINITY for the top bracket
  incomeInBracketUSD: number;
  taxUSD: number;
};

export type FederalResult = {
  totalGrossIncomeUSD: number;
  ordinaryIncomeUSD: number;
  ltcgIncomeUSD: number;
  preTaxAdjustmentsUSD: number;
  agiUSD: number;
  deductionUSD: number;
  deductionSource: "standard" | "itemized";
  taxableOrdinaryIncomeUSD: number;
  taxableLtcgUSD: number;
  ordinaryTaxUSD: number;
  ltcgTaxUSD: number;
  ficaSsUSD: number;
  ficaMedicareUSD: number;
  additionalMedicareUSD: number;
  seTaxUSD: number;
  niitUSD: number;
  /**
   * AMT (Alternative Minimum Tax) — the excess of Tentative
   * Minimum Tax over Regular Tax. Most taxpayers post-TCJA see
   * 0 here because the AMT exemption was raised and SALT was
   * capped, leaving few preference items to trigger AMT.
   * Triggered most commonly by ISO bargain element from
   * exercising private-company stock options.
   */
  amtUSD: number;
  /**
   * Tentative Minimum Tax (informational). Useful for diagnosing
   * "why is my AMT 0?" — if TMT < regular tax by a wide margin,
   * the user has substantial AMT headroom.
   */
  tmtUSD: number;
  /**
   * AMTI (Alternative Minimum Taxable Income) — the starting
   * point for AMT. Exposed for the calculator's bracket breakdown.
   */
  amtiUSD: number;
  /** AMT exemption after phase-out (informational). */
  amtExemptionUSD: number;
  /**
   * Prior-year AMT credit (Form 8801) actually applied this year.
   * Bounded by `max(0, regular - TMT)` headroom; carries forward
   * when AMT > 0 (no headroom). Always 0 when input
   * `priorYearAMTCreditUSD` is 0/unset.
   */
  amtCreditUsedUSD: number;
  totalFederalTaxUSD: number;
  effectiveRateOverall: number;
  marginalRateOrdinary: number;
  marginalRateLTCG: number;
  ordinaryBracketBreakdown: BracketBreakdownRow[];
  ltcgBracketBreakdown: BracketBreakdownRow[];
};

export type StateResult = {
  state: USState;
  stateName: string;
  filingStatusUsed: FilingStatus;
  hasIncomeTax: boolean;
  taxableIncomeUSD: number;
  stateTaxUSD: number;
  effectiveRate: number;
  marginalRate: number;
  bracketBreakdown: BracketBreakdownRow[];
  note?: string;
};

export type UsTaxResult = {
  inputs: UsTaxInputs;
  federal: FederalResult;
  state: StateResult;
  totalTaxUSD: number;
  takeHomeUSD: number;
  overallEffectiveRate: number;
};

/* ------------------------------------------------------------------ */
/* 2025 federal constants (IRS Rev. Proc. 2024-40)                    */
/* ------------------------------------------------------------------ */

type Bracket = { rate: number; threshold: number };

// Each entry's `threshold` is the bottom of that bracket. The
// implicit top is the threshold of the next bracket; the last
// bracket has no top.
export const FEDERAL_ORDINARY_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.10, threshold: 0 },
    { rate: 0.12, threshold: 11_925 },
    { rate: 0.22, threshold: 48_475 },
    { rate: 0.24, threshold: 103_350 },
    { rate: 0.32, threshold: 197_300 },
    { rate: 0.35, threshold: 250_525 },
    { rate: 0.37, threshold: 626_350 },
  ],
  mfj: [
    { rate: 0.10, threshold: 0 },
    { rate: 0.12, threshold: 23_850 },
    { rate: 0.22, threshold: 96_950 },
    { rate: 0.24, threshold: 206_700 },
    { rate: 0.32, threshold: 394_600 },
    { rate: 0.35, threshold: 501_050 },
    { rate: 0.37, threshold: 751_600 },
  ],
  hoh: [
    { rate: 0.10, threshold: 0 },
    { rate: 0.12, threshold: 17_000 },
    { rate: 0.22, threshold: 64_850 },
    { rate: 0.24, threshold: 103_350 },
    { rate: 0.32, threshold: 197_300 },
    { rate: 0.35, threshold: 250_500 },
    { rate: 0.37, threshold: 626_350 },
  ],
  mfs: [
    { rate: 0.10, threshold: 0 },
    { rate: 0.12, threshold: 11_925 },
    { rate: 0.22, threshold: 48_475 },
    { rate: 0.24, threshold: 103_350 },
    { rate: 0.32, threshold: 197_300 },
    { rate: 0.35, threshold: 250_525 },
    { rate: 0.37, threshold: 375_800 },
  ],
};

// LTCG / qualified dividends. 3 brackets each: 0%, 15%, 20%.
export const FEDERAL_LTCG_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.00, threshold: 0 },
    { rate: 0.15, threshold: 48_350 },
    { rate: 0.20, threshold: 533_400 },
  ],
  mfj: [
    { rate: 0.00, threshold: 0 },
    { rate: 0.15, threshold: 96_700 },
    { rate: 0.20, threshold: 600_050 },
  ],
  hoh: [
    { rate: 0.00, threshold: 0 },
    { rate: 0.15, threshold: 64_750 },
    { rate: 0.20, threshold: 566_700 },
  ],
  mfs: [
    { rate: 0.00, threshold: 0 },
    { rate: 0.15, threshold: 48_350 },
    { rate: 0.20, threshold: 300_000 },
  ],
};

export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15_000,
  mfj: 30_000,
  hoh: 22_500,
  mfs: 15_000,
};

// 2025 AMT parameters (Rev. Proc. 2024-40).
//
// AMT exemption — subtracted from AMTI to compute the AMTI
// excess that's actually taxed at the 26/28% AMT rates.
export const AMT_EXEMPTION_2025: Record<FilingStatus, number> = {
  single: 88_100,
  mfj: 137_000,
  hoh: 88_100,
  mfs: 68_500,
};

// AMT exemption phase-out — exemption is reduced by 25¢ per
// dollar of AMTI above this threshold.
export const AMT_EXEMPTION_PHASEOUT_START_2025: Record<FilingStatus, number> = {
  single: 626_350,
  mfj: 1_252_700,
  hoh: 626_350,
  mfs: 626_350,
};

// AMT 26%/28% rate breakpoint. Above this much AMTI excess,
// the rate steps from 26% to 28%.
export const AMT_RATE_BREAKPOINT_2025: Record<FilingStatus, number> = {
  single: 239_100,
  mfj: 239_100,
  hoh: 239_100,
  // MFS gets HALF the breakpoint per longstanding AMT design (a
  // single MFJ couple shouldn't be advantaged by splitting).
  mfs: 119_550,
};

export const AMT_RATE_LOW = 0.26;
export const AMT_RATE_HIGH = 0.28;

// 2025 Social Security wage base (SSA announcement).
export const SS_WAGE_BASE_2025 = 176_100;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDITIONAL_MEDICARE_RATE = 0.009;

// Additional Medicare / NIIT thresholds by filing status.
export const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  mfj: 250_000,
  hoh: 200_000,
  mfs: 125_000,
};

export const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  mfj: 250_000,
  hoh: 200_000,
  mfs: 125_000,
};
export const NIIT_RATE = 0.038;

// Self-employment.
export const SE_INCOME_FACTOR = 0.9235; // 92.35%
export const SE_SS_RATE = 0.124;
export const SE_MEDICARE_RATE = 0.029;
export const SE_TOTAL_RATE = SE_SS_RATE + SE_MEDICARE_RATE; // 15.3%

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function safeFinite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

function nonneg(n: number): number {
  return Math.max(0, safeFinite(n, 0));
}

/**
 * Apply a bracket schedule to a slice of income that starts at
 * `incomeBelow` (already-taxed income that "pushes" this slice up
 * into higher brackets — used for LTCG stacking) and has length
 * `amount`. Returns the tax for that slice + a per-bracket breakdown
 * row for each bracket in the schedule (rows have 0 income/tax if
 * the slice doesn't touch that bracket).
 *
 * The breakdown is keyed by the bracket schedule, NOT by what was
 * actually used, so the UI can render a stable bracket table that
 * highlights "this is where your marginal $ landed."
 */
function applyBrackets(
  schedule: Bracket[],
  amount: number,
  incomeBelow: number,
): { tax: number; breakdown: BracketBreakdownRow[] } {
  let tax = 0;
  const breakdown: BracketBreakdownRow[] = [];
  const safeAmount = Math.max(0, amount);
  const sliceStart = Math.max(0, incomeBelow);
  const sliceEnd = sliceStart + safeAmount;

  for (let i = 0; i < schedule.length; i++) {
    const bracket = schedule[i];
    const floor = bracket.threshold;
    const ceiling =
      i + 1 < schedule.length
        ? schedule[i + 1].threshold
        : Number.POSITIVE_INFINITY;
    // Portion of THIS BRACKET that overlaps with our slice.
    const overlapLo = Math.max(floor, sliceStart);
    const overlapHi = Math.min(ceiling, sliceEnd);
    const inBracket = Math.max(0, overlapHi - overlapLo);
    const bracketTax = inBracket * bracket.rate;
    tax += bracketTax;
    breakdown.push({
      rate: bracket.rate,
      floor,
      ceiling,
      incomeInBracketUSD: inBracket,
      taxUSD: bracketTax,
    });
  }
  return { tax, breakdown };
}

/**
 * Marginal rate at a given income level for a bracket schedule —
 * i.e., the rate the NEXT dollar of income at this level would hit.
 * Returns 0 when income is 0 (no marginal exposure).
 */
function marginalRateAt(schedule: Bracket[], income: number): number {
  if (income <= 0) return 0;
  let rate = schedule[0]?.rate ?? 0;
  for (const b of schedule) {
    if (income > b.threshold) rate = b.rate;
  }
  return rate;
}

/* ------------------------------------------------------------------ */
/* Federal tax                                                         */
/* ------------------------------------------------------------------ */

function computeFICA(
  wages: number,
  filingStatus: FilingStatus,
): { ss: number; medicare: number; addMedicare: number } {
  const w = Math.max(0, wages);
  const ss = Math.min(w, SS_WAGE_BASE_2025) * SS_RATE;
  const medicare = w * MEDICARE_RATE;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const addMedicare =
    Math.max(0, w - threshold) * ADDITIONAL_MEDICARE_RATE;
  return { ss, medicare, addMedicare };
}

function computeSETax(
  seIncome: number,
  wagesAlreadySubjectToSs: number = 0,
): {
  seTax: number;
  deductible: number;
} {
  if (seIncome <= 0) return { seTax: 0, deductible: 0 };
  const netSe = seIncome * SE_INCOME_FACTOR;
  // Per Schedule SE, the SS portion is capped at
  // `SS_WAGE_BASE − wages already subject to SS` (form line 8a).
  // Round-3 audit HIGH fix: pass wages so the cap composes
  // correctly when filer has both W-2 + SE income. Previously
  // this capped `netSe` against the full wage base
  // independently of wages → up to ~$5.7k SE-SS overstatement
  // for a filer at the W-2 cap + meaningful SE.
  const ssRemainingBase = Math.max(0, SS_WAGE_BASE_2025 - wagesAlreadySubjectToSs);
  const ssPortion = Math.min(netSe, ssRemainingBase) * SE_SS_RATE;
  const medicarePortion = netSe * SE_MEDICARE_RATE;
  const seTax = ssPortion + medicarePortion;
  return { seTax, deductible: seTax / 2 };
}

function computeNIIT(
  netInvestmentIncome: number,
  magi: number,
  filingStatus: FilingStatus,
): number {
  const threshold = NIIT_THRESHOLD[filingStatus];
  const excess = Math.max(0, magi - threshold);
  return NIIT_RATE * Math.min(Math.max(0, netInvestmentIncome), excess);
}

/**
 * Alternative Minimum Tax (AMT) computation — 2025 rules.
 *
 * Post-TCJA, AMT mostly only triggers when a user has substantial
 * ISO bargain element (exercised but not sold private stock
 * options) or private activity bond interest. The standard
 * deduction and TCJA's SALT cap eliminated the previous
 * itemized-deduction triggers for most filers.
 *
 * The flow:
 *   1. AMTI = AGI + AMT preferences (ISO bargain, PAB interest)
 *      - For simplicity we DON'T model: NOL adjustments, depreciation
 *        adjustments, mining/oil & gas preferences, large itemized
 *        deductions add-backs (SALT cap means this is usually moot).
 *   2. AMTI - exemption (phased out) = AMTI excess.
 *   3. Apply 26%/28% rates with the LTCG/QD portion of AMTI excess
 *      still taxed at LTCG rates (AMT preserves the LTCG preference).
 *   4. AMT = max(0, TMT - regular tax).
 *
 * Returns the four AMT figures consumed by FederalResult.
 */
function computeAMT(args: {
  filingStatus: FilingStatus;
  agi: number;
  taxableOrdinaryIncomeUSD: number;
  taxableLtcgUSD: number;
  regularTaxUSD: number;
  isoBargainElementUSD: number;
  privateActivityBondInterestUSD: number;
  saltAddBackUSD: number;
  priorYearAMTCreditUSD: number;
}): {
  amtUSD: number;
  tmtUSD: number;
  amtiUSD: number;
  amtExemptionUSD: number;
  amtCreditUsedUSD: number;
} {
  const {
    filingStatus,
    taxableOrdinaryIncomeUSD,
    taxableLtcgUSD,
    regularTaxUSD,
    isoBargainElementUSD,
    privateActivityBondInterestUSD,
    saltAddBackUSD,
    priorYearAMTCreditUSD,
  } = args;

  // AMTI starting point — taxable income + AMT preference add-backs.
  // The standard deduction is implicitly retained (AMT no longer
  // disallows it post-TCJA). For itemizers, the SALT deduction
  // must be added back (Form 6251 line 2a) — capped at $10K by
  // TCJA so the add-back never exceeds that. Round-5 audit BLOCK.
  const amti =
    taxableOrdinaryIncomeUSD +
    taxableLtcgUSD +
    nonneg(isoBargainElementUSD) +
    nonneg(privateActivityBondInterestUSD) +
    Math.min(10_000, nonneg(saltAddBackUSD));

  // Phase-out: exemption reduces 25¢ per $1 of AMTI above threshold.
  const baseExemption = AMT_EXEMPTION_2025[filingStatus];
  const phaseoutStart = AMT_EXEMPTION_PHASEOUT_START_2025[filingStatus];
  const phaseoutReduction = Math.max(0, (amti - phaseoutStart) * 0.25);
  const amtExemption = Math.max(0, baseExemption - phaseoutReduction);

  const amtiExcess = Math.max(0, amti - amtExemption);

  // Form 6251 Part III split: ORDINARY portion of AMTI excess
  // gets 26%/28% AMT rates; LTCG portion of AMTI excess gets the
  // regular LTCG bracket schedule (0%/15%/20%) STACKED on top of
  // the ordinary AMTI excess.
  //
  // Round-4 audit BLOCK fix: the prior implementation put LTCG
  // at the BOTTOM of the excess (`min(taxableLtcgUSD, amtiExcess)`)
  // and used a flat 15% rate. This was wrong in two directions:
  //   - When AMTI excess < taxableLtcg, ALL the excess was
  //     mis-attributed to LTCG, leaving ordinaryInExcess=0 and
  //     understating TMT (no 26/28% applied to anything).
  //   - The flat 15% rate overcharged the 0% LTCG bracket
  //     (single ord < $48,350 → first LTCG dollars should be 0%)
  //     and undercharged the 20% bracket (single ord > $533,400).
  //
  // Correct Form 6251 split:
  //   ordinaryInExcess = max(0, amtiExcess - taxableLtcgUSD)
  //   ltcgInExcess     = amtiExcess - ordinaryInExcess
  // Then stack LTCG above ordinary using the existing applyBrackets
  // helper, same way regular tax stacks LTCG above ordinary income.
  const ordinaryInExcess = Math.max(0, amtiExcess - taxableLtcgUSD);
  const ltcgInExcess = amtiExcess - ordinaryInExcess;

  // Apply 26%/28% to the ordinary portion.
  const breakpoint = AMT_RATE_BREAKPOINT_2025[filingStatus];
  const ordinaryAt26 = Math.min(ordinaryInExcess, breakpoint);
  const ordinaryAt28 = Math.max(0, ordinaryInExcess - breakpoint);
  const tmtOrdinary =
    ordinaryAt26 * AMT_RATE_LOW + ordinaryAt28 * AMT_RATE_HIGH;

  // LTCG portion uses the regular LTCG bracket schedule with
  // `ordinaryInExcess` as the stacking floor (matches Form 6251
  // Part III line 40+ — capital gains worksheet).
  const ltcgSchedule = FEDERAL_LTCG_BRACKETS_2025[filingStatus];
  const tmtLtcg = applyBrackets(
    ltcgSchedule,
    ltcgInExcess,
    ordinaryInExcess,
  ).tax;

  const tmt = tmtOrdinary + tmtLtcg;
  // AMT = excess of TMT over regular tax (income tax only — FICA,
  // SE, NIIT excluded). Computed against the pre-credit regular
  // tax per Form 6251 line 9.
  const amt = Math.max(0, tmt - regularTaxUSD);

  // Prior-year MTC (Form 8801): reduces regular tax by `headroom
  // = max(0, regular - TMT)` capped at the available credit
  // balance. When AMT > 0, headroom is 0 → no credit used this
  // year (full carryforward).
  const headroom = Math.max(0, regularTaxUSD - tmt);
  const amtCreditUsed = Math.min(nonneg(priorYearAMTCreditUSD), headroom);

  return {
    amtUSD: amt,
    tmtUSD: tmt,
    amtiUSD: amti,
    amtExemptionUSD: amtExemption,
    amtCreditUsedUSD: amtCreditUsed,
  };
}

export function computeFederalTax(inputs: UsTaxInputs): FederalResult {
  const i = inputs.income;
  const filingStatus = inputs.filingStatus;

  const wages = nonneg(i.wagesUSD);
  const seInc = nonneg(i.selfEmploymentUSD);
  const interest = nonneg(i.interestIncomeUSD);
  const ordDivs = nonneg(i.ordinaryDividendsUSD);
  const stcg = nonneg(i.shortTermCapGainsUSD);
  const qualDivs = Math.min(nonneg(i.qualifiedDividendsUSD), ordDivs);
  const ltcg = nonneg(i.longTermCapGainsUSD);
  const otherOrd = nonneg(i.otherOrdinaryUSD);
  const retire = nonneg(inputs.retirementContribUSD);
  // Itemized deduction. null = use standard.
  const itemized =
    inputs.itemizedDeductionUSD == null
      ? null
      : nonneg(inputs.itemizedDeductionUSD);

  // SE tax + half-deduction (above-the-line adjustment).
  // Round-3 audit HIGH fix: pass `wages` so the SE-SS cap composes
  // with W-2 SS already withheld (Schedule SE line 8a).
  const { seTax, deductible: seDeductible } = computeSETax(seInc, wages);

  // Ordinary-bucket income (taxed at federal ordinary brackets):
  //   wages + interest + (ordinary divs − qualified divs) + STCG +
  //   SE income (full) + other ordinary
  // Qualified dividends are a SUBSET of ordinary dividends in 1099-DIV;
  // we pull them out so they're taxed at LTCG rates instead.
  const nonQualOrdDivs = Math.max(0, ordDivs - qualDivs);
  const ordinaryIncomeGross =
    wages + interest + nonQualOrdDivs + stcg + seInc + otherOrd;
  const ltcgIncome = ltcg + qualDivs;

  const totalGrossIncome = ordinaryIncomeGross + ltcgIncome;

  // AGI = gross − above-the-line adjustments.
  // Above-the-line: retirement contributions, half of SE tax.
  // Round-3 audit HIGH fix: retirement cap now spans wages +
  // SE-net-earnings, not just wages. Previously self-employed
  // filers funding a SEP-IRA or Solo 401(k) got ZERO deduction
  // because the cap was wages-only. Real-world SEP / Solo
  // contributions can be up to 20% of net SE earnings; an exact
  // model would require the contribution-type input. For v1 we
  // simply allow the cap to include SE net earnings (post-92.35%
  // adjustment) so SE filers can claim a deduction at all.
  const seNetEarnings = Math.max(0, seInc * SE_INCOME_FACTOR - seDeductible);
  const retireAdj = Math.min(retire, wages + seNetEarnings);
  const preTaxAdjustments = retireAdj + seDeductible;
  const ordinaryAfterAdj = Math.max(0, ordinaryIncomeGross - preTaxAdjustments);
  const agi = ordinaryAfterAdj + ltcgIncome;

  // Deduction.
  const standardDed = STANDARD_DEDUCTION_2025[filingStatus];
  const itemizedHonored = itemized != null && itemized > standardDed;
  const deduction = itemizedHonored ? (itemized as number) : standardDed;
  const deductionSource: "standard" | "itemized" = itemizedHonored
    ? "itemized"
    : "standard";

  // Apply deduction. IRS convention: deduction is applied to taxable
  // income in total, but ordering matters for LTCG stacking. We
  // apply the deduction to ordinary income FIRST (which is the
  // taxpayer-favorable rule embedded in the Qualified Dividends &
  // Capital Gain Tax Worksheet), with leftover spilling into LTCG
  // (which is rare in practice — only happens when ordinary income
  // is below the deduction).
  let taxableOrdinary = Math.max(0, ordinaryAfterAdj - deduction);
  const dedAppliedToOrdinary = ordinaryAfterAdj - taxableOrdinary;
  const dedRemainder = deduction - dedAppliedToOrdinary;
  const taxableLtcg = Math.max(0, ltcgIncome - dedRemainder);

  // Federal ordinary tax.
  const ordinarySchedule = FEDERAL_ORDINARY_BRACKETS_2025[filingStatus];
  const ord = applyBrackets(ordinarySchedule, taxableOrdinary, 0);

  // LTCG stacking: LTCG fills brackets STARTING from where the
  // ordinary taxable income left off. The "incomeBelow" floor is
  // therefore taxableOrdinary.
  const ltcgSchedule = FEDERAL_LTCG_BRACKETS_2025[filingStatus];
  const ltcgTax = applyBrackets(ltcgSchedule, taxableLtcg, taxableOrdinary);

  // FICA on wages.
  const fica = computeFICA(wages, filingStatus);

  // NIIT.
  // Net investment income (NII) = interest + ord divs + STCG + LTCG.
  // (SE income is NOT investment income; rental can be, but we
  // approximate by excluding `otherOrdinary`.)
  //
  // Round-3 audit HIGH fix: `ordDivs` already INCLUDES `qualDivs`
  // (qualDivs is clamped to ordDivs at the boundary because the
  // qualified portion is a subset of ordinary divs reported on
  // Form 1099-DIV box 1a vs 1b). Adding both inflated NII by
  // `qualDivs` → up to ~$760 NIIT overstatement on a $20k qual-
  // div + above-threshold MAGI.
  const nii = interest + ordDivs + stcg + ltcg;
  const niit = computeNIIT(nii, agi, filingStatus);

  // AMT — computed AFTER regular income tax (ord + LTCG) so we
  // can compare TMT vs that figure. AMT is ADDITIVE on top —
  // when triggered, the user pays max(regular, TMT), which is
  // (regular + AMT) using the AMT field. NOTE: we use only the
  // income-tax portion of regular tax for the comparison; FICA,
  // SE, and NIIT are NOT in scope for the AMT comparison.
  const regularIncomeTax = ord.tax + ltcgTax.tax;
  // SALT add-back only applies when itemizing AND the itemized
  // total was actually used (itemizedHonored from line 663
  // already encodes this). When standard deduction wins, no SALT
  // was deducted → no add-back. Capped at $10K by TCJA.
  const saltAddBack = itemizedHonored
    ? Math.min(10_000, nonneg(inputs.stateAndLocalTaxItemizedUSD ?? 0))
    : 0;
  const amtResult = computeAMT({
    filingStatus,
    agi,
    taxableOrdinaryIncomeUSD: taxableOrdinary,
    taxableLtcgUSD: taxableLtcg,
    regularTaxUSD: regularIncomeTax,
    isoBargainElementUSD: nonneg(inputs.isoBargainElementUSD ?? 0),
    privateActivityBondInterestUSD: nonneg(
      inputs.privateActivityBondInterestUSD ?? 0,
    ),
    saltAddBackUSD: saltAddBack,
    priorYearAMTCreditUSD: nonneg(inputs.priorYearAMTCreditUSD ?? 0),
  });

  // Prior-year AMT credit (Form 8801): reduces regular tax,
  // bounded by AMT headroom (`max(0, regular - TMT)`). When AMT
  // > 0, headroom is 0 → credit fully carries forward.
  // computeAMT already capped the usable portion in
  // amtCreditUsedUSD. Apply it as a reduction to regular income
  // tax here.
  void regularIncomeTax;

  const totalFederalTax =
    ord.tax +
    ltcgTax.tax +
    fica.ss +
    fica.medicare +
    fica.addMedicare +
    seTax +
    niit +
    amtResult.amtUSD -
    amtResult.amtCreditUsedUSD;

  const effectiveRateOverall =
    totalGrossIncome > 0 ? totalFederalTax / totalGrossIncome : 0;

  // Marginal rates: where the NEXT dollar of ordinary or LTCG income
  // would land. For ordinary that's the bracket containing
  // taxableOrdinary; for LTCG it's the LTCG bracket containing
  // (taxableOrdinary + taxableLtcg) — i.e., the stacked top.
  const marginalRateOrdinary = marginalRateAt(ordinarySchedule, taxableOrdinary);
  const marginalRateLTCG = marginalRateAt(
    ltcgSchedule,
    taxableOrdinary + taxableLtcg,
  );

  return {
    totalGrossIncomeUSD: totalGrossIncome,
    ordinaryIncomeUSD: ordinaryIncomeGross,
    ltcgIncomeUSD: ltcgIncome,
    preTaxAdjustmentsUSD: preTaxAdjustments,
    agiUSD: agi,
    deductionUSD: deduction,
    deductionSource,
    taxableOrdinaryIncomeUSD: taxableOrdinary,
    taxableLtcgUSD: taxableLtcg,
    ordinaryTaxUSD: ord.tax,
    ltcgTaxUSD: ltcgTax.tax,
    ficaSsUSD: fica.ss,
    ficaMedicareUSD: fica.medicare,
    additionalMedicareUSD: fica.addMedicare,
    seTaxUSD: seTax,
    niitUSD: niit,
    amtUSD: amtResult.amtUSD,
    tmtUSD: amtResult.tmtUSD,
    amtiUSD: amtResult.amtiUSD,
    amtExemptionUSD: amtResult.amtExemptionUSD,
    amtCreditUsedUSD: amtResult.amtCreditUsedUSD,
    totalFederalTaxUSD: totalFederalTax,
    effectiveRateOverall,
    marginalRateOrdinary,
    marginalRateLTCG,
    ordinaryBracketBreakdown: ord.breakdown,
    ltcgBracketBreakdown: ltcgTax.breakdown,
  };
}

/* ------------------------------------------------------------------ */
/* State tax                                                           */
/* ------------------------------------------------------------------ */

export function computeStateTax(
  inputs: UsTaxInputs,
  federal: FederalResult,
): StateResult {
  const stateData = STATE_BRACKETS_2025[inputs.state];
  const stateName = US_STATE_NAMES[inputs.state];

  // No income tax states (and PR which the calculator doesn't model).
  if (stateData.kind === "none") {
    return {
      state: inputs.state,
      stateName,
      filingStatusUsed: inputs.filingStatus,
      hasIncomeTax: false,
      taxableIncomeUSD: 0,
      stateTaxUSD: 0,
      effectiveRate: 0,
      marginalRate: 0,
      bracketBreakdown: [],
      note: stateData.note,
    };
  }

  // Special case: NH historically only taxed interest + dividends,
  // but the I&D tax is repealed effective Jan 1 2025. Treat as none
  // (the data already does this, but documenting the precedent).

  // State taxable income: a simplified model. Round-7 audit CRITICAL
  // fix — we now start from federal AGI (not federal TAXABLE income),
  // so the FEDERAL standard deduction is not double-subtracted when
  // we then apply the STATE standard deduction below. Most states
  // begin their schedule from federal AGI (or a close cousin) and
  // apply their own state-specific deduction, which is exactly what
  // this approximation now models.
  //
  // Most states treat LTCG as ordinary, so we collapse the two
  // federal taxable streams into a single state-taxable amount.
  const stateStdDed =
    stateData.standardDeduction?.[inputs.filingStatus] ?? 0;
  const taxableIncome = Math.max(0, federal.agiUSD - stateStdDed);

  // Pick the bracket schedule for this filing status. Some states
  // ignore filing status (flat tax) or only have one schedule.
  const filingStatusUsed = stateData.brackets[inputs.filingStatus]
    ? inputs.filingStatus
    : "single";
  const schedule = stateData.brackets[filingStatusUsed] ?? [];

  if (schedule.length === 0) {
    return {
      state: inputs.state,
      stateName,
      filingStatusUsed,
      hasIncomeTax: false,
      taxableIncomeUSD: taxableIncome,
      stateTaxUSD: 0,
      effectiveRate: 0,
      marginalRate: 0,
      bracketBreakdown: [],
      note: stateData.note,
    };
  }

  const { tax, breakdown } = applyBrackets(schedule, taxableIncome, 0);
  const effective = taxableIncome > 0 ? tax / taxableIncome : 0;
  const marginal = marginalRateAt(schedule, taxableIncome);

  return {
    state: inputs.state,
    stateName,
    filingStatusUsed,
    hasIncomeTax: true,
    taxableIncomeUSD: taxableIncome,
    stateTaxUSD: tax,
    effectiveRate: effective,
    marginalRate: marginal,
    bracketBreakdown: breakdown,
    note: stateData.note,
  };
}

/* ------------------------------------------------------------------ */
/* Top-level entry                                                     */
/* ------------------------------------------------------------------ */

export function computeUsTax(inputs: UsTaxInputs): UsTaxResult {
  const federal = computeFederalTax(inputs);
  const state = computeStateTax(inputs, federal);
  const totalTax = federal.totalFederalTaxUSD + state.stateTaxUSD;
  const takeHome = Math.max(0, federal.totalGrossIncomeUSD - totalTax);
  const overall =
    federal.totalGrossIncomeUSD > 0
      ? totalTax / federal.totalGrossIncomeUSD
      : 0;
  return {
    inputs,
    federal,
    state,
    totalTaxUSD: totalTax,
    takeHomeUSD: takeHome,
    overallEffectiveRate: overall,
  };
}

/* ------------------------------------------------------------------ */
/* Empty / default inputs                                              */
/* ------------------------------------------------------------------ */

export const EMPTY_INCOME: IncomeBuckets = {
  wagesUSD: 0,
  selfEmploymentUSD: 0,
  interestIncomeUSD: 0,
  ordinaryDividendsUSD: 0,
  shortTermCapGainsUSD: 0,
  qualifiedDividendsUSD: 0,
  longTermCapGainsUSD: 0,
  otherOrdinaryUSD: 0,
};

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  hoh: "Head of household",
  mfs: "Married filing separately",
};
