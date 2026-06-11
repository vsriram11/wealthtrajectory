import { describe, expect, it } from "vitest";

import { computeCalendarYearStats, computeStats } from "./TickerLookup";

/**
 * Build a synthetic daily-history series across `years`, with the
 * price growing linearly from `startPrice` to `endPrice` across the
 * window. Uses one point per business-day-equivalent (~250/year)
 * which is enough resolution for the calendar-year aggregator's
 * first-of-year / last-of-year picks.
 */
function buildHistory(
  startYear: number,
  endYear: number,
  startPrice: number,
  endPrice: number,
): Array<{ t: number; p: number }> {
  const out: Array<{ t: number; p: number }> = [];
  const startMs = Date.UTC(startYear, 0, 2); // Jan 2 — first trading-day proxy
  const endMs = Date.UTC(endYear, 11, 30); // Dec 30 — last trading-day proxy
  const STEP_MS = 86_400_000 * 1.45; // ~250 points/year
  const span = endMs - startMs;
  for (let t = startMs; t <= endMs; t += STEP_MS) {
    const f = (t - startMs) / span;
    out.push({ t, p: startPrice + f * (endPrice - startPrice) });
  }
  return out;
}

describe("computeCalendarYearStats", () => {
  it("returns an empty array when history has fewer than 2 points", () => {
    expect(computeCalendarYearStats([], [])).toEqual([]);
    expect(
      computeCalendarYearStats([{ t: Date.UTC(2020, 0, 1), p: 100 }], []),
    ).toEqual([]);
  });

  it("emits one row per calendar year covered by the history", () => {
    const history = buildHistory(2018, 2021, 100, 200);
    const rows = computeCalendarYearStats(history, []);
    expect(rows.map((r) => r.year)).toEqual([2018, 2019, 2020, 2021]);
  });

  it("price return: end / start - 1 for a single calendar year", () => {
    // Single year 2020, linear growth 100 → 120 → 20% nominal.
    const history = buildHistory(2020, 2020, 100, 120);
    const rows = computeCalendarYearStats(history, []);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.year).toBe(2020);
    expect(r.priceReturnNominal!).toBeCloseTo(0.2, 2);
    // No dividends → total return == price return, share
    // multiplier stays at 1.
    expect(r.totalReturnNominal!).toBeCloseTo(0.2, 2);
    // No dividends → every yield convention reports 0.
    expect(r.dividendYieldOpening!).toBe(0);
    expect(r.dividendYieldAverage!).toBe(0);
    expect(r.dividendYieldTrailing!).toBe(0);
  });

  it("dividend yield (opening): sum-of-year-divs / opening price", () => {
    // Flat 2021 at 100, two $1 dividends → opening yield = 2%.
    const history = buildHistory(2021, 2021, 100, 100);
    const dividends = [
      { t: Date.UTC(2021, 2, 15), amount: 1 },
      { t: Date.UTC(2021, 8, 15), amount: 1 },
    ];
    const rows = computeCalendarYearStats(history, dividends);
    expect(rows).toHaveLength(1);
    expect(rows[0].dividendYieldOpening!).toBeCloseTo(0.02, 3);
  });

  it("dividend yield (average): sum-of-year-divs / mean of daily closes", () => {
    // Linear ramp 100 → 200 across 2021 → mean close ≈ 150.
    // $3 of dividends → average yield ≈ 3 / 150 = 2%.
    const history = buildHistory(2021, 2021, 100, 200);
    const dividends = [
      { t: Date.UTC(2021, 2, 15), amount: 1 },
      { t: Date.UTC(2021, 5, 15), amount: 1 },
      { t: Date.UTC(2021, 8, 15), amount: 1 },
    ];
    const [row] = computeCalendarYearStats(history, dividends);
    expect(row.dividendYieldAverage!).toBeCloseTo(0.02, 2);
    // Opening yield (denom = 100) > average yield > trailing
    // (denom = 200): a ramping price makes the three diverge in
    // a predictable order, which itself is a useful sanity check.
    expect(row.dividendYieldOpening!).toBeGreaterThan(
      row.dividendYieldAverage!,
    );
    expect(row.dividendYieldAverage!).toBeGreaterThan(
      row.dividendYieldTrailing!,
    );
  });

  it("dividend yield (trailing): sum-of-year-divs / closing price", () => {
    // 2021 ramp 100 → 200, $2 of dividends → trailing yield = 1%
    // (the headline number Yahoo / Morningstar would print).
    const history = buildHistory(2021, 2021, 100, 200);
    const dividends = [
      { t: Date.UTC(2021, 2, 15), amount: 1 },
      { t: Date.UTC(2021, 8, 15), amount: 1 },
    ];
    const [row] = computeCalendarYearStats(history, dividends);
    expect(row.dividendYieldTrailing!).toBeCloseTo(0.01, 3);
  });

  it("flat-price years: all three yield conventions agree", () => {
    // When the price never moves, open / avg / close all equal
    // the same number → all three yields converge.
    const history = buildHistory(2021, 2021, 100, 100);
    const dividends = [{ t: Date.UTC(2021, 5, 15), amount: 2 }];
    const [row] = computeCalendarYearStats(history, dividends);
    expect(row.dividendYieldOpening!).toBeCloseTo(0.02, 3);
    expect(row.dividendYieldAverage!).toBeCloseTo(0.02, 3);
    expect(row.dividendYieldTrailing!).toBeCloseTo(0.02, 3);
  });

  it("total return > price return when dividends are paid (reinvestment lifts shares)", () => {
    // Flat price (100 → 100), $2 in dividends → total return is
    // strictly positive while price return is ~0.
    const history = buildHistory(2021, 2021, 100, 100);
    const dividends = [
      { t: Date.UTC(2021, 5, 15), amount: 1 },
      { t: Date.UTC(2021, 11, 15), amount: 1 },
    ];
    const [row] = computeCalendarYearStats(history, dividends);
    expect(row.priceReturnNominal!).toBeCloseTo(0, 2);
    expect(row.totalReturnNominal!).toBeGreaterThan(0.019); // ~ 2%
  });

  it("real returns are LOWER than nominal during inflationary periods", () => {
    // 2022 CPI rose ~6% in our table; a 10% nominal return is
    // therefore noticeably less in real terms.
    const history = buildHistory(2022, 2022, 100, 110);
    const [row] = computeCalendarYearStats(history, []);
    expect(row.priceReturnNominal!).toBeCloseTo(0.1, 2);
    expect(row.priceReturnReal!).toBeLessThan(row.priceReturnNominal!);
  });

  it("flags partial / YTD years (data ends mid-year)", () => {
    // 2020 → mid-2021. The 2021 row should be marked partial.
    const history: Array<{ t: number; p: number }> = [];
    const startMs = Date.UTC(2020, 0, 2);
    const midOf2021Ms = Date.UTC(2021, 5, 30);
    const STEP_MS = 86_400_000 * 1.45;
    for (let t = startMs; t <= midOf2021Ms; t += STEP_MS) {
      const f = (t - startMs) / (midOf2021Ms - startMs);
      history.push({ t, p: 100 + f * 30 });
    }
    const rows = computeCalendarYearStats(history, []);
    const r2020 = rows.find((r) => r.year === 2020)!;
    const r2021 = rows.find((r) => r.year === 2021)!;
    expect(r2020.partial).toBe(false);
    expect(r2021.partial).toBe(true);
  });

  it("flags an inception-year row as partial when the series starts late in the year", () => {
    // Ticker inception in October 2020 → 2020 row is partial.
    const history: Array<{ t: number; p: number }> = [];
    const startMs = Date.UTC(2020, 9, 15); // Oct 15 2020
    const endMs = Date.UTC(2021, 11, 30);
    const STEP_MS = 86_400_000 * 1.45;
    for (let t = startMs; t <= endMs; t += STEP_MS) {
      const f = (t - startMs) / (endMs - startMs);
      history.push({ t, p: 100 + f * 20 });
    }
    const rows = computeCalendarYearStats(history, []);
    const r2020 = rows.find((r) => r.year === 2020)!;
    expect(r2020.partial).toBe(true);
  });

  it("real returns are null for years outside the CPI series (pre-2004)", () => {
    // CPI coverage starts at 2004; a 2002 row gets null reals
    // (the function surfaces null rather than silently falling
    // through to the nominal figure).
    const history = buildHistory(2002, 2002, 100, 110);
    const [row] = computeCalendarYearStats(history, []);
    expect(row.priceReturnNominal!).toBeCloseTo(0.1, 2);
    expect(row.priceReturnReal).toBeNull();
    expect(row.totalReturnReal).toBeNull();
  });

  it("rows come back in ascending-year order (UI reverses for display)", () => {
    const history = buildHistory(2015, 2020, 100, 200);
    const rows = computeCalendarYearStats(history, []);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].year).toBeGreaterThan(rows[i - 1].year);
    }
  });

  it("skips years where only one history point is available", () => {
    // Inject a single mid-2017 point; the 2017 row should be
    // skipped (need two points to compute a return).
    const history = [
      { t: Date.UTC(2016, 11, 28), p: 100 },
      { t: Date.UTC(2017, 5, 1), p: 110 },
      { t: Date.UTC(2018, 0, 5), p: 115 },
      { t: Date.UTC(2018, 11, 28), p: 130 },
    ];
    const rows = computeCalendarYearStats(history, []);
    const years = rows.map((r) => r.year);
    expect(years).not.toContain(2017);
    expect(years).toContain(2018);
  });
});

