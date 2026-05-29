import type {
  AccountId,
  HoldingId,
  HouseholdId,
  LiabilityId,
  MemberId,
  ScenarioId,
} from "@/lib/entityIds";

// Re-export so consumers that already import everything from
// `./types` keep working without touching their import lines.
export type {
  AccountId,
  HoldingId,
  HouseholdId,
  LiabilityId,
  MemberId,
  ScenarioId,
} from "@/lib/entityIds";
export {
  castAccountId,
  castHoldingId,
  castHouseholdId,
  castLiabilityId,
  castMemberId,
  castScenarioId,
} from "@/lib/entityIds";

export type AccountCategory =
  | "401K"
  | "ROTH_401K"
  | "TRAD_IRA"
  | "ROTH_IRA"
  | "HSA"
  | "BROKERAGE"
  | "SAVINGS"
  | "CHECKING"
  | "FIVE_29"
  | "TRUMP_ACCOUNT"
  | "CRYPTO"
  | "REAL_ESTATE"
  | "OTHER";

export type TaxTreatment =
  | "PRE_TAX"
  | "ROTH"
  | "TAXABLE"
  | "HSA"
  | "EDUCATION";

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  PRE_TAX: "Pre-tax",
  ROTH: "Roth",
  TAXABLE: "Taxable",
  HSA: "HSA · triple-tax",
  EDUCATION: "Education",
};

export const TAX_TREATMENT_BY_CATEGORY: Record<AccountCategory, TaxTreatment> = {
  "401K": "PRE_TAX",
  ROTH_401K: "ROTH",
  TRAD_IRA: "PRE_TAX",
  ROTH_IRA: "ROTH",
  HSA: "HSA",
  BROKERAGE: "TAXABLE",
  SAVINGS: "TAXABLE",
  CHECKING: "TAXABLE",
  FIVE_29: "EDUCATION",
  // Trump Account: a federally-seeded tax-deferred account for newborn
  // US citizens (One Big Beautiful Bill Act, launching 2026-07-04).
  // Bucketed under EDUCATION because it shares the "dedicated to a
  // child's future use, locked until majority" semantic with 529s.
  // The math layer is unchanged — the new category just routes through
  // the existing EDUCATION tax-bucket logic.
  TRUMP_ACCOUNT: "EDUCATION",
  CRYPTO: "TAXABLE",
  REAL_ESTATE: "TAXABLE",
  OTHER: "TAXABLE",
};

export const ACCOUNT_CATEGORY_LABELS: Record<AccountCategory, string> = {
  "401K": "401(k)",
  ROTH_401K: "Roth 401(k)",
  TRAD_IRA: "Traditional IRA",
  ROTH_IRA: "Roth IRA",
  HSA: "HSA",
  BROKERAGE: "Brokerage",
  SAVINGS: "Savings",
  CHECKING: "Checking",
  FIVE_29: "529",
  TRUMP_ACCOUNT: "Trump Account",
  CRYPTO: "Crypto",
  REAL_ESTATE: "Real estate",
  OTHER: "Other",
};

// ── Equity (stock) classification ──
export const STYLE_BOX_CELLS = [
  "LARGE_VALUE",
  "LARGE_BLEND",
  "LARGE_GROWTH",
  "MID_VALUE",
  "MID_BLEND",
  "MID_GROWTH",
  "SMALL_VALUE",
  "SMALL_BLEND",
  "SMALL_GROWTH",
] as const;
export type StyleBoxCell = (typeof STYLE_BOX_CELLS)[number];
export type StyleBoxAllocation = Record<StyleBoxCell, number>;

export const STYLE_BOX_SIZE_LABELS = ["Large", "Mid", "Small"] as const;
export const STYLE_BOX_STYLE_LABELS = ["Value", "Blend", "Growth"] as const;

export const STYLE_BOX_GRID: StyleBoxCell[][] = [
  ["LARGE_VALUE", "LARGE_BLEND", "LARGE_GROWTH"],
  ["MID_VALUE", "MID_BLEND", "MID_GROWTH"],
  ["SMALL_VALUE", "SMALL_BLEND", "SMALL_GROWTH"],
];

export const EMPTY_STYLE_BOX: StyleBoxAllocation = {
  LARGE_VALUE: 0,
  LARGE_BLEND: 0,
  LARGE_GROWTH: 0,
  MID_VALUE: 0,
  MID_BLEND: 0,
  MID_GROWTH: 0,
  SMALL_VALUE: 0,
  SMALL_BLEND: 0,
  SMALL_GROWTH: 0,
};

// ── Bond (fixed income) classification ──
// Two independent axes: type (Govt vs Corporate) and geography (shared with
// equities). Each axis sums to 100% per holding.
export const BOND_TYPES = ["GOVT", "CORPORATE"] as const;
export type BondType = (typeof BOND_TYPES)[number];
export type BondTypeAllocation = Record<BondType, number>;

export const BOND_TYPE_LABELS: Record<BondType, string> = {
  GOVT: "Government",
  CORPORATE: "Corporate",
};

export const EMPTY_BOND_TYPE: BondTypeAllocation = {
  GOVT: 0,
  CORPORATE: 0,
};

// ── Commodity sub-classification ──
// Two-tier breakdown that mirrors how commodity index providers like
// Bloomberg / S&P GSCI / DBC structure their constituents:
//   Tier 1: Metals (precious + base) vs Energy / Agriculture / Livestock
//   Tier 2: Specific contract within each tier
//
// Each tier-2 record sums to 1 *within its tier*. The top-level
// `metalsShare` controls how the tiers combine into the final
// breakdown — 0.2 metalsShare + 0.8 energyAgShare means 20% of the
// holding's commodity face is metals, 80% is energy/ag.
export const METAL_TYPES = [
  "GOLD",
  "SILVER",
  "PLATINUM",
  "PALLADIUM",
  "COPPER",
  "ALUMINUM",
  "LEAD",
  "ZINC",
  "OTHER_METALS",
] as const;
export type MetalType = (typeof METAL_TYPES)[number];
export type MetalAllocation = Record<MetalType, number>;

export const METAL_LABELS: Record<MetalType, string> = {
  GOLD: "Gold",
  SILVER: "Silver",
  PLATINUM: "Platinum",
  PALLADIUM: "Palladium",
  COPPER: "Copper",
  ALUMINUM: "Aluminum",
  LEAD: "Lead",
  ZINC: "Zinc",
  OTHER_METALS: "Other metals",
};

