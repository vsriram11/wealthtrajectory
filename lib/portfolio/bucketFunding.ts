/**
 * Cash-bucket-funding tax model.
 *
 * When the user requests a larger cash bucket than their projected
 * cash share, the simulator now MODELS the cost of raising that
 * cash (rather than disclaiming it). The user said:
 *
 *   "tackle the tax calculation too (which would mean less net
 *    worth after selling for cash, and highest leverage equities
 *    should be prioritized to sell for the cash, primary residence
 *    cannot be sold)"
 *
 * Sale-priority rules baked in:
 *
 *   1. Highest leverage equity first (3x ETFs → 2x ETFs → 1x).
 *      Motivation: the bucket strategy's whole point is SORR
 *      protection. Converting risky leveraged exposure to cash
 *      DOUBLY de-risks the portfolio AND funds the buffer.
 *   2. Within the same leverage tier, prefer tax-advantaged
 *      accounts (rebalancing inside an IRA/401k/Roth is tax-free).
 *      This minimizes the tax bill while still honoring the user's
 *      "leverage-first" preference.
 *   3. After all equity is sold, fall through to bonds, commodity,
 *      non-primary real estate, and other alts.
 *   4. EXCLUDED entirely: primary residence (you'd have to move),
 *      private stock (restricted), anything explicitly marked
 *      `isIlliquid`. Same set as the existing `isLiquid` helper.
 *
 * Tax model:
 *   - Sales from TAXABLE accounts (BROKERAGE/SAVINGS/CHECKING)
 *     incur capital-gains tax = saleAmount × gainFraction × taxRate.
 *   - Sales from PRE_TAX (401K/Trad IRA), ROTH (Roth IRA/Roth 401K),
 *     HSA, or EDUCATION (529/Trump): zero immediate tax —
 *     rebalancing INSIDE these accounts is a wash. (Future
 *     WITHDRAWAL from pre-tax is taxed; that's already in the
 *     simulator's drawdown logic upstream.)
 *
 * Cost-basis assumption: this app doesn't track per-holding basis,
 * so we follow the same convention as `computeLeveragedEquityBuckets`:
 * default `gainFraction = 1.0` (treat all current value as gain) —
 * the conservative stress-test bound. Surfaced to the user so the
 * assumption isn't invisible.
 *
 * Engine-pure: no React, no store imports, no I/O.
 */

import {
  TAX_TREATMENT_BY_CATEGORY,
  isExcludedFromCashBucketSale,
  isLiquid,
  type Account,
  type Holding,
  type Household,
} from "@/lib/types";
import { MULTI_ASSET_WRAPPER_TICKERS } from "@/lib/portfolio/leveragedEquity";

/** Single source of truth for "this ticker is a capital-efficient multi-asset wrapper." */
const SET_MULTI_ASSET_WRAPPER = new Set<string>(MULTI_ASSET_WRAPPER_TICKERS);

/**
 * Maximum bond duration (years) at which the holding is treated as
 * a CASH EQUIVALENT for bucket-funding purposes. Money market funds,
 * T-bills, sub-1-year CDs, short Treasuries all qualify — they're
 * functionally part of the user's SORR buffer and shouldn't need to
 * be "sold" to fund the cash bucket. (They still run through the
 * simulator's BOND return series; this constant is only about the
 * bucket-funding accounting.)
 */
export const SHORT_DURATION_BOND_CUTOFF_YEARS = 1;

/**
 * True when a bond holding behaves like cash for bucket sizing —
 * short duration means the dollar value barely fluctuates with
 * rates, so it's already a functional reserve. Per the user:
 * "short duration bonds 1 year or less are basically cash already."
 */
export function isCashEquivalentBond(h: Holding): boolean {
  if (h.kind !== "bond") return false;
  return (
    typeof h.averageDurationYears === "number" &&
    h.averageDurationYears <= SHORT_DURATION_BOND_CUTOFF_YEARS
  );
}

/**
 * Asset-class buckets a sale can pull from, in PRIORITY order
 * (index 0 = sold first). Used to drive both the tax accounting
 * AND the post-sale allocation re-anchor (so the simulator's
 * class shares match what was actually sold).
 *
 *   - `leveragedEquity`: equity with leverage > 1, sub-sorted by
 *     leverage DESC so 3x is drained before 2x.
 *   - `regularEquity`: equity with leverage == 1.
 *   - `bonds`: bond holdings.
 *   - `commodity`: commodity holdings (gold series).
 *   - `realEstate`: non-primary RE only (primary is filtered by
 *     `isLiquid`).
 *   - `otherAlts`: alts (crypto, "other"). Note: private_stock is
 *     filtered out by `isLiquid` too.
 */
