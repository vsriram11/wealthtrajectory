import { describe, expect, it } from "vitest";
import {
  HISTORICAL_REAL_RETURNS,
  HISTORICAL_RETURNS_FIRST_YEAR,
  HISTORICAL_RETURNS_LAST_YEAR,
  LEVERAGED_2X_PROJECTION,
  LEVERAGED_2X_REAL_DATA_START_YEAR,
  RECOGNIZED_2X_EQUITY_TICKERS,
} from "./historicalReturns";

describe("HISTORICAL_REAL_RETURNS — base coverage", () => {
  it("spans 1928-2025 (98 years)", () => {
    expect(HISTORICAL_RETURNS_FIRST_YEAR).toBe(1928);
    expect(HISTORICAL_RETURNS_LAST_YEAR).toBe(2025);
    expect(HISTORICAL_REAL_RETURNS).toHaveLength(98);
  });

  it("years are strictly ascending with no gaps", () => {
    for (let i = 1; i < HISTORICAL_REAL_RETURNS.length; i++) {
      expect(HISTORICAL_REAL_RETURNS[i].year).toBe(
        HISTORICAL_REAL_RETURNS[i - 1].year + 1,
      );
    }
  });

  it("all real-return fields are finite numbers", () => {
    for (const row of HISTORICAL_REAL_RETURNS) {
      expect(Number.isFinite(row.stocks)).toBe(true);
      expect(Number.isFinite(row.bonds)).toBe(true);
      expect(Number.isFinite(row.cash)).toBe(true);
      expect(Number.isFinite(row.corpBonds)).toBe(true);
      expect(Number.isFinite(row.realEstate)).toBe(true);
      expect(Number.isFinite(row.gold)).toBe(true);
      expect(Number.isFinite(row.stocks2x)).toBe(true);
    }
  });
});

describe("stocks2x — provenance flags", () => {
  it("years 1928-2000 are flagged 'projected'", () => {
    for (const row of HISTORICAL_REAL_RETURNS) {
      if (row.year < LEVERAGED_2X_REAL_DATA_START_YEAR) {
        expect(row.stocks2xSource).toBe("projected");
      }
    }
  });

  it("years 2001-2025 are flagged 'real' (RYTNX-derived)", () => {
    for (const row of HISTORICAL_REAL_RETURNS) {
      if (row.year >= LEVERAGED_2X_REAL_DATA_START_YEAR) {
        expect(row.stocks2xSource).toBe("real");
      }
    }
  });

  it("LEVERAGED_2X_REAL_DATA_START_YEAR matches the first 'real' row", () => {
    const firstReal = HISTORICAL_REAL_RETURNS.find(
      (r) => r.stocks2xSource === "real",
    );
    expect(firstReal?.year).toBe(LEVERAGED_2X_REAL_DATA_START_YEAR);
  });
});

describe("stocks2x — projection formula consistency (1928-2000)", () => {
  // Re-apply the calibrated formula and verify each projected row
  // matches within rounding tolerance (4 dp).
  function project2x(stocks: number): number {
    return (
      LEVERAGED_2X_PROJECTION.aCoefficient * stocks +
      LEVERAGED_2X_PROJECTION.bCoefficient * stocks * stocks +
      LEVERAGED_2X_PROJECTION.dragRealAnnual
    );
  }

  it("each projected row matches the formula within rounding (1e-4)", () => {
    for (const row of HISTORICAL_REAL_RETURNS) {
      if (row.stocks2xSource !== "projected") continue;
      const expected = project2x(row.stocks);
      // 4-decimal storage means up to 5e-5 rounding error per side
      expect(Math.abs(row.stocks2x - expected)).toBeLessThanOrEqual(1e-4);
    }
  });
});