export const EMPTY_METAL: MetalAllocation = {
  GOLD: 0,
  SILVER: 0,
  PLATINUM: 0,
  PALLADIUM: 0,
  COPPER: 0,
  ALUMINUM: 0,
  LEAD: 0,
  ZINC: 0,
  OTHER_METALS: 0,
};

export const ENERGY_AG_TYPES = [
  "CRUDE_OIL",
  "NATURAL_GAS",
  "GASOLINE",
  "HEATING_OIL",
  "WHEAT",
  "CORN",
  "SOYBEAN",
  "SUGAR",
  "COFFEE",
  "COTTON",
  "CATTLE",
  "OTHER_ENERGY_AG",
] as const;
export type EnergyAgType = (typeof ENERGY_AG_TYPES)[number];
export type EnergyAgAllocation = Record<EnergyAgType, number>;

export const ENERGY_AG_LABELS: Record<EnergyAgType, string> = {
  CRUDE_OIL: "Crude oil",
  NATURAL_GAS: "Natural gas",
  GASOLINE: "Gasoline",
  HEATING_OIL: "Heating oil",
  WHEAT: "Wheat",
  CORN: "Corn",
  SOYBEAN: "Soybean",
  SUGAR: "Sugar",
  COFFEE: "Coffee",
  COTTON: "Cotton",
  CATTLE: "Cattle",
  OTHER_ENERGY_AG: "Other energy/ag",
};

export const EMPTY_ENERGY_AG: EnergyAgAllocation = {
  CRUDE_OIL: 0,
  NATURAL_GAS: 0,
  GASOLINE: 0,
  HEATING_OIL: 0,
  WHEAT: 0,
  CORN: 0,
  SOYBEAN: 0,
  SUGAR: 0,
  COFFEE: 0,
  COTTON: 0,
  CATTLE: 0,
  OTHER_ENERGY_AG: 0,
};

/**
 * Optional sub-classification of a commodity holding's exposure.
 * Pure metadata for display — does NOT affect class-level totals or
 * portfolio leverage (the holding still rolls up under "Commodities"
 * in the top-level breakdown).
 */
export type CommodityBreakdown = {
  /** Fraction of the holding in Metals (0-1). The complement is Energy/Ag. */
  metalsShare: number;
  /** Per-item weights within the Metals tier. Sums to 1 when used. */
  metals: MetalAllocation;
  /** Per-item weights within the Energy/Ag tier. Sums to 1 when used. */
  energyAg: EnergyAgAllocation;
};

export function metalOf(cells: Partial<MetalAllocation>): MetalAllocation {
  return { ...EMPTY_METAL, ...cells };
}
export function energyAgOf(
  cells: Partial<EnergyAgAllocation>,
): EnergyAgAllocation {
  return { ...EMPTY_ENERGY_AG, ...cells };
}

// ── Geography ──
export const GEOGRAPHIES = ["US", "DEVELOPED", "EMERGING"] as const;
export type Geography = (typeof GEOGRAPHIES)[number];
export type GeographyAllocation = Record<Geography, number>;

export const GEOGRAPHY_LABELS: Record<Geography, string> = {
  US: "US",
  DEVELOPED: "Developed Intl",
  EMERGING: "Emerging Intl",
};

export const EMPTY_GEOGRAPHY: GeographyAllocation = {
  US: 0,
  DEVELOPED: 0,
  EMERGING: 0,
};

// ── Holdings ──
/**
 * A single leg of a multi-asset ETF's composition. Used for funds like
 * NTSX (90% stocks + 60% bonds via Treasury futures), GDE (90% stocks +
 * 90% gold via futures), RSST (100% stocks + 100% managed futures), etc.
 * The sum of leg weights gives the fund's intrinsic leverage (NTSX = 1.5;
 * GDE = 1.8; RSST = 2.0). Each leg's contribution to portfolio exposure
 * is weight × holding.valueUSD.
 *
 * `kind` mirrors AssetClass for the leg's class. `commodity` is allowed
 * here (gold, etc.); it does not yet appear as a top-level AssetClass,
 * so commodity legs roll into "other" in the class breakdown.
 */
export type CompositionLegKind =
  | "equity"
  | "bond"
  | "cash"
  | "crypto"
  | "commodity"
  | "other";

export type CompositionLeg = {
  kind: CompositionLegKind;
  /** Fraction of face value the leg is exposed to. NTSX equity leg = 0.9. */
  weight: number;
  /**
   * Expected real CAGR for this leg. When absent, the engine falls back
   * to a class default (equity 7%, bond 1.5%, cash 0%, commodity 1%,
   * other 3%). Useful so projection math can blend NTSX's 90% × 7%
   * stocks with its 60% × 1.5% bonds rather than assuming a single
   * scalar return on the wrapper.
   */
  expectedRealCAGR?: number;
};

export type EquityHolding = {
  kind: "equity";
  id: HoldingId;
  symbol: string;
  shares: number;
  lastPriceUSD: number;
  lastPricedAt: number | null;
  isManualPrice: boolean;
  enteredAsShares: boolean;
  acquiredAt: number | null;
  valueUSD: number;
  expectedRealCAGR: number;
  leverage: number;
  styleBox: StyleBoxAllocation;
  geography: GeographyAllocation;
  /** User override: treat this holding as illiquid (see isLiquid). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority is allowed to sell it). Composes with
   * `isIlliquid` — an illiquid holding is already excluded from
   * bucket sales; this flag is for LIQUID holdings the user wants
   * to preserve (e.g. high-conviction long-held positions, tax-
   * loss carryforward setups, employer-share concentration plays).
   * Consumed by `lib/portfolio/bucketFunding.ts`.
   */
  excludeFromCashBucketSale?: boolean;
  /**
   * Optional intrinsic composition for multi-asset ETFs (NTSX, GDE, etc.).
   * When present, the holding's effective leverage equals the sum of
   * leg weights (overriding the scalar `leverage` field), and the class
   * breakdown decomposes the holding's face value across the legs.
   * Absent = behave as a pure equity holding (today's behavior).
   */
  composition?: CompositionLeg[];
};

