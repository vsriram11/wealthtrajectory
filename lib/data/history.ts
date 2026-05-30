import type { Quote } from "@/lib/data/quotes";
import { priceAt } from "@/lib/data/quotes";
import type { Snapshot } from "@/lib/persistence/persistence";
import {
  filterHousehold,
  householdNetWorth,
  type Account,
  type Holding,
  type Household,
} from "@/lib/types";

/**
 * Project a snapshot list into a specific member's slice. For rich
 * snapshots (those carrying a full household payload) filter the
 * embedded household by memberId and recompute the scalar NW from
 * the filtered slice — so both the composition-source pass inside
 * reconstructHistory and the scalar-overlay pass agree on member-
 * filtered values. Legacy NW-only snapshots (no household) are
 * dropped under filter: the family-wide scalar can't be attributed
 * to a single member.
 *
 * Memberless (memberId=null) calls pass through untouched —
 * Household view uses every snapshot as recorded.
 *
 * Pure function so the rest of the history pipeline stays oblivious
 * to the member concept; single source of truth for the filter logic.
 */
export function memberFilteredSnapshots(
  snapshots: Snapshot[],
  memberId: string | null,
): Snapshot[] {
  // Boundary NaN/Infinity guard for `s.t`: cloud-sync / external
  // imports can deliver a row with `t = NaN` (corrupted clock /
  // hostile payload). NaN poisons Math.min in summary text and
  // sort comparators (undefined ordering), so drop those rows
  // here at the single canonical filter. Memberless calls also
  // need the guard; can't pass-through-reference any more, but
  // the cost is one filter pass on a tiny list (snapshots <100).
  const finite = snapshots.filter((s) => Number.isFinite(s.t));
  if (!memberId) {
    // Pass-through identity when no NaN rows were filtered, so
    // memoization downstream stays stable on clean data.
    return finite.length === snapshots.length ? snapshots : finite;
  }
  const out: Snapshot[] = [];
  for (const s of finite) {
    if (!s.household) continue; // legacy NW-only — can't attribute
    const filteredHh = filterHousehold(s.household, memberId);
    out.push({
      ...s,
      household: filteredHh,
      netWorthUSD: householdNetWorth(filteredHh),
    });
  }
  return out;
}

export type HistoryRange = "1M" | "3M" | "6M" | "1Y" | "YTD" | "5Y" | "ALL";

export const HISTORY_RANGE_LABELS: Record<HistoryRange, string> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
  YTD: "YTD",
  "5Y": "5Y",
  ALL: "All",
};

export function rangeStartMs(range: HistoryRange, now = Date.now()): number {
  const d = new Date(now);
  switch (range) {
    case "1M":
      d.setMonth(d.getMonth() - 1);
      return d.getTime();
    case "3M":
      d.setMonth(d.getMonth() - 3);
      return d.getTime();
    case "6M":
      d.setMonth(d.getMonth() - 6);
      return d.getTime();
    case "1Y":
      d.setFullYear(d.getFullYear() - 1);
      return d.getTime();
    case "YTD":
      return new Date(d.getFullYear(), 0, 1).getTime();
    case "5Y":
      d.setFullYear(d.getFullYear() - 5);
      return d.getTime();
    case "ALL":
      return 0;
  }
}

