import { describe, expect, it } from "vitest";
import type { AssetClass } from "@/lib/types";
import {
  HOLDING_KINDS,
  HOLDING_KIND_META,
  defaultRealCAGR,
  pluralLabel,
  singularLabel,
} from "@/lib/portfolio/holdingKinds";

const ALL_KINDS: AssetClass[] = [
  "equity",
  "bond",
  "cash",
  "crypto",
  "commodity",
  "real_estate",
  "private_stock",
  "other",
];

describe("HOLDING_KIND_META", () => {
  it("has an entry for every AssetClass discriminant", () => {
    for (const kind of ALL_KINDS) {
      expect(HOLDING_KIND_META[kind]).toBeDefined();
      expect(HOLDING_KIND_META[kind].kind).toBe(kind);
    }
  });

  it("every entry's `kind` field matches its key", () => {
    for (const [key, meta] of Object.entries(HOLDING_KIND_META)) {
      expect(meta.kind).toBe(key);
    }
  });

  it("HOLDING_KINDS enumerates every key exactly once", () => {
    expect([...HOLDING_KINDS].sort()).toEqual([...ALL_KINDS].sort());
    expect(new Set(HOLDING_KINDS).size).toBe(HOLDING_KINDS.length);
  });

  it("every plural and singular label is a non-empty string", () => {
    for (const kind of ALL_KINDS) {
      expect(HOLDING_KIND_META[kind].pluralLabel.length).toBeGreaterThan(0);
      expect(HOLDING_KIND_META[kind].singularLabel.length).toBeGreaterThan(0);
    }
  });

  it("every defaultRealCAGR is finite and within a sane range", () => {
    for (const kind of ALL_KINDS) {
      const cagr = HOLDING_KIND_META[kind].defaultRealCAGR;
      expect(Number.isFinite(cagr)).toBe(true);
      // Sanity: real CAGR defaults shouldn't be > 20% or < -5% under
      // any reasonable benchmark; a typo will exceed this.
      expect(cagr).toBeGreaterThanOrEqual(-0.05);
      expect(cagr).toBeLessThanOrEqual(0.2);
    }
  });

  it("equity is the highest default (long-run-equity bias)", () => {
    const equityCAGR = HOLDING_KIND_META.equity.defaultRealCAGR;
    for (const kind of ALL_KINDS) {
      if (kind === "equity" || kind === "private_stock") continue;
      expect(HOLDING_KIND_META[kind].defaultRealCAGR).toBeLessThanOrEqual(
        equityCAGR,
      );
    }
  });
});

describe("helper accessors", () => {
  it("pluralLabel returns the registry's pluralLabel", () => {
    expect(pluralLabel("equity")).toBe("Stocks");
    expect(pluralLabel("commodity")).toBe("Commodities");
  });

  it("singularLabel returns the registry's singularLabel", () => {
    expect(singularLabel("equity")).toBe("Stock");
    expect(singularLabel("commodity")).toBe("Commodity");
  });

  it("plural and singular labels differ for inflectable kinds", () => {
    // For "Cash", "Real estate", "Private stock", "Other" they
    // intentionally match — singularizing those reads worse.
    const inflectable: AssetClass[] = ["equity", "bond", "commodity"];
    for (const kind of inflectable) {
      expect(pluralLabel(kind)).not.toBe(singularLabel(kind));
    }
  });

  it("defaultRealCAGR returns the registry value", () => {
    expect(defaultRealCAGR("equity")).toBe(0.07);
    expect(defaultRealCAGR("bond")).toBe(0.015);
    expect(defaultRealCAGR("cash")).toBe(0.005);
  });
});
