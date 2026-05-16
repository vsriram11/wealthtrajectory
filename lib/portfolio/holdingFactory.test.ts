import { describe, expect, it } from "vitest";
import { buildHolding, type HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { defaultRealCAGR } from "@/lib/portfolio/holdingKinds";

const FAKE_ID = "hld-test-1";

describe("buildHolding — dispatcher", () => {
  it("returns the correct discriminant for every kind", () => {
    const inputs: Array<{ kind: HoldingCreateInput["kind"]; input: HoldingCreateInput }> = [
      { kind: "cash", input: { kind: "cash", valueUSD: 1000, expectedRealCAGR: 0.005 } },
      { kind: "equity", input: { kind: "equity", symbol: "VOO", valueUSD: 5000 } },
      { kind: "bond", input: { kind: "bond", symbol: "BND", valueUSD: 5000 } },
      { kind: "crypto", input: { kind: "crypto", symbol: "BTC", shares: 1, pricePerUnit: 50000 } },
      { kind: "commodity", input: { kind: "commodity", symbol: "GLD", valueUSD: 3000 } },
      { kind: "real_estate", input: { kind: "real_estate", name: "Home", valueUSD: 500000, expectedRealCAGR: 0.02 } },
      { kind: "private_stock", input: { kind: "private_stock", company: "Acme", shares: 10000, fmvPricePerShareUSD: 1.5 } },
      { kind: "other", input: { kind: "other", name: "Art", valueUSD: 2000, expectedRealCAGR: 0 } },
    ];
    for (const { kind, input } of inputs) {
      const result = buildHolding(FAKE_ID, input);
      expect(result, `kind=${kind}`).not.toBeNull();
      expect(result?.kind).toBe(kind);
      expect(result?.id).toBe(FAKE_ID);
    }
  });
});

describe("buildHolding — cash", () => {
  it("sets valueUSD, CAGR, and 100% US geography by default", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "cash",
      valueUSD: 25000,
      expectedRealCAGR: 0.005,
    });
    expect(h).toMatchObject({
      kind: "cash",
      valueUSD: 25000,
      expectedRealCAGR: 0.005,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    });
  });
});

describe("buildHolding — equity", () => {
  it("Path 1: copies preset reference price + class metadata when symbol is in registry", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "equity",
      symbol: "VOO",
      valueUSD: 1000,
    });
    expect(h?.kind).toBe("equity");
    if (h?.kind !== "equity") throw new Error("narrow");
    expect(h.isManualPrice).toBe(false);
    expect(h.lastPriceUSD).toBeGreaterThan(0);
    // Live tracking on day one: no lastPricedAt until first refresh.
    expect(h.lastPricedAt).toBeNull();
    // Shares back-solved from valueUSD ÷ referencePrice.
    expect(h.shares * h.lastPriceUSD).toBeCloseTo(1000, 6);
    expect(h.valueUSD).toBeCloseTo(1000, 6);
  });

  it("Path 1 with shares input: back-solves valueUSD from shares × referencePrice", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "equity",
      symbol: "VOO",
      shares: 10,
    });
    if (h?.kind !== "equity") throw new Error("narrow");
    expect(h.shares).toBe(10);
    expect(h.valueUSD).toBeCloseTo(10 * h.lastPriceUSD, 6);
    expect(h.enteredAsShares).toBe(true);
  });

  it("Path 2: live-priced unknown ticker keeps live tracking + applies Large Blend US defaults", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "equity",
      symbol: "UNKNOWN",
      valueUSD: 2000,
      livePrice: 100,
    });
    if (h?.kind !== "equity") throw new Error("narrow");
    expect(h.isManualPrice).toBe(false);
    expect(h.lastPriceUSD).toBe(100);
    expect(h.lastPricedAt).not.toBeNull();
    expect(h.shares).toBe(20);
    expect(h.expectedRealCAGR).toBe(defaultRealCAGR("equity"));
    expect(h.styleBox.LARGE_BLEND).toBe(1);
    expect(h.geography.US).toBe(1);
  });

  it("Path 3: unrecognized symbol with no live price falls back to manual mode", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "equity",
      symbol: "UNKNOWN",
      valueUSD: 1500,
    });
    if (h?.kind !== "equity") throw new Error("narrow");
    expect(h.isManualPrice).toBe(true);
    expect(h.lastPricedAt).toBeNull();
    expect(h.valueUSD).toBe(1500);
    expect(h.expectedRealCAGR).toBe(defaultRealCAGR("equity"));
  });
});

