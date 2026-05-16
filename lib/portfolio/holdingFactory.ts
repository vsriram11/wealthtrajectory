/**
 * Pure factory that constructs a {@link Holding} from creator-form
 * input. One file, one job — keeps the 386-line per-kind dispatch
 * out of the store action handler.
 *
 * Each `buildXxxHolding` helper takes the discriminant-narrowed
 * variant of {@link HoldingCreateInput} plus the freshly-minted
 * holding id, and returns the corresponding Holding shape.
 * `buildHolding` is the public entry point — switch over `kind`
 * and dispatch.
 *
 * No store reads, no side effects: the caller owns persistence.
 */

import {
  bondLeverageFromDuration,
  leverageMatchesDuration,
} from "@/lib/portfolio/bondLeverage";
import { defaultRealCAGR } from "@/lib/portfolio/holdingKinds";
import { getPreset } from "@/lib/portfolio/presets";
import {
  EMPTY_ENERGY_AG,
  EMPTY_GEOGRAPHY,
  EMPTY_METAL,
  EMPTY_STYLE_BOX,
  type Holding,
} from "@/lib/types";

// ── Input variants ───────────────────────────────────────────────────

/**
 * Discriminated union of the input shapes accepted by
 * {@link buildHolding}. Two-mode shapes (equity / bond / crypto /
 * commodity) split into a `valueUSD` branch and a `shares` branch
 * so call sites are forced to pick exactly one — never both.
 */
export type HoldingCreateInput =
  | { kind: "equity"; symbol: string; valueUSD: number; livePrice?: number; name?: string }
  | { kind: "equity"; symbol: string; shares: number; livePrice?: number; name?: string }
  | { kind: "bond"; symbol: string; valueUSD: number; livePrice?: number; name?: string }
  | { kind: "bond"; symbol: string; shares: number; livePrice?: number; name?: string }
  | { kind: "cash"; valueUSD: number; expectedRealCAGR: number }
  | {
      kind: "crypto";
      symbol: string;
      valueUSD: number;
      name?: string;
      expectedRealCAGR?: number;
    }
  | {
      kind: "crypto";
      symbol: string;
      shares: number;
      pricePerUnit: number;
      name?: string;
      expectedRealCAGR?: number;
    }
  | {
      // Commodity supports two entry modes (mirrors crypto):
      //   1. Ticker + value: "GLD" $25K → tries preset / live quote
      //   2. Manual name + value: "Gold jewelry" $5K → face-value
      //      holding, no live-quote attempt
      // `isCustom: true` flags the manual mode so we don't try to
      // resolve the "symbol" against a ticker registry.
      kind: "commodity";
      symbol: string;
      valueUSD: number;
      isCustom?: boolean;
      isIlliquid?: boolean;
      expectedRealCAGR?: number;
    }
  | {
      kind: "commodity";
      symbol: string;
      shares: number;
      pricePerUnit: number;
      isCustom?: boolean;
      isIlliquid?: boolean;
      expectedRealCAGR?: number;
    }
  | {
      kind: "real_estate";
      name: string;
      valueUSD: number;
      expectedRealCAGR: number;
      leverage?: number;
      isPrimaryResidence?: boolean;
    }
  | {
      kind: "private_stock";
      company: string;
      shares: number;
      fmvPricePerShareUSD: number;
      fmvAsOf?: number | null;
      preferredRoundPricePerShareUSD?: number | null;
      expectedRealCAGR?: number;
      acquiredAt?: number | null;
      leverage?: number;
    }
  | {
      kind: "other";
      name: string;
      valueUSD: number;
      expectedRealCAGR: number;
      isIlliquid?: boolean;
    };

// ── Class-level defaults ─────────────────────────────────────────────
// Real-CAGR defaults come from the kind registry (`./holdingKinds`).
// Bond duration default is bond-specific structural detail kept here.

const DEFAULT_BOND_DURATION_YEARS = 7;

// ── Dispatcher ───────────────────────────────────────────────────────

/**
 * Build a {@link Holding} from a creator-form input. Pure: no
 * store access, no clock reads other than `Date.now()` for live-
 * price timestamps. Returns `null` for unhandled discriminants
 * (defensive guard — every member of the union is covered today).
 */