export type SaleBucket =
  | "leveragedEquity"
  | "regularEquity"
  | "bonds"
  | "commodity"
  | "realEstate"
  | "otherAlts";

export const SALE_PRIORITY_ORDER: ReadonlyArray<SaleBucket> = [
  "leveragedEquity",
  "regularEquity",
  "bonds",
  "commodity",
  "realEstate",
  "otherAlts",
] as const;

export type SaleBucketSummary = {
  bucket: SaleBucket;
  /** Total face value SOLD from this bucket. */
  faceValueSoldUSD: number;
  /** Of that, the portion in TAXABLE accounts (subject to cap gains). */
  taxableFaceValueSoldUSD: number;
  /** Capital-gains tax paid on the taxable portion. */
  taxOwedUSD: number;
};

/**
 * Per-holding line item in the sale plan. Surfaced both as
 * `candidates` (every eligible holding, for the advanced override
 * panel) and `sales` (the subset where the engine or the user
 * decided to sell). Stable across re-runs (sorted by sale priority).
 */
export type HoldingSale = {
  holdingId: string;
  accountId: string;
  /** Optional display symbol/name. Cash + RE + private_stock have no symbol. */
  label: string;
  kind: Holding["kind"];
  bucket: SaleBucket;
  leverage: number;
  isTaxable: boolean;
  accountCategory: Account["category"];
  /** Total face value of the holding (the maximum sellable). */
  fullValueUSD: number;
  /** Face value actually sold per this plan (0 if untouched). */
  faceValueSoldUSD: number;
  /** Capital-gains tax owed on this sale (0 for tax-advantaged accounts). */
  taxOwedUSD: number;
};

export type BucketFundingPlan = {
  /**
   * Cash-equivalent share the user ALREADY has (cash holdings +
   * short-duration bonds with averageDurationYears <= 1). The amount
   * needed to raise is computed against THIS share, not raw cash%,
   * because short bonds are already in the SORR buffer. Normalized
   * against the caller-passed `totalNetWorthUSD` for denominator
   * consistency.
   */
  effectiveCashEquivalentShare: number;
  /**
   * The cash fraction the SIMULATOR should actually run with —
   * post-tax. When the user requests X% cash but raising the cash
   * costs $T in tax, the actually-raised cash is less than the
   * requested face, and the post-tax NW is also less. Pass THIS
   * value to `applyCashBucketOverride` (not the raw requested
   * fraction) so the simulator's cash dollars match the plan's
   * actual cash dollars. Round-1 audit HIGH: prior versions piped
   * the requested fraction through and magicked $T worth of cash
   * out of thin air.
   *   = (preExistingCashUSD + amountRaisedUSD - totalTaxOwedUSD)
   *     / (totalNetWorthUSD - totalTaxOwedUSD)
   * When no tax fires (or requested ≤ effective cash equivalent),
   * this equals the user's request.
   */
  effectiveCashFractionPostTax: number;
  /** Total dollars the user wants to raise to hit the requested cash%. */
  amountToRaiseUSD: number;
  /** Actually raised (= min(amountToRaise, totalSellableValue)). */
  amountRaisedUSD: number;
  /**
   * Shortfall = amountToRaiseUSD - amountRaisedUSD. Positive if the
   * sellable portfolio can't fund the requested bucket (e.g. nearly
   * everything is in primary residence). UI should surface this.
   */
  shortfallUSD: number;
  /** Total capital-gains tax owed on the sales. */
  totalTaxOwedUSD: number;
  /** Per-bucket sale summary, in PRIORITY order (drained first first). */
  perBucket: SaleBucketSummary[];
  /**
   * Per-holding sale line items WHERE faceValueSoldUSD > 0. Sorted
   * by sale priority (highest leverage first within tier). The UI
   * renders this as the "what got sold" summary.
   */
  sales: HoldingSale[];
  /**
   * Total face value the user EXPLICITLY excluded via the per-
   * holding `excludeFromCashBucketSale` flag. Separate from
   * `excludedIlliquidUSD` so the UI can distinguish "you opted out
   * of selling this" from "this is structurally illiquid (primary
   * residence, private stock, etc.)".
   */
  excludedUserOptOutUSD: number;
  /**
   * Total face value EXCLUDED from sales by liquidity rules.
   * Reported so the UI can be honest about what's off-limits.
   * Includes primary residence + private stock + isIlliquid.
   */
  excludedIlliquidUSD: number;
  /** Of `excludedIlliquidUSD`, how much is primary residence specifically. */
  excludedPrimaryResidenceUSD: number;
  /**
   * Total face value of short-duration bonds (≤ 1yr) — counted as
   * cash-equivalent and NOT sold. Surfaced so the UI can explain
   * "you already had $X in short bonds, so we only had to raise the
   * difference."
   */
  shortDurationBondUSD: number;
  /** Tax-rate used (clamped). */
  effectiveTaxRate: number;
  /** Gain fraction used (clamped). */
  effectiveGainFraction: number;
};