export type BondHolding = {
  kind: "bond";
  id: HoldingId;
  symbol: string;
  shares: number;
  lastPriceUSD: number;
  lastPricedAt: number | null;
  isManualPrice: boolean;
  enteredAsShares: boolean;
  acquiredAt: number | null;
  valueUSD: number;
  expectedRealCAGR: number;
  leverage: number;
  /**
   * Did the user explicitly set leverage (true), or is it auto-
   * derived from `averageDurationYears` via
   * `bondLeverageFromDuration` (false / undefined)?
   *
   * When auto, changing duration immediately recomputes leverage —
   * a bond's effective leverage is mostly a function of its
   * rate-sensitivity, so the two fields should move together.
   * When manual (e.g. user typed a custom value, or a leveraged
   * preset like TMF / 3× treasury), leverage is frozen until
   * the user clicks "Reset to auto" in the editor.
   *
   * Optional for back-compat: holdings that predate this field
   * are treated as manual (preserves their existing leverage
   * unchanged when duration changes).
   */
  bondLeverageIsManual?: boolean;
  bondType: BondTypeAllocation;
  geography: GeographyAllocation;
  averageDurationYears: number;
  /** User override: treat this holding as illiquid (see isLiquid). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority is allowed to sell it). Composes with
   * `isIlliquid` — an illiquid holding is already excluded from
   * bucket sales; this flag is for LIQUID holdings the user wants
   * to preserve (e.g. high-conviction long-held positions, tax-
   * loss carryforward setups, employer-share concentration plays).
   * Consumed by `lib/portfolio/bucketFunding.ts`.
   */
  excludeFromCashBucketSale?: boolean;
  /**
   * Optional intrinsic composition for multi-asset bond wrappers
   * (e.g. a TIPS-anchored fund that also overlays gold/crypto).
   * When present, the holding's effective leverage equals the sum
   * of leg weights, and the class breakdown decomposes the face
   * value across legs. The bond leg (if any) inherits the wrapper's
   * bondType / geography / averageDurationYears.
   */
  composition?: CompositionLeg[];
};

export type CashHolding = {
  kind: "cash";
  id: HoldingId;
  valueUSD: number;
  expectedRealCAGR: number;
  geography: GeographyAllocation;
  /** User override: treat this holding as illiquid (see isLiquid). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority is allowed to sell it). Composes with
   * `isIlliquid` — an illiquid holding is already excluded from
   * bucket sales; this flag is for LIQUID holdings the user wants
   * to preserve (e.g. high-conviction long-held positions, tax-
   * loss carryforward setups, employer-share concentration plays).
   * Consumed by `lib/portfolio/bucketFunding.ts`.
   */
  excludeFromCashBucketSale?: boolean;
};

export type CryptoHolding = {
  kind: "crypto";
  id: HoldingId;
  symbol: string;
  shares: number;
  lastPriceUSD: number;
  lastPricedAt: number | null;
  isManualPrice: boolean;
  enteredAsShares: boolean;
  acquiredAt: number | null;
  valueUSD: number;
  expectedRealCAGR: number;
  /**
   * Intrinsic leverage. Default 1. Spot crypto ETFs (IBIT, FBTC, GBTC,
   * ETHA, ETHE) are 1×. Leveraged crypto ETFs (BITX = 2× Bitcoin)
   * carry a >1 multiplier that flows through to portfolio effective
   * leverage and stress tests.
   */
  leverage?: number;
  /** User override: treat this holding as illiquid (see isLiquid). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority is allowed to sell it). Composes with
   * `isIlliquid` — an illiquid holding is already excluded from
   * bucket sales; this flag is for LIQUID holdings the user wants
   * to preserve (e.g. high-conviction long-held positions, tax-
   * loss carryforward setups, employer-share concentration plays).
   * Consumed by `lib/portfolio/bucketFunding.ts`.
   */
  excludeFromCashBucketSale?: boolean;
  /**
   * Optional intrinsic composition. Useful for a hypothetical crypto-
   * dominant multi-asset wrapper (e.g. a BTC-allocated treasury
   * company stock). Most crypto positions don't need this.
   */
  composition?: CompositionLeg[];
};

/**
 * Commodities are a first-class asset class — distinct from equity,
 * bonds, cash, crypto, and real estate. They include precious metals
 * (gold, silver), industrial metals, energy, agriculture, and broad
 * commodity baskets.
 *
 * A user might hold them as:
 *   - A commodity ETF (GLD, IAU, GLDM, SGOL, SLV, DBC, USO) — live
 *     priced via the same /api/quote pipeline as equity tickers.
 *   - A manual position with no ticker — e.g. "Gold jewelry", "Physical
 *     silver coins", "Vault gold". The user enters a display name and
 *     face value; isManualPrice=true skips quote attempts.
 *
 * Shape mirrors CryptoHolding so the share-tracked update helpers
 * (updateHoldingValue / Shares / Price) work uniformly via
 * isPricedHolding. For manual entries the convention is shares=1,
 * lastPriceUSD=valueUSD, isManualPrice=true.
 */
export type CommodityHolding = {
  kind: "commodity";
  id: HoldingId;
  /** Ticker (GLD, IAU, …) for live-priced ETFs, or a display name for manual entries ("Gold jewelry"). */
  symbol: string;
  shares: number;
  lastPriceUSD: number;
  lastPricedAt: number | null;
  isManualPrice: boolean;
  enteredAsShares: boolean;
  acquiredAt: number | null;
  valueUSD: number;
  expectedRealCAGR: number;
  /** User override: treat this holding as illiquid (e.g. physical jewelry). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority allowed). Same semantic as on equity / bond /
   * etc. — see those types' docs.
   */
  excludeFromCashBucketSale?: boolean;
  /**
   * Optional intrinsic composition. Useful for commodity-dominant
   * multi-asset wrappers (e.g. a gold fund that overlays bond income).
   */
  composition?: CompositionLeg[];
  /**
   * Optional Pro sub-classification: Metals vs Energy/Ag at tier 1,
   * specific contracts at tier 2 (gold, silver, copper, …; crude oil,
   * natural gas, wheat, corn, …). Pure display metadata. Pre-populated
   * by commodity preset for known tickers (GLD → 100% gold, DBC →
   * the actual broad mix, USO → 100% crude oil).
   */
  breakdown?: CommodityBreakdown;
};

