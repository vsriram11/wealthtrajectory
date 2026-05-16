import { describe, expect, it } from "vitest";
import { getPreset } from "@/lib/portfolio/presets";
import { bondLeverageFromDuration } from "@/lib/portfolio/bondLeverage";

// Leveraged-ETF defaults shipped in the preset registry. If any of
// these regress (wrong leverage multiplier, removed entirely), this
// test catches it.
const LEVERAGED_DEFAULTS: ReadonlyArray<[string, number]> = [
  ["TQQQ", 3],
  ["SOXL", 3],
  ["QLD", 2],
  ["SSO", 2],
  ["UPRO", 3],
  ["SPXL", 3],
  ["SQQQ", 3],
  ["NVDL", 2],
  ["FNGU", 3],
  ["TECL", 3],
  ["TNA", 3],
  ["FAS", 3],
  ["UCO", 2],
  ["LABU", 3],
  ["BOIL", 2],
  ["YINN", 3],
  ["GUSH", 2],
  ["DPST", 3],
  ["NUGT", 2],
  ["USD", 2],
  ["ROM", 2],
  ["UYG", 2],
  ["JNUG", 2],
  ["DIG", 2],
  ["MVV", 2],
  ["BIB", 2],
  ["UWM", 2],
  ["SPUU", 2],
  ["MIDU", 3],
  ["TMF", 3],
  ["UDOW", 3],
];

