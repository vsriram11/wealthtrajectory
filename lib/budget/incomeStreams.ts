/**
 * Future-income streams.
 *
 * Real retirees rarely have a single, flat retirement spend
 * funded entirely from portfolio drawdowns. They typically have
 * MULTIPLE INCOME STREAMS that each:
 *
 *   - start in a specific calendar year
 *   - end in a specific calendar year (could be the same as
 *     start, for a one-year stream)
 *   - pay a real-dollar annual amount
 *   - optionally grow above inflation (real growth rate; default
 *     0 = inflation-protected)
 *
 * Examples:
 *
 *   - Consulting from 65 to 70: 2032-2037, $80k/yr, 0% real
 *     growth
 *   - Social Security from 67: 2034-2080 (life expectancy),
 *     $40k/yr, 0% (already inflation-indexed by SSA)
 *   - Pension from 70: 2037-2080, $24k/yr, -2% real growth
 *     (most legacy pensions aren't COLA'd → -2% real)
 *   - Rental income for 10y after downsize: 2035-2044, $18k/yr,
 *     1% real growth (rent typically tracks 1% above CPI)
 *   - Side business that ramps and ends: 2027-2029, $15k/yr,
 *     5% real growth (early-stage growth)
 *
 * Engine contract: streams flow into rollups as POSITIVE cash
 * flow in their active years, reducing the net drawdown the
 * portfolio has to cover. This shows up in:
 *
 *   - Monte Carlo survival rate (income years effectively lower
 *     the withdrawal — more sequences survive)
 *   - Independence projection (income offsets withdrawals month-
 *     by-month; corpus lasts longer in lost-decade stress)
 *   - Per-member rollup filtering (a stream owned by an
 *     excluded member doesn't count toward the household total)
 *
 * Composition rule: streams are owned by a specific member
 * (ownerId), like accounts and liabilities. When the user picks
 * a member from the chip nav, only that member's streams flow
 * into rollups for that view. When no member is picked, all
 * streams owned by ACTIVE members flow in.
 *
 * Why YEAR-based (not age-based, not duration-based):
 *
 *   - Most users think in calendar years for Social Security,
 *     pension start dates, etc. "Starts when I turn 67" is just
 *     a year in their head.
 *   - Two-spouse households: a single "age" reference would have
 *     to pick one spouse. Years are unambiguous.
 *   - The historical-Monte-Carlo simulator already keys on
 *     calendar year for return data — same coordinate system.
 *
 * NaN-safety: the engine helpers treat non-finite inputs as 0.
 * The UI layer is responsible for preventing them at write
 * time (the slice's `addIncomeStream` clamps + coerces).
 */

import type { MemberId } from "@/lib/types";

export type IncomeStreamId = string;

export type IncomeStream = {
  id: IncomeStreamId;
  /**
   * Free-text user label ("Consulting", "Social Security",
   * "Rental income"). Kept human — no enum — because the
   * universe of income sources is too long to enumerate
   * usefully and labeling rigor would just hide expressivity
   * from the planner.
   */
  label: string;
  /**
   * First calendar year the stream pays (inclusive). The
   * stream pays its full `annualUSD` (in real dollars,
   * pre-growth) in this year.
   */
  startYear: number;
  /**
   * Last calendar year the stream pays (inclusive). Equal to
   * startYear for a one-year stream. The slice's add/update
   * actions refuse to write `endYear < startYear`.
   */
  endYear: number;
  /**
   * Annual amount at startYear, in REAL dollars (today's
   * dollars / inflation-adjusted). Stored as real $ to match
   * the rest of the projection engine, which works entirely in
   * real terms.
   */
  annualUSD: number;
  /**
   * Real growth rate per year as a decimal (0.02 = 2% above
   * inflation). Defaults to 0 (perfectly inflation-protected —
   * the conservative assumption for Social Security and most
   * indexed annuities). Negative values are allowed (e.g.
   * legacy pensions that aren't COLA'd shrink in real terms).
   */
  realGrowthRate: number;
  /**
   * Member this stream belongs to. Required (not optional) so
   * the per-member rollup filter is unambiguous — every
   * stream has exactly one owner the user must pick.
   */
  ownerId: MemberId;
};

/**
 * Generate a unique-enough id for a new stream. Mirrors the
 * `acc-` / `liab-` / `bud-` prefix convention used elsewhere
 * in the store so an id seen in a stack trace tells you which
 * collection it came from at a glance.
 */