const DEFAULT_GAIN_FRACTION = 1.0;

/**
 * Classify a holding into its sale bucket. Returns `null` if the
 * holding shouldn't be in any sale bucket (cash — can't sell cash
 * for cash; AND short-duration bonds — they're already cash-
 * equivalent per the SORR-buffer rule). Caller is responsible for
 * filtering `isLiquid` first.
 */
function classifyHolding(h: Holding): SaleBucket | null {
  if (h.kind === "cash") return null;
  if (isCashEquivalentBond(h)) return null;
  if (h.kind === "equity") {
    // Multi-asset capital-efficient wrappers (NTSX/GDE/RSST/etc.)
    // have leverage > 1 but are EXPLICITLY designed for long-term
    // hold — same exclusion the deleveraging engine applies. They
    // also have decomposed composition specs (per-class breakdown
    // upstream), so flagging them as "leveraged" double-counts.
    // Treat as regular equity for sale priority. Round-1 audit fix.
    const isWrapper =
      (h.composition && h.composition.length > 0) ||
      SET_MULTI_ASSET_WRAPPER.has(h.symbol);
    if (isWrapper) return "regularEquity";
    return h.leverage > 1 ? "leveragedEquity" : "regularEquity";
  }
  if (h.kind === "bond") return "bonds";
  if (h.kind === "commodity") return "commodity";
  if (h.kind === "real_estate") return "realEstate";
  // crypto / private_stock / other → otherAlts.
  // (private_stock is also filtered by isLiquid upstream, so it
  // shouldn't reach this branch in practice; keep the mapping
  // here for completeness.)
  return "otherAlts";
}

type ClassifiedHolding = {
  holding: Holding;
  account: Account;
  bucket: SaleBucket;
  /** Is the account taxable? Drives the per-sale tax calc. */
  isTaxable: boolean;
};

/** Display label for a holding (for the sale-plan UI). */
function labelFor(h: Holding): string {
  if ("symbol" in h && h.symbol) return h.symbol;
  if ("name" in h && h.name) return h.name;
  return h.kind;
}

/**
 * Plan the sale + compute the tax cost of funding a cash bucket
 * larger than the projected cash share.
 *
 * @param household        Active-projection-resolved household
 *                         (already through rollup + member +
 *                         liquidity filters).
 * @param totalNetWorthUSD The projected portfolio total at retirement
 *                         (denominator for the percentage-based
 *                         amount-to-raise calculation).
 * @param projectedCashShare The portfolio's cash share BEFORE the
 *                           override.
 * @param requestedCashFraction  The user's requested cash share
 *                               (0..1).
 * @param retirementTaxRate  Long-term capital-gains rate at
 *                           retirement.
 * @param gainFraction       Fraction of sold value treated as gain.
 *                           Default 1.0 (conservative — matches
 *                           computeLeveragedEquityBuckets).
 *
 * Returns a plan even when requested <= projected (zero-amount sale,
 * zero tax — easier for callers than nullable returns).
 */