export type HistoryPoint = {
  t: number;
  netWorthUSD: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * IMPORTANT contract for callers: when the global member filter is
 * active, `household` MUST be the member-filtered view AND `snapshots`
 * MUST be pre-filtered via `memberFilteredSnapshots(snapshots, memberId)`.
 * Round-2 audit (this branch) found that consumers passing raw
 * snapshots alongside a member-filtered household silently produce
 * a mid-chart discontinuity at the snapshot boundary (past windows
 * show full household; present window shows member slice). This
 * function trusts the caller; it has no way to detect the mismatch
 * post-hoc. HistoryView and GrowthVelocityCard already comply.
 */
export function reconstructHistory(
  household: Household,
  quotes: Record<string, Quote | null>,
  range: HistoryRange,
  now = Date.now(),
  snapshots: Snapshot[] = [],
): HistoryPoint[] {
  const start = rangeStartMs(range, now);
  if (start === 0) {
    const earliest = earliestQuoteTimestamp(quotes);
    if (earliest != null) {
      return reconstructHistory(
        household,
        quotes,
        "5Y",
        now,
        snapshots,
      ).filter((p) => p.t >= earliest);
    }
  }

  // Snapshots with a full household payload give us authoritative
  // composition at known timestamps. Between adjacent snapshots,
  // hold the earlier snapshot's composition fixed (the user owned
  // exactly those holdings during that window). Outside of any
  // snapshot window, fall back to the live household with
  // quote-or-CAGR back-projection. Snapshots without a household
  // payload (legacy "just NW") still anchor the chart at their NW
  // via overlaySnapshots() in a separate pass.
  const richSnapshots = snapshots
    .filter((s): s is Snapshot & { household: Household } => !!s.household)
    .sort((a, b) => a.t - b.t);

  // USER-REPORTED BUG: adding a holding today with `acquiredAt`
  // set to a backdate (e.g. 2021) made the history chart show
  // a large fake gain — the back-projection algorithm treated
  // the holding as if it actually grew at its expected CAGR
  // through the past year, when in reality the holding wasn't
  // in the system until today. The "+8.8%" wasn't real, it was
  // the algorithmic back-projection of holdings that didn't
  // exist in the user's recorded history.
  //
  // FIX: identify holdings that aren't present in any past
  // snapshot. Pass those IDs to composeNetWorthAt so it can
  // hold them FLAT at today's value across all historical
  // timepoints (instead of back-projecting them via CAGR).
  // The holding still contributes to historical NW — just at
  // its constant present-day value — so the chart shows it
  // without inventing growth that didn't happen.
  // USER-REPORTED BUG: adding a holding TODAY with `acquiredAt`
  // backdated to e.g. 2021 made the history chart show a fake
  // +8.8% gain. The back-projection treated the holding as
  // having actually grown for a year, when it just appeared.
  //
  // TARGETED FIX: detect the EXACT scenario — a holding whose
  // user-claimed `acquiredAt` PREDATES the oldest snapshot, but
  // the holding is missing from EVERY snapshot. That mismatch
  // ("I claim I had this back then but my snapshots don't show
  // it") is the user-intent signal that calls for the flat-line
  // treatment.
  //
  // This is narrower than "any holding missing from snapshots"
  // (which would break the pruned-snapshot test where the user
  // legitimately captured a smaller composition at a past
  // moment in time — those holdings SHOULD be excluded from
  // that snapshot's window, not flat-lined).
  let newlyAddedFlatUSD = 0;
  const newlyAddedIds = new Set<string>();
  if (richSnapshots.length > 0) {
    const oldestSnapshotT = richSnapshots[0].t;
    const idsInSnapshotHistory = new Set<string>();
    for (const snap of richSnapshots) {
      for (const acct of snap.household.accounts) {
        for (const h of acct.holdings ?? []) {
          idsInSnapshotHistory.add(h.id);
        }
      }
    }
    for (const acct of household.accounts) {
      for (const h of acct.holdings ?? []) {
        if (idsInSnapshotHistory.has(h.id)) continue;
        // Trigger condition: user-claimed acquisition predates
        // the snapshot record. They're saying "I had this back
        // then" but the snapshots disagree. Flat-line to avoid
        // attributing fake gain. `acquiredAt` only exists on
        // priced + real-estate kinds; cash/other don't have it,
        // and they're already skipped earlier in the
        // back-projection (held flat at face value).
        const acquiredAt =
          "acquiredAt" in h ? (h.acquiredAt as number | null | undefined) : null;
        const claimedOld =
          acquiredAt != null && acquiredAt < oldestSnapshotT;
        if (claimedOld && Number.isFinite(h.valueUSD)) {
          newlyAddedIds.add(h.id);
          newlyAddedFlatUSD += h.valueUSD;
        }
      }
    }
  }

  const days = Math.max(2, Math.ceil((now - start) / MS_PER_DAY));
  const out: HistoryPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const t = start + (i * (now - start)) / days;
    const compSnap = pickCompositionSnapshot(richSnapshots, t);
    const composition = compSnap?.household ?? household;
    const nw =
      composeNetWorthAt(composition, quotes, t, now, newlyAddedIds) +
      newlyAddedFlatUSD;
    out.push({ t, netWorthUSD: nw });
  }
  return out;
}