export function newIncomeStreamId(): IncomeStreamId {
  // crypto.randomUUID is available in modern browsers + Node 19+.
  // The slice-creation contract is "called from a Zustand action",
  // which only runs in those environments — no SSR concern.
  return `inc-${crypto.randomUUID()}`;
}

/**
 * Per-year amount paid by a single stream, in REAL dollars.
 * Returns 0 outside [startYear, endYear].
 *
 * Real growth compounds from `startYear`: in year `startYear +
 * k`, the stream pays `annualUSD × (1 + realGrowthRate)^k`. This
 * is the standard interpretation — growth is measured from when
 * the stream first pays out, not from "now."
 *
 * NaN-safe: returns 0 when any input is non-finite. The
 * Math.pow guard handles pathological growth rates that would
 * overflow to Infinity over very long horizons.
 */
export function incomeForYear(stream: IncomeStream, year: number): number {
  if (!Number.isFinite(year)) return 0;
  if (!Number.isFinite(stream.startYear) || !Number.isFinite(stream.endYear)) {
    return 0;
  }
  if (year < stream.startYear || year > stream.endYear) return 0;
  if (!Number.isFinite(stream.annualUSD) || stream.annualUSD < 0) return 0;
  const yearsFromStart = year - stream.startYear;
  const growthRate = Number.isFinite(stream.realGrowthRate)
    ? stream.realGrowthRate
    : 0;
  // Math.pow(1 + g, k). When 1 + g is non-positive (g <= -1, an
  // absurd shrink) we'd get NaN or Infinity — guard.
  const base = 1 + growthRate;
  if (base <= 0) return 0;
  const grown = stream.annualUSD * Math.pow(base, yearsFromStart);
  return Number.isFinite(grown) ? grown : 0;
}

/**
 * Sum of per-year amounts across multiple streams. Same NaN-
 * safety contract as `incomeForYear` — bad streams contribute
 * 0, valid streams sum normally.
 */
export function totalIncomeForYear(
  streams: readonly IncomeStream[],
  year: number,
): number {
  let total = 0;
  for (const s of streams) total += incomeForYear(s, year);
  return total;
}

/**
 * Pre-compute a per-year income array for a simulation or
 * projection. `result[i]` is the total real-dollar income across
 * all streams in calendar year `baseYear + i`. Length is
 * `numYears`.
 *
 * This is the shape the Monte Carlo simulator + Independence
 * projection consume — a flat array of per-year amounts they can
 * add to cash flow each year without re-iterating the stream
 * list.
 */
export function incomePerYearUSD(
  streams: readonly IncomeStream[],
  baseYear: number,
  numYears: number,
): number[] {
  if (!Number.isFinite(numYears) || numYears <= 0) return [];
  const out = new Array<number>(numYears);
  for (let i = 0; i < numYears; i++) {
    out[i] = totalIncomeForYear(streams, baseYear + i);
  }
  return out;
}

/**
 * Total nominal-equivalent dollars paid by a stream over its
 * full life, in real terms. Used by the UI to show a "Lifetime
 * total: $X" summary on the stream row so the user can see
 * what they're committing to in aggregate.
 *
 * Closed form: sum of geometric series. For g = 0, just
 * annualUSD × duration. For g != 0,
 *   total = annualUSD × ((1+g)^duration - 1) / g
 * Both branches NaN-safe via incomeForYear's guards.
 */
export function lifetimeTotalReal(stream: IncomeStream): number {
  const duration = stream.endYear - stream.startYear + 1;
  if (duration <= 0) return 0;
  let total = 0;
  for (let i = 0; i < duration; i++) {
    total += incomeForYear(stream, stream.startYear + i);
  }
  return total;
}

/**
 * Scope an income-stream array to ROLLUP membership — the same
 * composition rule the rest of the rollup machinery uses:
 *
 *   - When a specific `memberId` is picked, return that
 *     member's streams only (the explicit pick wins, even when
 *     they're flagged out of rollups — same semantic boundary
 *     as `filterHousehold`).
 *   - When no member is picked, return streams owned by ACTIVE
 *     members only — streams owned by rollup-excluded members
 *     drop out.
 *
 * Pass `activeOwnerIds` as a Set computed via `activeMemberIds`
 * from lib/types. Mirrors the `filterBudgetForRollups` shape so
 * both helpers can compose at the same call site.
 */
export function filterIncomeStreamsForRollups(
  streams: readonly IncomeStream[],
  memberId: MemberId | null,
  activeOwnerIds: ReadonlySet<string>,
): IncomeStream[] {
  if (memberId) return streams.filter((s) => s.ownerId === memberId);
  return streams.filter((s) => activeOwnerIds.has(s.ownerId));
}
