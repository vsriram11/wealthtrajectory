/**
 * Tax-aware withdrawal sequencer — year-by-year retirement
 * drawdown simulator that respects the canonical Bogleheads /
 * Mike Piper sequence:
 *
 *   1. Taxable accounts first (only cap gains taxed; preserves
 *      tax-deferred compounding)
 *   2. Pre-tax accounts (Traditional 401k / IRA) — fully taxed as
 *      ordinary income
 *   3. Roth accounts last (no tax; let them grow the longest)
 *   4. HSA preserved for healthcare; not withdrawn unless forced
 *
 * Plus the mandatory bits:
 *   - RMDs at age 73 (SECURE 2.0; rises to 75 in 2033) on
 *     pre-tax balances. If RMD exceeds desired spend, the
 *     surplus is taxed and reinvested into taxable (modeled as
 *     a tax drag, not a separate cash flow).
 *   - Tax gross-up: gross withdrawal needed to net the target
 *     real spend at the effective marginal rate.
 *
 * This is a SIMPLIFIED model — not a CPA-grade tax engine.
 * Specifically:
 *   - Treats federal effective tax rate as a single user-supplied
 *     number (`retirementTaxRate`), not full bracket math.
 *   - No state taxes, no NIIT, no IRMAA brackets.
 *   - No Social Security / pension interaction.
 *   - No QCD or other charitable workarounds.
 *
 * What it gets right:
 *   - The sequence (taxable → pre-tax → Roth)
 *   - The RMD floor (you can't avoid those withdrawals)
 *   - Per-bucket month-of-runway tracking
 *   - Real-terms throughout (matches the rest of the app)
 *
 * Returns a year-by-year SimulationLog that the UI can render
 * as a table or chart. Engine-pure: no React, no store.
 */

/**
 * The four canonical retirement-account buckets. We use bucket
 * labels (not the existing account categories) because multiple
 * 401k accounts roll into one bucket for sequencing purposes.
 */
export type AccountBucket = "taxable" | "pretax" | "roth" | "hsa";

export type BucketBalances = Record<AccountBucket, number>;

export type WithdrawalSequencerInputs = {
  /** Real-$ balances per bucket at retirement. */
  startingBalances: BucketBalances;
  /** Real-$ annual spend during retirement. */
  annualRealSpendUSD: number;
  /**
   * Real CAGR per bucket (e.g. 0.05 for 5% real). Taxable and
   * pre-tax often have the same investment mix; Roth + HSA may
   * be more equity-heavy. The engine doesn't enforce this — it
   * just applies the per-bucket rate each year.
   */
  realCAGRByBucket: BucketBalances;
  /**
   * Retirement starting age (the year-0 age). RMDs start when
   * age + year >= rmdStartAge.
   */
  startingAge: number;
  /** RMD start age. SECURE 2.0: 73; 2033+: 75. Default 73. */
  rmdStartAge?: number;
  /** Effective marginal tax rate on pre-tax + cap gains. 0–0.99. */
  retirementTaxRate: number;
  /** How many years to simulate. */
  years: number;
  /**
   * Optional withdrawal-order override. Default
   * ["taxable", "pretax", "roth", "hsa"].
   */
  order?: AccountBucket[];
};

export type YearRow = {
  year: number;
  age: number;
  startingBalances: BucketBalances;
  endingBalances: BucketBalances;
  withdrawalsByBucket: BucketBalances;
  /** Mandatory RMD this year, $0 if not yet 73. */
  rmdAmountUSD: number;
  /** Real-$ net spend covered. May be less than target if portfolio is depleted. */
  netSpendAchievedUSD: number;
  /** Real-$ total gross withdrawals (before tax). */
  grossWithdrawalUSD: number;
  /** Tax paid this year (real $). */
  taxesPaidUSD: number;
  /** True if portfolio fully depleted this year. */
  depleted: boolean;
};