function pickCompositionSnapshot(
  rich: Array<Snapshot & { household: Household }>,
  t: number,
): (Snapshot & { household: Household }) | null {
  if (rich.length === 0) return null;
  // Latest snapshot whose timestamp is <= t. Linear scan from the
  // tail is fastest because reconstruction calls this in order.
  for (let i = rich.length - 1; i >= 0; i--) {
    if (rich[i].t <= t) return rich[i];
  }
  return null;
}

function composeNetWorthAt(
  household: Household,
  quotes: Record<string, Quote | null>,
  t: number,
  now: number,
  /**
   * IDs of holdings that exist in the current household but were
   * NEVER in any past snapshot — "newly added to the system."
   * For these, hold the value FLAT at today's lastPriceUSD×shares
   * across all historical timepoints. Prevents fake-gain bug
   * where a holding added today with backdated `acquiredAt` got
   * back-projected via CAGR (inventing growth that didn't happen).
   */
  newlyAddedIds: Set<string> = new Set(),
): number {
  const cashTotal = sumCash(household);
  const liabilitiesTotal = household.liabilities.reduce(
    (s, l) => s + l.balanceUSD,
    0,
  );
  let nw = cashTotal - liabilitiesTotal;
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      // Cash, real-estate, private-stock, and "other" are all held
      // at face value across history. Cash/RE/other have no price
      // feed; private-stock updates in discrete 409A jumps that
      // aren't smooth-CAGR-shaped, so synthesizing a back-projection
      // would mislead. Only equity / bond / crypto get historical
      // reconstruction.
      if (
        h.kind === "cash" ||
        h.kind === "real_estate" ||
        h.kind === "private_stock" ||
        h.kind === "other"
      )
        continue;
      if (h.acquiredAt != null && h.acquiredAt > t) continue;
      // Newly-added IDs are accounted for via the OUTER flat
      // contribution in reconstructHistory — skip them here to
      // avoid double-counting when iterating the LIVE household.
      // (Snapshot-composition iteration won't see these IDs by
      // construction, so this branch only fires on the live path.)
      if (newlyAddedIds.has(h.id)) continue;
      const q = quotes[h.symbol.toUpperCase()];
      let price: number;
      if (q && q.history.length > 0) {
        price = priceAt(q, t) ?? h.lastPriceUSD;
      } else {
        // Synthesize the back-projection from the holding's expected
        // real CAGR. Better than a flat line when upstream history
        // isn't available (Finnhub key missing, rate limited, etc.).
        // Caller flags this case in the UI as "estimated".
        const monthsBack = (now - t) / (30.44 * 24 * 60 * 60 * 1000);
        const monthlyRate =
          h.expectedRealCAGR === 0
            ? 0
            : Math.pow(1 + h.expectedRealCAGR, 1 / 12) - 1;
        price =
          monthlyRate === 0
            ? h.lastPriceUSD
            : h.lastPriceUSD / Math.pow(1 + monthlyRate, monthsBack);
      }
      nw += h.shares * price;
    }
  }
  return nw;
}

function sumCash(h: Household): number {
  // Bundles cash, real-estate, private-stock, and "other" — all held
  // flat across the history window (no price feed / 409A jumps /
  // freeform value).
  return h.accounts.reduce(
    (s, a) =>
      s +
      a.holdings.reduce(
        (ss, hh) =>
          ss +
          (hh.kind === "cash" ||
          hh.kind === "real_estate" ||
          hh.kind === "private_stock" ||
          hh.kind === "other"
            ? hh.valueUSD
            : 0),
        0,
      ),
    0,
  );
}

function earliestQuoteTimestamp(quotes: Record<string, Quote | null>): number | null {
  let earliest: number | null = null;
  for (const q of Object.values(quotes)) {
    if (!q || q.history.length === 0) continue;
    const t = q.history[0].t;
    if (earliest == null || t < earliest) earliest = t;
  }
  return earliest;
}

