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
 * Default assumed annual CPI rate (2.5%) used to extrapolate beyond
 * the published series. Matches the app's plan-level inflation
 * default. Picks the published series first, only falls back to
 * extrapolation when the timestamp postdates the latest tabulated
 * year — the published values are anchors, never replaced.
 */
const ASSUMED_FORWARD_CPI_RATE = 0.025;

/**
 * Interpolate the CPI level at a specific UTC timestamp.
 *
 * Coverage rules:
 *   - Inside the published window (2004 through the latest
 *     tabulated year): linear interpolation between Dec-of-year
 *     anchors.
 *   - PAST the published window: extrapolate from the latest
 *     tabulated CPI using `ASSUMED_FORWARD_CPI_RATE`. Without
 *     this, a session whose wall-clock sits in a year not yet
 *     published surfaces "real CAGR unavailable" everywhere —
 *     the trailing few months of any chart range hit a null
 *     factor. Extrapolation produces a slightly-conservative
 *     estimate (the published rate often beats 2.5% in recent
 *     years) but a finite number that drives the real-CAGR
 *     math cleanly.
 *   - BEFORE the published window (pre-2004): returns null. The
 *     static-cache window starts Dec 2005, so this branch only
 *     fires on misuse and shouldn't be papered over with a guess.
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
  if (prior && current) {
    return prior.cpi + yearFraction * (current.cpi - prior.cpi);
  }
  // Forward extrapolation: timestamp postdates the published
  // series. Walk forward from the latest tabulated year applying
  // the assumed rate.
  const latest = CPI_ANNUAL_DECEMBER[CPI_ANNUAL_DECEMBER.length - 1];
  if (latest && year > latest.year) {
    const fullYearsAhead = year - latest.year - 1;
    const cpiAtPriorYearEnd =
      latest.cpi * Math.pow(1 + ASSUMED_FORWARD_CPI_RATE, fullYearsAhead);
    const cpiAtThisYearEnd =
      cpiAtPriorYearEnd * (1 + ASSUMED_FORWARD_CPI_RATE);
    return cpiAtPriorYearEnd + yearFraction * (cpiAtThisYearEnd - cpiAtPriorYearEnd);
  }
  return null;
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
