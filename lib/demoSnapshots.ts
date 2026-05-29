import type { Snapshot, SnapshotAppState } from "@/lib/persistence/persistence";
import type { Holding, Household, AssetClass } from "@/lib/types";
import { holdingClass, householdNetWorth } from "@/lib/types";
import { DEMO_ASSUMPTIONS, DEMO_BUDGET, DEMO_HOUSEHOLD, DEMO_INCOME_STREAMS } from "@/lib/demo";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";

/**
 * Demo-mode synthetic snapshot history — 60 monthly snapshots
 * (5 years) ending at `now`, anchored to first-of-month at noon
 * UTC (matches the production monthly-auto-snapshot anchoring).
 *
 * Purpose: the new History tab on the Allocation page needs
 * substantive data to render meaningfully. In real mode that comes
 * from the user's own snapshot accumulation. In demo mode, IDB is
 * inert (PersistenceHydrator gates writes by mode === "real") so
 * without these synthesized snapshots the History tab would always
 * be empty for the demo persona.
 *
 * DESIGN
 *
 *   - "today's" household (DEMO_HOUSEHOLD) is treated as the END
 *     of the 60-month window. We back-cast prior months by
 *     SCALING each holding's `valueUSD` by a per-class growth
 *     trajectory that's deterministic, reproducible, and broadly
 *     realistic for the relevant asset class.
 *
 *   - Per-class trajectory =
 *       base annual growth (compounded backwards)
 *     * deterministic monthly noise (PRNG seeded by month index
 *       so the same demo session always sees the same history)
 *     * mid-window drawdown event (months -30 to -18 simulating
 *       a 2022-style bear) — equity ~-20%, bond ~-12%, crypto
 *       ~-65%, real-estate ~-8%.
 *
 *   - Every snapshot carries the FULL household composition
 *     (back-scaled holdings + members + accounts shape preserved
 *     identically to DEMO_HOUSEHOLD) so per-member views work
 *     across the timeline. Liabilities are NOT back-scaled
 *     (mortgages amortize forward in real life, but the demo
 *     uses fixed principals and modeling that decay deterministically
 *     would add complexity beyond the History tab's needs).
 *
 *   - Each snapshot also carries an `appState` matching the
 *     current demo plan slices, so any future "target alloc over
 *     time" / "assumption drift" visualization gets sensible
 *     demo data (constant targets + constant assumptions across
 *     the 5y window — realistic for most users who don't churn
 *     these settings).
 *
 * PURITY
 *
 *   Pure function of (now, optional months). No Date.now() at
 *   module scope, no Math.random() — the PRNG is a small inline
 *   LCG. Lift into any context (worker / SSR / test) without
 *   modification.
 */

const MONTHS_DEFAULT = 60;

/** Per-class annualized growth rate used to back-cast each holding. */
const ANNUAL_GROWTH: Record<AssetClass, number> = {
  equity: 0.085,
  bond: 0.025,
  cash: 0.04,
  crypto: 0.45,
  commodity: 0.03,
  real_estate: 0.055,
  private_stock: 0.12,
  other: 0.0,
};

/**
 * Monthly noise amplitude (standard deviation as a fraction).
 * Larger = more volatile sparkline. Crypto noisiest, cash zero.
 */
const NOISE_AMP: Record<AssetClass, number> = {
  equity: 0.035,
  bond: 0.012,
  cash: 0.0,
  crypto: 0.14,
  commodity: 0.04,
  real_estate: 0.015,
  private_stock: 0.06,
  other: 0.0,
};

/**
 * Mid-window drawdown intensity per class (peak-to-trough loss
 * as a fraction). Applied across a 12-month window centered ~24
 * months ago, with a smooth bell-shaped envelope so the dip is
 * visible in sparklines without looking like a single-bar
 * artifact.
 */
