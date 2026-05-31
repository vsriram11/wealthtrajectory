/**
 * Annual end-of-year US CPI-U (urban) levels, source: BLS CPIAUCNS
 * series (the same series the `historicalReturns.ts` workbook
 * deflates against). Values are December-of-year index points,
 * 1982–84 = 100 base.
 *
 * Used by `TickerLookup` (and any other surface that wants a
 * point-to-point inflation factor) to compute REAL CAGR for an
 * arbitrary ticker over an arbitrary window:
 *
 *   nominalCAGR = (P_end / P_start) ^ (1 / years) - 1
 *   inflationFactor = CPI_end / CPI_start
 *   realCAGR = ((P_end / P_start) / inflationFactor) ^ (1/years) - 1
 *
 * For partial years (e.g., a ticker that started mid-2010) we
 * linearly interpolate between Dec-of-prior-year and Dec-of-year
 * — accurate enough at the multi-year horizons this is used for,
 * and a hell of a lot simpler than carrying monthly CPI.
 *
 * The cache's price history starts Dec 1 2005, so we cover 2004
 * (for the prior-year baseline used by the Dec-2005 interpolation)
 * through the most recent complete year. The series is extended
 * each January when BLS publishes the prior December's reading.
 */
export const CPI_ANNUAL_DECEMBER: ReadonlyArray<{
  year: number;
  /** End-of-year (December) CPI-U index level, base 1982-84 = 100. */
  cpi: number;
}> = [
  { year: 2004, cpi: 190.3 },
  { year: 2005, cpi: 196.8 },
  { year: 2006, cpi: 201.8 },
  { year: 2007, cpi: 210.04 },
  { year: 2008, cpi: 210.23 },
  { year: 2009, cpi: 215.95 },
  { year: 2010, cpi: 219.18 },
  { year: 2011, cpi: 225.67 },
  { year: 2012, cpi: 229.6 },
  { year: 2013, cpi: 233.05 },
  { year: 2014, cpi: 234.81 },
  { year: 2015, cpi: 236.53 },
  { year: 2016, cpi: 241.43 },
  { year: 2017, cpi: 246.52 },
  { year: 2018, cpi: 251.23 },
  { year: 2019, cpi: 256.97 },
  { year: 2020, cpi: 260.47 },
  { year: 2021, cpi: 278.8 },
  { year: 2022, cpi: 296.8 },
  { year: 2023, cpi: 306.75 },
  { year: 2024, cpi: 315.61 },
  { year: 2025, cpi: 324.55 },
];

/**
 * Interpolate the CPI level at a specific UTC timestamp. Returns
 * null when the timestamp falls outside the covered window — caller
 * should treat that as "real CAGR unavailable" rather than guessing.
 *
 * The interpolation pins each year's value to Dec 31 (end of year)
 * and linearly bridges between consecutive years. A timestamp on
 * Jul 1 2010 sits halfway between Dec 31 2009's CPI and Dec 31
 * 2010's CPI.
 */
export function cpiAt(t: number): number | null {
  const date = new Date(t);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getUTCFullYear();
  // Day-of-year fraction (0 at Jan 1, ~1 at Dec 31). Use UTC
  // arithmetic to keep the function deterministic across server /
  // client / timezones.
  const startOfYear = Date.UTC(year, 0, 1);
  const startOfNextYear = Date.UTC(year + 1, 0, 1);
  const yearFraction = (t - startOfYear) / (startOfNextYear - startOfYear);
  // Bridge from prior-year-end to this-year-end at `yearFraction`.
  const prior = CPI_ANNUAL_DECEMBER.find((r) => r.year === year - 1);
  const current = CPI_ANNUAL_DECEMBER.find((r) => r.year === year);
  if (!prior || !current) return null;
  return prior.cpi + yearFraction * (current.cpi - prior.cpi);
}

/**
 * Cumulative inflation factor between two timestamps. Returns null
 * when either timestamp is outside the covered window.
 *
 *   factor = CPI(end) / CPI(start)
 *
 * A factor of 1.25 means the same dollar bought 25% less by `end`.
 * Used to convert nominal returns to real returns.
 */
export function inflationFactor(
  startT: number,
  endT: number,
): number | null {
  const a = cpiAt(startT);
  const b = cpiAt(endT);
  if (a == null || b == null || a <= 0) return null;
  return b / a;
}
