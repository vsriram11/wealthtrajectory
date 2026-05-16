import {
  bondTypeOf,
  energyAgOf,
  geographyOf,
  metalOf,
  styleBoxOf,
  type AssetClass,
  type BondTypeAllocation,
  type CommodityBreakdown,
  type CompositionLeg,
  type GeographyAllocation,
  type StyleBoxAllocation,
} from "@/lib/types";

export type EquityPreset = {
  assetClass: "equity";
  symbol: string;
  name: string;
  referencePriceUSD: number;
  expectedRealCAGR: number;
  leverage: number;
  styleBox: StyleBoxAllocation;
  geography: GeographyAllocation;
  /**
   * Intrinsic multi-asset composition (NTSX, GDE, RSST, …). When set,
   * the holding's true leverage is sum-of-weights (NTSX = 1.5) and the
   * value decomposes across class buckets. Absent for plain ETFs.
   */
  composition?: CompositionLeg[];
};

export type BondPreset = {
  assetClass: "bond";
  symbol: string;
  name: string;
  referencePriceUSD: number;
  expectedRealCAGR: number;
  leverage: number;
  bondType: BondTypeAllocation;
  geography: GeographyAllocation;
  averageDurationYears: number;
};

export type CryptoPreset = {
  assetClass: "crypto";
  symbol: string;
  name: string;
  referencePriceUSD: number;
  expectedRealCAGR: number;
  /**
   * Intrinsic leverage. Default 1 (spot crypto, IBIT, FBTC, GBTC).
   * 2 for leveraged crypto ETFs (BITX). Higher for hypothetical 3×
   * crypto products if/when they appear.
   */
  leverage?: number;
  /**
   * True when the symbol is a stock-market-traded ETF (IBIT, FBTC,
   * BITO, GBTC, ETHA, ETHE, BITX) and can be live-priced through
   * /api/quote. False/undefined for native cryptocurrencies (BTC,
   * ETH, USDC entered as units).
   */
  livePriceable?: boolean;
};

export type CommodityPreset = {
  assetClass: "commodity";
  symbol: string;
  name: string;
  referencePriceUSD: number;
  expectedRealCAGR: number;
  /**
   * Default sub-classification populated when the user adds this
   * preset. GLD → 100% metals → 100% gold; DBC → the actual broad
   * mix. The user can override on a per-holding basis in the editor.
   */
  breakdown?: CommodityBreakdown;
};

export type AssetPreset =
  | EquityPreset
  | BondPreset
  | CryptoPreset
  | CommodityPreset;

