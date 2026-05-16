import type { Snapshot } from "@/lib/persistence/persistence";

/**
 * Trailing-window NW growth velocity. Reads from the user's snapshot
 * history and derives:
 *
 *   - 30 / 90 / 365 / lifetime $ change
 *   - annualized growth-rate (CAGR-equivalent) over the same windows
 *
 * Snapshots are the canonical history; we trust them as ground truth
 * over any reconstructed series. Returns null for any window that
 * lacks enough data (no snapshot on/before the window cutoff, or no
 * positive starting NW).
 *
 * Why annualize trailing windows: the headline Independence projection is
 * forward-looking with assumed CAGR. This card answers the inverse —
 * "what CAGR have I *actually* run at lately?" — so users can sanity-
 * check their assumptions against lived experience.
 */

export type GrowthWindow = "30d" | "90d" | "1y" | "lifetime";

export type GrowthVelocityWindow = {
  window: GrowthWindow;
  /** Days covered by the window. lifetime → variable. */
  daysCovered: number;
  startUSD: number;
  endUSD: number;
  deltaUSD: number;
  /** Annualized growth rate (nominal — snapshots are nominal $). null if undefined. */
  annualizedReturn: number | null;
};

export type GrowthVelocity = {
  asOf: number;
  windows: GrowthVelocityWindow[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Minimum trailing window before annualization is meaningful. Below
 * this, the Math.pow(ratio, 365/days) projection explodes on any
 * meaningful change — e.g. a large $ jump over a single afternoon
 * compounds to absurd percentages (literally hundreds of digits).
 * The $ delta is still useful for short windows; we just suppress
 * the meaningless annualized %.
 */
const MIN_DAYS_FOR_ANNUALIZATION = 7;

/**
 * Defensive clamp on annualized returns. Even at the 7-day floor a
 * 2x move would imply ~2^52 ≈ 4.5e15 annualized — still too wild to
 * render. Capping at ±1000% (11x in a year) keeps the display
 * readable while still flagging "ran very hot". null beyond this
 * because we can't honestly show such a number as meaningful.
 */
const MAX_ANNUALIZED = 10;
const MIN_ANNUALIZED = -1;

const WINDOW_DAYS: Record<Exclude<GrowthWindow, "lifetime">, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

function snapshotAtOrBefore(
  snapshots: Snapshot[],
  t: number,
): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    if (s.t <= t && (!best || s.t > best.t)) best = s;
  }
  return best;
}

function annualize(
  startUSD: number,
  endUSD: number,
  days: number,
): number | null {
  if (startUSD <= 0 || days <= 0) return null;
  // Sub-week windows can't be meaningfully annualized — return null
  // so the UI omits the percent rather than rendering an exploded
  // power-law projection. The $ delta is still rendered.
  if (days < MIN_DAYS_FOR_ANNUALIZATION) return null;
  const ratio = endUSD / startUSD;
  if (ratio <= 0) return MIN_ANNUALIZED;
  const annualized = Math.pow(ratio, 365 / days) - 1;
  if (!Number.isFinite(annualized)) return null;
  // Defensive clamp — anything beyond this is "rendered as the
  // cap value" to keep the layout sane; the underlying delta $
  // already tells the real story.
  if (annualized > MAX_ANNUALIZED) return MAX_ANNUALIZED;
  if (annualized < MIN_ANNUALIZED) return MIN_ANNUALIZED;
  return annualized;
}

export function growthVelocity(
  snapshots: Snapshot[],
  now: number = Date.now(),
): GrowthVelocity | null {
  if (snapshots.length < 2) return null;
  // Defensive copy + sort so caller doesn't have to.
  const sorted = snapshots
    .filter((s) => Number.isFinite(s.netWorthUSD) && s.netWorthUSD > 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return null;

  const latest = sorted[sorted.length - 1];

  const windows: GrowthVelocityWindow[] = [];

  for (const w of ["30d", "90d", "1y"] as const) {
    const cutoff = now - WINDOW_DAYS[w] * MS_PER_DAY;
    const start = snapshotAtOrBefore(sorted, cutoff);
    if (!start) continue;
    const days = (latest.t - start.t) / MS_PER_DAY;
    if (days <= 0) continue;
    windows.push({
      window: w,
      daysCovered: days,
      startUSD: start.netWorthUSD,
      endUSD: latest.netWorthUSD,
      deltaUSD: latest.netWorthUSD - start.netWorthUSD,
      annualizedReturn: annualize(start.netWorthUSD, latest.netWorthUSD, days),
    });
  }

  const first = sorted[0];
  const lifetimeDays = (latest.t - first.t) / MS_PER_DAY;
  if (lifetimeDays > 0) {
    windows.push({
      window: "lifetime",
      daysCovered: lifetimeDays,
      startUSD: first.netWorthUSD,
      endUSD: latest.netWorthUSD,
      deltaUSD: latest.netWorthUSD - first.netWorthUSD,
      annualizedReturn: annualize(
        first.netWorthUSD,
        latest.netWorthUSD,
        lifetimeDays,
      ),
    });
  }

  if (windows.length === 0) return null;
  return { asOf: now, windows };
}

export const GROWTH_WINDOW_LABELS: Record<GrowthWindow, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
  lifetime: "Lifetime",
};
