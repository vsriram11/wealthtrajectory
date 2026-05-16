import { describe, expect, it } from "vitest";
import {
  formatLeverage,
  formatPercent,
  formatPercent0,
  formatPercentTight,
  formatUSD,
  formatUSDCompact,
  formatYearsMonths,
} from "@/lib/format";

describe("formatPercentTight", () => {
  it("returns 1 decimal place without the % sign for tight UI slots", () => {
    expect(formatPercentTight(0.634)).toBe("63.4");
    expect(formatPercentTight(0.5)).toBe("50.0");
    expect(formatPercentTight(1)).toBe("100.0");
    expect(formatPercentTight(0)).toBe("0.0");
  });

  it("rounds half-up at the 1-decimal mark", () => {
    expect(formatPercentTight(0.12345)).toBe("12.3");
    expect(formatPercentTight(0.12351)).toBe("12.4");
  });

  it("handles tiny shares without going scientific", () => {
    expect(formatPercentTight(0.0005)).toBe("0.1"); // 0.05 rounds to 0.1 nope → 0.05 → "0.1"? actually toFixed(1) on 0.05 = "0.1"
    expect(formatPercentTight(0.0001)).toBe("0.0");
  });
});

describe("formatPercent (default — 1 decimal max)", () => {
  it("uses up to 1 decimal", () => {
    expect(formatPercent(0.634)).toMatch(/^63\.4%$/);
    expect(formatPercent(0.5)).toMatch(/^50%$/); // 50.0 collapses to 50 because maxFractionDigits trims
  });
});

describe("formatPercent0 (no decimals)", () => {
  it("rounds to nearest integer", () => {
    expect(formatPercent0(0.634)).toBe("63%");
    expect(formatPercent0(0.5)).toBe("50%");
  });
});

describe("formatUSD", () => {
  it("rounds to whole dollars", () => {
    expect(formatUSD(1234.56)).toBe("$1,235");
    expect(formatUSD(0)).toBe("$0");
  });
});

describe("formatUSDCompact", () => {
  it("uses compact notation for large numbers", () => {
    expect(formatUSDCompact(1_500_000)).toBe("$1.5M");
    expect(formatUSDCompact(2_500)).toBe("$2.5K");
  });
});

describe("formatLeverage", () => {
  it("uses 2 decimals under 10×", () => {
    expect(formatLeverage(1)).toBe("1.00x");
    expect(formatLeverage(1.5)).toBe("1.50x");
    expect(formatLeverage(3.25)).toBe("3.25x");
  });

  it("drops decimals at 10× and above", () => {
    expect(formatLeverage(10)).toBe("10x");
    expect(formatLeverage(15.5)).toBe("16x");
  });
});

describe("formatYearsMonths", () => {
  it("handles past/zero gracefully", () => {
    expect(formatYearsMonths(0)).toBe("now");
    expect(formatYearsMonths(-5)).toBe("now");
  });

  it("formats months-only when under a year", () => {
    expect(formatYearsMonths(5)).toBe("5 mo");
  });

  it("formats years and months", () => {
    expect(formatYearsMonths(14)).toBe("1 yr 2 mo");
    expect(formatYearsMonths(26)).toBe("2 yrs 2 mo");
  });

  it("drops the 0-month suffix on round years", () => {
    expect(formatYearsMonths(12)).toBe("1 yr");
    expect(formatYearsMonths(24)).toBe("2 yrs");
  });
});