export type RealEstateHolding = {
  kind: "real_estate";
  id: HoldingId;
  name: string;
  valueUSD: number;
  expectedRealCAGR: number;
  acquiredAt: number | null;
  /**
   * Inherent leverage from a mortgage. For a $500K property with a
   * $100K equity stake (i.e. $400K mortgage), leverage is 5.0. The
   * valueUSD field tracks the *equity* in the property (net of debt
   * principal) so net worth math stays correct; leverage captures the
   * fact that the *gross asset* is larger and moves with the full
   * property price. Default 1 = owned outright.
   */
  leverage: number;
  /**
   * Marks this property as the user's primary residence. Primary
   * residences are treated as illiquid for Independence planning — you can't
   * realistically tap them to fund retirement spending without moving.
   * Other real estate (rentals, second homes, land held for sale) is
   * liquid by default. Undefined = liquid (back-compat).
   */
  isPrimaryResidence?: boolean;
  /**
   * Manual illiquid override for non-primary real estate. Sometimes a
   * rental or held-for-sale property genuinely isn't spendable
   * (tenants, partnership tied up, raw land, etc.) — the user can flip
   * this on so the Liquid net-worth view drops it the same way it
   * drops a primary residence. Mirrors the `isIlliquid` flag on
   * equity / bond / cash / crypto / commodity / other.
   */
  isIlliquid?: boolean;
  /**
   * User override: keep this property when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority allowed). Primary residences are ALREADY
   * excluded structurally; this flag is for sellable RE (rentals,
   * land) the user explicitly wants preserved.
   */
  excludeFromCashBucketSale?: boolean;
};

/**
 * Private company stock (founder / employee equity). Priced via the
 * latest 409A appraisal, NOT the most recent preferred-round price —
 * the holding creator intentionally collects shares × 409A so people
 * don't confuse the (typically inflated) preferred-round valuation
 * with the value of their common shares.
 *
 * Shape mirrors CryptoHolding so the share-tracked update helpers
 * (updateHoldingValue / Shares / Price) work uniformly via
 * isPricedHolding:
 *   - `symbol` carries the company name (e.g. "Acme Inc.")
 *   - `lastPriceUSD` is the latest 409A FMV per share
 *   - `lastPricedAt` is the 409A appraisal date
 *
 * preferredRoundPricePerShareUSD is captured separately for context
 * (e.g. the cap-table headline number) but is NOT used to compute
 * valueUSD. Forcing the user to enter the 409A is the point.
 */
export type PrivateStockHolding = {
  kind: "private_stock";
  id: HoldingId;
  symbol: string;
  shares: number;
  lastPriceUSD: number;
  lastPricedAt: number | null;
  isManualPrice: boolean;
  enteredAsShares: boolean;
  acquiredAt: number | null;
  valueUSD: number;
  expectedRealCAGR: number;
  /**
   * Same exposure-multiplier semantic as equity/bond/real-estate. The
   * common case is 1× (you own outright). Set higher if you levered
   * up to acquire — e.g. exercised options funded by a margin loan,
   * or QSBS held through a structure with operational leverage.
   */
  leverage: number;
  /** Optional, for context only — does not affect valueUSD. */
  preferredRoundPricePerShareUSD: number | null;
};

/**
 * Generic catch-all asset that doesn't fit the other kinds. Useful
 * for things like collectibles, jewelry, watches, art, vehicles,
 * vested-but-unsettled comp, an unclassified business stake, etc.
 *
 * Just a name + face value + an expected real CAGR. No price feed,
 * no shares concept, no styleBox / geography. Liquid by default;
 * the user can mark it illiquid via the standard isIlliquid flag.
 */
export type OtherHolding = {
  kind: "other";
  id: HoldingId;
  name: string;
  valueUSD: number;
  expectedRealCAGR: number;
  acquiredAt: number | null;
  /** User override: treat this holding as illiquid (see isLiquid). */
  isIlliquid?: boolean;
  /**
   * User override: keep this holding when the MC stress-test bucket
   * policy needs to sell assets to fund a larger cash bucket. Default
   * = false (auto-priority is allowed to sell it). Composes with
   * `isIlliquid` — an illiquid holding is already excluded from
   * bucket sales; this flag is for LIQUID holdings the user wants
   * to preserve (e.g. high-conviction long-held positions, tax-
   * loss carryforward setups, employer-share concentration plays).
   * Consumed by `lib/portfolio/bucketFunding.ts`.
   */
  excludeFromCashBucketSale?: boolean;
};

export type Holding =
  | EquityHolding
  | BondHolding
  | CashHolding
  | CryptoHolding
  | CommodityHolding
  | RealEstateHolding
  | PrivateStockHolding
  | OtherHolding;

/**
 * Holdings whose value derives from `shares × lastPriceUSD` (and which
 * therefore carry symbol / shares / lastPriceUSD / isManualPrice).
 * Includes equities, bonds, crypto, commodity, and private-stock. Cash
 * and real-estate hold a flat valueUSD only.
 */
export type PricedHolding =
  | EquityHolding
  | BondHolding
  | CryptoHolding
  | CommodityHolding
  | PrivateStockHolding;

export function isPricedHolding(h: Holding): h is PricedHolding {
  return (
    h.kind === "equity" ||
    h.kind === "bond" ||
    h.kind === "crypto" ||
    h.kind === "commodity" ||
    h.kind === "private_stock"
  );
}

/**
 * Holdings that can be live-priced through the /api/quote pipeline.
 * Commodity ETFs (GLD, IAU, DBC, …) and spot crypto ETFs (IBIT, FBTC,
 * GBTC, ETHA, …) all trade like stocks so Yahoo's endpoint works.
 * Manual-name commodity entries ("Gold jewelry") and the native
 * cryptocurrencies (BTC, ETH, USDC entered as units) stay manual.
 */
export type LivePriceableHolding =
  | EquityHolding
  | BondHolding
  | CommodityHolding
  | CryptoHolding;

export function isLivePriceable(h: Holding): h is LivePriceableHolding {
  if (h.kind === "equity" || h.kind === "bond") return true;
  // Commodity / crypto are live-priceable only when they carry a real
  // stock-market ticker. "Gold jewelry" or native BTC entries are
  // isManualPrice=true and don't ping /api/quote.
  if (h.kind === "commodity" || h.kind === "crypto") return !h.isManualPrice;
  return false;
}

export type AssetClass =
  | "equity"
  | "bond"
  | "cash"
  | "crypto"
  | "commodity"
  | "real_estate"
  | "private_stock"
  | "other";

