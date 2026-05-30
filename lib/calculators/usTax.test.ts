import { describe, expect, it } from "vitest";

import {
  EMPTY_INCOME,
  FEDERAL_LTCG_BRACKETS_2025,
  FEDERAL_ORDINARY_BRACKETS_2025,
  STANDARD_DEDUCTION_2025,
  computeFederalTax,
  computeStateTax,
  computeUsTax,
  type UsTaxInputs,
} from "./usTax";
import { US_STATE_NAMES, type USState } from "./usStateTaxBrackets";

const baseInputs = (overrides: Partial<UsTaxInputs> = {}): UsTaxInputs => ({
  taxYear: 2025,
  filingStatus: "single",
  state: "NONE",
  income: { ...EMPTY_INCOME, ...(overrides.income ?? {}) },
  retirementContribUSD: overrides.retirementContribUSD ?? 0,
  itemizedDeductionUSD:
    overrides.itemizedDeductionUSD === undefined
      ? null
      : overrides.itemizedDeductionUSD,
  ...(overrides.filingStatus !== undefined
    ? { filingStatus: overrides.filingStatus }
    : {}),
  ...(overrides.state !== undefined ? { state: overrides.state } : {}),
  // AMT preference inputs (back-compat optional, default 0).
  ...(overrides.isoBargainElementUSD !== undefined
    ? { isoBargainElementUSD: overrides.isoBargainElementUSD }
    : {}),
  ...(overrides.privateActivityBondInterestUSD !== undefined
    ? {
        privateActivityBondInterestUSD: overrides.privateActivityBondInterestUSD,
      }
    : {}),
  ...(overrides.stateAndLocalTaxItemizedUSD !== undefined
    ? { stateAndLocalTaxItemizedUSD: overrides.stateAndLocalTaxItemizedUSD }
    : {}),
  ...(overrides.priorYearAMTCreditUSD !== undefined
    ? { priorYearAMTCreditUSD: overrides.priorYearAMTCreditUSD }
    : {}),
});

describe("computeFederalTax — zero / boundary cases", () => {
  it("zero income → zero tax for any filing status", () => {
    for (const fs of ["single", "mfj", "hoh", "mfs"] as const) {
      const r = computeFederalTax(baseInputs({ filingStatus: fs }));
      expect(r.totalFederalTaxUSD).toBe(0);
      expect(r.effectiveRateOverall).toBe(0);
      expect(r.marginalRateOrdinary).toBe(0);
    }
  });

  it("NaN-safety: NaN inputs degrade to zero, never NaN/Infinity", () => {
    const r = computeFederalTax({
      taxYear: 2025,
      filingStatus: "single",
      state: "NONE",
      income: {
        wagesUSD: Number.NaN,
        selfEmploymentUSD: Number.NaN,
        interestIncomeUSD: Number.NaN,
        ordinaryDividendsUSD: Number.NaN,
        shortTermCapGainsUSD: Number.NaN,
        qualifiedDividendsUSD: Number.NaN,
        longTermCapGainsUSD: Number.NaN,
        otherOrdinaryUSD: Number.NaN,
      },
      retirementContribUSD: Number.NaN,
      itemizedDeductionUSD: Number.NaN,
    });
    expect(Number.isFinite(r.totalFederalTaxUSD)).toBe(true);
    expect(r.totalFederalTaxUSD).toBe(0);
  });

  it("negative income inputs are clamped to zero", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: -1000 } }),
    );
    expect(r.totalFederalTaxUSD).toBe(0);
  });
});

describe("computeFederalTax — single filer ordinary brackets", () => {
  it("$50k wages, single → known ordinary tax (post standard deduction)", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 50_000 } }),
    );
    // AGI = 50,000; taxable = 50,000 − 15,000 = 35,000
    // Tax: 11,925 × 10% = 1,192.50; (35,000 − 11,925) × 12% = 2,769.00
    // = 3,961.50 federal income tax
    expect(r.taxableOrdinaryIncomeUSD).toBe(35_000);
    expect(r.ordinaryTaxUSD).toBeCloseTo(3_961.5, 2);
    // Plus FICA: SS 50k * 6.2% = 3,100; Medicare 50k * 1.45% = 725
    expect(r.ficaSsUSD).toBeCloseTo(3_100, 2);
    expect(r.ficaMedicareUSD).toBeCloseTo(725, 2);
    expect(r.additionalMedicareUSD).toBe(0);
  });

  it("marginal rate reflects the top occupied bracket", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 200_000 } }),
    );
    // Taxable 185,000 → top of 24% bracket (kicks in at 103,350; ceiling 197,300)
    expect(r.marginalRateOrdinary).toBe(0.24);
  });
});

