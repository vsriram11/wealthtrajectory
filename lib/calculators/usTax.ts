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
 *   - AMT (Alternative Minimum Tax).
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

function computeSETax(seIncome: number): {
  seTax: number;
  deductible: number;
} {
  if (seIncome <= 0) return { seTax: 0, deductible: 0 };
  const netSe = seIncome * SE_INCOME_FACTOR;
  // SS portion is capped at the wage base too. Per Schedule SE, the
  // SS portion is capped at SS_WAGE_BASE − wages already subject to
  // SS. We don't have that linkage here at v1 — typical SE filers
  // don't ALSO have wages near the cap. Approximation: cap SS portion
  // independently. Documented limitation.
  const ssPortion = Math.min(netSe, SS_WAGE_BASE_2025) * SE_SS_RATE;
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
  const { seTax, deductible: seDeductible } = computeSETax(seInc);

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
  // Above-the-line: retirement contributions (capped at wages to
  // avoid going negative — UI also validates), half of SE tax.
  const retireAdj = Math.min(retire, wages);
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
  // Net investment income (NII) = interest + ord divs + STCG + LTCG +
  // qualified divs. (SE income is NOT investment income; rental can
  // be, but we approximate by excluding `otherOrdinary`.)
  const nii =
    interest + ordDivs + stcg + ltcg + qualDivs;
  const niit = computeNIIT(nii, agi, filingStatus);

  const totalFederalTax =
    ord.tax +
    ltcgTax.tax +
    fica.ss +
    fica.medicare +
    fica.addMedicare +
    seTax +
    niit;

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

  // State taxable income: a simplified model — we use federal taxable
  // income (ordinary + LTCG, since most states treat LTCG as ordinary)
  // minus the state standard deduction. This is a deliberate
  // simplification documented in the disclosures.
  const federalTaxableTotal =
    federal.taxableOrdinaryIncomeUSD + federal.taxableLtcgUSD;
  const stateStdDed =
    stateData.standardDeduction?.[inputs.filingStatus] ?? 0;
  const taxableIncome = Math.max(0, federalTaxableTotal - stateStdDed);

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