// Per-class display labels + defaults live in `./holdingKinds` — the
// single source of truth for everything that varies by AssetClass.

// ── Helpers ──
export function styleBoxOf(
  cells: Partial<StyleBoxAllocation>,
): StyleBoxAllocation {
  return { ...EMPTY_STYLE_BOX, ...cells };
}

export function bondTypeOf(
  cells: Partial<BondTypeAllocation>,
): BondTypeAllocation {
  return { ...EMPTY_BOND_TYPE, ...cells };
}

export function geographyOf(
  cells: Partial<GeographyAllocation>,
): GeographyAllocation {
  return { ...EMPTY_GEOGRAPHY, ...cells };
}

// ── Account / Liability / Household ──
export type Account = {
  id: AccountId;
  category: AccountCategory;
  displayName: string;
  ownerId: string;
  holdings: Holding[];
  monthlyContributionUSD: number;
};

export type Liability = {
  id: LiabilityId;
  name: string;
  balanceUSD: number;
  annualInterestRate: number;
  monthlyPaymentUSD: number;
  ownerId: string;
};

export type Member = {
  id: MemberId;
  displayName: string;
  /**
   * Optional per-member annual gross income (USD). Rolls up to the
   * household via `householdIncomeSum`. Stored at the member level
   * because in a multi-earner household the savings-rate framing is
   * meaningful only when each earner's income is captured separately
   * (otherwise a $200K + $50K couple looks the same as a $250K solo
   * earner for divorce / per-member planning purposes).
   *
   * Optional (null) when the member doesn't earn (kid / retired
   * parent / non-earning partner).
   */
  incomeUSD?: number | null;
  /**
   * Optional per-member age. Rolls up via `householdAverageAge` for
   * surfaces that need a single number (e.g. the Fed-SCF percentile
   * benchmark). Stored at member level because age varies within
   * a household and the user shouldn't be forced into a single
   * "household age" lie.
   */
  age?: number | null;
  /**
   * Whether this member's per-member fields (income, age, blended
   * assumptions) feed household-level rollups. Defaults to true
   * when undefined — existing data pre-dating this field continues
   * to roll up exactly as before, with no SCHEMA_VERSION bump
   * needed.
   *
   * Use cases that motivated this flag:
   *   - "Hide my kid from the rollup temporarily" — kid drags the
   *     average age down, distorts the Fed-SCF percentile band.
   *     User wants to set them aside without losing the data.
   *   - A non-earning partner whose absence the user wants to model
   *     as a sensitivity check (Independence under solo income).
   *
   * Scope: this flag affects MEMBER-LEVEL rollups only. Accounts
   * and liabilities owned by an excluded member still count toward
   * household net worth — ownership-cascade is a deliberately
   * separate concern (the kid use-case has no owned accounts;
   * cascading would surprise users in the partner case). If the
   * user wants to exclude a member's accounts too, they reassign
   * ownership or move the accounts out.
   */
  includeInRollup?: boolean;
};

export type Household = {
  id: HouseholdId;
  members: Member[];
  accounts: Account[];
  liabilities: Liability[];
};

export type DrawdownPhase = {
  startMonthsAfterIndependence: number;
  withdrawalRate: number;
};

export type Assumptions = {
  targetNetWorthUSD: number;
  withdrawalRate: number;
  legacyFloorUSD: number;
  drawdownHorizonYears: number;
  expectedInflationRate: number;
  /**
   * Additional drawdown phases that kick in after Independence. Phase 0 is the
   * baseline `withdrawalRate`; entries here describe phase 1, 2, …,
   * each one specifying how many months after Independence it begins and the
   * new withdrawal rate. When a phase begins, the monthly draw is
   * recomputed as (current portfolio) × rate / 12 and held flat in
   * real dollars until the next phase.
   */
  drawdownPhases?: DrawdownPhase[];
  /**
   * Fraction of variable budget expenses the user expects to cut
   * in retirement. 0 = no haircut (variable = same as today;
   * default and back-compat-safe); 0.5 = halve variable spending;
   * 1 = drop variable entirely. Fixed expenses are never cut by
   * this lever — that's the whole point of the type distinction.
   *
   * Drives `suggestedIndependenceCorpus` on the Budget panel: a user with
   * \$2K/mo of variable expenses who plans a 50% retirement
   * lifestyle cut saves ~\$12K/yr of required spend → ~\$300K less
   * corpus at 4% SWR. Per-member-overridable like every other
   * assumption field.
   */
  retirementVariableHaircut?: number;
  /**
   * Conditional haircut mode: when true, the variable-expense
   * haircut applies ONLY in retirement years that follow a year
   * of negative real stock returns. Models the realistic "spend
   * less when scared" behavior real retirees exhibit (a.k.a.
   * "down-year spending guardrails" in retirement-planning
   * literature) — preserves standard of living in good years
   * while still tempering sequence-of-returns risk in bad ones.
   *
   * Default false (always-apply) for back-compat: existing plans
   * keep behaving exactly as they did pre-feature.
   *
   * Effect surfaces:
   *   - Monte Carlo simulator: applies the haircut in-loop based
   *     on prior-year stock return (year 0 of any path doesn't
   *     check — no prior year to read).
   *   - Corpus suggestion (`suggestedIndependenceCorpus`): when
   *     true, uses an effective haircut of `rate × historical
   *     down-year frequency` (~31% from 1928–2025) so the
   *     suggested corpus matches the realized average withdrawal
   *     instead of the always-apply best-case.
   *   - Static Independence projection: unchanged. The static
   *     compounder has no per-year sequence to react to; the
   *     in-loop conditional logic only makes sense in MC.
   *
   * Tradeoff vs. always-apply (which is the only mode pre-this-
   * field): conditional has HIGHER expected lifestyle (you don't
   * cut in good years), so survival % in MC is somewhere between
   * "no haircut" (worst survival, full lifestyle) and "always-
   * apply" (best survival, permanent lifestyle cut).
   */
  retirementVariableHaircutOnDownYearOnly?: boolean;
  /**
   * Fraction of retirement spend that is "variable" (the slice
   * the haircut can reduce). Optional override; when unset, the
   * effective value is derived from the user's budget items
   * (variable monthly / total retirement monthly) — or falls
   * back to 0.35 when no budget exists (BLS Consumer Expenditure
   * Survey median for retirees: fixed ≈ housing/insurance/
   * utilities/Medicare premiums; variable ≈ everything else).
   *
   * Why this is a SHARE (a fraction), not a dollar amount:
   * the MC card's annual-spend input may not match the budget's
   * implied retirement spend (target-NW × SWR can diverge from
   * budget-derived spend by a lot). Storing a SHARE means the
   * haircut applies to a consistent fraction of whatever spend
   * the user is actually testing — no double-cutting, no
   * silently-wrong amounts when target and budget disagree.
   *
   * Resolved via `effectiveVariableShare(items, override)` in
   * lib/budget.ts.
   */
  retirementVariableShare?: number;
  /**
   * Effective tax rate the user expects on retirement withdrawals.
   * Used to gross up the suggested-Independence-corpus math: if the user
   * needs `S` to spend (net) and faces a tax rate `t`, they have
   * to withdraw `S / (1 - t)` to net `S` after tax. Corpus is
   * sized against the gross withdrawal, not the net spend.
   *
   * Defaults to 0.20 when unspecified (a reasonable blend across
   * pre-tax, Roth, and taxable buckets — the user can dial it).
   * Clamped to [0, 0.99] at the math layer to avoid divide-by-
   * zero when t = 1.
   */
  retirementTaxRate?: number;
  /**
   * Fraction of a sold holding's current value treated as taxable
   * capital gain when modeling the bucket-funding + deleveraging
   * cap-gains tax in the historical Monte Carlo card. The app does
   * not track per-holding cost basis, so the engines need a single
   * portfolio-wide assumption to convert "I sold $X face value" into
   * "I owe $X × gainFraction × retirementTaxRate" cap-gains tax.
   *
   * Examples:
   *   1.0 — treat ALL current value as gain (conservative; correct
   *         for very long-held positions that have already doubled+).
   *   0.5 — treat half as gain (rough proxy for a position that has
   *         doubled — basis is half the current value).
   *   0.0 — no gain at all (e.g. just-purchased, basis ≈ value).
   *
   * Defaults to 1.0 (the conservative behavior the engine has shipped
   * with). Clamped to [0, 1] at the math layer. Flows through to
   * both `planBucketFunding` and `computeLeveragedEquityBuckets` so
   * the two tax computations stay internally consistent.
   */
  assumedCapGainsFraction?: number;
  /**
   * SORR mitigation — freeze withdrawals in NOMINAL terms for the
   * first N retirement years. In the engine's real-terms math this
   * translates to a geometric decay of the real withdrawal during
   * the freeze window:
   *   real_y = annualSpend / (1 + expectedInflationRate) ** y
   * for y ∈ [0, retirementFixedNominalYears), then snaps back to
   * full real-flat. 10 years at 3% inflation cuts cumulative real
   * spend by ~14% of one year's amount — meaningful relief during
   * the early-retirement danger zone without permanently dropping
   * the standard of living.
   *
   * 0 (default / undefined) → no freeze, identical to today's
   * behavior. Per-member-overridable like every other field; the
   * inflation rate consumed by the engine is the same
   * `expectedInflationRate` on this assumptions object, so users
   * don't have to set inflation twice.
   */
  retirementFixedNominalYears?: number;
};

