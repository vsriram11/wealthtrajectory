/**
 * US state income tax brackets — 2025 tax year.
 *
 * Categorization
 *   - "none": no state income tax (AK, FL, NV, SD, TN, TX, WA, WY,
 *     NH (I&D tax repealed effective 2025)).
 *   - "flat": single rate applied to (taxable income − state standard
 *     deduction). Examples: CO 4.4%, MA 5%, PA 3.07%.
 *   - "progressive": filing-status-dependent bracket schedule. Some
 *     states use the same schedule for all filers; others widen MFJ
 *     brackets (typically 2× single).
 *
 * Simplifications (documented in UI disclosures)
 *   - State taxable income is approximated as federal taxable income
 *     minus the state standard deduction. No state-specific personal
 *     exemptions, no Schedule M-style add-backs, no QBI conformity,
 *     no SALT-cap-workaround pass-through entity elections.
 *   - All capital gains taxed at state's ordinary rates EXCEPT for
 *     "none" states. WA's 7% LTCG-only tax (with $270k threshold and
 *     primary-residence exclusion) is acknowledged in a note but not
 *     modeled — most households don't hit it.
 *   - Local income taxes (NYC, Yonkers, Philadelphia, SF, Detroit,
 *     Indiana / Ohio / Kentucky / Pennsylvania municipalities) are
 *     not modeled.
 *   - California's 1.1% Mental Health Services Tax (MHST) surcharge
 *     above $1M is rolled into the top bracket (effectively making
 *     it 13.3% + 1.1% = 14.4% modeled at the top).
 *
 * Sources: each state's Department of Revenue / Tax Department 2025
 * published inflation-adjusted rate schedules. Where 2025 numbers
 * were not yet published at compile time, 2024 figures are used with
 * a TODO comment — flat-rate states are stable and accurate; the
 * progressive states use the most recent published brackets.
 */

import type { FilingStatus } from "./usTax";

export type USState =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA"
  | "ME" | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE"
  | "NV" | "NH" | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK"
  | "OR" | "PA" | "RI" | "SC" | "SD" | "TN" | "TX" | "UT" | "VT"
  | "VA" | "WA" | "WV" | "WI" | "WY" | "DC" | "PR" | "NONE";

export const US_STATE_NAMES: Record<USState, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
  PR: "Puerto Rico",
  NONE: "No state",
};

export type StateBracket = { rate: number; threshold: number };

/**
 * State data shape:
 *   - "none": no income tax.
 *   - "data": brackets by filing status + optional standard deduction.
 *     If a filing-status key is missing, the calculator falls back to
 *     "single" (covers flat-tax states that have only one schedule).
 */
export type StateData =
  | { kind: "none"; note?: string }
  | {
      kind: "flat" | "progressive";
      brackets: Partial<Record<FilingStatus, StateBracket[]>>;
      standardDeduction?: Partial<Record<FilingStatus, number>>;
      note?: string;
    };

/**
 * Flat-tax helper: returns a single-bracket schedule at the given rate.
 */
function flat(rate: number): StateBracket[] {
  return [{ rate, threshold: 0 }];
}

/**
 * Build a flat-tax state entry with the same rate for all filing
 * statuses. Standard deductions (if any) are filing-status-specific.
 */
function flatState(
  rate: number,
  standardDeduction?: Partial<Record<FilingStatus, number>>,
  note?: string,
): StateData {
  return {
    kind: "flat",
    brackets: {
      single: flat(rate),
      mfj: flat(rate),
      hoh: flat(rate),
      mfs: flat(rate),
    },
    standardDeduction,
    note,
  };
}

/**
 * Build a progressive state entry where MFJ thresholds = 2× single
 * (and HoH / MFS = single). Common pattern when a state hasn't
 * published filing-status-specific brackets.
 */
function progressiveSimple(
  singleBrackets: StateBracket[],
  options?: {
    mfjDoubled?: boolean;
    standardDeduction?: Partial<Record<FilingStatus, number>>;
    note?: string;
  },
): StateData {
  const mfjDoubled = options?.mfjDoubled ?? false;
  const mfjBrackets = mfjDoubled
    ? singleBrackets.map((b) => ({ rate: b.rate, threshold: b.threshold * 2 }))
    : singleBrackets;
  return {
    kind: "progressive",
    brackets: {
      single: singleBrackets,
      mfj: mfjBrackets,
      hoh: singleBrackets,
      mfs: singleBrackets,
    },
    standardDeduction: options?.standardDeduction,
    note: options?.note,
  };
}