describe("computeFederalTax — MFJ", () => {
  it("MFJ $100k wages + $20k LTCG: ordinary tax + 0% LTCG fill below threshold", () => {
    const r = computeFederalTax(
      baseInputs({
        filingStatus: "mfj",
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 100_000,
          longTermCapGainsUSD: 20_000,
        },
      }),
    );
    // Ordinary AGI 100k; taxable 100k − 30k = 70,000
    // 10% on 23,850 = 2,385; 12% on (70k − 23,850) = 12% × 46,150 = 5,538
    // Ordinary tax ≈ 7,923
    expect(r.ordinaryTaxUSD).toBeCloseTo(7_923, 2);
    // LTCG starts at $70k stacked; MFJ 0% bracket ends at 96,700
    // → all $20k LTCG falls in 0% bracket
    expect(r.ltcgTaxUSD).toBe(0);
    expect(r.marginalRateLTCG).toBe(0); // top dollar in 0% bracket
  });

  it("MFS bracket thresholds equal single (except top); top kicks in at $375,800", () => {
    expect(FEDERAL_ORDINARY_BRACKETS_2025.mfs[6].threshold).toBe(375_800);
    expect(FEDERAL_ORDINARY_BRACKETS_2025.single[6].threshold).toBe(626_350);
  });
});

describe("computeFederalTax — LTCG stacking", () => {
  it("$20k wages + $80k LTCG single: 0% bracket on most LTCG", () => {
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 20_000,
          longTermCapGainsUSD: 80_000,
        },
      }),
    );
    // AGI = 100k; deduction 15k applied to ordinary first
    // taxableOrdinary = 20k − 15k = 5,000 (all in 10%)
    // Ordinary tax = 500
    expect(r.taxableOrdinaryIncomeUSD).toBe(5_000);
    expect(r.ordinaryTaxUSD).toBeCloseTo(500, 2);
    // LTCG = 80k, stacks at 5k; 0% bracket ends at 48,350
    // → 48,350 − 5,000 = 43,350 of LTCG in 0%
    // → 80,000 − 43,350 = 36,650 at 15% = 5,497.50
    expect(r.ltcgTaxUSD).toBeCloseTo(5_497.5, 2);
  });

  it("wealth-analyze-style example: $40k wages + $50k LTCG single", () => {
    // 2025 brackets:
    //   ordinary taxable = 40k − 15k = 25k
    //   10% on 11,925 = 1,192.50
    //   12% on (25,000 − 11,925) = 12% × 13,075 = 1,569.00
    //   ordinary tax = 2,761.50
    //
    //   LTCG starts at 25k stacked. 0% bracket ends at 48,350.
    //   → 23,350 of LTCG at 0%
    //   → 50,000 − 23,350 = 26,650 at 15% = 3,997.50
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 40_000,
          longTermCapGainsUSD: 50_000,
        },
      }),
    );
    expect(r.taxableOrdinaryIncomeUSD).toBe(25_000);
    expect(r.ordinaryTaxUSD).toBeCloseTo(2_761.5, 2);
    expect(r.ltcgTaxUSD).toBeCloseTo(3_997.5, 2);
  });

  it("LTCG bracket breakdown rows always cover all schedule brackets", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 50_000 } }),
    );
    expect(r.ltcgBracketBreakdown).toHaveLength(
      FEDERAL_LTCG_BRACKETS_2025.single.length,
    );
  });

  it("qualified dividends are taxed at LTCG rates, not ordinary", () => {
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 50_000,
          ordinaryDividendsUSD: 10_000,
          qualifiedDividendsUSD: 10_000,
        },
      }),
    );
    // ordinary divs $10k = qualified divs $10k → 0 non-qual divs
    // ordinaryIncome = 50,000 wages; taxable = 35,000
    // ordTax same as $50k wages alone = 3,961.50
    expect(r.ordinaryTaxUSD).toBeCloseTo(3_961.5, 2);
    // LTCG = $10k qualified divs, stacks at 35k.
    // 0% bracket ends 48,350; 10k all in 0%.
    expect(r.ltcgTaxUSD).toBe(0);
  });
});

describe("computeFederalTax — Medicare / NIIT", () => {
  it("Additional Medicare 0.9% kicks in above threshold for single ($200k)", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 300_000 } }),
    );
    // 100k wages above threshold * 0.9% = 900
    expect(r.additionalMedicareUSD).toBeCloseTo(900, 2);
  });

  it("MFJ Additional Medicare threshold is $250k", () => {
    const r = computeFederalTax(
      baseInputs({
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 300_000 },
      }),
    );
    // 50k above threshold * 0.9% = 450
    expect(r.additionalMedicareUSD).toBeCloseTo(450, 2);
  });

  it("NIIT 3.8% applies to investment income above MAGI threshold", () => {
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 180_000,
          longTermCapGainsUSD: 50_000,
        },
      }),
    );
    // MAGI ≈ 230k. AGI = 180k + 50k = 230k.
    // Above 200k threshold by 30k. NII = 50k.
    // NIIT = 3.8% × min(50k, 30k) = 3.8% × 30k = 1,140
    expect(r.niitUSD).toBeCloseTo(1_140, 2);
  });

  it("No NIIT when investment income is zero", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 500_000 } }),
    );
    expect(r.niitUSD).toBe(0);
  });
});

describe("computeFederalTax — Social Security wage base", () => {
  it("SS portion caps at 2025 wage base ($176,100)", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 300_000 } }),
    );
    expect(r.ficaSsUSD).toBeCloseTo(176_100 * 0.062, 2);
  });

  it("Medicare 1.45% has no cap", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 500_000 } }),
    );
    expect(r.ficaMedicareUSD).toBeCloseTo(500_000 * 0.0145, 2);
  });
});

