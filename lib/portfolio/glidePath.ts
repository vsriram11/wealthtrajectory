import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";
import type { AssetClass } from "@/lib/types";

/**
 * Lifecycle / glide-path target allocation.
 *
 * A glide-path is a sequence of {age, allocation} waypoints. Between
 * waypoints, we linearly interpolate each asset class. Before the
 * first waypoint, the first allocation applies; after the last, the
 * last applies (constant tails). This mirrors how Vanguard /
 * Fidelity / Schwab target-date funds publish their glides.
 *
 * Why store waypoints instead of a parameterized curve (e.g. "100 −
 * age in stocks"): users have intuitions about specific ages ("at
 * 50 I want 70% stocks, at 65 I want 50%"). Waypoints let them
 * express that directly. The interpolation handles the years in
 * between.
 *
 * Stored alongside the static `targetAllocation` so users can pick
 * one or the other. When a GlidePath is set, it shadows the static
 * target — consumers prefer the glide-path-resolved allocation
 * when computing drift.
 *
 * Engine-pure: no React, no store.
 */

/**
 * One waypoint in a glide-path.
 *
 *   age: the member's age (years) where this allocation applies.
 *   allocation: target shares per asset class, summing approximately
 *               to 1. Same shape as the static TargetAllocation.
 */
export type GlidePathWaypoint = {
  age: number;
  allocation: TargetAllocation;
};

export type GlidePath = {
  /** Sorted waypoints in ascending age order. */
  waypoints: GlidePathWaypoint[];
};

/**
 * Sort waypoints in-place by age and return a new GlidePath. Use on
 * any user input to keep downstream code simple (no need to handle
 * out-of-order input).
 */
export function normalizeGlidePath(gp: GlidePath): GlidePath {
  // Sort, then collapse same-age waypoints to the last-written
  // one. Without this, two waypoints sharing an age would make
  // allocationAtAge return only the first one's allocation
  // forever (because the linear-interpolation `span = 0` case
  // pins t = 0). Real-world cause: a user accidentally adds a
  // 65-year waypoint twice while tweaking; the second edit
  // appears to do nothing.
  const sorted = gp.waypoints.slice().sort((a, b) => a.age - b.age);
  const deduped: GlidePathWaypoint[] = [];
  for (const w of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.age === w.age) {
      deduped[deduped.length - 1] = w; // later write wins
    } else {
      deduped.push(w);
    }
  }
  return { waypoints: deduped };
}

/**
 * Resolve the target allocation at a specific age via linear
 * interpolation between the surrounding waypoints. Constant-tail
 * before the first and after the last waypoint.
 *
 * Returns null when the glide-path has no waypoints.
 *
 * Linear interpolation is per-class. If class C is 0.8 at age 40 and
 * 0.5 at age 60, then at age 50 it's 0.65. The sum-to-1 invariant
 * holds if each waypoint sums to 1 (linear combination preserves
 * the sum).
 */
export function allocationAtAge(
  gp: GlidePath,
  age: number,
): TargetAllocation | null {
  const wps = gp.waypoints;
  if (wps.length === 0) return null;
  if (wps.length === 1) return wps[0].allocation;
  if (age <= wps[0].age) return wps[0].allocation;
  if (age >= wps[wps.length - 1].age) return wps[wps.length - 1].allocation;
  // Find the bracket.
  let lo = wps[0];
  let hi = wps[wps.length - 1];
  for (let i = 0; i < wps.length - 1; i++) {
    if (age >= wps[i].age && age <= wps[i + 1].age) {
      lo = wps[i];
      hi = wps[i + 1];
      break;
    }
  }
  const span = hi.age - lo.age;
  const t = span > 0 ? (age - lo.age) / span : 0;
  const classes = new Set<AssetClass>([
    ...(Object.keys(lo.allocation) as AssetClass[]),
    ...(Object.keys(hi.allocation) as AssetClass[]),
  ]);
  const out: TargetAllocation = {};
  for (const c of classes) {
    const a = lo.allocation[c] ?? 0;
    const b = hi.allocation[c] ?? 0;
    out[c] = a * (1 - t) + b * t;
  }
  return out;
}

/**
 * Three named glide-path presets matching the major target-date
 * fund families, plus a Pfau/Kitces rising-equity shape. Numbers are
 * simplified — the real funds tweak yearly, but these capture the
 * shape users mean when they say "Vanguard-style glide-path."
 *
 * Vanguard Target Retirement (representative):
 *   age 25: 90/10 stocks/bonds
 *   age 40: 90/10
 *   age 60: 50/50  (start tapering ~10 years before target)
 *   age 65: 50/50  (retirement)
 *   age 72: 30/70  (stabilizes at 30% stocks)
 *
 * Conservative (Fidelity Freedom Index-like):
 *   age 25: 90/10
 *   age 50: 70/30
 *   age 65: 45/55
 *   age 75: 30/70
 *
 * Aggressive (Vanguard LifeStrategy Growth-like, never tapers):
 *   age 25: 90/10
 *   age 65: 80/20  (stays high; "perpetual portfolio" for Independence crowd)
 *   age 90: 80/20
 *
 * Rising-equity (Pfau/Kitces "U-shape"):
 *   Dip equity at retirement to mitigate sequence-of-returns risk,
 *   then ramp BACK UP as the portfolio survives the early-retirement
 *   gauntlet. The original Pfau/Kitces paper (Reducing Retirement
 *   Risk with a Rising Equity Glide Path, 2014) tests starts between
 *   20-40% equity at retirement → 60-80% by end-of-life. We use a
 *   FIRE-friendly shape: 60% equity in late-accumulation drifts down
 *   to 40% at the typical FIRE retirement age, then rises back to
 *   80% by age 80 as the portfolio's survival is increasingly
 *   established. See https://www.kitces.com/blog/rising-equity-glidepaths-in-retirement/
 *   for the research baseline.
 */
export const GLIDE_PATH_PRESETS: Record<string, GlidePath> = {
  vanguard_target_retirement: {
    waypoints: [
      { age: 25, allocation: { equity: 0.9, bond: 0.1 } },
      { age: 40, allocation: { equity: 0.9, bond: 0.1 } },
      { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
      { age: 65, allocation: { equity: 0.5, bond: 0.5 } },
      { age: 72, allocation: { equity: 0.3, bond: 0.7 } },
    ],
  },
  conservative: {
    waypoints: [
      { age: 25, allocation: { equity: 0.9, bond: 0.1 } },
      { age: 50, allocation: { equity: 0.7, bond: 0.3 } },
      { age: 65, allocation: { equity: 0.45, bond: 0.55 } },
      { age: 75, allocation: { equity: 0.3, bond: 0.7 } },
    ],
  },
  perpetual_aggressive: {
    waypoints: [
      { age: 25, allocation: { equity: 0.9, bond: 0.1 } },
      { age: 65, allocation: { equity: 0.8, bond: 0.2 } },
      { age: 90, allocation: { equity: 0.8, bond: 0.2 } },
    ],
  },
  rising_equity_pfau: {
    waypoints: [
      { age: 30, allocation: { equity: 0.6, bond: 0.4 } },
      { age: 45, allocation: { equity: 0.4, bond: 0.6 } },
      { age: 60, allocation: { equity: 0.6, bond: 0.4 } },
      { age: 80, allocation: { equity: 0.8, bond: 0.2 } },
    ],
  },
};