describe("stocks2x — calibration parameters are documented", () => {
  it("projection constants are exported and finite", () => {
    expect(Number.isFinite(LEVERAGED_2X_PROJECTION.aCoefficient)).toBe(true);
    expect(Number.isFinite(LEVERAGED_2X_PROJECTION.bCoefficient)).toBe(true);
    expect(Number.isFinite(LEVERAGED_2X_PROJECTION.dragRealAnnual)).toBe(true);
    expect(LEVERAGED_2X_PROJECTION.calibrationYearStart).toBe(2001);
    expect(LEVERAGED_2X_PROJECTION.calibrationYearEnd).toBe(2025);
  });

  it("aCoefficient is ~2 (LETF leverage factor)", () => {
    // Calibrated value is exactly 2.0; floor at 1.9 / ceiling at 2.1 in case
    // future re-calibration nudges it slightly.
    expect(LEVERAGED_2X_PROJECTION.aCoefficient).toBeGreaterThanOrEqual(1.9);
    expect(LEVERAGED_2X_PROJECTION.aCoefficient).toBeLessThanOrEqual(2.1);
  });

  it("dragRealAnnual is negative (fee + financing cost)", () => {
    expect(LEVERAGED_2X_PROJECTION.dragRealAnnual).toBeLessThan(0);
    // Sanity-check magnitude: should be in -2% to -10% range (real terms,
    // covers expense ratio + financing - inflation offset).
    expect(LEVERAGED_2X_PROJECTION.dragRealAnnual).toBeGreaterThanOrEqual(
      -0.1,
    );
    expect(LEVERAGED_2X_PROJECTION.dragRealAnnual).toBeLessThanOrEqual(-0.02);
  });
});

describe("stocks2x — real data sanity checks (2001-2025)", () => {
  // Catastrophic year (2008): real RYTNX should be ~-68% real.
  it("2008 real RYTNX ≈ -67.9% real", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 2008);
    expect(row).toBeDefined();
    expect(row?.stocks2xSource).toBe("real");
    expect(row?.stocks2x).toBeLessThan(-0.65);
    expect(row?.stocks2x).toBeGreaterThan(-0.7);
  });

  // High-volatility bull year (2013): real RYTNX should significantly
  // outpace 2x of the 1x stocks return due to daily-reset compounding.
  it("2013 real RYTNX exceeds 2x of the 1x stocks return (compounding bonus)", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 2013);
    expect(row).toBeDefined();
    expect(row?.stocks2x).toBeGreaterThan(2 * (row?.stocks ?? 0));
  });

  // Stock-bond crash 2022: real RYTNX should be heavily negative but
  // less than -2 * 1x stocks return (daily-reset mitigation).
  it("2022 real RYTNX is between 2x of 1x stocks and naive -2x", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 2022);
    expect(row).toBeDefined();
    const stocks = row?.stocks ?? 0;
    const stocks2x = row?.stocks2x ?? 0;
    // Should be more negative than 1x stocks
    expect(stocks2x).toBeLessThan(stocks);
    // But less negative than naive -2x (daily-reset prevents full doubling)
    expect(stocks2x).toBeGreaterThan(2 * stocks);
  });
});

describe("stocks2x — projected catastrophic years (historical SORR)", () => {
  // The Great Depression 1931 projection should be catastrophic — confirm
  // the formula produces a survival-threatening number.
  it("1931 projected stocks2x indicates ~-69% real (Great Depression)", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 1931);
    expect(row).toBeDefined();
    expect(row?.stocks2xSource).toBe("projected");
    expect(row?.stocks2x).toBeLessThan(-0.65);
  });

  // The 1973-74 stagflation crash — 1974 should show extreme loss.
  it("1974 projected stocks2x indicates ~-64% real (stagflation crash)", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 1974);
    expect(row).toBeDefined();
    expect(row?.stocks2xSource).toBe("projected");
    expect(row?.stocks2x).toBeLessThan(-0.6);
  });

  // 1937 (FDR recession): another well-known catastrophic year.
  it("1937 projected stocks2x indicates ~-68% real (FDR recession)", () => {
    const row = HISTORICAL_REAL_RETURNS.find((r) => r.year === 1937);
    expect(row).toBeDefined();
    expect(row?.stocks2xSource).toBe("projected");
    expect(row?.stocks2x).toBeLessThan(-0.65);
  });
});

describe("RECOGNIZED_2X_EQUITY_TICKERS", () => {
  it("exports SSO, SPUU, QLD as the 2x-equity basis tickers", () => {
    expect(RECOGNIZED_2X_EQUITY_TICKERS).toContain("SSO");
    expect(RECOGNIZED_2X_EQUITY_TICKERS).toContain("SPUU");
    expect(RECOGNIZED_2X_EQUITY_TICKERS).toContain("QLD");
  });

  it("does NOT contain 3x or sector-leverage tickers", () => {
    const tickerList = RECOGNIZED_2X_EQUITY_TICKERS as readonly string[];
    expect(tickerList).not.toContain("TQQQ");
    expect(tickerList).not.toContain("UPRO");
    expect(tickerList).not.toContain("SOXL");
    expect(tickerList).not.toContain("SPXL");
  });
});