export type ScenarioOverrides = {
  // Global multipliers / deltas applied to every account / holding
  contributionMultiplier?: number; // 1 = no change; 1.5 = +50%
  cagrDelta?: number; // additive delta (0.01 = +1pt) applied to every holding
  // Per-account replacement of the monthly contribution amount
  accountContributions?: Record<string, number>;
  // Per-holding replacement of expected real CAGR
  holdingCAGRs?: Record<string, number>;
  // Global assumption overrides
  withdrawalRate?: number;
  targetNetWorthUSD?: number;
  legacyFloorUSD?: number;
};

export type Scenario = {
  id: ScenarioId;
  name: string;
  color: string;
  overrides: ScenarioOverrides;
  createdAt: number;
};

// ── Aggregation helpers ──
export function holdingValue(h: Holding): number {
  return h.valueUSD;
}

export function holdingClass(h: Holding): AssetClass {
  return h.kind;
}

/**
 * Single-source display label for a holding across the union. Priced
 * holdings carry a `symbol` (ticker); cash / real-estate / other carry
 * a free-text `name`. Falls back to the kind as a last resort so this
 * helper never returns empty for any valid Holding.
 */
export function holdingLabel(h: Holding): string {
  if ("symbol" in h && h.symbol) return h.symbol;
  if ("name" in h && h.name) return h.name;
  return h.kind;
}

export function holdingLeverage(h: Holding): number {
  // Composition wrappers' effective leverage = sum of leg weights.
  // Applies to any priced holding (equity / bond / crypto / commodity)
  // — so NTSX (equity wrapper, 1.5×), a TIPS+gold+crypto fund (bond
  // wrapper, 1.9×), and a BTC-overlay equity wrapper all report the
  // correct intrinsic leverage.
  if (
    h.kind === "equity" ||
    h.kind === "bond" ||
    h.kind === "crypto" ||
    h.kind === "commodity"
  ) {
    if (h.composition && h.composition.length > 0) {
      return h.composition.reduce((s, l) => s + l.weight, 0);
    }
  }
  if (h.kind === "equity" || h.kind === "bond") return h.leverage;
  if (h.kind === "crypto") return h.leverage ?? 1;
  if (h.kind === "real_estate" || h.kind === "private_stock") return h.leverage;
  // Cash, commodity (plain), and "other" carry no leverage concept.
  return 1;
}

/**
 * Default real CAGR for a composition leg whose `expectedRealCAGR` is
 * not specified. Mirrors the figures used in the existing presets.
 */
export function defaultLegCAGR(kind: CompositionLegKind): number {
  switch (kind) {
    case "equity":
      return 0.07;
    case "bond":
      return 0.015;
    case "cash":
      return 0;
    case "crypto":
      return 0.05; // long-run real CAGR guess for BTC/ETH-class exposure
    case "commodity":
      return 0.01;
    case "other":
      return 0.03;
  }
}

/**
 * Map a composition leg's kind to the top-level AssetClass bucket it
 * should appear under in the class breakdown. Commodity is now a
 * first-class AssetClass — GDE's 90% gold leg goes straight into the
 * commodity column instead of rolling into "other".
 */
export function legAssetClass(kind: CompositionLegKind): AssetClass {
  return kind;
}