describe("buildHolding — bond", () => {
  it("preserves preset leverage when it diverges from duration-derived (e.g. TMF 17y / 3×)", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "bond",
      symbol: "TMF",
      valueUSD: 5000,
    });
    if (h?.kind !== "bond") throw new Error("narrow");
    expect(h.leverage).toBeGreaterThan(1);
    // TMF is daily-3x; bondLeverageIsManual should be true so future
    // duration tweaks don't silently nuke the manual override.
    expect(h.bondLeverageIsManual).toBe(true);
  });

  it("auto-derives leverage from duration when the preset has matching leverage", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "bond",
      symbol: "BND",
      valueUSD: 5000,
    });
    if (h?.kind !== "bond") throw new Error("narrow");
    expect(h.bondLeverageIsManual).toBe(false);
  });

  it("falls back to manual mode for unrecognized + no-live-price input", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "bond",
      symbol: "UNKNOWN-BOND",
      valueUSD: 5000,
    });
    if (h?.kind !== "bond") throw new Error("narrow");
    expect(h.isManualPrice).toBe(true);
    expect(h.averageDurationYears).toBe(7);
    expect(h.bondType).toEqual({ GOVT: 0.5, CORPORATE: 0.5 });
  });
});

describe("buildHolding — crypto", () => {
  it("shares + price-per-unit input (native crypto path) produces a manual-priced holding", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "crypto",
      symbol: "BTC",
      shares: 0.5,
      pricePerUnit: 100000,
    });
    if (h?.kind !== "crypto") throw new Error("narrow");
    expect(h.shares).toBe(0.5);
    expect(h.lastPriceUSD).toBe(100000);
    expect(h.valueUSD).toBe(50000);
    expect(h.isManualPrice).toBe(true);
    expect(h.enteredAsShares).toBe(true);
  });

  it("manual-priced preset (BTC value-only) back-solves shares against the reference price", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "crypto",
      symbol: "BTC",
      valueUSD: 10000,
    });
    if (h?.kind !== "crypto") throw new Error("narrow");
    expect(h.isManualPrice).toBe(true);
    expect(h.shares * h.lastPriceUSD).toBeCloseTo(10000, 6);
  });

  it("unrecognized crypto symbol stores as 1 unit at the entered value", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "crypto",
      symbol: "OBSCURECOIN",
      valueUSD: 500,
    });
    if (h?.kind !== "crypto") throw new Error("narrow");
    expect(h.shares).toBe(1);
    expect(h.lastPriceUSD).toBe(500);
    expect(h.expectedRealCAGR).toBe(defaultRealCAGR("crypto"));
  });
});

describe("buildHolding — commodity", () => {
  it("preset (GLD value-only) gets live tracking + 100% gold metals breakdown", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "commodity",
      symbol: "GLD",
      valueUSD: 8000,
    });
    if (h?.kind !== "commodity") throw new Error("narrow");
    // GLD is 100% physical gold in the preset registry. The
    // `> 0` floor doesn't pin that — a regression that emitted
    // 0.01 gold + 0.99 silver would also pass. Pin the exact
    // share so the registry contract stays load-bearing.
    expect(h.isManualPrice).toBe(false);
    expect(h.breakdown).toBeDefined();
    expect(h.breakdown!.metalsShare).toBe(1);
    expect(h.breakdown!.metals.GOLD).toBe(1);
  });

  it("custom-name (`isCustom: true`) seeds 100% gold metals breakdown", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "commodity",
      symbol: "Gold jewelry",
      valueUSD: 4000,
      isCustom: true,
    });
    if (h?.kind !== "commodity") throw new Error("narrow");
    expect(h.isManualPrice).toBe(true);
    expect(h.breakdown).toBeDefined();
    expect(h.breakdown!.metalsShare).toBe(1);
    expect(h.breakdown!.metals.GOLD).toBe(1);
  });

  it("isIlliquid flag propagates", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "commodity",
      symbol: "Gold jewelry",
      valueUSD: 4000,
      isCustom: true,
      isIlliquid: true,
    });
    if (h?.kind !== "commodity") throw new Error("narrow");
    expect(h.isIlliquid).toBe(true);
  });
});

