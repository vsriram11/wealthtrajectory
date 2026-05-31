import { describe, expect, it } from "vitest";

import {
  CPI_ANNUAL_DECEMBER,
  cpiAt,
  inflationFactor,
} from "./cpiHistory";

describe("CPI_ANNUAL_DECEMBER", () => {
  it("covers 2004 through at least 2025 (the cache window)", () => {
    const years = CPI_ANNUAL_DECEMBER.map((r) => r.year);
    expect(years).toContain(2004);
    expect(Math.max(...years)).toBeGreaterThanOrEqual(2025);
  });

  it("is monotonically non-decreasing (CPI doesn't run backward over a year)", () => {
    // Year-over-year deflation IS possible historically but only by
    // tiny amounts (2009 was the only sub-1% reading since the
    // 1950s). Pinning monotonic-non-decreasing catches data-entry
    // errors that would flip a digit and produce an absurd negative
    // CAGR baseline.
    for (let i = 1; i < CPI_ANNUAL_DECEMBER.length; i++) {
      expect(
        CPI_ANNUAL_DECEMBER[i].cpi,
        `CPI ${CPI_ANNUAL_DECEMBER[i].year} >= ${CPI_ANNUAL_DECEMBER[i - 1].year}`,
      ).toBeGreaterThanOrEqual(CPI_ANNUAL_DECEMBER[i - 1].cpi - 1);
    }
  });

  it("years are unique (no duplicates that would break the year lookup)", () => {
    const years = CPI_ANNUAL_DECEMBER.map((r) => r.year);
    expect(new Set(years).size).toBe(years.length);
  });
});

describe("cpiAt", () => {
  it("returns the December anchor at end-of-year", () => {
    // Dec 31, 2010 UTC. yearFraction ≈ 1, so result ≈ CPI[2010].
    const t = Date.UTC(2010, 11, 31);
    const result = cpiAt(t);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(219.18, 0);
  });

  it("interpolates linearly mid-year between two anchors", () => {
    // Halfway through 2010, value should sit halfway between
    // CPI[2009] (215.95) and CPI[2010] (219.18).
    const t = Date.UTC(2010, 6, 2); // ~Jul 2, day 183 of 365
    const result = cpiAt(t);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(215.95);
    expect(result!).toBeLessThan(219.18);
    // Approximately the midpoint of the two anchors.
    expect(result!).toBeCloseTo((215.95 + 219.18) / 2, 0);
  });

  it("returns null for a timestamp before the covered window", () => {
    // 2003 is before our 2004 baseline.
    const t = Date.UTC(2003, 5, 1);
    expect(cpiAt(t)).toBeNull();
  });

  it("returns null for a timestamp after the latest covered year", () => {
    // The window ends with the latest year in the data. 2030 is
    // well beyond it.
    const t = Date.UTC(2030, 5, 1);
    expect(cpiAt(t)).toBeNull();
  });
});

describe("inflationFactor", () => {
  it("matches CPI(end)/CPI(start) for two year-end anchors", () => {
    // From Dec 31 2010 to Dec 31 2020. CPI 219.18 → 260.47.
    // Cumulative inflation factor = 260.47 / 219.18 ≈ 1.188.
    const startT = Date.UTC(2010, 11, 31);
    const endT = Date.UTC(2020, 11, 31);
    const f = inflationFactor(startT, endT);
    expect(f).not.toBeNull();
    expect(f!).toBeCloseTo(260.47 / 219.18, 3);
  });

  it("returns null when either endpoint falls outside the covered window", () => {
    expect(inflationFactor(Date.UTC(2003, 0, 1), Date.UTC(2010, 0, 1))).toBeNull();
    expect(inflationFactor(Date.UTC(2010, 0, 1), Date.UTC(2030, 0, 1))).toBeNull();
  });

  it("returns 1.0 (no inflation) when start === end", () => {
    const t = Date.UTC(2015, 5, 1);
    const f = inflationFactor(t, t);
    expect(f).not.toBeNull();
    expect(f!).toBeCloseTo(1.0, 6);
  });

  it("typical 2007-2025 window matches cumulative US inflation ~73%", () => {
    // Cumulative inflation since Dec 2007 ≈ 54% per FRED CPIAUCNS.
    // (210.04 → ~324.55, ratio ≈ 1.55). Reality-check the data.
    const f = inflationFactor(
      Date.UTC(2007, 11, 31),
      Date.UTC(2025, 11, 31),
    );
    expect(f).not.toBeNull();
    expect(f!).toBeGreaterThan(1.4);
    expect(f!).toBeLessThan(1.7);
  });
});