/**
 * Compute the holding's effective real CAGR using its composition when
 * present. Bridges the NTSX-style wrapper to projection math:
 *   NTSX = 0.9 × 7% (equity) + 0.6 × 1.5% (bond) = 7.2% on face
 * (not the 9%-ish you'd get assuming the whole wrapper is equity).
 * Returns null when no composition is set so callers can fall back.
 */
export function compositionWeightedCAGR(h: Holding): number | null {
  if (
    h.kind !== "equity" &&
    h.kind !== "bond" &&
    h.kind !== "crypto" &&
    h.kind !== "commodity"
  ) {
    return null;
  }
  if (!h.composition || h.composition.length === 0) return null;
  let total = 0;
  for (const leg of h.composition) {
    const rate = leg.expectedRealCAGR ?? defaultLegCAGR(leg.kind);
    total += leg.weight * rate;
  }
  return total;
}

/**
 * Exposure-weighted blended CAGR for a composition wrapper. Same as
 * compositionWeightedCAGR but typed strictly on its leg array (no
 * holding-kind check) — used by setHoldingComposition to re-derive
 * the wrapper's stored `expectedRealCAGR` whenever its legs change,
 * so projectIndependence / accountWeightedCAGR / futureAllocation (which all
 * read the wrapper-level scalar) stay consistent with the leg-driven
 * computePortfolio.weightedRealCAGR.
 */
export function blendedCAGRFromLegs(legs: CompositionLeg[]): number {
  let total = 0;
  for (const leg of legs) {
    const rate = leg.expectedRealCAGR ?? defaultLegCAGR(leg.kind);
    total += leg.weight * rate;
  }
  return total;
}

export function accountValue(a: Account): number {
  return a.holdings.reduce((s, h) => s + h.valueUSD, 0);
}

export function accountWeightedCAGR(a: Account): number {
  const total = accountValue(a);
  if (total <= 0) return 0;
  return a.holdings.reduce(
    (s, h) => s + (h.valueUSD / total) * h.expectedRealCAGR,
    0,
  );
}

export function householdNetWorth(h: Household): number {
  const acc = h.accounts.reduce((s, a) => s + accountValue(a), 0);
  const liab = h.liabilities.reduce((s, l) => s + l.balanceUSD, 0);
  return acc - liab;
}

/**
 * Members eligible to roll up into household-level computations.
 *
 * Single source of truth for the `includeInRollup` flag — every
 * household-level helper (`householdIncomeSum`,
 * `householdAverageAge`, `householdYoungestAge`,
 * `effectiveHouseholdAssumptions`) filters through here. New
 * rollup surfaces should call this instead of iterating
 * `h.members` directly.
 *
 * The `!== false` check (not `=== true`) is deliberate: members
 * persisted before this flag existed have `includeInRollup ===
 * undefined`, and we want them to keep rolling up by default.
 * Only an explicit `false` excludes a member.
 */
export function activeMembers(h: Household): Member[] {
  return h.members.filter((m) => m.includeInRollup !== false);
}

/**
 * Set of member ids currently rolling up. Used by callers that
 * filter ownership-keyed collections (accounts, liabilities,
 * budget items) — checking set membership is faster + clearer
 * than re-deriving the active-member array each time.
 */
export function activeMemberIds(h: Household): Set<string> {
  return new Set(activeMembers(h).map((m) => m.id));
}

/**
 * The household scoped to ROLLUP membership.
 *
 * Returns a new Household containing only:
 *   - members flagged as included (or with the flag unset, which
 *     defaults to included for back-compat)
 *   - accounts owned by an included member
 *   - liabilities owned by an included member
 *
 * This is the canonical "household total" view — call it at the
 * entry to any household-level rollup so excluding a member
 * removes ALL of their contribution (income, age, accounts,
 * liabilities, etc.). Composes cleanly with `liquidHousehold`
 * and `filterHouseholdByTaxBucket`; do NOT compose with
 * `filterHousehold(h, memberId)` — those are alternatives, not
 * stackable filters (per-member view shows the explicitly-picked
 * person regardless of their rollup flag).
 *
 * Why this is a separate helper from `filterHousehold`: the two
 * are conceptually different scopings. `filterHousehold(h, X)`
 * answers "what's Member X's view of the household?" — and the
 * answer must include X even if X is rollup-excluded, because
 * the user explicitly asked for X. `householdForRollups(h)`
 * answers "what should the household's aggregate dashboard show?"
 * — and that excludes anyone the user has set aside.
 */
export function householdForRollups(h: Household): Household {
  const ids = activeMemberIds(h);
  // Short-circuit when nothing is excluded — most households use
  // every member, and avoiding the .filter calls keeps reference
  // identity stable so memoized downstream hooks don't recompute.
  if (ids.size === h.members.length) return h;
  return {
    ...h,
    members: h.members.filter((m) => ids.has(m.id)),
    accounts: h.accounts.filter((a) => ids.has(a.ownerId)),
    liabilities: h.liabilities.filter((l) => ids.has(l.ownerId)),
  };
}

/**
 * Count of members currently rolling up vs. total. Used by the
 * Members sheet to surface the "{N of M} included in rollups"
 * subtitle so the flag's effect is legible from the config
 * surface (we deliberately don't sprinkle this status across
 * every rollup panel).
 */
export function householdRollupCounts(h: Household): {
  active: number;
  total: number;
} {
  return { active: activeMembers(h).length, total: h.members.length };
}

/**
 * Sum of per-member annual gross incomes across members included
 * in the rollup. Returns null when no included member has an
 * income set (the "we don't know yet" state) so callers can show
 * an empty-state prompt rather than a misleading "$0 household
 * income".
 */