describe("computeFederalTax — Self-employment", () => {
  it("SE tax = 15.3% of 92.35% of SE income; half is deductible", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, selfEmploymentUSD: 50_000 } }),
    );
    // Net SE = 50,000 * 0.9235 = 46,175
    // SE tax = 46,175 * 0.153 = 7,064.78
    expect(r.seTaxUSD).toBeCloseTo(46_175 * 0.153, 2);
    // Half SE tax deductible → preTaxAdjustments includes that half
    expect(r.preTaxAdjustmentsUSD).toBeCloseTo(r.seTaxUSD / 2, 2);
  });

  it("Self-employed at $100k → known total federal tax", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, selfEmploymentUSD: 100_000 },
      }),
    );
    // Net SE = 92,350; SE tax = 14,129.55
    // Half-SE = 7,064.775
    // ordinaryAfterAdj = 100,000 − 7,064.775 = 92,935.225
    // taxable = 92,935.225 − 15,000 = 77,935.225
    // Tax: 11,925*0.10 + (48,475-11,925)*0.12 + (77,935.225-48,475)*0.22
    //    = 1,192.50 + 4,386.00 + 6,481.35 = 12,059.85 (approx)
    expect(r.seTaxUSD).toBeCloseTo(14_129.55, 2);
    expect(r.ordinaryTaxUSD).toBeCloseTo(12_059.75, 1);
    expect(r.totalFederalTaxUSD).toBeCloseTo(
      r.seTaxUSD + r.ordinaryTaxUSD,
      1,
    );
  });
});

describe("computeFederalTax — Deductions", () => {
  it("itemized > standard → itemized honored", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
        itemizedDeductionUSD: 25_000,
      }),
    );
    expect(r.deductionUSD).toBe(25_000);
    expect(r.deductionSource).toBe("itemized");
  });

  it("itemized < standard → standard wins", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
        itemizedDeductionUSD: 5_000,
      }),
    );
    expect(r.deductionUSD).toBe(STANDARD_DEDUCTION_2025.single);
    expect(r.deductionSource).toBe("standard");
  });

  it("retirement contributions reduce wages above-the-line", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
        retirementContribUSD: 20_000,
      }),
    );
    // AGI = 100k − 20k = 80k; taxable = 80k − 15k = 65k
    expect(r.agiUSD).toBe(80_000);
    expect(r.taxableOrdinaryIncomeUSD).toBe(65_000);
  });

  it("retirement contribution capped at wages (prevents negative AGI)", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 50_000 },
        retirementContribUSD: 100_000,
      }),
    );
    expect(r.agiUSD).toBe(0);
  });
});

describe("computeStateTax — basic categories", () => {
  it("WA → no state income tax (with LTCG note)", () => {
    const r = computeUsTax(
      baseInputs({
        state: "WA",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.state.hasIncomeTax).toBe(false);
    expect(r.state.stateTaxUSD).toBe(0);
    expect(r.state.note).toMatch(/Washington/);
  });

  it("NONE → no state tax", () => {
    const r = computeUsTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 100_000 } }),
    );
    expect(r.state.stateTaxUSD).toBe(0);
  });

  it("CO flat 4.4% applies to federal AGI (no double-counting of federal std ded)", () => {
    const r = computeUsTax(
      baseInputs({
        state: "CO",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    // Round-7 audit CRITICAL fix: state tax base starts from federal
    // AGI ($100k here — no retirement adj, no SE deductible), NOT
    // federal TAXABLE income (which would have subtracted the federal
    // $15k std deduction first). CO has no state std ded modeled →
    // $100k × 4.4% = $4,400. Previously this returned $3,740, silently
    // under-stating state liability by the federal-deduction × state-
    // rate cross-product (here $660).
    expect(r.state.stateTaxUSD).toBeCloseTo(100_000 * 0.044, 2);
  });

  it("CA single $100k wages → progressive brackets applied", () => {
    const r = computeUsTax(
      baseInputs({
        state: "CA",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.state.stateTaxUSD).toBeGreaterThan(0);
    // CA effective rate at this level should be in the single digits
    expect(r.state.effectiveRate).toBeGreaterThan(0.03);
    expect(r.state.effectiveRate).toBeLessThan(0.07);
  });
});

describe("computeUsTax — top-level", () => {
  it("returns federal + state + take-home consistently", () => {
    const r = computeUsTax(
      baseInputs({
        state: "CO",
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 75_000,
          interestIncomeUSD: 500,
        },
      }),
    );
    expect(r.totalTaxUSD).toBeCloseTo(
      r.federal.totalFederalTaxUSD + r.state.stateTaxUSD,
      2,
    );
    expect(r.takeHomeUSD).toBeCloseTo(
      r.federal.totalGrossIncomeUSD - r.totalTaxUSD,
      2,
    );
  });

  it("overall effective rate = totalTax / gross", () => {
    const r = computeUsTax(
      baseInputs({
        state: "CA",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.overallEffectiveRate).toBeCloseTo(
      r.totalTaxUSD / r.federal.totalGrossIncomeUSD,
      6,
    );
  });

  it("doesn't mutate inputs", () => {
    const inputs = baseInputs({
      income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
    });
    const snapshot = JSON.parse(JSON.stringify(inputs));
    computeUsTax(inputs);
    expect(inputs).toEqual(snapshot);
  });

  it("same inputs → same result (reproducibility)", () => {
    const inputs = baseInputs({
      state: "CA",
      income: {
        ...EMPTY_INCOME,
        wagesUSD: 150_000,
        longTermCapGainsUSD: 30_000,
      },
    });
    const a = computeUsTax(inputs);
    const b = computeUsTax(inputs);
    expect(a).toEqual(b);
  });
});

describe("computeStateTax — coverage of all state shapes", () => {
  it("every state's bracket schedules apply cleanly to a $75k wage scenario", () => {
    const allStates = Object.keys(US_STATE_NAMES) as USState[];
    for (const s of allStates) {
      const r = computeUsTax(
        baseInputs({
          state: s,
          income: { ...EMPTY_INCOME, wagesUSD: 75_000 },
        }),
      );
      expect(Number.isFinite(r.state.stateTaxUSD)).toBe(true);
      expect(r.state.stateTaxUSD).toBeGreaterThanOrEqual(0);
      expect(r.totalTaxUSD).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeFederalTax — bracket breakdown integrity", () => {
  it("sum of bracket-row tax = ordinary tax (no rounding drift)", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 250_000 } }),
    );
    const sum = r.ordinaryBracketBreakdown.reduce((acc, b) => acc + b.taxUSD, 0);
    expect(sum).toBeCloseTo(r.ordinaryTaxUSD, 4);
  });

  it("sum of bracket-row income = taxable ordinary income", () => {
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 250_000 } }),
    );
    const sum = r.ordinaryBracketBreakdown.reduce(
      (acc, b) => acc + b.incomeInBracketUSD,
      0,
    );
    expect(sum).toBeCloseTo(r.taxableOrdinaryIncomeUSD, 4);
  });

  it("LTCG breakdown: floors stack ABOVE ordinary taxable income", () => {
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 60_000,
          longTermCapGainsUSD: 30_000,
        },
      }),
    );
    // Total LTCG income in breakdown rows equals taxableLtcg
    const lcgSum = r.ltcgBracketBreakdown.reduce(
      (acc, b) => acc + b.incomeInBracketUSD,
      0,
    );
    expect(lcgSum).toBeCloseTo(r.taxableLtcgUSD, 4);
  });
});