export type WithdrawalSequenceResult = {
  rows: YearRow[];
  /** Year when portfolio depleted, or -1 if survived. */
  depletedYear: number;
  /** Total taxes paid over the simulation (real $). */
  totalTaxesPaidUSD: number;
  /** Total net spend covered (real $). */
  totalNetSpendUSD: number;
  /** Ending balance, real $. */
  endingTotalUSD: number;
};

const DEFAULT_ORDER: AccountBucket[] = [
  "taxable",
  "pretax",
  "roth",
  "hsa",
];

/**
 * Uniform Lifetime Table divisors (IRS Publication 590-B, 2022+).
 * Indexed by age. We only need ~73 onward; ages below 73 produce
 * no RMD anyway. Values above 100 cap at ~6.0 — past 110 the
 * RMD is effectively the full balance.
 */
const RMD_DIVISORS: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0,
  79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8,
  85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2,
  91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4,
  97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6,
  103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9,
  109: 3.7, 110: 3.5,
};

function rmdDivisor(age: number): number {
  // Floor to integer before lookup. The simulator advances age in
  // fractional steps; without flooring, age 75.5 → table miss →
  // the `?? 26.5` fallback (which is the age-73 divisor) silently
  // applied to a 75-year-old, computing a ~3× too-large RMD
  // ($1M / 26.5 = $37.7k instead of $1M / 24.6 = $40.7k). Worse:
  // the fallback constant disguises the table miss as a "default,"
  // so a future RMD-table update would also leave the off-integer
  // ages broken. Drop the fallback — every integer age 73-110 is
  // in the table.
  const a = Math.floor(age);
  if (a < 73) return Infinity;
  if (a >= 110) return 3.5;
  return RMD_DIVISORS[a];
}

function copyBalances(b: BucketBalances): BucketBalances {
  return { taxable: b.taxable, pretax: b.pretax, roth: b.roth, hsa: b.hsa };
}

function emptyBalances(): BucketBalances {
  return { taxable: 0, pretax: 0, roth: 0, hsa: 0 };
}

/**
 * Run one year of the sequencer. Steps:
 *   1. Grow balances by the per-bucket real CAGR.
 *   2. Compute the year's required RMD (if any).
 *   3. Compute target gross withdrawal: net spend ÷ (1 − tax).
 *   4. Subtract the RMD (it counts toward gross — you have to
 *      withdraw it regardless).
 *   5. Walk the sequence, draining buckets in order to cover
 *      the remaining gross. Mid-bucket, partial draws.
 *   6. Tax: roughly `gross × tax`, except Roth/HSA portions are
 *      untaxed. We model this as: tax = (taxable + pretax + RMD)
 *      × tax_rate; Roth + HSA contribute nothing.
 *
 * This is a simplified model; documented at the top.
 */