describe("buildHolding — real_estate", () => {
  it("trims name + clamps leverage to >= 1×", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "real_estate",
      name: "  Beach house  ",
      valueUSD: 800000,
      expectedRealCAGR: 0.02,
      leverage: 0.5, // bogus: leverage can't be < 1× for a property
    });
    if (h?.kind !== "real_estate") throw new Error("narrow");
    expect(h.name).toBe("Beach house");
    expect(h.leverage).toBe(1);
  });

  it("isPrimaryResidence flag propagates", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "real_estate",
      name: "Home",
      valueUSD: 500000,
      expectedRealCAGR: 0.02,
      isPrimaryResidence: true,
    });
    if (h?.kind !== "real_estate") throw new Error("narrow");
    expect(h.isPrimaryResidence).toBe(true);
  });

  it("empty name falls back to 'Property'", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "real_estate",
      name: "   ",
      valueUSD: 1,
      expectedRealCAGR: 0.02,
    });
    if (h?.kind !== "real_estate") throw new Error("narrow");
    expect(h.name).toBe("Property");
  });
});

describe("buildHolding — private_stock", () => {
  it("computes valueUSD = shares × FMV and clamps negative FMV to 0", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "private_stock",
      company: "Acme Inc",
      shares: 10000,
      fmvPricePerShareUSD: 2.5,
    });
    if (h?.kind !== "private_stock") throw new Error("narrow");
    expect(h.valueUSD).toBe(25000);
    expect(h.lastPriceUSD).toBe(2.5);
  });

  it("negative FMV is floored to 0 (no negative-value holdings)", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "private_stock",
      company: "Acme",
      shares: 100,
      fmvPricePerShareUSD: -5,
    });
    if (h?.kind !== "private_stock") throw new Error("narrow");
    expect(h.lastPriceUSD).toBe(0);
    expect(h.valueUSD).toBe(0);
  });

  it("preserves preferred-round price when supplied", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "private_stock",
      company: "Acme",
      shares: 100,
      fmvPricePerShareUSD: 1,
      preferredRoundPricePerShareUSD: 5,
    });
    if (h?.kind !== "private_stock") throw new Error("narrow");
    expect(h.preferredRoundPricePerShareUSD).toBe(5);
  });
});

describe("buildHolding — other", () => {
  it("trims name + falls back to 'Asset' when empty", () => {
    const h = buildHolding(FAKE_ID, {
      kind: "other",
      name: "  ",
      valueUSD: 1000,
      expectedRealCAGR: 0,
    });
    if (h?.kind !== "other") throw new Error("narrow");
    expect(h.name).toBe("Asset");
  });

  it("preserves isIlliquid flag (undefined when false)", () => {
    const explicit = buildHolding(FAKE_ID, {
      kind: "other",
      name: "Watches",
      valueUSD: 1000,
      expectedRealCAGR: 0,
      isIlliquid: true,
    });
    if (explicit?.kind !== "other") throw new Error("narrow");
    expect(explicit.isIlliquid).toBe(true);

    const implicit = buildHolding(FAKE_ID, {
      kind: "other",
      name: "Watches",
      valueUSD: 1000,
      expectedRealCAGR: 0,
    });
    if (implicit?.kind !== "other") throw new Error("narrow");
    expect(implicit.isIlliquid).toBeUndefined();
  });
});

describe("buildHolding — id propagation", () => {
  it("every kind threads the supplied id through to the result", () => {
    const inputs: HoldingCreateInput[] = [
      { kind: "cash", valueUSD: 1, expectedRealCAGR: 0 },
      { kind: "equity", symbol: "VOO", valueUSD: 1 },
      { kind: "bond", symbol: "BND", valueUSD: 1 },
      { kind: "crypto", symbol: "BTC", valueUSD: 1 },
      { kind: "commodity", symbol: "GLD", valueUSD: 1 },
      { kind: "real_estate", name: "Home", valueUSD: 1, expectedRealCAGR: 0 },
      { kind: "private_stock", company: "Acme", shares: 1, fmvPricePerShareUSD: 1 },
      { kind: "other", name: "Art", valueUSD: 1, expectedRealCAGR: 0 },
    ];
    for (const input of inputs) {
      const h = buildHolding("custom-id", input);
      expect(h?.id, `kind=${input.kind}`).toBe("custom-id");
    }
  });
});