const DRAWDOWN_DEPTH: Record<AssetClass, number> = {
  equity: 0.2,
  bond: 0.12,
  cash: 0.0,
  crypto: 0.65,
  commodity: 0.05,
  real_estate: 0.08,
  private_stock: 0.18,
  other: 0.0,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOON_MS = 12 * 60 * 60 * 1000;

/**
 * Tiny deterministic PRNG (mulberry32). Same seed → same sequence.
 * Used to synthesize the per-class monthly noise so a demo
 * session is fully reproducible (test-fixture friendly, no
 * flakiness from different machines / sessions / time-of-day).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller, deterministic from PRNG. */
function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Per-class cumulative growth factor from `monthsAgo` ago to today.
 *
 * Composition (multiplied together):
 *   1. base compounding: (1 + r/12)^monthsAgo  — applied INVERSELY
 *      so monthsAgo=0 yields 1 (today) and monthsAgo=60 yields the
 *      "5 years ago" baseline that's strictly less than today.
 *   2. drawdown envelope: bell curve centered at monthsAgo=24, half-
 *      width 6 months, depth = DRAWDOWN_DEPTH[class]. Applied
 *      multiplicatively to amplify the dip just at that window.
 *   3. deterministic noise: gaussian * NOISE_AMP, seeded by
 *      (class, monthsAgo) so the same month-class pair always
 *      produces the same noise.
 *
 * Returns the multiplier you multiply TODAY's value by to get the
 * past value: `pastValue = todayValue * factor(monthsAgo, class)`.
 * monthsAgo=0 → ~1.0; larger monthsAgo → smaller factor (since
 * values were generally lower in the past).
 */
function classBackFactor(cls: AssetClass, monthsAgo: number): number {
  if (monthsAgo === 0) return 1;
  const r = ANNUAL_GROWTH[cls];
  // Compound DOWN by monthsAgo: past = today / (1+r/12)^monthsAgo.
  const compoundFactor = 1 / Math.pow(1 + r / 12, monthsAgo);
  // Drawdown bell: centered at 24 months ago, half-width 6.
  const dx = (monthsAgo - 24) / 6;
  const bell = Math.exp(-dx * dx);
  const drawdownFactor = 1 - DRAWDOWN_DEPTH[cls] * bell;
  // Deterministic noise seeded by (class hash, monthsAgo).
  const seed = (hashCls(cls) ^ (monthsAgo * 2654435761)) >>> 0;
  const rand = mulberry32(seed);
  const noise = gaussian(rand) * NOISE_AMP[cls];
  const noiseFactor = 1 + noise;
  const out = compoundFactor * drawdownFactor * noiseFactor;
  // Defense: never let an extreme noise sample produce a negative
  // value (would invalidate the snapshot).
  return Math.max(0.01, out);
}

function hashCls(cls: AssetClass): number {
  let h = 5381;
  for (let i = 0; i < cls.length; i++) {
    h = ((h * 33) ^ cls.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Build the demo household as it would have looked `monthsAgo`
 * months in the past — same accounts, same members, same liability
 * shape; each holding's valueUSD scaled by the per-class
 * back-factor. We do NOT change holding ids (they remain stable
 * across the timeline so per-position CAGR queries work).
 */
function buildBackdatedHousehold(monthsAgo: number): Household {
  const scale = (h: Holding): Holding => {
    const cls = holdingClass(h);
    const factor = classBackFactor(cls, monthsAgo);
    // Defense in depth: if DEMO_HOUSEHOLD ever ships a NaN value
    // (or a future test injects one to verify resilience), the
    // multiplication would propagate NaN through householdNetWorth
    // and then maybeRecordSnapshot's `<= 0` gate would skip it
    // silently — invisible demo-history truncation. Floor to 0
    // so the math degrades gracefully (per CLAUDE.md "no NaN
    // poisoning of downstream accumulators").
    const newValue = Number.isFinite(h.valueUSD)
      ? h.valueUSD * factor
      : 0;
    // Shape-preserving back-scale: just update valueUSD. The
    // returned holding keeps every other field (kind, geo, shares,
    // etc) identical so downstream engines work without special-
    // casing demo rows.
    return { ...h, valueUSD: newValue };
  };
  return {
    ...DEMO_HOUSEHOLD,
    accounts: DEMO_HOUSEHOLD.accounts.map((a) => ({
      ...a,
      holdings: a.holdings.map(scale),
    })),
  };
}

/**
 * Anchor a timestamp `monthsAgo` months before `now`.
 *
 *   - monthsAgo >= 1: first-of-month at noon UTC. Matches
 *     `maybeRecordMonthlySnapshot`'s anchoring so historical
 *     demo + real snapshots align on the same primary keys
 *     (collision-friendly with the production policy).
 *
 *   - monthsAgo === 0: `now` itself. Round-2 audit BLOCK fix:
 *     anchoring "today's" demo snapshot to first-of-current-
 *     month-at-noon-UTC placed the newest point in the PAST
 *     (up to ~30 days behind wall clock for users opening the
 *     app late in the month). Confusing for History charts that
 *     are supposed to end at "today." The exception means the
 *     newest demo row sits at the actual current moment, which
 *     is what users expect.
 */
function monthAnchor(now: number, monthsAgo: number): number {
  if (monthsAgo === 0) return now;
  const d = new Date(now);
  const targetMonth = d.getUTCMonth() - monthsAgo;
  return Date.UTC(
    d.getUTCFullYear(),
    targetMonth,
    1,
    12,
    0,
    0,
    0,
  );
}

/**
 * Time-varying targetAllocation across the demo timeline. Models
 * the realistic "younger investor was more aggressive 5 years ago,
 * gradually shifted toward conservative as they aged" arc:
 *
 *   - monthsAgo=60 (5y ago): equity 65 / bond 20 / cash 5 / crypto 5 / real_estate 5
 *   - monthsAgo=0 (today):   equity 75 / bond 12 / cash 3 / crypto 4 / real_estate 6
 *
 * Linear interpolation between the two endpoints — no fancy curve,
 * just enough drift that a target-vs-actual visualization would
 * have something interesting to show. Returns null when the
 * configured drift would produce nonsensical (negative) weights;
 * defensive bound.
 */
function backdatedTarget(monthsAgo: number): TargetAllocation | null {
  // alpha = 1 at today, 0 at 5 years ago.
  const alpha = Math.max(0, Math.min(1, 1 - monthsAgo / 60));
  const past = {
    equity: 0.65,
    bond: 0.2,
    cash: 0.05,
    crypto: 0.05,
    real_estate: 0.05,
  };
  const today = {
    equity: 0.75,
    bond: 0.12,
    cash: 0.03,
    crypto: 0.04,
    real_estate: 0.06,
  };
  const out: TargetAllocation = {};
  for (const k of Object.keys(today) as Array<keyof typeof today>) {
    const v = past[k] + alpha * (today[k] - past[k]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

/**
 * Per-month household annual income trajectory. Models realistic
 * compensation growth: starts at ~$155k 5 years ago, ends at
 * $250k today (≈10% annualized — a plausible mid-career raise
 * cadence including a job change). Linear interpolation; the
 * appState captures this with each snapshot so a future
 * income-history visualization has real data.
 */
function backdatedAnnualIncome(monthsAgo: number): number {
  const PAST = 155_000;
  const TODAY = 250_000;
  const alpha = Math.max(0, Math.min(1, 1 - monthsAgo / 60));
  return Math.round(PAST + alpha * (TODAY - PAST));
}

export function buildDemoSnapshots(
  now: number,
  months: number = MONTHS_DEFAULT,
): Snapshot[] {
  // Guard against silly input (negative / zero months) — return
  // an empty history rather than throwing.
  if (months <= 0) return [];
  const out: Snapshot[] = [];
  // i=0 → oldest (months-1 months ago); i=months-1 → newest (today).
  for (let i = 0; i < months; i++) {
    const monthsAgo = months - 1 - i;
    const t = monthAnchor(now, monthsAgo);
    const household = buildBackdatedHousehold(monthsAgo);
    const netWorth = householdNetWorth(household);
    const appState: SnapshotAppState = {
      // Assumptions + budget + income-stream SHAPE held constant
      // across the timeline (most users don't churn these
      // settings). Where there's realistic drift to model
      // (targetAllocation, annual income), the helpers above
      // produce a per-month trajectory.
      assumptions: DEMO_ASSUMPTIONS,
      memberAssumptions: {},
      budgetItems: DEMO_BUDGET,
      incomeStreams: DEMO_INCOME_STREAMS,
      scenarios: [],
      healthPlans: [],
      healthImportanceWeights: {},
      targetAllocation: backdatedTarget(monthsAgo),
      glidePath: null,
      householdAnnualIncomeUSD: backdatedAnnualIncome(monthsAgo),
    };
    out.push({
      t,
      netWorthUSD: netWorth,
      household,
      appState,
    });
  }
  return out;
}

// Exported for tests that want to verify the back-factor curve
// without spinning up full snapshots.
export const __testHooks = {
  classBackFactor,
  monthAnchor,
};

// Re-export the date helper used by callers (HistoryTab).
export { MS_PER_DAY, NOON_MS };