/**
 * Overlay real net-worth snapshots onto a reconstructed series. For
 * each output bucket, prefer the most-recent snapshot at-or-before that
 * timestamp; fall back to the reconstructed value otherwise. The result
 * is a series where past-but-recorded points reflect what the user
 * actually saw on those days, while pre-snapshot points retain the
 * back-projection (CAGR-synthesized or quote-driven).
 *
 * Zero / negative-NW snapshots are ignored — these are almost always
 * from a now-fixed bug where the auto-recorder fired before household
 * state hydrated, and they make the chart drop to $0 at the snapshot
 * timestamp. Leaving them in IDB (visible in SnapshotsManager so the
 * user can delete them) but excluding them from the overlay keeps the
 * chart sensible regardless of what's accumulated locally.
 */
export function overlaySnapshots(
  series: HistoryPoint[],
  snapshots: Snapshot[],
  /**
   * Optional live net-worth value used to pin the LAST bucket (today)
   * regardless of any snapshot or quote-driven value. Snapshots are
   * the source of truth for past dates; the live household is the
   * source of truth for "now". Without this pin, a stale or partially-
   * recorded snapshot (NW=$0.01 recorded mid-hydration, before the
   * 3-defense filter was added) could overlay-replace today's bucket
   * and make the chart drop to ~$0 on the right edge. Likewise,
   * outdated quote history that doesn't extend to today can leave
   * the last bucket using yesterday's price; pinning to live keeps
   * the chart and the headline NW consistent.
   */
  liveNetWorth?: number,
): HistoryPoint[] {
  // Round-1 audit MED: don't drop legitimate zero/negative-NW
  // snapshots here. A user underwater (high mortgage, low assets)
  // has real negative NW worth charting. `loadSnapshots` already
  // purges genuinely-corrupt NaN/Infinity at the IDB boundary;
  // any finite value is user-intentional and renders.
  const usable = snapshots.filter((s) => Number.isFinite(s.netWorthUSD));
  let out = series;
  if (usable.length > 0) {
    const sorted = [...usable].sort((a, b) => a.t - b.t);
    let i = 0;
    out = series.map((p) => {
      while (i + 1 < sorted.length && sorted[i + 1].t <= p.t) i++;
      const snap = sorted[i];
      if (snap.t > p.t) return p;
      return { t: p.t, netWorthUSD: snap.netWorthUSD };
    });
  }
  if (
    liveNetWorth != null &&
    Number.isFinite(liveNetWorth) &&
    out.length > 0
  ) {
    const lastIdx = out.length - 1;
    out = [
      ...out.slice(0, lastIdx),
      { t: out[lastIdx].t, netWorthUSD: liveNetWorth },
    ];
  }
  return out;
}

export function uniqueSymbols(household: Household): string[] {
  const out = new Set<string>();
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      // Equity, bond, commodity, and live-priceable crypto holdings
      // are all stock-market-traded ETFs from the quote pipeline's
      // perspective — they share the same `isManualPrice: false`
      // creation path. Cash / real-estate / private-stock / other
      // don't have live-price fields. Manual-priced holdings opt
      // out via `isManualPrice: true` (native crypto units, custom
      // commodity entries like jewelry, etc).
      if (
        h.kind !== "equity" &&
        h.kind !== "bond" &&
        h.kind !== "commodity" &&
        h.kind !== "crypto"
      )
        continue;
      if (h.isManualPrice) continue;
      out.add(h.symbol.toUpperCase());
    }
  }
  return Array.from(out);
}

export function symbolsForAccount(a: Account): string[] {
  const out = new Set<string>();
  for (const h of a.holdings) {
    // Mirrors uniqueSymbols: equity / bond / commodity ETFs +
    // live-priceable crypto ETFs feed the same quote pipeline.
    if (
      h.kind !== "equity" &&
      h.kind !== "bond" &&
      h.kind !== "commodity" &&
      h.kind !== "crypto"
    )
      continue;
    if (h.isManualPrice) continue;
    out.add(h.symbol.toUpperCase());
  }
  return Array.from(out);
}

export function holdingsAreLive(holdings: Holding[]): boolean {
  return holdings.some(
    (h) =>
      (h.kind === "equity" || h.kind === "bond") && !h.isManualPrice,
  );
}
