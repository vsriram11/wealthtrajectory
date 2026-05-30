import {
  accountValue,
  TAX_TREATMENT_BY_CATEGORY,
  type Account,
  type Household,
  type TaxTreatment,
} from "@/lib/types";

/**
 * Tax-efficient withdrawal sequencer.
 *
 * Bogleheads-style default order (broad consensus among
 * fee-only-fiduciary planners):
 *
 *   1. Taxable brokerage first — already-taxed principal + (mostly)
 *      long-term-capital-gains income. Drawing first lets tax-
 *      deferred accounts keep growing tax-deferred.
 *   2. Tax-deferred (401k / Trad IRA) — withdrawals are ordinary-
 *      income taxed; better to take them when in retirement-era
 *      lower bracket than to defer all the way until RMDs at 73+
 *      and end up forced into a higher bracket.
 *   3. Roth (401k / IRA) — never taxed on withdrawal; preserve as
 *      long as possible because tax-free growth compounds best.
 *   4. HSA — special case: tax-free for qualified medical, ordinary-
 *      income otherwise after 65. Treated as "preserve" alongside
 *      Roth because qualified medical expenses are extremely
 *      common in late retirement.
 *
 * This is the *default* — exceptions exist (Roth ladder, large
 * pre-tax balance with no other income, etc.), but the default
 * is right for the majority. We surface it as guidance, not as
 * dogma.
 *
 * Cash / savings are pre-emptied alongside taxable so the user
 * doesn't sit on idle cash drag while drawing from invested
 * accounts.
 */

export type WithdrawalBucket =
  | "taxable"
  | "pre_tax"
  | "roth"
  | "hsa"
  | "education";

export type WithdrawalRow = {
  bucket: WithdrawalBucket;
  /** Bucket label for display. */
  label: string;
  /** Bucket priority — 1 is first to draw from. */
  priority: number;
  /** Current value across all accounts in this bucket. */
  totalUSD: number;
  /** Per-account contributions to the bucket, sorted desc. */
  accounts: { id: string; name: string; valueUSD: number }[];
  /**
   * Months this bucket alone covers at the household's annual
   * spending (computed from assumptions.targetNetWorthUSD *
   * withdrawalRate). null when spend is 0.
   */
  monthsOfRunway: number | null;
  /** Plain-language rationale shown to the user. */
  why: string;
};

export type WithdrawalSequence = {
  rows: WithdrawalRow[];
  /** Annual spend used for runway computation. */
  annualSpendUSD: number;
};

const BUCKET_PRIORITY: Record<WithdrawalBucket, number> = {
  taxable: 1,
  pre_tax: 2,
  roth: 3,
  hsa: 4,
  // Education last — these dollars legally can't fund retirement
  // spending (529/Trump Account = beneficiary-locked).
  education: 5,
};

const BUCKET_LABELS: Record<WithdrawalBucket, string> = {
  taxable: "Taxable & cash",
  pre_tax: "Tax-deferred (401k / Trad IRA)",
  roth: "Roth (401k / IRA)",
  hsa: "HSA",
  education: "Education (529 / Trump Account)",
};

const BUCKET_WHY: Record<WithdrawalBucket, string> = {
  taxable:
    "Already taxed — long-term-gains rates are usually lower than ordinary income. Draw first to let tax-deferred space keep growing.",
  pre_tax:
    "Taxed as ordinary income on withdrawal. Pull at retirement-era bracket to flatten lifetime tax bill before RMDs at 73 force the issue.",
  roth: "Tax-free growth. Preserve as long as possible — the compounding here is the most valuable dollar-for-dollar in the portfolio.",
  hsa: "Tax-free for qualified medical expenses (which are common late in life). Save receipts now to reimburse later.",
  education:
    "Beneficiary-locked — these dollars can only pay for the beneficiary's qualified education (529) or the child's vested account (Trump). Excluded from the year-by-year retirement drawdown schedule; included here so the user sees the bucket exists but understands why it's not spendable for retirement.",
};

function bucketForAccount(a: Account): WithdrawalBucket {
  const t: TaxTreatment = TAX_TREATMENT_BY_CATEGORY[a.category];
  if (t === "TAXABLE") return "taxable";
  if (t === "PRE_TAX") return "pre_tax";
  if (t === "ROTH") return "roth";
  if (t === "HSA") return "hsa";
  // EDUCATION (529 / Trump Account) — earmarked, beneficiary-locked,
  // not part of retirement drawdown. Round-5 audit fix: previously
  // collapsed into the Roth bucket, which silently inflated the
  // schedule's tax-free runway by the 529 balance. Now lives in
  // its own bucket so the card can display + EXCLUDE it from the
  // drawdown engine.
  return "education";
}

export function withdrawalSequence(
  household: Household,
  annualSpendUSD: number,
): WithdrawalSequence {
  const buckets: Record<WithdrawalBucket, WithdrawalRow> = {
    taxable: emptyRow("taxable"),
    pre_tax: emptyRow("pre_tax"),
    roth: emptyRow("roth"),
    hsa: emptyRow("hsa"),
    education: emptyRow("education"),
  };
  for (const a of household.accounts) {
    const bucket = bucketForAccount(a);
    const v = accountValue(a);
    if (v <= 0) continue;
    buckets[bucket].totalUSD += v;
    buckets[bucket].accounts.push({
      id: a.id,
      name: a.displayName,
      valueUSD: v,
    });
  }
  const rows = Object.values(buckets);
  for (const r of rows) {
    r.accounts.sort((a, b) => b.valueUSD - a.valueUSD);
    if (annualSpendUSD > 0) {
      r.monthsOfRunway = Math.floor((r.totalUSD / annualSpendUSD) * 12);
    }
  }
  rows.sort((a, b) => a.priority - b.priority);
  return { rows, annualSpendUSD };
}

function emptyRow(bucket: WithdrawalBucket): WithdrawalRow {
  return {
    bucket,
    label: BUCKET_LABELS[bucket],
    priority: BUCKET_PRIORITY[bucket],
    totalUSD: 0,
    accounts: [],
    monthsOfRunway: null,
    why: BUCKET_WHY[bucket],
  };
}