export const ASSET_PRESETS: Record<string, AssetPreset> = {
  // Equities
  VOO: {
    assetClass: "equity",
    symbol: "VOO",
    name: "Vanguard S&P 500",
    referencePriceUSD: 520,
    expectedRealCAGR: 0.07,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  VTI: {
    assetClass: "equity",
    symbol: "VTI",
    name: "Vanguard Total US Stock Market",
    referencePriceUSD: 290,
    expectedRealCAGR: 0.07,
    leverage: 1,
    styleBox: styleBoxOf({
      LARGE_BLEND: 0.82,
      MID_BLEND: 0.12,
      SMALL_BLEND: 0.06,
    }),
    geography: geographyOf({ US: 1 }),
  },
  QQQ: {
    assetClass: "equity",
    symbol: "QQQ",
    name: "Invesco QQQ",
    referencePriceUSD: 520,
    expectedRealCAGR: 0.08,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  QQQM: {
    assetClass: "equity",
    symbol: "QQQM",
    name: "Invesco NASDAQ-100",
    referencePriceUSD: 215,
    expectedRealCAGR: 0.08,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  TQQQ: {
    assetClass: "equity",
    symbol: "TQQQ",
    name: "ProShares UltraPro QQQ (3x)",
    referencePriceUSD: 85,
    expectedRealCAGR: 0.12,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  SSO: {
    assetClass: "equity",
    symbol: "SSO",
    name: "ProShares Ultra S&P 500 (2x)",
    referencePriceUSD: 95,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  VXUS: {
    assetClass: "equity",
    symbol: "VXUS",
    name: "Vanguard Total International Stock",
    referencePriceUSD: 65,
    expectedRealCAGR: 0.06,
    leverage: 1,
    styleBox: styleBoxOf({
      LARGE_BLEND: 0.75,
      MID_BLEND: 0.18,
      SMALL_BLEND: 0.07,
    }),
    geography: geographyOf({ DEVELOPED: 0.75, EMERGING: 0.25 }),
  },
  VEA: {
    assetClass: "equity",
    symbol: "VEA",
    name: "Vanguard FTSE Developed Markets",
    referencePriceUSD: 55,
    expectedRealCAGR: 0.06,
    leverage: 1,
    styleBox: styleBoxOf({
      LARGE_BLEND: 0.8,
      MID_BLEND: 0.15,
      SMALL_BLEND: 0.05,
    }),
    geography: geographyOf({ DEVELOPED: 1 }),
  },
  VWO: {
    assetClass: "equity",
    symbol: "VWO",
    name: "Vanguard FTSE Emerging Markets",
    referencePriceUSD: 46,
    expectedRealCAGR: 0.06,
    leverage: 1,
    styleBox: styleBoxOf({
      LARGE_BLEND: 0.8,
      MID_BLEND: 0.15,
      SMALL_BLEND: 0.05,
    }),
    geography: geographyOf({ EMERGING: 1 }),
  },
  IWD: {
    assetClass: "equity",
    symbol: "IWD",
    name: "iShares Russell 1000 Value",
    referencePriceUSD: 190,
    expectedRealCAGR: 0.07,
    leverage: 1,
    styleBox: styleBoxOf({ LARGE_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  IJR: {
    assetClass: "equity",
    symbol: "IJR",
    name: "iShares Core S&P Small-Cap",
    referencePriceUSD: 115,
    expectedRealCAGR: 0.075,
    leverage: 1,
    styleBox: styleBoxOf({ SMALL_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  AVUV: {
    assetClass: "equity",
    symbol: "AVUV",
    name: "Avantis US Small Cap Value",
    referencePriceUSD: 95,
    expectedRealCAGR: 0.08,
    leverage: 1,
    styleBox: styleBoxOf({ SMALL_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },

  // ── Leveraged equity ETFs (baked-in defaults) ─────────────────────
  // 30+ of the most-held leveraged tickers. Free users entering any
  // of these get the right leverage multiplier automatically (the
  // engine multiplies through to effective exposure on the home tile
  // and allocation views). Custom-overriding leverage stays Pro.
  // Reference prices are coarse approximations — live prices replace
  // them on first refresh.
  SOXL: {
    assetClass: "equity",
    symbol: "SOXL",
    name: "Direxion Daily Semiconductor Bull 3X",
    referencePriceUSD: 25,
    expectedRealCAGR: 0.1,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  QLD: {
    assetClass: "equity",
    symbol: "QLD",
    name: "ProShares Ultra QQQ (2x)",
    referencePriceUSD: 110,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  UPRO: {
    assetClass: "equity",
    symbol: "UPRO",
    name: "ProShares UltraPro S&P 500 (3x)",
    referencePriceUSD: 80,
    expectedRealCAGR: 0.12,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  SPXL: {
    assetClass: "equity",
    symbol: "SPXL",
    name: "Direxion Daily S&P 500 Bull 3X",
    referencePriceUSD: 170,
    expectedRealCAGR: 0.12,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  SQQQ: {
    assetClass: "equity",
    symbol: "SQQQ",
    name: "ProShares UltraPro Short QQQ (3x inverse)",
    referencePriceUSD: 25,
    expectedRealCAGR: -0.05,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  NVDL: {
    assetClass: "equity",
    symbol: "NVDL",
    name: "GraniteShares 2x Long NVDA",
    referencePriceUSD: 70,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  FNGU: {
    assetClass: "equity",
    symbol: "FNGU",
    name: "MicroSectors FANG+ 3X",
    referencePriceUSD: 400,
    expectedRealCAGR: 0.12,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  TECL: {
    assetClass: "equity",
    symbol: "TECL",
    name: "Direxion Daily Technology Bull 3X",
    referencePriceUSD: 80,
    expectedRealCAGR: 0.12,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  TNA: {
    assetClass: "equity",
    symbol: "TNA",
    name: "Direxion Daily Small Cap Bull 3X",
    referencePriceUSD: 40,
    expectedRealCAGR: 0.08,
    leverage: 3,
    styleBox: styleBoxOf({ SMALL_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  FAS: {
    assetClass: "equity",
    symbol: "FAS",
    name: "Direxion Daily Financial Bull 3X",
    referencePriceUSD: 130,
    expectedRealCAGR: 0.08,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  UCO: {
    assetClass: "equity",
    symbol: "UCO",
    name: "ProShares Ultra Bloomberg Crude Oil (2x)",
    referencePriceUSD: 30,
    expectedRealCAGR: 0.02,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  LABU: {
    assetClass: "equity",
    symbol: "LABU",
    name: "Direxion Daily S&P Biotech Bull 3X",
    referencePriceUSD: 90,
    expectedRealCAGR: 0.08,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  BOIL: {
    assetClass: "equity",
    symbol: "BOIL",
    name: "ProShares Ultra Bloomberg Natural Gas (2x)",
    referencePriceUSD: 50,
    expectedRealCAGR: 0.0,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  YINN: {
    assetClass: "equity",
    symbol: "YINN",
    name: "Direxion Daily FTSE China Bull 3X",
    referencePriceUSD: 30,
    expectedRealCAGR: 0.06,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ EMERGING: 1 }),
  },
  GUSH: {
    assetClass: "equity",
    symbol: "GUSH",
    name: "Direxion Daily S&P Oil & Gas E&P Bull 2X",
    referencePriceUSD: 55,
    expectedRealCAGR: 0.05,
    leverage: 2,
    styleBox: styleBoxOf({ MID_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  DPST: {
    assetClass: "equity",
    symbol: "DPST",
    name: "Direxion Daily Regional Banks Bull 3X",
    referencePriceUSD: 70,
    expectedRealCAGR: 0.06,
    leverage: 3,
    styleBox: styleBoxOf({ MID_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  NUGT: {
    assetClass: "equity",
    symbol: "NUGT",
    name: "Direxion Daily Gold Miners Bull 2X",
    referencePriceUSD: 50,
    expectedRealCAGR: 0.03,
    leverage: 2,
    styleBox: styleBoxOf({ MID_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  USD: {
    assetClass: "equity",
    symbol: "USD",
    name: "ProShares Ultra Semiconductors (2x)",
    referencePriceUSD: 65,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  ROM: {
    assetClass: "equity",
    symbol: "ROM",
    name: "ProShares Ultra Technology (2x)",
    referencePriceUSD: 70,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  UYG: {
    assetClass: "equity",
    symbol: "UYG",
    name: "ProShares Ultra Financials (2x)",
    referencePriceUSD: 95,
    expectedRealCAGR: 0.07,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  JNUG: {
    assetClass: "equity",
    symbol: "JNUG",
    name: "Direxion Daily Junior Gold Miners Bull 2X",
    referencePriceUSD: 35,
    expectedRealCAGR: 0.03,
    leverage: 2,
    styleBox: styleBoxOf({ SMALL_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  DIG: {
    assetClass: "equity",
    symbol: "DIG",
    name: "ProShares Ultra Oil & Gas (2x)",
    referencePriceUSD: 60,
    expectedRealCAGR: 0.05,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_VALUE: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  MVV: {
    assetClass: "equity",
    symbol: "MVV",
    name: "ProShares Ultra MidCap400 (2x)",
    referencePriceUSD: 75,
    expectedRealCAGR: 0.09,
    leverage: 2,
    styleBox: styleBoxOf({ MID_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  BIB: {
    assetClass: "equity",
    symbol: "BIB",
    name: "ProShares Ultra Nasdaq Biotechnology (2x)",
    referencePriceUSD: 65,
    expectedRealCAGR: 0.07,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_GROWTH: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  UWM: {
    assetClass: "equity",
    symbol: "UWM",
    name: "ProShares Ultra Russell2000 (2x)",
    referencePriceUSD: 50,
    expectedRealCAGR: 0.08,
    leverage: 2,
    styleBox: styleBoxOf({ SMALL_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  SPUU: {
    assetClass: "equity",
    symbol: "SPUU",
    name: "Direxion Daily S&P 500 Bull 2X",
    referencePriceUSD: 130,
    expectedRealCAGR: 0.1,
    leverage: 2,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  MIDU: {
    assetClass: "equity",
    symbol: "MIDU",
    name: "Direxion Daily Mid Cap Bull 3X",
    referencePriceUSD: 80,
    expectedRealCAGR: 0.1,
    leverage: 3,
    styleBox: styleBoxOf({ MID_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },
  UDOW: {
    assetClass: "equity",
    symbol: "UDOW",
    name: "ProShares UltraPro Dow30 (3x)",
    referencePriceUSD: 90,
    expectedRealCAGR: 0.1,
    leverage: 3,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
  },

  // ── Multi-asset / capital-efficient ETFs ─────────────────────────────
  // A single ticker that gives exposure to multiple asset classes via
  // futures overlays. `composition` legs let the engine decompose the
  // holding across equity / bond / commodity buckets so the allocation
  // and leverage math reflects reality (NTSX is 1.5×, RSST is 2.0×).
  // `leverage` field is kept for backwards compatibility but ignored when
  // composition is set (sum-of-weights wins).
  NTSX: {
    assetClass: "equity",
    symbol: "NTSX",
    name: "WisdomTree US Efficient Core (90/60 stocks/bonds)",
    referencePriceUSD: 45,
    expectedRealCAGR: 0.072, // 0.9 × 7% + 0.6 × 1.5%
    leverage: 1.5,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  },
  NTSI: {
    assetClass: "equity",
    symbol: "NTSI",
    name: "WisdomTree Intl Efficient Core (90/60 dev stocks/bonds)",
    referencePriceUSD: 25,
    expectedRealCAGR: 0.063, // 0.9 × 6% + 0.6 × 1.5%
    leverage: 1.5,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ DEVELOPED: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.06 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  },
  NTSE: {
    assetClass: "equity",
    symbol: "NTSE",
    name: "WisdomTree EM Efficient Core (90/60 EM stocks/bonds)",
    referencePriceUSD: 22,
    expectedRealCAGR: 0.069, // 0.9 × 7% + 0.6 × 1.5%
    leverage: 1.5,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ EMERGING: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  },
  GDE: {
    assetClass: "equity",
    symbol: "GDE",
    name: "WisdomTree Efficient Gold + Equity (90/90 stocks/gold)",
    referencePriceUSD: 50,
    // 0.9 × 7% (equity) + 0.9 × 1% (gold) = 7.2%
    expectedRealCAGR: 0.072,
    leverage: 1.8,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "commodity", weight: 0.9, expectedRealCAGR: 0.01 },
    ],
  },
  RSST: {
    assetClass: "equity",
    symbol: "RSST",
    name: "Return Stacked US Stocks & Managed Futures (100/100)",
    referencePriceUSD: 28,
    expectedRealCAGR: 0.1, // 1.0 × 7% + 1.0 × 3%
    leverage: 2.0,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 1.0, expectedRealCAGR: 0.07 },
      { kind: "other", weight: 1.0, expectedRealCAGR: 0.03 },
    ],
  },
  RSSY: {
    assetClass: "equity",
    symbol: "RSSY",
    name: "Return Stacked US Stocks & Futures Yield (100/100)",
    referencePriceUSD: 28,
    expectedRealCAGR: 0.1,
    leverage: 2.0,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 1 }),
    composition: [
      { kind: "equity", weight: 1.0, expectedRealCAGR: 0.07 },
      { kind: "other", weight: 1.0, expectedRealCAGR: 0.03 },
    ],
  },
  RSSB: {
    assetClass: "equity",
    symbol: "RSSB",
    name: "Return Stacked Global Stocks & Bonds (100/100)",
    referencePriceUSD: 28,
    expectedRealCAGR: 0.085, // 1.0 × 7% + 1.0 × 1.5%
    leverage: 2.0,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 0.6, DEVELOPED: 0.3, EMERGING: 0.1 }),
    composition: [
      { kind: "equity", weight: 1.0, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 1.0, expectedRealCAGR: 0.015 },
    ],
  },
  NTSG: {
    assetClass: "equity",
    symbol: "NTSG",
    name: "WisdomTree Global Efficient Core (90/60)",
    referencePriceUSD: 24,
    expectedRealCAGR: 0.066,
    leverage: 1.5,
    styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
    geography: geographyOf({ US: 0.6, DEVELOPED: 0.3, EMERGING: 0.1 }),
    composition: [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.065 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ],
  },
  AVGE: {
    assetClass: "equity",
    symbol: "AVGE",
    name: "Avantis All Equity Markets ETF",
    referencePriceUSD: 60,
    expectedRealCAGR: 0.07,
    leverage: 1,
    styleBox: styleBoxOf({
      LARGE_BLEND: 0.55,
      MID_BLEND: 0.2,
      SMALL_VALUE: 0.25,
    }),
    geography: geographyOf({ US: 0.65, DEVELOPED: 0.25, EMERGING: 0.1 }),
    // AVGE is single-class (all equity), no composition needed.
  },

  // Bonds — two axes: type (Govt/Corp) + geography (US/Dev/EM)
  // Non-leveraged bond ETFs: leverage matches what
  // bondLeverageFromDuration() yields for the given duration, so on
  // creation they're flagged as auto. Truly leveraged products like
  // TMF keep their explicit leverage and become manual overrides.
  BND: {
    assetClass: "bond",
    symbol: "BND",
    name: "Vanguard Total Bond Market",
    referencePriceUSD: 73,
    expectedRealCAGR: 0.015,
    leverage: 0.75, // 6.5y → 0.75 (auto)
    bondType: bondTypeOf({ GOVT: 0.4, CORPORATE: 0.6 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 6.5,
  },
  AGG: {
    assetClass: "bond",
    symbol: "AGG",
    name: "iShares Core US Aggregate Bond",
    referencePriceUSD: 98,
    expectedRealCAGR: 0.015,
    leverage: 0.75, // 6.5y → 0.75 (auto)
    bondType: bondTypeOf({ GOVT: 0.4, CORPORATE: 0.6 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 6.5,
  },
  TLT: {
    assetClass: "bond",
    symbol: "TLT",
    name: "iShares 20+ Year Treasury",
    referencePriceUSD: 92,
    expectedRealCAGR: 0.015,
    leverage: 1, // 17y → 1 (auto)
    bondType: bondTypeOf({ GOVT: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 17,
  },
  IEF: {
    assetClass: "bond",
    symbol: "IEF",
    name: "iShares 7-10 Year Treasury",
    referencePriceUSD: 94,
    expectedRealCAGR: 0.012,
    leverage: 1, // 8y → 1 (auto)
    bondType: bondTypeOf({ GOVT: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 8,
  },
  SHY: {
    assetClass: "bond",
    symbol: "SHY",
    name: "iShares 1-3 Year Treasury",
    referencePriceUSD: 82,
    expectedRealCAGR: 0.005,
    leverage: 0.17, // 2y → 0.167 (auto)
    bondType: bondTypeOf({ GOVT: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 2,
  },
  LQD: {
    assetClass: "bond",
    symbol: "LQD",
    name: "iShares iBoxx Investment Grade Corp",
    referencePriceUSD: 107,
    expectedRealCAGR: 0.02,
    leverage: 1, // 8y → 1 (auto)
    bondType: bondTypeOf({ CORPORATE: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 8,
  },
  HYG: {
    assetClass: "bond",
    symbol: "HYG",
    name: "iShares iBoxx High Yield Corp",
    referencePriceUSD: 78,
    expectedRealCAGR: 0.03,
    leverage: 0.39, // 4y → 0.389 (auto)
    bondType: bondTypeOf({ CORPORATE: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 4,
  },
  EMB: {
    assetClass: "bond",
    symbol: "EMB",
    name: "iShares JPM USD Emerging Markets Bond",
    referencePriceUSD: 85,
    expectedRealCAGR: 0.025,
    leverage: 0.83, // 7y → 0.833 (auto)
    bondType: bondTypeOf({ GOVT: 0.8, CORPORATE: 0.2 }),
    geography: geographyOf({ EMERGING: 1 }),
    averageDurationYears: 7,
  },
  BNDX: {
    assetClass: "bond",
    symbol: "BNDX",
    name: "Vanguard Total International Bond",
    referencePriceUSD: 50,
    expectedRealCAGR: 0.015,
    leverage: 0.83, // 7y → 0.833 (auto)
    bondType: bondTypeOf({ GOVT: 0.6, CORPORATE: 0.4 }),
    geography: geographyOf({ DEVELOPED: 0.8, EMERGING: 0.2 }),
    averageDurationYears: 7,
  },
  TMF: {
    assetClass: "bond",
    symbol: "TMF",
    name: "Direxion Daily 20+ Treasury (3x)",
    referencePriceUSD: 42,
    expectedRealCAGR: 0.03,
    leverage: 3,
    bondType: bondTypeOf({ GOVT: 1 }),
    geography: geographyOf({ US: 1 }),
    averageDurationYears: 17,
  },

  // ── Commodity ETFs ───────────────────────────────────────────────────
  // Trade like stocks but represent commodities (gold, silver, oil,
  // broad commodity baskets). Live-priced through /api/quote. Expected
  // real return is the long-run historical baseline (gold ≈ 1% real,
  // broad commodities ≈ 0% real after costs).
  GLD: {
    assetClass: "commodity",
    symbol: "GLD",
    name: "SPDR Gold Shares",
    referencePriceUSD: 230,
    expectedRealCAGR: 0.01,
    breakdown: {
      metalsShare: 1,
      metals: metalOf({ GOLD: 1 }),
      energyAg: energyAgOf({}),
    },
  },
  IAU: {
    assetClass: "commodity",
    symbol: "IAU",
    name: "iShares Gold Trust",
    referencePriceUSD: 47,
    expectedRealCAGR: 0.01,
    breakdown: {
      metalsShare: 1,
      metals: metalOf({ GOLD: 1 }),
      energyAg: energyAgOf({}),
    },
  },
  GLDM: {
    assetClass: "commodity",
    symbol: "GLDM",
    name: "SPDR Gold MiniShares",
    referencePriceUSD: 55,
    expectedRealCAGR: 0.01,
    breakdown: {
      metalsShare: 1,
      metals: metalOf({ GOLD: 1 }),
      energyAg: energyAgOf({}),
    },
  },
  SGOL: {
    assetClass: "commodity",
    symbol: "SGOL",
    name: "abrdn Physical Gold Shares",
    referencePriceUSD: 24,
    expectedRealCAGR: 0.01,
    breakdown: {
      metalsShare: 1,
      metals: metalOf({ GOLD: 1 }),
      energyAg: energyAgOf({}),
    },
  },
  SLV: {
    assetClass: "commodity",
    symbol: "SLV",
    name: "iShares Silver Trust",
    referencePriceUSD: 25,
    expectedRealCAGR: 0.005,
    breakdown: {
      metalsShare: 1,
      metals: metalOf({ SILVER: 1 }),
      energyAg: energyAgOf({}),
    },
  },
  DBC: {
    assetClass: "commodity",
    symbol: "DBC",
    name: "Invesco DB Commodity Index",
    referencePriceUSD: 22,
    expectedRealCAGR: 0,
    // Approximate DB Commodity Index weights:
    //   ~20% metals (gold, silver, copper, aluminum, zinc)
    //   ~80% energy/ag (crude, gasoline, heating oil, natgas, wheat,
    //                    corn, soybean, sugar)
    breakdown: {
      metalsShare: 0.2,
      metals: metalOf({
        GOLD: 0.4,
        SILVER: 0.1,
        ALUMINUM: 0.25,
        COPPER: 0.15,
        ZINC: 0.1,
      }),
      energyAg: energyAgOf({
        CRUDE_OIL: 0.4,
        GASOLINE: 0.15,
        HEATING_OIL: 0.1,
        NATURAL_GAS: 0.07,
        WHEAT: 0.07,
        CORN: 0.07,
        SOYBEAN: 0.08,
        SUGAR: 0.06,
      }),
    },
  },
  USO: {
    assetClass: "commodity",
    symbol: "USO",
    name: "United States Oil Fund",
    referencePriceUSD: 80,
    expectedRealCAGR: 0,
    breakdown: {
      metalsShare: 0,
      metals: metalOf({}),
      energyAg: energyAgOf({ CRUDE_OIL: 1 }),
    },
  },
  PDBC: {
    assetClass: "commodity",
    symbol: "PDBC",
    name: "Invesco Optimum Yield Diversified Commodity",
    referencePriceUSD: 15,
    expectedRealCAGR: 0,
    breakdown: {
      metalsShare: 0.18,
      metals: metalOf({
        GOLD: 0.45,
        ALUMINUM: 0.25,
        COPPER: 0.2,
        SILVER: 0.1,
      }),
      energyAg: energyAgOf({
        CRUDE_OIL: 0.4,
        GASOLINE: 0.15,
        HEATING_OIL: 0.1,
        NATURAL_GAS: 0.05,
        WHEAT: 0.08,
        CORN: 0.08,
        SOYBEAN: 0.08,
        SUGAR: 0.06,
      }),
    },
  },

  // Crypto. Reference prices are conservative placeholders; users
  // override via the holding editor or by entering a current per-unit
  // price at creation. Expected real CAGR is a high-uncertainty
  // long-run guess — the user should override based on their thesis.
  BTC: {
    assetClass: "crypto",
    symbol: "BTC",
    name: "Bitcoin",
    referencePriceUSD: 70000,
    expectedRealCAGR: 0.08,
  },
  ETH: {
    assetClass: "crypto",
    symbol: "ETH",
    name: "Ethereum",
    referencePriceUSD: 3500,
    expectedRealCAGR: 0.08,
  },
  SOL: {
    assetClass: "crypto",
    symbol: "SOL",
    name: "Solana",
    referencePriceUSD: 150,
    expectedRealCAGR: 0.08,
  },
  USDC: {
    assetClass: "crypto",
    symbol: "USDC",
    name: "USD Coin (stablecoin)",
    referencePriceUSD: 1,
    expectedRealCAGR: 0.0,
  },

  // ── Crypto ETFs (stock-market-traded crypto exposure) ───────────────
  // These trade on stock exchanges and get live quotes through the
  // same /api/quote pipeline as equities. They are crypto exposure
  // dressed in an ETF wrapper — for class-breakdown purposes they
  // land in the Crypto bucket, not Stocks.
  IBIT: {
    assetClass: "crypto",
    symbol: "IBIT",
    name: "iShares Bitcoin Trust",
    referencePriceUSD: 60,
    expectedRealCAGR: 0.08,
    livePriceable: true,
  },
  FBTC: {
    assetClass: "crypto",
    symbol: "FBTC",
    name: "Fidelity Wise Origin Bitcoin Fund",
    referencePriceUSD: 90,
    expectedRealCAGR: 0.08,
    livePriceable: true,
  },
  BITO: {
    assetClass: "crypto",
    symbol: "BITO",
    name: "ProShares Bitcoin Strategy ETF",
    referencePriceUSD: 25,
    expectedRealCAGR: 0.07, // futures-roll drag vs spot
    livePriceable: true,
  },
  GBTC: {
    assetClass: "crypto",
    symbol: "GBTC",
    name: "Grayscale Bitcoin Trust",
    referencePriceUSD: 85,
    expectedRealCAGR: 0.075,
    livePriceable: true,
  },
  ETHA: {
    assetClass: "crypto",
    symbol: "ETHA",
    name: "iShares Ethereum Trust",
    referencePriceUSD: 28,
    expectedRealCAGR: 0.07,
    livePriceable: true,
  },
  ETHE: {
    assetClass: "crypto",
    symbol: "ETHE",
    name: "Grayscale Ethereum Trust",
    referencePriceUSD: 35,
    expectedRealCAGR: 0.07,
    livePriceable: true,
  },
  BITX: {
    assetClass: "crypto",
    symbol: "BITX",
    name: "Volatility Shares 2x Bitcoin Strategy",
    referencePriceUSD: 70,
    expectedRealCAGR: 0.1,
    leverage: 2,
    livePriceable: true,
  },
};

export function getPreset(symbol: string): AssetPreset | undefined {
  return ASSET_PRESETS[symbol.toUpperCase()];
}

export function presetClass(symbol: string): AssetClass | null {
  const p = getPreset(symbol);
  return p ? p.assetClass : null;
}