export function buildHolding(
  id: string,
  input: HoldingCreateInput,
): Holding | null {
  switch (input.kind) {
    case "cash":
      return buildCashHolding(id, input);
    case "equity":
      return buildEquityHolding(id, input);
    case "bond":
      return buildBondHolding(id, input);
    case "crypto":
      return buildCryptoHolding(id, input);
    case "commodity":
      return buildCommodityHolding(id, input);
    case "real_estate":
      return buildRealEstateHolding(id, input);
    case "private_stock":
      return buildPrivateStockHolding(id, input);
    case "other":
      return buildOtherHolding(id, input);
  }
}

// ── Per-kind builders ────────────────────────────────────────────────

function buildCashHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "cash" }>,
): Holding {
  return {
    kind: "cash",
    id,
    valueUSD: input.valueUSD,
    expectedRealCAGR: input.expectedRealCAGR,
    geography: { ...EMPTY_GEOGRAPHY, US: 1 },
  };
}

function buildEquityHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "equity" }>,
): Holding {
  const symbol = input.symbol.trim();
  const preset = getPreset(symbol);
  const enteredAsShares = "shares" in input;

  // Path 1: recognized equity preset — copy reference price + class data.
  if (preset && preset.assetClass === "equity") {
    const shares = enteredAsShares
      ? input.shares
      : input.valueUSD / preset.referencePriceUSD;
    return {
      kind: "equity",
      id,
      symbol: preset.symbol,
      shares,
      lastPriceUSD: preset.referencePriceUSD,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares,
      acquiredAt: null,
      valueUSD: shares * preset.referencePriceUSD,
      expectedRealCAGR: preset.expectedRealCAGR,
      leverage: preset.leverage,
      styleBox: preset.styleBox,
      geography: preset.geography,
      ...(preset.composition ? { composition: preset.composition } : {}),
    };
  }

  // Path 2: unknown ticker validated via /api/quote — keep live tracking
  // on, apply Large Blend US defaults that the user can refine later.
  if (input.livePrice && input.livePrice > 0) {
    const shares = enteredAsShares
      ? input.shares
      : input.valueUSD / input.livePrice;
    return {
      kind: "equity",
      id,
      symbol: symbol.toUpperCase(),
      shares,
      lastPriceUSD: input.livePrice,
      lastPricedAt: Date.now(),
      isManualPrice: false,
      enteredAsShares,
      acquiredAt: null,
      valueUSD: shares * input.livePrice,
      expectedRealCAGR: defaultRealCAGR("equity"),
      leverage: 1,
      styleBox: { ...EMPTY_STYLE_BOX, LARGE_BLEND: 1 },
      geography: { ...EMPTY_GEOGRAPHY, US: 1 },
    };
  }

  // Path 3: unrecognized + no live price — manual-mode face-value entry.
  const valueUSD = enteredAsShares ? input.shares : input.valueUSD;
  return {
    kind: "equity",
    id,
    symbol: symbol.toUpperCase(),
    shares: 1,
    lastPriceUSD: valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: defaultRealCAGR("equity"),
    leverage: 1,
    styleBox: { ...EMPTY_STYLE_BOX, LARGE_BLEND: 1 },
    geography: { ...EMPTY_GEOGRAPHY, US: 1 },
  };
}

function buildBondHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "bond" }>,
): Holding {
  const symbol = input.symbol.trim();
  const preset = getPreset(symbol);
  const enteredAsShares = "shares" in input;

  // Path 1: recognized bond preset.
  if (preset && preset.assetClass === "bond") {
    const shares = enteredAsShares
      ? input.shares
      : input.valueUSD / preset.referencePriceUSD;
    // If the preset's leverage matches what the duration would auto-
    // derive (e.g. TLT 17y / 1×), treat as auto. If it diverges
    // (TMF 17y / 3×, or BND 6.5y / 1×) preserve the preset value but
    // mark manual so future duration tweaks don't silently nuke it.
    const presetIsManual = !leverageMatchesDuration(
      preset.leverage,
      preset.averageDurationYears,
    );
    const leverage = presetIsManual
      ? preset.leverage
      : bondLeverageFromDuration(preset.averageDurationYears);
    return {
      kind: "bond",
      id,
      symbol: preset.symbol,
      shares,
      lastPriceUSD: preset.referencePriceUSD,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares,
      acquiredAt: null,
      valueUSD: shares * preset.referencePriceUSD,
      expectedRealCAGR: preset.expectedRealCAGR,
      leverage,
      bondLeverageIsManual: presetIsManual,
      bondType: preset.bondType,
      geography: preset.geography,
      averageDurationYears: preset.averageDurationYears,
    };
  }

  // Path 2: unknown ticker validated live.
  if (input.livePrice && input.livePrice > 0) {
    const shares = enteredAsShares
      ? input.shares
      : input.valueUSD / input.livePrice;
    return {
      kind: "bond",
      id,
      symbol: symbol.toUpperCase(),
      shares,
      lastPriceUSD: input.livePrice,
      lastPricedAt: Date.now(),
      isManualPrice: false,
      enteredAsShares,
      acquiredAt: null,
      valueUSD: shares * input.livePrice,
      expectedRealCAGR: defaultRealCAGR("bond"),
      leverage: bondLeverageFromDuration(DEFAULT_BOND_DURATION_YEARS),
      bondLeverageIsManual: false,
      bondType: { GOVT: 0.5, CORPORATE: 0.5 },
      geography: { ...EMPTY_GEOGRAPHY, US: 1 },
      averageDurationYears: DEFAULT_BOND_DURATION_YEARS,
    };
  }

  // Path 3: manual face-value bond entry.
  const valueUSD = enteredAsShares ? input.shares : input.valueUSD;
  return {
    kind: "bond",
    id,
    symbol: symbol.toUpperCase(),
    shares: 1,
    lastPriceUSD: valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: defaultRealCAGR("bond"),
    leverage: bondLeverageFromDuration(DEFAULT_BOND_DURATION_YEARS),
    bondLeverageIsManual: false,
    bondType: { GOVT: 0.5, CORPORATE: 0.5 },
    geography: { ...EMPTY_GEOGRAPHY, US: 1 },
    averageDurationYears: DEFAULT_BOND_DURATION_YEARS,
  };
}

function buildCryptoHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "crypto" }>,
): Holding {
  const symbol = input.symbol.trim().toUpperCase();
  const preset = getPreset(symbol);
  const cryptoPreset =
    preset && preset.assetClass === "crypto" ? preset : null;
  // Live-priceable presets are stock-market-traded crypto ETFs
  // (IBIT, FBTC, GBTC, ETHA, ETHE, BITX) that use the same live-pricing
  // pipeline as equities. Native cryptocurrencies (BTC, ETH, USDC
  // entered as units) stay manual.
  const isLivePriceablePreset = cryptoPreset?.livePriceable === true;
  const expectedRealCAGR =
    input.expectedRealCAGR ??
    (cryptoPreset ? cryptoPreset.expectedRealCAGR : defaultRealCAGR("crypto"));
  const leverage = cryptoPreset?.leverage;

  // Path 1: shares + price-per-unit (native crypto: BTC, ETH).
  if ("shares" in input) {
    return {
      kind: "crypto",
      id,
      symbol,
      shares: input.shares,
      lastPriceUSD: input.pricePerUnit,
      lastPricedAt: Date.now(),
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: input.shares * input.pricePerUnit,
      expectedRealCAGR,
      ...(leverage && leverage !== 1 ? { leverage } : {}),
    };
  }

  // Path 2: stock-market-traded crypto ETF (live-priced like equity).
  if (isLivePriceablePreset && cryptoPreset) {
    return {
      kind: "crypto",
      id,
      symbol: cryptoPreset.symbol,
      shares: input.valueUSD / cryptoPreset.referencePriceUSD,
      lastPriceUSD: cryptoPreset.referencePriceUSD,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: input.valueUSD,
      expectedRealCAGR: cryptoPreset.expectedRealCAGR,
      ...(leverage && leverage !== 1 ? { leverage } : {}),
    };
  }

  // Path 3: manual-priced preset (BTC / ETH / SOL / USDC value-only).
  if (cryptoPreset) {
    return {
      kind: "crypto",
      id,
      symbol: cryptoPreset.symbol,
      shares: input.valueUSD / cryptoPreset.referencePriceUSD,
      lastPriceUSD: cryptoPreset.referencePriceUSD,
      lastPricedAt: null,
      isManualPrice: true,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: input.valueUSD,
      expectedRealCAGR: cryptoPreset.expectedRealCAGR,
    };
  }

  // Path 4: unrecognized symbol, value-only — store as 1 unit @ value.
  return {
    kind: "crypto",
    id,
    symbol,
    shares: 1,
    lastPriceUSD: input.valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: input.valueUSD,
    expectedRealCAGR,
  };
}

function buildCommodityHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "commodity" }>,
): Holding {
  const symbolRaw = input.symbol.trim();
  const symbol = input.isCustom ? symbolRaw : symbolRaw.toUpperCase();
  const preset = input.isCustom ? null : getPreset(symbol);
  const isCommodityPreset =
    preset != null && preset.assetClass === "commodity";
  const expectedRealCAGR =
    input.expectedRealCAGR ??
    (isCommodityPreset ? preset.expectedRealCAGR : defaultRealCAGR("commodity"));

  // Default sub-classification:
  //   - Preset with a breakdown → copy it (GLD = 100% gold, DBC = mix)
  //   - Custom name → assume "Gold jewelry" shape: 100% metals → 100% gold
  //   - Otherwise: leave undefined (user fills in)
  const breakdown =
    isCommodityPreset && preset.breakdown
      ? preset.breakdown
      : input.isCustom
        ? ({
            metalsShare: 1,
            metals: { ...EMPTY_METAL, GOLD: 1 },
            energyAg: { ...EMPTY_ENERGY_AG },
          } as const)
        : undefined;

  const illiquidPatch = input.isIlliquid ? { isIlliquid: true as const } : {};
  const breakdownPatch = breakdown ? { breakdown } : {};

  // Path 1: shares + price-per-unit input.
  if ("shares" in input) {
    return {
      kind: "commodity",
      id,
      symbol,
      shares: input.shares,
      lastPriceUSD: input.pricePerUnit,
      lastPricedAt: Date.now(),
      isManualPrice: true,
      enteredAsShares: true,
      acquiredAt: null,
      valueUSD: input.shares * input.pricePerUnit,
      expectedRealCAGR,
      ...illiquidPatch,
      ...breakdownPatch,
    };
  }

  // Path 2: recognized commodity preset (value-only).
  if (isCommodityPreset) {
    return {
      kind: "commodity",
      id,
      symbol: preset.symbol,
      shares: input.valueUSD / preset.referencePriceUSD,
      lastPriceUSD: preset.referencePriceUSD,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: input.valueUSD,
      expectedRealCAGR: preset.expectedRealCAGR,
      ...illiquidPatch,
      ...breakdownPatch,
    };
  }

  // Path 3: custom name ("Gold jewelry") OR unrecognized ticker, value-
  // only. Store as 1-unit @ value; manual entries skip live-quote
  // attempts via isLivePriceable.
  return {
    kind: "commodity",
    id,
    symbol,
    shares: 1,
    lastPriceUSD: input.valueUSD,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: input.valueUSD,
    expectedRealCAGR,
    ...illiquidPatch,
    ...breakdownPatch,
  };
}

function buildRealEstateHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "real_estate" }>,
): Holding {
  return {
    kind: "real_estate",
    id,
    name: input.name.trim() || "Property",
    valueUSD: input.valueUSD,
    expectedRealCAGR: input.expectedRealCAGR,
    acquiredAt: null,
    leverage: Math.max(1, input.leverage ?? 1),
    isPrimaryResidence: input.isPrimaryResidence === true,
  };
}

function buildPrivateStockHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "private_stock" }>,
): Holding {
  const company = input.company.trim() || "Private company";
  const fmv = Math.max(0, input.fmvPricePerShareUSD);
  return {
    kind: "private_stock",
    id,
    symbol: company,
    shares: input.shares,
    lastPriceUSD: fmv,
    lastPricedAt: input.fmvAsOf ?? null,
    isManualPrice: true,
    enteredAsShares: true,
    acquiredAt: input.acquiredAt ?? null,
    valueUSD: input.shares * fmv,
    expectedRealCAGR: input.expectedRealCAGR ?? 0,
    leverage: Math.max(0.25, input.leverage ?? 1),
    preferredRoundPricePerShareUSD:
      input.preferredRoundPricePerShareUSD ?? null,
  };
}

function buildOtherHolding(
  id: string,
  input: Extract<HoldingCreateInput, { kind: "other" }>,
): Holding {
  return {
    kind: "other",
    id,
    name: input.name.trim() || "Asset",
    valueUSD: input.valueUSD,
    expectedRealCAGR: input.expectedRealCAGR,
    acquiredAt: null,
    isIlliquid: input.isIlliquid === true ? true : undefined,
  };
}
