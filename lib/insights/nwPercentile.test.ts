import { describe, expect, it } from "vitest";
import {
  ageToBand,
  getBandTable,
  nwPercentile,
  yearsSinceSCFSnapshot,
} from "@/lib/insights/nwPercentile";

describe("ageToBand", () => {
  it("maps ages correctly", () => {
    expect(ageToBand(30)).toBe("under_35");
    expect(ageToBand(34)).toBe("under_35");
    expect(ageToBand(35)).toBe("35_44");
    expect(ageToBand(44)).toBe("35_44");
    expect(ageToBand(45)).toBe("45_54");
    expect(ageToBand(64)).toBe("55_64");
    expect(ageToBand(65)).toBe("65_74");
    expect(ageToBand(80)).toBe("75_plus");
  });

  it("returns null for invalid", () => {
    expect(ageToBand(NaN)).toBeNull();
    expect(ageToBand(5)).toBeNull();
  });
});

describe("nwPercentile", () => {
  it("at the median maps to ~50", () => {
    const t = getBandTable("35_44");
    expect(nwPercentile(t.p50, "35_44")).toBeCloseTo(50, 0);
  });

  it("at p90 maps to ~90", () => {
    const t = getBandTable("45_54");
    expect(nwPercentile(t.p90, "45_54")).toBeCloseTo(90, 0);
  });

  it("below p10 clamps to 1", () => {
    expect(nwPercentile(-1_000_000, "35_44")).toBe(1);
  });

  it("above p99 clamps to 99", () => {
    expect(nwPercentile(1_000_000_000, "35_44")).toBe(99);
  });

  it("monotonic increase with NW", () => {
    const band = "55_64" as const;
    let prev = -Infinity;
    for (const v of [10_000, 100_000, 500_000, 1_000_000, 5_000_000]) {
      const p = nwPercentile(v, band);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("inflation adjustment", () => {
  it("zero inflation = identity (matches raw table)", () => {
    const raw = getBandTable("35_44");
    const inflated = getBandTable("35_44", 0, 5);
    expect(inflated.p50).toBe(raw.p50);
  });

  it("zero years = identity (snapshot itself)", () => {
    const raw = getBandTable("35_44");
    const inflated = getBandTable("35_44", 0.03, 0);
    expect(inflated.p50).toBe(raw.p50);
  });

  it("scales breakpoints by (1+i)^y", () => {
    const raw = getBandTable("35_44");
    const inflated = getBandTable("35_44", 0.03, 3);
    const factor = Math.pow(1.03, 3);
    expect(inflated.p50).toBeCloseTo(raw.p50 * factor, 5);
    expect(inflated.p10).toBeCloseTo(raw.p10 * factor, 5);
  });

  it("inflated breakpoint comparison lowers your percentile (same NW, higher bar)", () => {
    // User NW at the raw median → 50th percentile.
    const raw = getBandTable("35_44");
    const userNW = raw.p50;
    expect(nwPercentile(userNW, "35_44")).toBeCloseTo(50, 0);
    // After 5 years of 3% inflation, the same dollar amount is
    // below the inflated median — lower percentile.
    const p = nwPercentile(userNW, "35_44", 0.03, 5);
    expect(p).toBeLessThan(50);
  });

  it("yearsSinceSCFSnapshot is positive after mid-2022", () => {
    const y = yearsSinceSCFSnapshot(Date.UTC(2025, 5, 1));
    expect(y).toBeCloseTo(3, 0);
  });

  it("yearsSinceSCFSnapshot clamps to 0 for pre-snapshot dates", () => {
    expect(yearsSinceSCFSnapshot(Date.UTC(2020, 0, 1))).toBe(0);
  });
});