export const STATE_BRACKETS_2025: Record<USState, StateData> = {
  /* ------------------- No income tax ------------------- */
  AK: { kind: "none" },
  FL: { kind: "none" },
  NV: { kind: "none" },
  SD: { kind: "none" },
  TN: { kind: "none" },
  TX: { kind: "none" },
  WA: {
    kind: "none",
    note: "Washington has no income tax on wages. It does levy a 7% capital-gains tax on LTCG above $270k (with primary-residence exclusion), which this calculator does not model.",
  },
  WY: { kind: "none" },
  NH: {
    kind: "none",
    note: "New Hampshire's interest & dividends tax was repealed effective January 1, 2025.",
  },
  NONE: { kind: "none", note: "No state income tax applied." },
  PR: {
    kind: "none",
    note: "Puerto Rico is not modeled; PR residents file under a separate territorial tax system.",
  },

  /* --------------------- Flat tax ---------------------- */
  AZ: flatState(0.025),
  CO: flatState(0.044),
  GA: flatState(0.0539),
  IL: flatState(0.0495, undefined, "Illinois exempts retirement income."),
  IN: flatState(0.030, undefined, "Indiana also levies county income tax (1-3%) not modeled here."),
  IA: flatState(0.038),
  KY: flatState(0.040),
  MA: flatState(
    0.05,
    undefined,
    "Massachusetts adds a 4% surtax on income above $1M (not modeled).",
  ),
  MI: flatState(0.0425, undefined, "Michigan also levies city income tax in select cities (not modeled)."),
  MS: flatState(0.044, { single: 2_300, mfj: 4_600, hoh: 3_400, mfs: 2_300 }),
  MO: flatState(0.047),
  MT: flatState(0.059),
  NE: flatState(0.0584),
  NC: flatState(0.0425),
  PA: flatState(
    0.0307,
    undefined,
    "Pennsylvania uses a unique tax base (no federal-style deductions). Approximation here.",
  ),
  UT: flatState(0.0455),

  /* ------------------- Progressive --------------------- */

  // Alabama
  AL: progressiveSimple(
    [
      { rate: 0.02, threshold: 0 },
      { rate: 0.04, threshold: 500 },
      { rate: 0.05, threshold: 3_000 },
    ],
    {
      mfjDoubled: true,
      standardDeduction: { single: 3_000, mfj: 8_500, hoh: 5_200, mfs: 4_250 },
    },
  ),

  // Arkansas
  AR: progressiveSimple([
    { rate: 0.02, threshold: 0 },
    { rate: 0.04, threshold: 4_400 },
    { rate: 0.039, threshold: 8_800 },
  ], { standardDeduction: { single: 2_410, mfj: 4_820, hoh: 2_410, mfs: 2_410 } }),

  // California (2024 schedule used as 2025 placeholder — FTB
  // typically publishes after October). Includes the 1% MHST roll-up
  // at the top.
  CA: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.01, threshold: 0 },
        { rate: 0.02, threshold: 10_756 },
        { rate: 0.04, threshold: 25_499 },
        { rate: 0.06, threshold: 40_245 },
        { rate: 0.08, threshold: 55_866 },
        { rate: 0.093, threshold: 70_606 },
        { rate: 0.103, threshold: 360_659 },
        { rate: 0.113, threshold: 432_787 },
        { rate: 0.123, threshold: 721_314 },
        { rate: 0.133, threshold: 1_000_000 }, // 12.3% + 1% MHST
      ],
      mfj: [
        { rate: 0.01, threshold: 0 },
        { rate: 0.02, threshold: 21_512 },
        { rate: 0.04, threshold: 50_998 },
        { rate: 0.06, threshold: 80_490 },
        { rate: 0.08, threshold: 111_732 },
        { rate: 0.093, threshold: 141_212 },
        { rate: 0.103, threshold: 721_318 },
        { rate: 0.113, threshold: 865_574 },
        { rate: 0.123, threshold: 1_442_628 },
        { rate: 0.133, threshold: 2_000_000 },
      ],
      hoh: [
        { rate: 0.01, threshold: 0 },
        { rate: 0.02, threshold: 21_527 },
        { rate: 0.04, threshold: 51_000 },
        { rate: 0.06, threshold: 65_744 },
        { rate: 0.08, threshold: 81_364 },
        { rate: 0.093, threshold: 96_107 },
        { rate: 0.103, threshold: 490_493 },
        { rate: 0.113, threshold: 588_593 },
        { rate: 0.123, threshold: 980_987 },
        { rate: 0.133, threshold: 1_000_000 },
      ],
      mfs: [
        { rate: 0.01, threshold: 0 },
        { rate: 0.02, threshold: 10_756 },
        { rate: 0.04, threshold: 25_499 },
        { rate: 0.06, threshold: 40_245 },
        { rate: 0.08, threshold: 55_866 },
        { rate: 0.093, threshold: 70_606 },
        { rate: 0.103, threshold: 360_659 },
        { rate: 0.113, threshold: 432_787 },
        { rate: 0.123, threshold: 721_314 },
        { rate: 0.133, threshold: 1_000_000 },
      ],
    },
    standardDeduction: { single: 5_540, mfj: 11_080, hoh: 11_080, mfs: 5_540 },
    note: "California's 1.1% Mental Health Services Tax surcharge above $1M is approximated within the top bracket. Does not model the 7-day SALT cap workaround PTE election.",
  },

  // Connecticut
  CT: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.02, threshold: 0 },
        { rate: 0.045, threshold: 10_000 },
        { rate: 0.055, threshold: 50_000 },
        { rate: 0.06, threshold: 100_000 },
        { rate: 0.065, threshold: 200_000 },
        { rate: 0.069, threshold: 250_000 },
        { rate: 0.0699, threshold: 500_000 },
      ],
      mfj: [
        { rate: 0.02, threshold: 0 },
        { rate: 0.045, threshold: 20_000 },
        { rate: 0.055, threshold: 100_000 },
        { rate: 0.06, threshold: 200_000 },
        { rate: 0.065, threshold: 400_000 },
        { rate: 0.069, threshold: 500_000 },
        { rate: 0.0699, threshold: 1_000_000 },
      ],
      hoh: [
        { rate: 0.02, threshold: 0 },
        { rate: 0.045, threshold: 16_000 },
        { rate: 0.055, threshold: 80_000 },
        { rate: 0.06, threshold: 160_000 },
        { rate: 0.065, threshold: 320_000 },
        { rate: 0.069, threshold: 400_000 },
        { rate: 0.0699, threshold: 800_000 },
      ],
      mfs: [
        { rate: 0.02, threshold: 0 },
        { rate: 0.045, threshold: 10_000 },
        { rate: 0.055, threshold: 50_000 },
        { rate: 0.06, threshold: 100_000 },
        { rate: 0.065, threshold: 200_000 },
        { rate: 0.069, threshold: 250_000 },
        { rate: 0.0699, threshold: 500_000 },
      ],
    },
  },

  // Delaware
  DE: progressiveSimple([
    { rate: 0.0, threshold: 0 },
    { rate: 0.022, threshold: 2_000 },
    { rate: 0.039, threshold: 5_000 },
    { rate: 0.048, threshold: 10_000 },
    { rate: 0.052, threshold: 20_000 },
    { rate: 0.0555, threshold: 25_000 },
    { rate: 0.066, threshold: 60_000 },
  ]),

  // Hawaii
  HI: progressiveSimple(
    [
      { rate: 0.014, threshold: 0 },
      { rate: 0.032, threshold: 2_400 },
      { rate: 0.055, threshold: 4_800 },
      { rate: 0.064, threshold: 9_600 },
      { rate: 0.068, threshold: 14_400 },
      { rate: 0.072, threshold: 19_200 },
      { rate: 0.076, threshold: 24_000 },
      { rate: 0.079, threshold: 36_000 },
      { rate: 0.0825, threshold: 48_000 },
      { rate: 0.09, threshold: 150_000 },
      { rate: 0.10, threshold: 175_000 },
      { rate: 0.11, threshold: 200_000 },
    ],
    { mfjDoubled: true, standardDeduction: { single: 4_400, mfj: 8_800, hoh: 6_424, mfs: 4_400 } },
  ),

  // Idaho — flat 5.695% post-2023 reform.
  ID: flatState(0.05695),

  // Kansas
  KS: progressiveSimple(
    [
      { rate: 0.052, threshold: 0 },
      { rate: 0.0558, threshold: 23_000 },
    ],
    { standardDeduction: { single: 3_500, mfj: 8_000, hoh: 6_000, mfs: 3_500 } },
  ),

  // Louisiana — flat 3% effective 2025 (post-reform).
  LA: flatState(
    0.03,
    { single: 12_500, mfj: 25_000, hoh: 12_500, mfs: 12_500 },
    "Louisiana switched to a flat 3% tax effective January 1, 2025.",
  ),

  // Maine
  ME: progressiveSimple([
    { rate: 0.058, threshold: 0 },
    { rate: 0.0675, threshold: 26_800 },
    { rate: 0.0715, threshold: 63_450 },
  ], {
    mfjDoubled: true,
    standardDeduction: { single: 14_600, mfj: 29_200, hoh: 21_900, mfs: 14_600 },
  }),

  // Maryland
  MD: progressiveSimple(
    [
      { rate: 0.02, threshold: 0 },
      { rate: 0.03, threshold: 1_000 },
      { rate: 0.04, threshold: 2_000 },
      { rate: 0.0475, threshold: 3_000 },
      { rate: 0.05, threshold: 100_000 },
      { rate: 0.0525, threshold: 125_000 },
      { rate: 0.055, threshold: 150_000 },
      { rate: 0.0575, threshold: 250_000 },
    ],
    {
      standardDeduction: { single: 2_550, mfj: 5_150, hoh: 2_550, mfs: 2_550 },
      note: "Maryland counties also levy income tax (2.25-3.20%) not modeled here.",
    },
  ),

  // Minnesota
  MN: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.0535, threshold: 0 },
        { rate: 0.068, threshold: 32_570 },
        { rate: 0.0785, threshold: 106_990 },
        { rate: 0.0985, threshold: 198_630 },
      ],
      mfj: [
        { rate: 0.0535, threshold: 0 },
        { rate: 0.068, threshold: 47_620 },
        { rate: 0.0785, threshold: 189_180 },
        { rate: 0.0985, threshold: 330_410 },
      ],
      hoh: [
        { rate: 0.0535, threshold: 0 },
        { rate: 0.068, threshold: 40_100 },
        { rate: 0.0785, threshold: 161_120 },
        { rate: 0.0985, threshold: 264_530 },
      ],
      mfs: [
        { rate: 0.0535, threshold: 0 },
        { rate: 0.068, threshold: 23_810 },
        { rate: 0.0785, threshold: 94_590 },
        { rate: 0.0985, threshold: 165_205 },
      ],
    },
    standardDeduction: { single: 14_575, mfj: 29_150, hoh: 21_900, mfs: 14_575 },
  },

  // New Jersey
  NJ: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.014, threshold: 0 },
        { rate: 0.0175, threshold: 20_000 },
        { rate: 0.035, threshold: 35_000 },
        { rate: 0.0553, threshold: 40_000 },
        { rate: 0.0637, threshold: 75_000 },
        { rate: 0.0897, threshold: 500_000 },
        { rate: 0.1075, threshold: 1_000_000 },
      ],
      mfj: [
        { rate: 0.014, threshold: 0 },
        { rate: 0.0175, threshold: 20_000 },
        { rate: 0.0245, threshold: 50_000 },
        { rate: 0.035, threshold: 70_000 },
        { rate: 0.0553, threshold: 80_000 },
        { rate: 0.0637, threshold: 150_000 },
        { rate: 0.0897, threshold: 500_000 },
        { rate: 0.1075, threshold: 1_000_000 },
      ],
      hoh: [
        { rate: 0.014, threshold: 0 },
        { rate: 0.0175, threshold: 20_000 },
        { rate: 0.0245, threshold: 50_000 },
        { rate: 0.035, threshold: 70_000 },
        { rate: 0.0553, threshold: 80_000 },
        { rate: 0.0637, threshold: 150_000 },
        { rate: 0.0897, threshold: 500_000 },
        { rate: 0.1075, threshold: 1_000_000 },
      ],
      mfs: [
        { rate: 0.014, threshold: 0 },
        { rate: 0.0175, threshold: 20_000 },
        { rate: 0.035, threshold: 35_000 },
        { rate: 0.0553, threshold: 40_000 },
        { rate: 0.0637, threshold: 75_000 },
        { rate: 0.0897, threshold: 500_000 },
        { rate: 0.1075, threshold: 1_000_000 },
      ],
    },
  },

  // New Mexico
  NM: progressiveSimple([
    { rate: 0.017, threshold: 0 },
    { rate: 0.032, threshold: 5_500 },
    { rate: 0.047, threshold: 16_500 },
    { rate: 0.049, threshold: 33_500 },
    { rate: 0.059, threshold: 210_000 },
  ], { mfjDoubled: true }),

  // New York (state — NYC/Yonkers not modeled)
  NY: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.04, threshold: 0 },
        { rate: 0.045, threshold: 8_500 },
        { rate: 0.0525, threshold: 11_700 },
        { rate: 0.055, threshold: 13_900 },
        { rate: 0.06, threshold: 80_650 },
        { rate: 0.0685, threshold: 215_400 },
        { rate: 0.0965, threshold: 1_077_550 },
        { rate: 0.103, threshold: 5_000_000 },
        { rate: 0.109, threshold: 25_000_000 },
      ],
      mfj: [
        { rate: 0.04, threshold: 0 },
        { rate: 0.045, threshold: 17_150 },
        { rate: 0.0525, threshold: 23_600 },
        { rate: 0.055, threshold: 27_900 },
        { rate: 0.06, threshold: 161_550 },
        { rate: 0.0685, threshold: 323_200 },
        { rate: 0.0965, threshold: 2_155_350 },
        { rate: 0.103, threshold: 5_000_000 },
        { rate: 0.109, threshold: 25_000_000 },
      ],
      hoh: [
        { rate: 0.04, threshold: 0 },
        { rate: 0.045, threshold: 12_800 },
        { rate: 0.0525, threshold: 17_650 },
        { rate: 0.055, threshold: 20_900 },
        { rate: 0.06, threshold: 107_650 },
        { rate: 0.0685, threshold: 269_300 },
        { rate: 0.0965, threshold: 1_616_450 },
        { rate: 0.103, threshold: 5_000_000 },
        { rate: 0.109, threshold: 25_000_000 },
      ],
      mfs: [
        { rate: 0.04, threshold: 0 },
        { rate: 0.045, threshold: 8_500 },
        { rate: 0.0525, threshold: 11_700 },
        { rate: 0.055, threshold: 13_900 },
        { rate: 0.06, threshold: 80_650 },
        { rate: 0.0685, threshold: 215_400 },
        { rate: 0.0965, threshold: 1_077_550 },
        { rate: 0.103, threshold: 5_000_000 },
        { rate: 0.109, threshold: 25_000_000 },
      ],
    },
    standardDeduction: { single: 8_000, mfj: 16_050, hoh: 11_200, mfs: 8_000 },
    note: "NYC and Yonkers also levy local income tax (up to 3.876% / 1.95%) not modeled here.",
  },

  // North Dakota
  ND: progressiveSimple([
    { rate: 0.0, threshold: 0 },
    { rate: 0.0195, threshold: 47_150 },
    { rate: 0.025, threshold: 238_200 },
  ], { mfjDoubled: true }),

  // Ohio
  OH: progressiveSimple(
    [
      { rate: 0.0, threshold: 0 },
      { rate: 0.0275, threshold: 26_050 },
      { rate: 0.035, threshold: 100_000 },
    ],
    { note: "Ohio also has municipal income tax (avg ~2%) not modeled here." },
  ),

  // Oklahoma
  OK: progressiveSimple(
    [
      { rate: 0.0025, threshold: 0 },
      { rate: 0.0075, threshold: 1_000 },
      { rate: 0.0175, threshold: 2_500 },
      { rate: 0.0275, threshold: 3_750 },
      { rate: 0.0375, threshold: 4_900 },
      { rate: 0.0475, threshold: 7_200 },
    ],
    { mfjDoubled: true },
  ),

  // Oregon
  OR: {
    kind: "progressive",
    brackets: {
      single: [
        { rate: 0.0475, threshold: 0 },
        { rate: 0.0675, threshold: 4_300 },
        { rate: 0.0875, threshold: 10_750 },
        { rate: 0.099, threshold: 125_000 },
      ],
      mfj: [
        { rate: 0.0475, threshold: 0 },
        { rate: 0.0675, threshold: 8_600 },
        { rate: 0.0875, threshold: 21_500 },
        { rate: 0.099, threshold: 250_000 },
      ],
      hoh: [
        { rate: 0.0475, threshold: 0 },
        { rate: 0.0675, threshold: 8_600 },
        { rate: 0.0875, threshold: 21_500 },
        { rate: 0.099, threshold: 250_000 },
      ],
      mfs: [
        { rate: 0.0475, threshold: 0 },
        { rate: 0.0675, threshold: 4_300 },
        { rate: 0.0875, threshold: 10_750 },
        { rate: 0.099, threshold: 125_000 },
      ],
    },
    standardDeduction: { single: 2_745, mfj: 5_495, hoh: 4_420, mfs: 2_745 },
  },

  // Rhode Island
  RI: progressiveSimple(
    [
      { rate: 0.0375, threshold: 0 },
      { rate: 0.0475, threshold: 79_900 },
      { rate: 0.0599, threshold: 181_650 },
    ],
    { standardDeduction: { single: 10_550, mfj: 21_150, hoh: 15_850, mfs: 10_575 } },
  ),

  // South Carolina
  SC: progressiveSimple(
    [
      { rate: 0.0, threshold: 0 },
      { rate: 0.03, threshold: 3_460 },
      { rate: 0.064, threshold: 17_330 },
    ],
    { standardDeduction: { single: 15_000, mfj: 30_000, hoh: 22_500, mfs: 15_000 } },
  ),

  // Vermont
  VT: progressiveSimple([
    { rate: 0.0335, threshold: 0 },
    { rate: 0.066, threshold: 47_900 },
    { rate: 0.076, threshold: 116_000 },
    { rate: 0.0875, threshold: 242_000 },
  ], { mfjDoubled: true }),

  // Virginia
  VA: progressiveSimple([
    { rate: 0.02, threshold: 0 },
    { rate: 0.03, threshold: 3_000 },
    { rate: 0.05, threshold: 5_000 },
    { rate: 0.0575, threshold: 17_000 },
  ], { standardDeduction: { single: 8_500, mfj: 17_000, hoh: 8_500, mfs: 8_500 } }),

  // West Virginia
  WV: progressiveSimple(
    [
      { rate: 0.0222, threshold: 0 },
      { rate: 0.0296, threshold: 10_000 },
      { rate: 0.0333, threshold: 25_000 },
      { rate: 0.0444, threshold: 40_000 },
      { rate: 0.0482, threshold: 60_000 },
    ],
  ),

  // Wisconsin
  WI: progressiveSimple(
    [
      { rate: 0.035, threshold: 0 },
      { rate: 0.044, threshold: 14_680 },
      { rate: 0.053, threshold: 29_370 },
      { rate: 0.0765, threshold: 323_290 },
    ],
    {
      mfjDoubled: true,
      standardDeduction: { single: 13_230, mfj: 24_490, hoh: 17_080, mfs: 11_630 },
    },
  ),

  // District of Columbia
  DC: progressiveSimple(
    [
      { rate: 0.04, threshold: 0 },
      { rate: 0.06, threshold: 10_000 },
      { rate: 0.065, threshold: 40_000 },
      { rate: 0.085, threshold: 60_000 },
      { rate: 0.0925, threshold: 250_000 },
      { rate: 0.0975, threshold: 500_000 },
      { rate: 0.1075, threshold: 1_000_000 },
    ],
    { standardDeduction: { single: 15_000, mfj: 30_000, hoh: 22_500, mfs: 15_000 } },
  ),
};

/** All states/territories in display order (alphabetical by name). */
export const US_STATES_ORDERED: USState[] = (
  Object.entries(US_STATE_NAMES) as [USState, string][]
)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([k]) => k);