export function planBucketFunding(
  household: Household,
  totalNetWorthUSD: number,
  requestedCashFraction: number,
  retirementTaxRate: number,
  /**
   * Optional set of holding IDs the caller has separately consumed
   * (e.g. the deleveraging restructure already applied to this
   * holding). The engine treats these as effectively gone for
   * sale purposes — neither sold nor counted in cash-equivalent.
   * Round-1 audit: prevents double-tax when deleveraging +
   * bucket-funding both want the same TQQQ.
   */
  excludedHoldingIds?: ReadonlySet<string>,
  gainFraction: number = DEFAULT_GAIN_FRACTION,
): BucketFundingPlan {
  // Boundary sanitization. NaN/Infinity → trivial empty plan.
  const safeNW = Number.isFinite(totalNetWorthUSD)
    ? Math.max(0, totalNetWorthUSD)
    : 0;
  const safeRequested = Number.isFinite(requestedCashFraction)
    ? Math.max(0, Math.min(1, requestedCashFraction))
    : 0;
  const effectiveTaxRate = Number.isFinite(retirementTaxRate)
    ? Math.max(0, Math.min(0.99, retirementTaxRate))
    : 0;
  const effectiveGainFraction = Number.isFinite(gainFraction)
    ? Math.max(0, Math.min(1, gainFraction))
    : DEFAULT_GAIN_FRACTION;

  // Walk every (account, holding) pair: classify, count excluded
  // value by reason (illiquid / primary-residence / opt-out / short
  // bond), tally cash, build sale candidates.
  //
  // Single-pass: walking the household here means we own both the
  // numerator (cash USD, short-bond USD) and the denominator (the
  // caller-passed `totalNetWorthUSD`) for the cash-equivalent
  // share — no risk of the gross-vs-net denominator mismatch
  // Round-1 audit flagged on the prior projectedCashShare param.
  let cashUSD = 0;
  let excludedIlliquidUSD = 0;
  let excludedPrimaryResidenceUSD = 0;
  let excludedUserOptOutUSD = 0;
  let shortDurationBondUSD = 0;
  const candidates: ClassifiedHolding[] = [];
  for (const account of household.accounts) {
    const isTaxable =
      TAX_TREATMENT_BY_CATEGORY[account.category] === "TAXABLE";
    for (const holding of account.holdings) {
      // Caller-supplied exclusion (Round-1 audit: prevents the
      // deleveraging engine + bucket-funding engine from
      // double-taxing the same holding).
      if (excludedHoldingIds?.has(holding.id)) continue;
      // Sanitize valueUSD at the boundary: NaN / Infinity / negative
      // (data corruption from manual entry or Drive-sync artifact)
      // → 0. Without this, downstream aggregates poison every
      // share computation. Round-11 audit HIGH. Engine-purity
      // contract: bad input contributes 0, not NaN.
      const valueUSD =
        Number.isFinite(holding.valueUSD)
          ? Math.max(0, holding.valueUSD)
          : 0;
      // Cash always counts toward the cash-equivalent share —
      // even if marked illiquid (a frozen savings account is
      // still cash for the SORR-buffer accounting).
      if (holding.kind === "cash") {
        cashUSD += valueUSD;
        continue;
      }
      // Liquidity gate (primary residence, private stock, isIlliquid).
      if (!isLiquid(holding)) {
        excludedIlliquidUSD += valueUSD;
        if (
          holding.kind === "real_estate" &&
          holding.isPrimaryResidence === true
        ) {
          excludedPrimaryResidenceUSD += valueUSD;
        }
        continue;
      }
      // Short-duration bonds count toward the cash-equivalent
      // buffer — they're not sold (per user: "short duration
      // bonds 1 year or less are basically cash already").
      if (isCashEquivalentBond(holding)) {
        shortDurationBondUSD += valueUSD;
        continue;
      }
      // User-explicit opt-out — keep this holding (high-conviction
      // pick, employer concentration, etc.).
      if (isExcludedFromCashBucketSale(holding)) {
        excludedUserOptOutUSD += valueUSD;
        continue;
      }
      const bucket = classifyHolding(holding);
      if (bucket == null) continue;
      candidates.push({ holding, account, bucket, isTaxable });
    }
  }

  // Effective cash-equivalent share = (cash + short bonds) / NW.
  // Both numerator and denominator are consistent now (NW = caller-
  // passed `totalNetWorthUSD`, typically `portfolio.netWorthUSD`
  // which is net of liabilities). Used as the BASELINE for
  // amount-to-raise.
  const effectiveCashEquivalentShare =
    safeNW > 0
      ? Math.min(1, (cashUSD + shortDurationBondUSD) / safeNW)
      : 0;
  const amountToRaiseUSD = Math.max(
    0,
    (safeRequested - effectiveCashEquivalentShare) * safeNW,
  );

  // Sort candidates by (bucket-priority asc, leverage desc within
  // bucket, isTaxable asc within tier [tax-advantaged first to
  // minimize tax bill], deterministic id tie-break for stable
  // output across runs).
  const priorityIndex: Record<SaleBucket, number> = {
    leveragedEquity: 0,
    regularEquity: 1,
    bonds: 2,
    commodity: 3,
    realEstate: 4,
    otherAlts: 5,
  };
  candidates.sort((a, b) => {
    const da = priorityIndex[a.bucket] - priorityIndex[b.bucket];
    if (da !== 0) return da;
    const dl = leverageOf(b.holding) - leverageOf(a.holding);
    if (dl !== 0) return dl;
    const dt = (a.isTaxable ? 1 : 0) - (b.isTaxable ? 1 : 0);
    if (dt !== 0) return dt;
    return a.holding.id.localeCompare(b.holding.id);
  });

  // Walk in sorted order, drain enough to satisfy amountToRaiseUSD.
  // Per-holding sale ledger captures everything (sold or not) for
  // the UI's "sale-plan breakdown" + "candidates" lists.
  let remaining = amountToRaiseUSD;
  const perBucketAcc: Record<
    SaleBucket,
    { face: number; taxableFace: number; tax: number }
  > = {
    leveragedEquity: { face: 0, taxableFace: 0, tax: 0 },
    regularEquity: { face: 0, taxableFace: 0, tax: 0 },
    bonds: { face: 0, taxableFace: 0, tax: 0 },
    commodity: { face: 0, taxableFace: 0, tax: 0 },
    realEstate: { face: 0, taxableFace: 0, tax: 0 },
    otherAlts: { face: 0, taxableFace: 0, tax: 0 },
  };
  let totalTaxOwedUSD = 0;
  let amountRaisedUSD = 0;
  const candidateLedger: HoldingSale[] = [];
  for (const c of candidates) {
    const available = Math.max(0, c.holding.valueUSD);
    let fromThis = 0;
    let taxThisHolding = 0;
    if (remaining > 1e-9 && available > 0) {
      fromThis = Math.min(remaining, available);
      perBucketAcc[c.bucket].face += fromThis;
      if (c.isTaxable) {
        perBucketAcc[c.bucket].taxableFace += fromThis;
        taxThisHolding = fromThis * effectiveGainFraction * effectiveTaxRate;
        perBucketAcc[c.bucket].tax += taxThisHolding;
        totalTaxOwedUSD += taxThisHolding;
      }
      remaining -= fromThis;
      amountRaisedUSD += fromThis;
    }
    candidateLedger.push({
      holdingId: c.holding.id,
      accountId: c.account.id,
      label: labelFor(c.holding),
      kind: c.holding.kind,
      bucket: c.bucket,
      leverage: leverageOf(c.holding),
      isTaxable: c.isTaxable,
      accountCategory: c.account.category,
      fullValueUSD: available,
      faceValueSoldUSD: fromThis,
      taxOwedUSD: taxThisHolding,
    });
  }

  const perBucket: SaleBucketSummary[] = SALE_PRIORITY_ORDER.map((bucket) => ({
    bucket,
    faceValueSoldUSD: perBucketAcc[bucket].face,
    taxableFaceValueSoldUSD: perBucketAcc[bucket].taxableFace,
    taxOwedUSD: perBucketAcc[bucket].tax,
  }));
  const sales = candidateLedger.filter((s) => s.faceValueSoldUSD > 0);

  // Post-tax effective cash fraction: what the SIMULATOR should
  // actually run with. Numerator = existing cash + sales net of
  // tax. Denominator = NW net of tax. Without this, the simulator
  // would pretend `requestedCashFraction × postTaxNW` worth of cash
  // exists, magicking $totalTaxOwed of cash out of thin air
  // (Round-1 audit HIGH). When tax is zero (no taxable-account
  // sales) this equals the user's request.
  const postTaxNW = Math.max(0, safeNW - totalTaxOwedUSD);
  const netCashFromSales = Math.max(0, amountRaisedUSD - totalTaxOwedUSD);
  const effectiveCashFractionPostTax =
    postTaxNW > 0
      ? Math.min(1, (cashUSD + netCashFromSales) / postTaxNW)
      : 0;

  return {
    effectiveCashEquivalentShare,
    effectiveCashFractionPostTax,
    amountToRaiseUSD,
    amountRaisedUSD,
    shortfallUSD: Math.max(0, amountToRaiseUSD - amountRaisedUSD),
    totalTaxOwedUSD,
    perBucket,
    sales,
    excludedIlliquidUSD,
    excludedPrimaryResidenceUSD,
    excludedUserOptOutUSD,
    shortDurationBondUSD,
    effectiveTaxRate,
    effectiveGainFraction,
  };
}

/**
 * Read the leverage field uniformly across holding kinds. Cash,
 * private_stock, and other don't have a leverage field — those
 * default to 1.0 (no leverage). Equity/bond/crypto/real_estate
 * carry an explicit leverage number.
 */
function leverageOf(h: Holding): number {
  if ("leverage" in h && typeof h.leverage === "number") return h.leverage;
  return 1;
}