export function householdIncomeSum(h: Household): number | null {
  let total = 0;
  let any = false;
  for (const m of activeMembers(h)) {
    if (m.incomeUSD != null && Number.isFinite(m.incomeUSD) && m.incomeUSD >= 0) {
      total += m.incomeUSD;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Average of per-member ages across members included in the
 * rollup, weighted equally across those that have a stated age.
 * Returns null when no included member has an age set. We average
 * rather than pick a representative because the Fed-SCF benchmark
 * is age-band keyed — the average of a 38 + 42 couple lives in
 * the 35-44 band, which is the right bucket.
 */
export function householdAverageAge(h: Household): number | null {
  let sum = 0;
  let count = 0;
  for (const m of activeMembers(h)) {
    if (m.age != null && Number.isFinite(m.age) && m.age > 0) {
      sum += m.age;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * Youngest stated age across members included in the rollup, or
 * null when no included member has an age set. Used to bound
 * forward-projection horizons — once we reach ~110−youngest_age
 * years, even the youngest member is past life-expectancy, and
 * projecting further is silly. Returns the minimum (not average)
 * because for Independence survival the binding constraint is the
 * longest-lived spouse.
 */
export function householdYoungestAge(h: Household): number | null {
  let min: number | null = null;
  for (const m of activeMembers(h)) {
    if (m.age != null && Number.isFinite(m.age) && m.age > 0) {
      if (min == null || m.age < min) min = m.age;
    }
  }
  return min;
}

/**
 * Per-holding liquidity. A holding is illiquid if you couldn't
 * realistically convert it to cash to fund retirement spending:
 *
 *   - private_stock: always — typically restricted, only realizes at exit
 *   - real_estate where isPrimaryResidence === true: selling means
 *     moving, so it can't be drawn from to live on
 *   - any other holding the user has explicitly marked isIlliquid
 *     (e.g. a friend's-startup stake parked in an OTHER account,
 *     vested-but-restricted RSUs, art, collectibles)
 *
 * Everything else (regular equity, bond, cash, crypto, non-primary RE)
 * is liquid. SINGLE source of truth for liquidity classification —
 * every UI and projection that cares about liquid vs total should call
 * this. Stays a pure function of one holding for easy testing.
 */
export function isLiquid(h: Holding): boolean {
  if (h.kind === "private_stock") return false;
  if (h.kind === "real_estate" && h.isPrimaryResidence === true) return false;
  if ("isIlliquid" in h && h.isIlliquid === true) return false;
  return true;
}

/**
 * True when the user has explicitly opted this holding OUT of the
 * MC stress-test's cash-bucket auto-sale pathway. Distinct from
 * `isLiquid` — an illiquid holding is already structurally excluded
 * from sales; this flag is for LIQUID holdings the user wants to
 * preserve (high-conviction picks, employer-share concentration,
 * tax-loss carryforward setups). Single source of truth so callers
 * don't sprinkle the membership check.
 */
export function isExcludedFromCashBucketSale(h: Holding): boolean {
  if ("excludeFromCashBucketSale" in h && h.excludeFromCashBucketSale === true) {
    return true;
  }
  return false;
}

/**
 * Liquid-only view of the household. Returns a structurally identical
 * Household with illiquid holdings removed, accounts that end up
 * empty dropped entirely, and all liabilities preserved (debts are
 * still debts even when the asset they secure is illiquid).
 *
 * Cleanly composable: pass the result to any existing engine —
 * projectIndependence, computePortfolio, history reconstruction — and you
 * get the liquid-only projection for free, no engine fork required.
 *
 * Note on contributions: we keep `monthlyContributionUSD` unchanged
 * on accounts that retain at least one liquid holding. The implicit
 * assumption is that ongoing contributions flow into liquid assets
 * (typical 401k / Roth / brokerage flow). Accounts with no liquid
 * holdings remaining are dropped entirely — their contributions
 * were funding illiquid growth (e.g. mortgage equity) which isn't
 * part of the liquid plan.
 */
export function liquidHousehold(h: Household): Household {
  const accounts = h.accounts
    .map((a) => ({
      ...a,
      holdings: a.holdings.filter(isLiquid),
    }))
    .filter((a) => a.holdings.length > 0);
  return { ...h, accounts };
}

export function liquidNetWorth(h: Household): number {
  return householdNetWorth(liquidHousehold(h));
}

/**
 * Defensive fingerprint: does this household look like the demo data?
 * Used as a last-resort guard so demo accounts never reach Drive even
 * if some race or future bug flips `mode` to "real" while household
 * still references DEMO_HOUSEHOLD. The demo's members and accounts
 * have well-known hardcoded IDs that no user-created household can
 * produce (real account IDs are prefixed `acc-mem-…` with a counter).
 */
export function isDemoHousehold(h: Household): boolean {
  if (h.id === "demo-household") return true;
  if (h.members.some((m) => m.id === "demo-member-primary")) return true;
  if (h.accounts.some((a) => a.ownerId === "demo-member-primary")) return true;
  return false;
}

export function illiquidNetWorth(h: Household): number {
  return householdNetWorth(h) - liquidNetWorth(h);
}

export function taxBucketTotals(
  h: Household,
): Record<TaxTreatment, number> {
  const out: Record<TaxTreatment, number> = {
    PRE_TAX: 0,
    ROTH: 0,
    TAXABLE: 0,
    HSA: 0,
    EDUCATION: 0,
  };
  for (const a of h.accounts) {
    const t = TAX_TREATMENT_BY_CATEGORY[a.category];
    out[t] += accountValue(a);
  }
  return out;
}

export function totalMonthlyContributions(
  h: Household,
  memberId?: string | null,
): number {
  return h.accounts
    .filter((a) => !memberId || a.ownerId === memberId)
    .reduce((s, a) => s + a.monthlyContributionUSD, 0);
}

export function filterHousehold(
  h: Household,
  memberId: string | null,
): Household {
  if (!memberId) return h;
  return {
    ...h,
    accounts: h.accounts.filter((a) => a.ownerId === memberId),
    liabilities: h.liabilities.filter((l) => l.ownerId === memberId),
  };
}

/**
 * Scope a household to a single tax-treatment bucket (PRE_TAX,
 * ROTH, TAXABLE, HSA, EDUCATION). Used by the Allocation page's
 * tax-bucket selector — tap a bucket in the TaxBuckets card to
 * filter the rest of the page (NW summary, leverage breakdown,
 * class breakdown, metrics) to just that bucket's holdings.
 *
 * Pass null to skip the filter (no scoping). Liabilities are
 * passed through unchanged because they don't carry a tax
 * treatment — they'd disappear under this filter otherwise and
 * leave the NW calc off.
 *
 * Composes cleanly with filterHousehold(byMember) and
 * liquidHousehold — apply in any order and the intersection is
 * the same.
 */
export function filterHouseholdByTaxBucket(
  h: Household,
  bucket: TaxTreatment | null,
): Household {
  if (!bucket) return h;
  return {
    ...h,
    accounts: h.accounts.filter(
      (a) => TAX_TREATMENT_BY_CATEGORY[a.category] === bucket,
    ),
  };
}