describe("State helper — computeStateTax pure function", () => {
  it("works when called directly with a federal result", () => {
    const inputs = baseInputs({
      state: "CO",
      income: { ...EMPTY_INCOME, wagesUSD: 75_000 },
    });
    const fed = computeFederalTax(inputs);
    const state = computeStateTax(inputs, fed);
    expect(state.stateTaxUSD).toBeGreaterThan(0);
  });
});

describe("Round 3 audit regression — engine fixes", () => {
  it("NIIT does NOT double-count qualified dividends (audit HIGH #3)", () => {
    // Single filer, $250k wages + $20k LTCG + $20k ord divs (all
    // qualified). NIIT applies to investment income above the
    // $200k MAGI threshold. NII = interest($0) + ord divs($20k)
    // + STCG($0) + LTCG($20k) = $40k. NOT 40 + 20 (qual divs
    // are inside ord divs).
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 250_000,
          longTermCapGainsUSD: 20_000,
          ordinaryDividendsUSD: 20_000,
          qualifiedDividendsUSD: 20_000,
        },
      }),
    );
    // MAGI ≈ AGI = $250k wages + $40k investment income = $290k.
    // Excess above $200k = $90k. NII = $40k. NIIT = 3.8% × min(40,
    // 90) = 3.8% × 40 = $1,520. NOT $2,280 (which would be the
    // double-count of qualDivs).
    expect(r.niitUSD).toBeCloseTo(1_520, 0);
  });

  it("SE-SS cap composes with W-2 wages at the cap (audit HIGH #1)", () => {
    // Filer with W-2 wages AT the SS cap ($176,100) + $50k SE
    // income. SE-SS portion should be ZERO (cap already used by
    // wages); only SE-Medicare (2.9%) applies to the SE side.
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 176_100,
          selfEmploymentUSD: 50_000,
        },
      }),
    );
    // SE-Medicare only: $50k × 0.9235 × 2.9% = $1,339.08
    // (NOT including SE-SS portion which is fully shadowed by
    // the wage-side SS already withheld).
    expect(r.seTaxUSD).toBeCloseTo(1_339.08, 1);
  });

  it("retirement contribution cap includes SE net earnings (audit HIGH #4)", () => {
    // Self-employed filer with $0 wages + $80k SE income +
    // $10k retirement contribution. Previously the cap was
    // wages-only → entire $10k was discarded. Now should
    // allow up to ~$70k (SE net earnings post-FICA half-deduction).
    const r = computeFederalTax(
      baseInputs({
        income: {
          ...EMPTY_INCOME,
          selfEmploymentUSD: 80_000,
        },
        retirementContribUSD: 10_000,
      }),
    );
    // AGI should be reduced by $10k. Quick sanity: with $80k SE,
    // SE tax ≈ $80k × 0.9235 × 15.3% = $11,304. Half deductible
    // = $5,652. With $10k retire deducted too → AGI = $80k -
    // $5,652 - $10,000 = $64,348.
    expect(r.agiUSD).toBeCloseTo(64_348, 0);
  });
});