/**
 * Build a TickerData fixture from a synthetic price + dividend
 * series. computeStats reads `history` (range-filtered) and
 * `dividends` (range-filtered) from the data object; we set both
 * to the same series so the "selected window" IS the whole
 * series, and pass an `allDividends` override on the calls where
 * we want to model a TTM lookback that reaches PRIOR to the
 * window.
 */
function tickerData(
  history: Array<{ t: number; p: number }>,
  dividends: Array<{ t: number; amount: number }>,
) {
  return {
    currentPrice: history[history.length - 1]?.p ?? null,
    history,
    dividends,
    splits: [],
    lastPoint: history[history.length - 1] ?? { t: 0, p: 0 },
  };
}

describe("computeStats — dividend yield (avg TTM across window)", () => {
  it("flat price + steady dividends: avg TTM yield equals annual divs / flat price", () => {
    // Three full years 2019-2021 at price 100, $1 dividend each
    // June 15. From any day in years 2-3 the TTM cash is exactly
    // $1 → yield 1%. Year 1 ramps up from 0 (Jan-May) to $1
    // (Jun-Dec) so the avg across all three years is a mix of
    // <1% and 1%. The 2020-2021-only window pins the steady-
    // state case cleanly.
    const history = buildDailyHistory(
      Date.UTC(2020, 0, 2),
      Date.UTC(2021, 11, 30),
      100,
      100,
    );
    const allDividends = [
      { t: Date.UTC(2019, 5, 15), amount: 1 },
      { t: Date.UTC(2020, 5, 15), amount: 1 },
      { t: Date.UTC(2021, 5, 15), amount: 1 },
    ];
    const stats = computeStats(
      tickerData(history, allDividends),
      allDividends,
    );
    expect(stats.dividendYield).toBeCloseTo(0.01, 3);
    expect(stats.ttmDividendsPerShare).toBeCloseTo(1.0, 1);
  });

  it("ramping price + flat dividends: avg yield sits BETWEEN open-yield and end-yield", () => {
    // Price ramps 100 → 200 across 2021. $2/yr in dividends
    // (steady-state by start of year because of priors). At the
    // window's open price ~100 the yield is ~2%; at the end
    // price 200 it's ~1%. The avg across the linearly-rising
    // window should be in between (and closer to the geometric
    // middle since the yield is the reciprocal of a linear
    // sequence).
    const history = buildDailyHistory(
      Date.UTC(2021, 0, 2),
      Date.UTC(2021, 11, 30),
      100,
      200,
    );
    const allDividends = [
      { t: Date.UTC(2020, 2, 15), amount: 0.5 },
      { t: Date.UTC(2020, 5, 15), amount: 0.5 },
      { t: Date.UTC(2020, 8, 15), amount: 0.5 },
      { t: Date.UTC(2020, 11, 15), amount: 0.5 },
      { t: Date.UTC(2021, 2, 15), amount: 0.5 },
      { t: Date.UTC(2021, 5, 15), amount: 0.5 },
      { t: Date.UTC(2021, 8, 15), amount: 0.5 },
      { t: Date.UTC(2021, 11, 15), amount: 0.5 },
    ];
    const stats = computeStats(
      tickerData(history, allDividends),
      allDividends,
    );
    // Boundary check: between end-of-window yield (1%) and
    // open-of-window yield (2%). Not annualizing or geometric-
    // meaning, just the arithmetic mean of daily TTM yields.
    expect(stats.dividendYield!).toBeGreaterThan(0.01);
    expect(stats.dividendYield!).toBeLessThan(0.02);
  });

  it("zero dividends across the entire window → yield is 0", () => {
    const history = buildDailyHistory(
      Date.UTC(2020, 0, 2),
      Date.UTC(2020, 11, 30),
      100,
      120,
    );
    const stats = computeStats(tickerData(history, []), []);
    expect(stats.dividendYield).toBe(0);
    // The return shape converts a zero TTM cash sum to null so
    // the UI sub-label can fall through to "no dividends across
    // range" instead of printing "$0.00/share".
    expect(stats.ttmDividendsPerShare).toBeNull();
  });

  it("uses the FULL dividend list (not just window-filtered) for the trailing 12m lookback", () => {
    // A 1-month window in mid-2021. The TTM lookback from any
    // day in that window reaches back into 2020 dividends —
    // which sit OUTSIDE the window. The function must include
    // them via allDividends.
    const windowHistory = buildDailyHistory(
      Date.UTC(2021, 5, 1),
      Date.UTC(2021, 5, 30),
      100,
      100,
    );
    const allDividends = [
      { t: Date.UTC(2020, 8, 15), amount: 1 },
      { t: Date.UTC(2020, 11, 15), amount: 1 },
      { t: Date.UTC(2021, 2, 15), amount: 1 },
    ];
    // The window's own `dividends` field is empty (no divs
    // landed in June 2021), but allDividends carries the
    // trailing context.
    const stats = computeStats(
      tickerData(windowHistory, []),
      allDividends,
    );
    // Three $1 divs within the trailing-12m of every June 2021
    // day → yield ≈ 3%, avg TTM cash ≈ $3.
    expect(stats.dividendYield).toBeCloseTo(0.03, 3);
    expect(stats.ttmDividendsPerShare).toBeCloseTo(3, 1);
  });
});

function buildDailyHistory(
  startMs: number,
  endMs: number,
  startPrice: number,
  endPrice: number,
): Array<{ t: number; p: number }> {
  const out: Array<{ t: number; p: number }> = [];
  const STEP_MS = 86_400_000; // daily
  for (let t = startMs; t <= endMs; t += STEP_MS) {
    const f = (t - startMs) / (endMs - startMs);
    out.push({ t, p: startPrice + f * (endPrice - startPrice) });
  }
  return out;
}