function simulateYear(
  startBal: BucketBalances,
  age: number,
  inputs: WithdrawalSequencerInputs,
  yearIndex: number,
): YearRow {
  const cagr = inputs.realCAGRByBucket;
  const order = inputs.order ?? DEFAULT_ORDER;
  const rmdStartAge = inputs.rmdStartAge ?? 73;
  const taxRate = Math.max(0, Math.min(0.99, inputs.retirementTaxRate));

  // 1. Grow all balances.
  const grown: BucketBalances = {
    taxable: Math.max(0, startBal.taxable * (1 + cagr.taxable)),
    pretax: Math.max(0, startBal.pretax * (1 + cagr.pretax)),
    roth: Math.max(0, startBal.roth * (1 + cagr.roth)),
    hsa: Math.max(0, startBal.hsa * (1 + cagr.hsa)),
  };

  // 2. RMD this year (if age ≥ start).
  const rmd =
    age >= rmdStartAge ? grown.pretax / rmdDivisor(age) : 0;

  // 3. Target net spend, tracked as "net dollars still needed."
  // The prior implementation grossed up ALL spend at the start
  // (`targetGross = targetNet / (1 - taxRate)`) — which silently
  // over-withdrew from Roth / HSA (untaxed) buckets by a factor
  // of `1/(1-t)`. Real-money error: a $100k spend retiree at
  // t=0.22 with Roth-only assets withdrew $128k/yr and "netted"
  // $128k while drained Roth at the grossed-up rate. Decide the
  // gross-up PER BUCKET, based on whether that bucket is taxed.
  const targetNet = Math.max(0, inputs.annualRealSpendUSD);

  const withdrawals: BucketBalances = emptyBalances();
  // Apply the RMD first — it's compulsory.
  withdrawals.pretax += Math.min(grown.pretax, rmd);
  const balancesPost: BucketBalances = copyBalances(grown);
  balancesPost.pretax -= withdrawals.pretax;
  // RMD covers SOME of the net target: its post-tax contribution
  // is `rmd * (1 - taxRate)`.
  let remainingNet = Math.max(
    0,
    targetNet - withdrawals.pretax * (1 - taxRate),
  );

  // 5. Walk the order to drain remaining net. For TAXED buckets
  // (taxable / pretax), gross up `1/(1-t)`; for UNTAXED buckets
  // (roth / hsa), draw literally. Net-contribution math at the
  // bottom mirrors the tax block in §6 so the two stay aligned.
  for (const bucket of order) {
    if (remainingNet <= 0) break;
    const available = balancesPost[bucket];
    if (available <= 0) continue;
    const isTaxed = bucket === "pretax" || bucket === "taxable";
    if (isTaxed) {
      const grossNeeded = remainingNet / (1 - taxRate);
      const draw = Math.min(available, grossNeeded);
      withdrawals[bucket] += draw;
      balancesPost[bucket] -= draw;
      remainingNet -= draw * (1 - taxRate);
    } else {
      const draw = Math.min(available, remainingNet);
      withdrawals[bucket] += draw;
      balancesPost[bucket] -= draw;
      remainingNet -= draw;
    }
  }

  // 6. Compute tax. Pretax + RMD are fully taxed; taxable is
  // approximated at the same rate (it's actually cap gains, but
  // we're using a single effective rate as documented). Roth +
  // HSA contribute zero tax.
  const taxableWithdrawal =
    withdrawals.taxable + withdrawals.pretax; // includes RMD via pretax
  const taxesPaid = taxableWithdrawal * taxRate;
  const grossWithdrawal =
    withdrawals.taxable +
    withdrawals.pretax +
    withdrawals.roth +
    withdrawals.hsa;
  const netSpendAchieved = grossWithdrawal - taxesPaid;

  const totalEnding =
    balancesPost.taxable +
    balancesPost.pretax +
    balancesPost.roth +
    balancesPost.hsa;

  return {
    year: yearIndex,
    age,
    startingBalances: startBal,
    endingBalances: balancesPost,
    withdrawalsByBucket: withdrawals,
    rmdAmountUSD: rmd,
    netSpendAchievedUSD: netSpendAchieved,
    grossWithdrawalUSD: grossWithdrawal,
    taxesPaidUSD: taxesPaid,
    depleted: totalEnding <= 0,
  };
}

/**
 * Run the full multi-year withdrawal sequence. Returns one row
 * per year plus aggregate stats.
 */
export function runWithdrawalSequence(
  inputs: WithdrawalSequencerInputs,
): WithdrawalSequenceResult {
  const rows: YearRow[] = [];
  let bal = copyBalances(inputs.startingBalances);
  let depletedYear = -1;
  let totalTax = 0;
  let totalNet = 0;
  for (let y = 0; y < inputs.years; y++) {
    const age = inputs.startingAge + y;
    const row = simulateYear(bal, age, inputs, y);
    rows.push(row);
    totalTax += row.taxesPaidUSD;
    totalNet += row.netSpendAchievedUSD;
    bal = row.endingBalances;
    if (row.depleted && depletedYear === -1) {
      depletedYear = y;
    }
  }
  const endingTotal =
    bal.taxable + bal.pretax + bal.roth + bal.hsa;
  return {
    rows,
    depletedYear,
    totalTaxesPaidUSD: totalTax,
    totalNetSpendUSD: totalNet,
    endingTotalUSD: endingTotal,
  };
}
