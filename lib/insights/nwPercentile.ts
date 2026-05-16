/**
 * Net worth percentile reference data, approximating the 2022
 * Federal Reserve Survey of Consumer Finances (SCF). Used to give
 * users a rough "where do I sit" against US household NW
 * distribution — not for clinical accuracy.
 *
 * The SCF reports household NW (assets - liabilities) including
 * primary residence equity and retirement accounts; matches the
 * way this app computes householdNetWorth, so the comparison is
 * apples-to-apples (close enough for ballpark UX).
 *
 * Values approximate the public summary breakdowns; for clarity
 * we round to 2-significant-figures and stay USD nominal-2022
 * (treat as today's $ — the user's NW today is also nominal-ish,
 * and inflation distortion is small enough at SCF's reporting
 * granularity).
 *
 * Citations: Fed SCF 2022 Bulletin (Sept 2023); secondary tables
 * from DQYDJ / Empower wealth reports.
 */

export type AgeBand =
  | "under_35"
  | "35_44"
  | "45_54"
  | "55_64"
  | "65_74"
  | "75_plus";

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  under_35: "Under 35",
  "35_44": "35 – 44",
  "45_54": "45 – 54",
  "55_64": "55 – 64",
  "65_74": "65 – 74",
  "75_plus": "75 +",
};

export function ageToBand(age: number): AgeBand | null {
  if (!Number.isFinite(age) || age < 18) return null;
  if (age < 35) return "under_35";
  if (age < 45) return "35_44";
  if (age < 55) return "45_54";
  if (age < 65) return "55_64";
  if (age < 75) return "65_74";
  return "75_plus";
}

type PercentileRow = {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
};

/**
 * Household NW percentile breakpoints by age band. Approximate
 * 2022 SCF figures.
 */
const TABLE: Record<AgeBand, PercentileRow> = {
  under_35: {
    p10: -1_000,
    p25: 3_500,
    p50: 39_000,
    p75: 135_000,
    p90: 370_000,
    p95: 650_000,
    p99: 2_500_000,
  },
  "35_44": {
    p10: 1_000,
    p25: 30_000,
    p50: 135_000,
    p75: 420_000,
    p90: 1_100_000,
    p95: 2_000_000,
    p99: 6_000_000,
  },
  "45_54": {
    p10: 3_500,
    p25: 70_000,
    p50: 247_000,
    p75: 760_000,
    p90: 2_000_000,
    p95: 3_700_000,
    p99: 11_000_000,
  },
  "55_64": {
    p10: 6_000,
    p25: 95_000,
    p50: 364_000,
    p75: 1_050_000,
    p90: 2_800_000,
    p95: 5_300_000,
    p99: 16_000_000,
  },
  "65_74": {
    p10: 10_000,
    p25: 110_000,
    p50: 410_000,
    p75: 1_130_000,
    p90: 3_000_000,
    p95: 5_600_000,
    p99: 17_000_000,
  },
  "75_plus": {
    p10: 9_000,
    p25: 95_000,
    p50: 334_000,
    p75: 880_000,
    p90: 2_400_000,
    p95: 4_300_000,
    p99: 13_000_000,
  },
};

/**
 * SCF 2022 was fielded mid-2022; we treat that as the snapshot
 * date for inflating breakpoints forward to "today's dollars".
 * Using a fractional-year offset rather than a calendar-year
 * boundary so the math is smooth as time passes.
 */
const SCF_SNAPSHOT_MS = Date.UTC(2022, 5, 1); // June 2022

export function yearsSinceSCFSnapshot(now: number = Date.now()): number {
  return Math.max(0, (now - SCF_SNAPSHOT_MS) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Inflate a single breakpoint forward by N years at the given
 * annual inflation rate. Compounds annually — close enough for
 * the multi-year horizons we apply here.
 */
function inflate(usd: number, rate: number, years: number): number {
  if (!Number.isFinite(rate) || rate <= 0 || years <= 0) return usd;
  return usd * Math.pow(1 + rate, years);
}

/**
 * Return the percentile table for a band, optionally inflation-
 * adjusted forward from the SCF 2022 snapshot date. Passing 0 for
 * inflationRate (or omitting it) yields the raw 2022 breakpoints.
 *
 * Math is intentionally simple — CPI-style uniform scaling. Real-
 * world wealth percentile breakpoints grow somewhat faster than
 * CPI (asset appreciation favors upper percentiles), but a pure
 * inflation adjustment is mathematically defensible and avoids
 * over-claiming about trend extrapolation. The card surfaces the
 * caveat explicitly.
 */
export function getBandTable(
  band: AgeBand,
  inflationRate = 0,
  yearsForward = 0,
): PercentileRow {
  const raw = TABLE[band];
  if (inflationRate <= 0 || yearsForward <= 0) return raw;
  return {
    p10: inflate(raw.p10, inflationRate, yearsForward),
    p25: inflate(raw.p25, inflationRate, yearsForward),
    p50: inflate(raw.p50, inflationRate, yearsForward),
    p75: inflate(raw.p75, inflationRate, yearsForward),
    p90: inflate(raw.p90, inflationRate, yearsForward),
    p95: inflate(raw.p95, inflationRate, yearsForward),
    p99: inflate(raw.p99, inflationRate, yearsForward),
  };
}

/**
 * Linearly interpolate the user's percentile from the table.
 * Off-table extremes clamp to 1 / 99. Optional inflation arguments
 * inflate the underlying breakpoints from the SCF 2022 snapshot
 * before lookup, so today's nominal NW gets compared against
 * today's-dollar breakpoints (rather than 2022 ones).
 */
export function nwPercentile(
  nwUSD: number,
  band: AgeBand,
  inflationRate = 0,
  yearsForward = 0,
): number {
  const row = getBandTable(band, inflationRate, yearsForward);
  const points: Array<[number, number]> = [
    [10, row.p10],
    [25, row.p25],
    [50, row.p50],
    [75, row.p75],
    [90, row.p90],
    [95, row.p95],
    [99, row.p99],
  ];
  if (nwUSD <= points[0][1]) return 1;
  if (nwUSD >= points[points.length - 1][1]) return 99;
  for (let i = 0; i < points.length - 1; i++) {
    const [pLow, vLow] = points[i];
    const [pHigh, vHigh] = points[i + 1];
    if (nwUSD >= vLow && nwUSD <= vHigh) {
      const frac = (nwUSD - vLow) / (vHigh - vLow);
      return pLow + frac * (pHigh - pLow);
    }
  }
  return 50;
}