describe("leveraged ETF preset defaults", () => {
  it("ships at least 31 leveraged tickers with correct multipliers", () => {
    for (const [symbol, expectedLeverage] of LEVERAGED_DEFAULTS) {
      const p = getPreset(symbol);
      if (!p) throw new Error(`Missing preset for ${symbol}`);
      // Bond presets (TMF) and equity presets (everything else) both
      // carry a `leverage` field with the same semantics.
      if (p.assetClass !== "equity" && p.assetClass !== "bond") {
        throw new Error(
          `Preset ${symbol} has assetClass ${p.assetClass} — leveraged defaults should be equity or bond`,
        );
      }
      expect(p.leverage).toBe(expectedLeverage);
    }
  });

  it("non-leveraged equity presets default to 1×", () => {
    // Equity presets stay flat at 1× — leverage doesn't auto-derive
    // from any other field for equity holdings.
    for (const symbol of ["VOO", "VTI", "QQQ"]) {
      const p = getPreset(symbol);
      if (!p) throw new Error(`Missing baseline preset ${symbol}`);
      if (p.assetClass !== "equity") continue;
      expect(p.leverage).toBe(1);
    }
  });

  it("non-leveraged bond presets default to bondLeverageFromDuration(duration)", () => {
    // Bonds with no explicit leverage product wrapper should carry the
    // duration-derived value so the holding is created as auto. Tests
    // the inverse: BND at 6.5y → 0.75, not 1×.
    for (const symbol of ["BND", "AGG", "TLT", "IEF", "SHY", "LQD", "HYG"]) {
      const p = getPreset(symbol);
      if (!p) throw new Error(`Missing baseline preset ${symbol}`);
      if (p.assetClass !== "bond") continue;
      const derived = bondLeverageFromDuration(p.averageDurationYears);
      expect(Math.abs(p.leverage - derived)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("multi-asset (capital-efficient) ETF presets", () => {
  // [symbol, expected leg kinds, sum of weights (intrinsic leverage)]
  const CAPITAL_EFFICIENT: ReadonlyArray<
    [string, ReadonlyArray<string>, number]
  > = [
    ["NTSX", ["equity", "bond"], 1.5],
    ["NTSI", ["equity", "bond"], 1.5],
    ["NTSE", ["equity", "bond"], 1.5],
    ["NTSG", ["equity", "bond"], 1.5],
    ["GDE", ["equity", "commodity"], 1.8],
    ["RSST", ["equity", "other"], 2.0],
    ["RSSY", ["equity", "other"], 2.0],
    ["RSSB", ["equity", "bond"], 2.0],
  ];

  it("each capital-efficient ETF ships a composition that matches its marketing", () => {
    for (const [symbol, expectedKinds, expectedLev] of CAPITAL_EFFICIENT) {
      const p = getPreset(symbol);
      if (!p) throw new Error(`Missing preset for ${symbol}`);
      if (p.assetClass !== "equity")
        throw new Error(`${symbol} should be equity assetClass`);
      if (!p.composition || p.composition.length === 0) {
        throw new Error(`${symbol} missing composition`);
      }
      const kinds = p.composition.map((l) => l.kind);
      expect(kinds).toEqual(expectedKinds);
      const sumW = p.composition.reduce((s, l) => s + l.weight, 0);
      expect(sumW).toBeCloseTo(expectedLev, 3);
    }
  });

  it("AVGE is single-class (no composition)", () => {
    const p = getPreset("AVGE");
    if (!p) throw new Error("Missing AVGE preset");
    if (p.assetClass !== "equity") throw new Error("AVGE should be equity");
    expect(p.composition).toBeUndefined();
  });
});

describe("commodity ETF presets", () => {
  const COMMODITY_TICKERS = [
    "GLD",
    "IAU",
    "GLDM",
    "SGOL",
    "SLV",
    "DBC",
    "USO",
    "PDBC",
  ];

  it("ships the major commodity ETFs under assetClass=commodity", () => {
    for (const sym of COMMODITY_TICKERS) {
      const p = getPreset(sym);
      if (!p) throw new Error(`Missing commodity preset ${sym}`);
      expect(p.assetClass).toBe("commodity");
    }
  });

  it("gold ETFs share the gold 1% real-CAGR baseline", () => {
    for (const sym of ["GLD", "IAU", "GLDM", "SGOL"]) {
      const p = getPreset(sym);
      if (!p) throw new Error(`Missing ${sym}`);
      expect(p.expectedRealCAGR).toBeCloseTo(0.01, 3);
    }
  });
});

describe("live-priceable crypto ETF presets", () => {
  const CRYPTO_ETF_TICKERS = [
    "IBIT",
    "FBTC",
    "BITO",
    "GBTC",
    "ETHA",
    "ETHE",
    "BITX",
  ];

  it("all stock-market crypto ETFs are flagged livePriceable", () => {
    for (const sym of CRYPTO_ETF_TICKERS) {
      const p = getPreset(sym);
      if (!p) throw new Error(`Missing crypto ETF preset ${sym}`);
      if (p.assetClass !== "crypto")
        throw new Error(`${sym} should be assetClass=crypto`);
      expect(p.livePriceable).toBe(true);
    }
  });

  it("native crypto presets (BTC, ETH) are not livePriceable", () => {
    for (const sym of ["BTC", "ETH", "SOL", "USDC"]) {
      const p = getPreset(sym);
      if (!p) throw new Error(`Missing native crypto preset ${sym}`);
      if (p.assetClass !== "crypto") continue;
      // livePriceable should be absent or false on the native ones.
      expect(p.livePriceable === true).toBe(false);
    }
  });

  it("BITX is 2× leverage (the only leveraged crypto preset)", () => {
    const p = getPreset("BITX");
    if (!p) throw new Error("Missing BITX");
    if (p.assetClass !== "crypto") throw new Error("Wrong class for BITX");
    expect(p.leverage).toBe(2);
  });
});

describe("commodity preset sub-classification (breakdown)", () => {
  it("GLD / IAU / GLDM / SGOL ship a 100% metals → 100% gold breakdown", () => {
    for (const sym of ["GLD", "IAU", "GLDM", "SGOL"]) {
      const p = getPreset(sym);
      if (!p || p.assetClass !== "commodity")
        throw new Error(`Missing or wrong-class ${sym}`);
      if (!p.breakdown) throw new Error(`${sym} should ship a breakdown`);
      expect(p.breakdown.metalsShare).toBe(1);
      expect(p.breakdown.metals.GOLD).toBe(1);
      const sum = Object.values(p.breakdown.metals).reduce(
        (s, v) => s + v,
        0,
      );
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("SLV ships 100% metals → 100% silver", () => {
    const p = getPreset("SLV");
    if (!p || p.assetClass !== "commodity")
      throw new Error("SLV missing or wrong class");
    if (!p.breakdown) throw new Error("SLV needs breakdown");
    expect(p.breakdown.metalsShare).toBe(1);
    expect(p.breakdown.metals.SILVER).toBe(1);
    expect(p.breakdown.metals.GOLD).toBe(0);
  });

  it("USO ships 0% metals → 100% crude oil", () => {
    const p = getPreset("USO");
    if (!p || p.assetClass !== "commodity")
      throw new Error("USO missing or wrong class");
    if (!p.breakdown) throw new Error("USO needs breakdown");
    expect(p.breakdown.metalsShare).toBe(0);
    expect(p.breakdown.energyAg.CRUDE_OIL).toBe(1);
  });

  it("DBC breakdown reflects a real broad-commodity mix (20% metals, 80% energy/ag)", () => {
    const p = getPreset("DBC");
    if (!p || p.assetClass !== "commodity")
      throw new Error("DBC missing or wrong class");
    if (!p.breakdown) throw new Error("DBC needs breakdown");
    expect(p.breakdown.metalsShare).toBeCloseTo(0.2, 2);
    const metalsSum = Object.values(p.breakdown.metals).reduce(
      (s, v) => s + v,
      0,
    );
    const energyAgSum = Object.values(p.breakdown.energyAg).reduce(
      (s, v) => s + v,
      0,
    );
    expect(metalsSum).toBeCloseTo(1, 3);
    expect(energyAgSum).toBeCloseTo(1, 3);
  });
});