describe("Round 7 audit regression — state tax engine fixes", () => {
  it("MA Millionaires Tax: 9% applies above $1M (audit R7 CRITICAL #1)", () => {
    // Single MA filer with $1.5M ordinary income. Previously MA was
    // modeled as a flat 5% → underreported tax by 4% × $500k = $20k.
    // Now: first $1M at 5% = $50k; next $500k at 9% = $45k; total $95k.
    // (State stdDed not modeled for MA; verify by simulation rather
    // than precise number to allow for tiny rounding.)
    const r = computeUsTax(
      baseInputs({
        state: "MA",
        income: { ...EMPTY_INCOME, wagesUSD: 1_500_000 },
      }),
    );
    // State tax base = federal AGI ≈ $1.5M (no adjustments here).
    // Expected MA tax: $50k + $45k = $95k (± small from any modeled
    // state deduction).
    expect(r.state.stateTaxUSD).toBeGreaterThan(94_000);
    expect(r.state.stateTaxUSD).toBeLessThan(96_000);
    // Marginal rate at the top should reflect the 9% surtax bracket.
    expect(r.state.marginalRate).toBeCloseTo(0.09, 5);
  });

  it("MA below $1M is flat 5% (sanity for the surtax)", () => {
    const r = computeUsTax(
      baseInputs({
        state: "MA",
        income: { ...EMPTY_INCOME, wagesUSD: 500_000 },
      }),
    );
    // $500k × 5% = $25k (state base = AGI = $500k, no MA std ded
    // modeled).
    expect(r.state.stateTaxUSD).toBeCloseTo(25_000, 0);
    expect(r.state.marginalRate).toBeCloseTo(0.05, 5);
  });

  it("AR post-2024 reform brackets are monotonic (audit R7 CRITICAL #2)", () => {
    // The OLD schedule was non-monotonic: 0.04 then 0.039 across
    // $4,400 and $8,800. Now we use the post-Act-532 schedule with
    // a clean monotonic 0 → 2 → 3 → 3.4 → 3.9%.
    const wagesUSD = 100_000;
    const r = computeUsTax(
      baseInputs({
        state: "AR",
        income: { ...EMPTY_INCOME, wagesUSD },
      }),
    );
    // Marginal rate at $100k should be the top 3.9%.
    expect(r.state.marginalRate).toBeCloseTo(0.039, 5);
    // Sanity: tax should be < 3.9% × $100k (because lower brackets
    // are lower rates) and > 3.4% × $100k − $1k (lots of income at top).
    expect(r.state.stateTaxUSD).toBeLessThan(0.039 * wagesUSD);
    expect(r.state.stateTaxUSD).toBeGreaterThan(0.034 * wagesUSD - 1_000);
  });

  it("state tax base = federal AGI, not federal taxable income (audit R7 CRITICAL #3)", () => {
    // The previous code used `federal.taxableOrdinaryIncomeUSD +
    // federal.taxableLtcgUSD` — which had the FEDERAL standard
    // deduction subtracted — as the state base. When the state then
    // applied its OWN standard deduction (or none), the federal
    // std ded was effectively double-counted. Switching to AGI fixes
    // it.
    //
    // CO has no state std ded modeled, so the test is precise:
    // wages $100k → AGI $100k → state tax $100k × 4.4% = $4,400.
    const r = computeUsTax(
      baseInputs({
        state: "CO",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.state.stateTaxUSD).toBeCloseTo(100_000 * 0.044, 2);
  });

  it("MD MFJ schedule uses joint thresholds, not single (audit R7 HIGH H3)", () => {
    // $300k MFJ. Under the OLD code MFJ fell back to the single
    // schedule, so brackets shifted upward at $250k → top 5.75%.
    // Under the actual MD joint schedule, 5.75% doesn't kick in
    // until $300k — so on $300k income, MFJ marginal is 5.5%,
    // not 5.75%.
    const r = computeUsTax(
      baseInputs({
        state: "MD",
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 300_000 },
      }),
    );
    expect(r.state.marginalRate).toBeCloseTo(0.055, 5);
    // And $400k MFJ should hit 5.75% (the new joint top bracket).
    const r2 = computeUsTax(
      baseInputs({
        state: "MD",
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
      }),
    );
    expect(r2.state.marginalRate).toBeCloseTo(0.0575, 5);
  });

  it("CA MFJ above $1M includes MHST and stays monotonic (audit R7 MED M1)", () => {
    // $1.2M MFJ income. Regular MFJ top bracket of 12.3% doesn't
    // kick in until $1.44M, so $1.2M falls in the 11.3% regular
    // bracket — but per-return MHST adds 1% above $1M → 12.3%.
    const r = computeUsTax(
      baseInputs({
        state: "CA",
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 1_200_000 },
      }),
    );
    expect(r.state.marginalRate).toBeCloseTo(0.123, 5);

    // $1.5M MFJ should hit the full 13.3% (12.3% regular + 1% MHST).
    const r2 = computeUsTax(
      baseInputs({
        state: "CA",
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 1_500_000 },
      }),
    );
    expect(r2.state.marginalRate).toBeCloseTo(0.133, 5);
  });

  it("GA rate reflects 2025 HB-1015 reduction to 5.19% (audit R7 MED M4)", () => {
    const r = computeUsTax(
      baseInputs({
        state: "GA",
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.state.marginalRate).toBeCloseTo(0.0519, 5);
  });

  it("every state bracket schedule is monotonically non-decreasing (cross-cutting property)", () => {
    // Pin the invariant the AR + CA-MFJ bugs both violated: the
    // bracket walker assumes thresholds increase monotonically. Any
    // future stale-rate edit that breaks this is caught here.
    const STATES = Object.keys(US_STATE_NAMES) as USState[];
    const statuses = ["single", "mfj", "hoh", "mfs"] as const;
    for (const state of STATES) {
      for (const status of statuses) {
        const r = computeUsTax(
          baseInputs({
            state,
            filingStatus: status,
            income: { ...EMPTY_INCOME, wagesUSD: 50_000 },
          }),
        );
        const breakdown = r.state.bracketBreakdown;
        for (let i = 1; i < breakdown.length; i++) {
          // Rates within a single state schedule must not decrease.
          // (We compare bracket-row rates pulled from breakdown.)
          if (breakdown[i].rate < breakdown[i - 1].rate) {
            throw new Error(
              `Non-monotonic bracket in ${state} ${status}: rate dropped from ${breakdown[i - 1].rate} to ${breakdown[i].rate}`,
            );
          }
        }
      }
    }
  });
});

describe("computeFederalTax — AMT (Alternative Minimum Tax)", () => {
  it("zero AMT for a middle-income single filer with no preference items (post-TCJA reality)", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 100_000 },
      }),
    );
    expect(r.amtUSD).toBe(0);
    // AMTI = taxable ordinary + LTCG (= 100k - $15,750 std ded = ~$84,250).
    expect(r.amtiUSD).toBeCloseTo(100_000 - STANDARD_DEDUCTION_2025.single, 0);
    // Exemption at the full $88,100 (well below the phase-out threshold).
    expect(r.amtExemptionUSD).toBe(88_100);
    // TMT is 0 here because AMTI ($84,250) is below the exemption
    // ($88,100) — AMTI excess is 0, no AMT due.
    expect(r.tmtUSD).toBe(0);
  });

  it("zero AMT for a high-W2 single filer ($500k wages, no preferences)", () => {
    // Even at $500k wages, regular tax >> TMT (no preference items
    // → AMTI ≈ taxable, exemption mostly intact, TMT 26%/28% on a
    // smallish base). Post-TCJA the SALT-cap-era AMT is rare here.
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 500_000 },
      }),
    );
    expect(r.amtUSD).toBe(0);
  });

  it("AMT triggers on ISO bargain element exposure (the #1 real-world trigger)", () => {
    // Single filer, $150K wages + $400K ISO bargain element →
    // AMTI ~= taxable + 400K, regular tax is computed only on
    // the $150K wages (since ISO exercise without sale is NOT
    // a regular-tax event), so TMT >> regular tax → real AMT.
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 150_000 },
        isoBargainElementUSD: 400_000,
      }),
    );
    expect(r.amtUSD).toBeGreaterThan(0);
    expect(r.amtiUSD).toBeGreaterThan(150_000 + 400_000 - 20_000);
    // Total tax includes the AMT add-on.
    expect(r.totalFederalTaxUSD).toBeGreaterThan(
      r.ordinaryTaxUSD + r.ltcgTaxUSD + r.ficaSsUSD + r.ficaMedicareUSD,
    );
  });

  it("AMT exemption phases out at high AMTI (very-high-income filer)", () => {
    // MFJ couple with $2M of W2 + $500K ISO bargain → AMTI is
    // well above the $1.252M phase-out threshold, exemption
    // should be heavily reduced or zero.
    const r = computeFederalTax(
      baseInputs({
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 2_000_000 },
        isoBargainElementUSD: 500_000,
      }),
    );
    // Base MFJ exemption = $137,000. Phase-out starts at $1.252M.
    // AMTI = ~$2M + $500K - std deduction = ~$2.47M (above
    // threshold by ~$1.21M; phase-out reduces exemption by
    // 25% of that ≈ $303K → exemption is fully zeroed).
    expect(r.amtExemptionUSD).toBe(0);
  });

  it("private activity bond interest adds to AMTI even when tax-exempt for regular tax", () => {
    // Tax-exempt PAB interest is the second-most-common AMT
    // preference. Regular tax treats it as $0 income; AMT
    // adds it back.
    const baseline = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
      }),
    );
    const withPAB = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        privateActivityBondInterestUSD: 100_000,
      }),
    );
    // Regular tax doesn't change (PAB interest still tax-exempt
    // for regular tax). AMTI does change.
    expect(withPAB.ordinaryTaxUSD).toBe(baseline.ordinaryTaxUSD);
    expect(withPAB.amtiUSD).toBeGreaterThan(baseline.amtiUSD);
  });

  it("AMT exposure on ISO exercise scales roughly with the bargain element size", () => {
    // Property-style sanity check: as ISO bargain element grows,
    // AMT exposure grows monotonically (or stays flat at 0).
    const variants = [0, 100_000, 300_000, 500_000].map((iso) =>
      computeFederalTax(
        baseInputs({
          income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
          isoBargainElementUSD: iso,
        }),
      ),
    );
    for (let i = 1; i < variants.length; i++) {
      expect(variants[i].amtUSD).toBeGreaterThanOrEqual(
        variants[i - 1].amtUSD,
      );
    }
  });

  it("LTCG portion of AMTI keeps preferential rate (no 26/28% on LTCG)", () => {
    // Single filer: $50K wages + $200K LTCG (no preferences).
    // Regular tax: ordinary on $50K - $15.75K std ded; LTCG at 15%.
    // AMT: AMTI excess includes the LTCG, but LTCG taxed at 15%
    // not 26/28%. With $200K LTCG, TMT(LTCG portion) ≈ $30K
    // which roughly matches regular LTCG tax → no AMT.
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 50_000, longTermCapGainsUSD: 200_000 },
      }),
    );
    // Regular LTCG tax (most of LTCG at 15%) and TMT-LTCG (also
    // 15%) match closely; AMT should be near zero.
    expect(r.amtUSD).toBeLessThan(5000);
  });

  it("SALT add-back for itemizers (round-5 audit BLOCK)", () => {
    // High earner in CA/NY using itemized deduction including
    // SALT capped at $10K. AMT engine must add back the $10K to
    // AMTI per Form 6251 line 2a.
    const baseline = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
        itemizedDeductionUSD: 60_000, // high itemized (mortgage + SALT)
      }),
    );
    const withSALT = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
        itemizedDeductionUSD: 60_000,
        stateAndLocalTaxItemizedUSD: 10_000,
      }),
    );
    // AMTI should be exactly $10K higher with the add-back.
    expect(withSALT.amtiUSD - baseline.amtiUSD).toBeCloseTo(10_000, 0);
  });

  it("SALT add-back capped at $10K even when input exceeds (TCJA cap)", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
        itemizedDeductionUSD: 60_000,
        stateAndLocalTaxItemizedUSD: 50_000, // way over cap
      }),
    );
    const baseline = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
        itemizedDeductionUSD: 60_000,
      }),
    );
    expect(r.amtiUSD - baseline.amtiUSD).toBeCloseTo(10_000, 0); // capped
  });

  it("SALT add-back ignored when using standard deduction (no SALT was deducted)", () => {
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
        // itemizedDeductionUSD: undefined → standard deduction
        stateAndLocalTaxItemizedUSD: 10_000, // ignored
      }),
    );
    const baseline = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 400_000 },
      }),
    );
    expect(r.amtiUSD).toBe(baseline.amtiUSD);
  });

  it("prior-year AMT credit reduces regular tax up to the AMT headroom (Form 8801)", () => {
    // User had AMT exposure last year, paid $20K AMT, gets it
    // as a credit this year. This year: no AMT triggers, regular
    // tax has ~$15K headroom above TMT → credit reduces regular
    // tax by $15K (the rest carries forward).
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        priorYearAMTCreditUSD: 20_000,
      }),
    );
    expect(r.amtUSD).toBe(0); // no AMT this year
    // Credit applied, up to headroom.
    expect(r.amtCreditUsedUSD).toBeGreaterThan(0);
    expect(r.amtCreditUsedUSD).toBeLessThanOrEqual(20_000);
  });

  it("prior-year AMT credit unused when AMT is owed (no headroom)", () => {
    // ISO trigger creates AMT exposure this year → no headroom →
    // credit fully carries forward.
    const r = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        isoBargainElementUSD: 300_000,
        priorYearAMTCreditUSD: 50_000,
      }),
    );
    expect(r.amtUSD).toBeGreaterThan(0);
    expect(r.amtCreditUsedUSD).toBe(0); // no headroom
  });

  it("AMT inputs are back-compat optional — callers omitting them get isoBargainElement=0", () => {
    // Existing callers (before the AMT feature) don't pass the
    // new ISO / PAB fields. They must still produce a valid
    // result with AMT = 0 and no NaN propagation.
    const r = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: 150_000 } }),
    );
    expect(r.amtUSD).toBe(0);
    expect(Number.isFinite(r.totalFederalTaxUSD)).toBe(true);
  });

  // ── Round-5 deferred audit: boundary + symmetry + additivity ──

  it("MFJ AMT equals 2× single MFS AMT at identical total income (no MFS-split advantage)", () => {
    // MFS breakpoint is half of MFJ by IRS design — splitting an
    // MFJ return into two MFS returns should NOT reduce AMT.
    // Pin this so a future MFS-breakpoint edit can't break it.
    const mfj = computeFederalTax(
      baseInputs({
        filingStatus: "mfj",
        income: { ...EMPTY_INCOME, wagesUSD: 600_000 },
        isoBargainElementUSD: 1_000_000,
      }),
    );
    const mfs = computeFederalTax(
      baseInputs({
        filingStatus: "mfs",
        income: { ...EMPTY_INCOME, wagesUSD: 300_000 },
        isoBargainElementUSD: 500_000,
      }),
    );
    // TMT (the bracket math output) should match: MFJ TMT ===
    // 2 × MFS TMT within float tolerance.
    expect(mfj.tmtUSD).toBeCloseTo(2 * mfs.tmtUSD, 0);
  });

  it("ISO bargain element + PAB interest add linearly to AMTI (no double-count, no interaction)", () => {
    const baseline = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
      }),
    );
    const isoOnly = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        isoBargainElementUSD: 100_000,
      }),
    );
    const pabOnly = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        privateActivityBondInterestUSD: 50_000,
      }),
    );
    const both = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: 200_000 },
        isoBargainElementUSD: 100_000,
        privateActivityBondInterestUSD: 50_000,
      }),
    );
    // AMTI delta from ISO alone:
    const isoAmtiDelta = isoOnly.amtiUSD - baseline.amtiUSD;
    // AMTI delta from PAB alone:
    const pabAmtiDelta = pabOnly.amtiUSD - baseline.amtiUSD;
    // Combined delta = sum (linearity holds).
    expect(both.amtiUSD - baseline.amtiUSD).toBeCloseTo(
      isoAmtiDelta + pabAmtiDelta,
      0,
    );
  });

  it("phase-out boundary: exemption full at threshold − $1, reduced by $0.25 at threshold + $1", () => {
    // Single phase-out starts at $626,350. At AMTI = $626,349,
    // exemption = full $88,100. At AMTI = $626,351, exemption =
    // $88,100 − ($1 × 0.25) = $88,099.75.
    //
    // We can't directly construct AMTI = X (it's derived from
    // wages - deductions + preferences), so engineer wages
    // that put AMTI close to the boundary, then verify the
    // exemption tier reflects the boundary.
    const single = process.env.STANDARD_DEDUCTION_2025_SINGLE
      ? Number(process.env.STANDARD_DEDUCTION_2025_SINGLE)
      : STANDARD_DEDUCTION_2025.single;
    // Wages such that taxable ordinary = phaseoutStart − 1 → AMTI
    // also = phaseoutStart − 1 (no LTCG, no preferences).
    const wagesAtBoundary = 626_350 - 1 + single;
    const below = computeFederalTax(
      baseInputs({ income: { ...EMPTY_INCOME, wagesUSD: wagesAtBoundary } }),
    );
    expect(below.amtExemptionUSD).toBe(88_100);
    // Wages 2 over: amti = phaseoutStart + 1 → exemption reduced
    // by 0.25 × 1 = 0.25.
    const above = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: wagesAtBoundary + 2 },
      }),
    );
    expect(above.amtExemptionUSD).toBeCloseTo(88_100 - 0.25, 2);
  });

  it("26%/28% breakpoint: $1 below = all 26%; $1 above = 26% then 28%", () => {
    // Construct AMTI excess straddling the $239,100 breakpoint.
    // Use ISO bargain element to inflate AMTI cleanly.
    // taxableOrdinary = 0 + ISO = AMTI = $239,100 + exemption $88,100 = $327,200
    // Wages such that taxableOrdinary ~ 0 + std ded.
    const single = STANDARD_DEDUCTION_2025.single;
    // At excess = 239,100 (just at top of 26% bucket): all 26%.
    const at = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: single }, // wages = std ded → taxableOrdinary = 0
        isoBargainElementUSD: 239_100 + 88_100,
      }),
    );
    // tmt_ordinary = 239,100 * 0.26 = 62,166
    expect(at.tmtUSD).toBeCloseTo(62_166, 0);
    // At excess = 239,101: first 239,100 at 26%, next $1 at 28%.
    const over = computeFederalTax(
      baseInputs({
        income: { ...EMPTY_INCOME, wagesUSD: single },
        isoBargainElementUSD: 239_101 + 88_100,
      }),
    );
    // delta = 0.28
    expect(over.tmtUSD - at.tmtUSD).toBeCloseTo(0.28, 2);
  });

  it("NIIT applies on top of AMT (independent §1411 tax)", () => {
    // ISO trigger creates AMT + LTCG triggers NIIT.
    // Verify total = ordinary + LTCG + FICA + NIIT + AMT (no
    // substitution of AMT for any other tax).
    const r = computeFederalTax(
      baseInputs({
        filingStatus: "mfj",
        income: {
          ...EMPTY_INCOME,
          wagesUSD: 500_000,
          longTermCapGainsUSD: 100_000,
        },
        isoBargainElementUSD: 300_000,
      }),
    );
    expect(r.amtUSD).toBeGreaterThan(0);
    expect(r.niitUSD).toBeGreaterThan(0);
    // Sum reconciles to within $1 (float).
    const reconciled =
      r.ordinaryTaxUSD +
      r.ltcgTaxUSD +
      r.ficaSsUSD +
      r.ficaMedicareUSD +
      r.additionalMedicareUSD +
      r.seTaxUSD +
      r.niitUSD +
      r.amtUSD -
      r.amtCreditUsedUSD;
    expect(reconciled).toBeCloseTo(r.totalFederalTaxUSD, 1);
  });
});
