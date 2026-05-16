/**
 * Asset-location optimizer. Flags misalignments between where your
 * tax-inefficient holdings sit vs where they *should* sit, given
 * each account's tax shelter properties.
 *
 * The fee-only-fiduciary consensus:
 *
 *   - Roth (Roth IRA / Roth 401k):
 *       highest-expected-return assets — small-cap value, growth
 *       equities, crypto. Tax-free growth compounds best here.
 *   - Tax-deferred (401k / Trad IRA):
 *       tax-inefficient income generators — bonds, REITs, high-yield
 *       funds. These would throw off ordinary-income coupons / non-
 *       qualified dividends in a taxable account.
 *   - Taxable:
 *       broad-market equity index funds (LTCG-eligible + qualified
 *       dividends + step-up basis at death + tax-loss-harvestable),
 *       muni bonds (already tax-free), and direct real estate.
 *   - HSA:
 *       same as Roth — once you've cleared the deductible-tracking
 *       reserve, the rest is "Roth on steroids".
 *
 * This implementation labels each holding's *current* tax-efficiency
 * for its bucket and flags two kinds of misalignment:
 *
 *   1. "Tax-inefficient in taxable" — bonds / REITs / high-yield in
 *      a brokerage account; should move to tax-deferred space.
 *   2. "Low-growth in Roth" — bonds in a Roth bucket; should swap
 *      with equities in a different bucket.
 *
 * Doesn't try to engineer the swap (that requires knowing user
 * balances + cap-gains); just surfaces the misalignment with a
 * specific recommendation.
 */

import {
  TAX_TREATMENT_BY_CATEGORY,
  holdingLabel,
  type Account,
  type Holding,
  type Household,
  type TaxTreatment,
} from "@/lib/types";

export type LocationBucket = "taxable" | "pre_tax" | "roth_hsa" | "other";

export type LocationFinding = {
  kind: "tax-inefficient-in-taxable" | "low-growth-in-roth";
  /** Holding symbol / name for display. */
  label: string;
  /** Account this holding currently lives in. */
  accountName: string;
  bucket: LocationBucket;
  valueUSD: number;
  /** Plain-language recommendation. */
  recommendation: string;
};

function bucketFor(a: Account): LocationBucket {
  const t: TaxTreatment = TAX_TREATMENT_BY_CATEGORY[a.category];
  if (t === "TAXABLE") return "taxable";
  if (t === "PRE_TAX") return "pre_tax";
  if (t === "ROTH" || t === "HSA") return "roth_hsa";
  return "other";
}

function isTaxInefficient(h: Holding): boolean {
  // Bond + commodity holdings throw off ordinary-income coupons /
  // non-qualified distributions. REITs (modeled as real_estate
  // with publicly-traded composition wrappers) would too, but the
  // current model doesn't distinguish a REIT ETF from direct RE,
  // so we only flag the pure-bond / commodity / cash cases.
  if (h.kind === "bond") return true;
  if (h.kind === "cash") return true;
  if (h.kind === "commodity") return true;
  return false;
}

function isLowGrowth(h: Holding): boolean {
  // Anything with a real CAGR below 2% is "low growth" for our
  // purposes — bonds (~1-2% real), cash (~0%), high-yield savings.
  // Equity even with leverage isn't flagged.
  return h.expectedRealCAGR < 0.02 && h.kind !== "real_estate";
}

export function assetLocationFindings(
  household: Household,
): LocationFinding[] {
  const findings: LocationFinding[] = [];
  for (const a of household.accounts) {
    const bucket = bucketFor(a);
    for (const h of a.holdings) {
      if (bucket === "taxable" && isTaxInefficient(h)) {
        findings.push({
          kind: "tax-inefficient-in-taxable",
          label: holdingLabel(h),
          accountName: a.displayName,
          bucket,
          valueUSD: h.valueUSD,
          recommendation:
            h.kind === "bond"
              ? "Bond coupons are taxed as ordinary income. Hold in a 401k / Trad IRA where the income is already tax-deferred."
              : h.kind === "commodity"
                ? "Commodity ETFs (60/40 1256 contracts) generate annual K-1 distributions taxed at blended ordinary + LTCG. Tax-deferred is cleaner."
                : "Cash interest is ordinary income. Park in a tax-deferred account or use muni bonds in taxable.",
        });
      }
      if (bucket === "roth_hsa" && isLowGrowth(h)) {
        findings.push({
          kind: "low-growth-in-roth",
          label: holdingLabel(h),
          accountName: a.displayName,
          bucket,
          valueUSD: h.valueUSD,
          recommendation:
            "Roth space is the most valuable account for *growth* — bonds here waste the tax shelter. Swap with equities in a 401k or Trad IRA.",
        });
      }
    }
  }
  // Sort by value desc so the biggest misalignments surface first.
  findings.sort((a, b) => b.valueUSD - a.valueUSD);
  return findings;
}
