import type { Quote } from "@/lib/data/quotes";
import { priceAtDetailed } from "@/lib/data/quotes";
import type { Snapshot } from "@/lib/persistence/persistence";
import {
  filterHousehold,
  householdForRollups,
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
    // R2 audit CRITICAL: even on Household view (memberId=null),
    // every snapshot's household MUST be passed through
    // householdForRollups so an `includeInRollup=false` member's
    // accounts drop out of past chart points the same way they
    // drop out of today's headline NW. Without this, chart shows
    // a discontinuity at the snapshot boundary.
    //
    // Short-circuit when nothing changes: if every snapshot lacks
    // a household payload OR has no excluded members, the scope
    // helper returns the same reference (identity preserved) and
    // we hand back the original array so memoization downstream
    // stays stable.
    const scoped = finite.map((s) => {
      if (!s.household) return s;
      const scopedHh = householdForRollups(s.household);
      if (scopedHh === s.household) return s;
      return {
        ...s,
        household: scopedHh,
        netWorthUSD: householdNetWorth(scopedHh),
      };
    });
    const anyChanged =
      scoped.some((s, i) => s !== finite[i]) ||
      finite.length !== snapshots.length;
    return anyChanged ? scoped : snapshots;
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
  let start = rangeStartMs(range, now);
  if (range === "ALL") {
    // R7 audit: the ALL range previously recursed into "5Y" and
    // filtered to the earliest QUOTE timestamp. Two bugs there:
    //   (a) when no quotes existed (all-manual household), the
    //       recursion was skipped and `start` stayed at 0 (Unix
    //       epoch) — chart became a nonsensical 1970-onward sweep.
    //   (b) when quotes existed older than 5y, the chart silently
    //       capped at 5y but still labeled itself "ALL".
    //
    // Fix: derive the earliest meaningful start from BOTH the
    // quote earliest AND the oldest snapshot t; take the older of
    // the two. Fall back to 5y if neither exists.
    const earliestQuote = earliestQuoteTimestamp(quotes);
    const oldestSnapT = snapshots.reduce<number | null>(
      (acc, s) =>
        Number.isFinite(s.t) && (acc === null || s.t < acc) ? s.t : acc,
      null,
    );
    let derivedStart: number | null = null;
    if (earliestQuote != null && oldestSnapT != null) {
      derivedStart = Math.min(earliestQuote, oldestSnapT);
    } else if (earliestQuote != null) {
      derivedStart = earliestQuote;
    } else if (oldestSnapT != null) {
      derivedStart = oldestSnapT;
    }
    if (derivedStart != null && derivedStart > 0 && derivedStart < now) {
      start = derivedStart;
    } else {
      // No quotes, no snapshots — fall back to 5y so the chart
      // still renders something instead of an epoch sweep.
      start = rangeStartMs("5Y", now);
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
  // Liability parallel to newlyAddedIds (R8 audit): liabilities
  // have no `acquiredAt` field on the type, so we can't ask the
  // user when the debt began. Without a guard, a mortgage the
  // user records TODAY would subtract from every past bucket —
  // making historical NW look artificially negative through dates
  // that pre-date the debt. Heuristic: any liability present in
  // the LIVE household but ABSENT from every rich snapshot is
  // treated as "newly recorded today" → excluded from the past
  // subtraction. (For pre-snapshot buckets where composition
  // falls back to live, composeNetWorthAt consults this set; for
  // snapshot-composition buckets, the snapshot's own liabilities
  // are used by default, so no extra filtering needed.)
  const newlyAddedLiabilityIds = new Set<string>();
  if (richSnapshots.length > 0) {
    const oldestSnapshotT = richSnapshots[0].t;
    const idsInSnapshotHistory = new Set<string>();
    const liabilityIdsInSnapshotHistory = new Set<string>();
    for (const snap of richSnapshots) {
      for (const acct of snap.household.accounts) {
        for (const h of acct.holdings ?? []) {
          idsInSnapshotHistory.add(h.id);
        }
      }
      for (const liability of snap.household.liabilities ?? []) {
        liabilityIdsInSnapshotHistory.add(liability.id);
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
        // R6 audit CRITICAL: also require valueUSD >= 0. A holding
        // with a negative valueUSD (data-import corruption / a
        // short position recorded incorrectly) would subtract from
        // every historical bucket and produce a phantom negative
        // band across the entire chart. Track the ID either way so
        // composeNetWorthAt SKIPS it (no back-projection), but
        // don't FLAT-line the negative value across history.
        if (claimedOld && Number.isFinite(h.valueUSD)) {
          newlyAddedIds.add(h.id);
          if (h.valueUSD > 0) newlyAddedFlatUSD += h.valueUSD;
        }
      }
    }
    for (const liability of household.liabilities ?? []) {
      if (!liabilityIdsInSnapshotHistory.has(liability.id)) {
        newlyAddedLiabilityIds.add(liability.id);
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
      composeNetWorthAt(
        composition,
        quotes,
        t,
        now,
        newlyAddedIds,
        // Liability exclusion only applies when the composition is
        // the LIVE household (pre-first-snapshot buckets). When
        // composition is a snapshot's household, that snapshot's
        // own liabilities are the authoritative record of debt at
        // that time — nothing to filter.
        compSnap ? new Set<string>() : newlyAddedLiabilityIds,
      ) + newlyAddedFlatUSD;
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
  /**
   * R8 audit: IDs of liabilities present in the LIVE household
   * but absent from every snapshot — "newly recorded today."
   * Excluded from the historical subtraction since a debt
   * recorded today shouldn't pull down past-bucket NW. Only
   * meaningful when the caller passes the live household as
   * `household` (pre-first-snapshot region); for snapshot-
   * composition buckets, the snapshot's own liabilities are
   * authoritative and the caller passes an empty set here.
   */
  newlyAddedLiabilityIds: Set<string> = new Set(),
): number {
  const cashTotal = sumCash(household);
  const liabilitiesTotal = household.liabilities.reduce(
    (s, l) => (newlyAddedLiabilityIds.has(l.id) ? s : s + l.balanceUSD),
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
      const detailed = q ? priceAtDetailed(q, t) : null;
      // CRITICAL (R2 audit): treat a CLAMPED lookup as a MISS and
      // fall through to CAGR back-projection. The old code took the
      // clamped price (oldest sample in the history window) for any
      // t before the window — so a 6-yr-old timepoint with a 5-yr
      // quote history would silently use the 5-yr-old price as if
      // it were the 6-yr-old price, making the chart flat-line at
      // the oldest sample and inventing zero growth. Falling to the
      // CAGR branch is the documented "estimated" behavior.
      if (detailed && !detailed.clamped) {
        price = detailed.price;
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
  /**
   * Optional live household. When supplied, each snapshot anchor's
   * recorded `netWorthUSD` is AUGMENTED to include the valueUSD of
   * any LIVE holdings that are backdated (`acquiredAt <= snap.t`)
   * but absent from THIS snapshot's embedded household. Without
   * this, a snapshot recorded BEFORE the user added a backdated
   * holding produces a chart anchor that ignores the holding —
   * even though the holding's acquiredAt claims it existed at the
   * snapshot's time. The user sees the chart "forget" the
   * backdated holding for any snapshot recorded before the user
   * entered it. R-deep audit user-reported bug.
   */
  liveHousehold?: Household,
): HistoryPoint[] {
  // Round-1 audit MED: don't drop legitimate zero/negative-NW
  // snapshots here. A user underwater (high mortgage, low assets)
  // has real negative NW worth charting. `loadSnapshots` already
  // purges genuinely-corrupt NaN/Infinity at the IDB boundary;
  // any finite value is user-intentional and renders.
  const usable = snapshots.filter((s) => Number.isFinite(s.netWorthUSD));
  let out = series;
  // Build the anchor list: every snapshot is an anchor the chart
  // MUST pass through. The live-NW (today's headline) is ALSO an
  // anchor when supplied — pinned at the last bucket's `t`. This
  // way the post-last-snapshot region interpolates toward today
  // instead of holding flat at a stale snapshot, AND the post-hoc
  // last-bucket pin (the original semantic) is preserved.
  const lastBucketT = series.length > 0 ? series[series.length - 1].t : null;
  const liveAnchorEnabled =
    liveNetWorth != null &&
    Number.isFinite(liveNetWorth) &&
    lastBucketT != null;
  if (usable.length > 0 || liveAnchorEnabled) {
    type Anchor = { t: number; netWorthUSD: number };
    const sorted = [...usable].sort((a, b) => a.t - b.t);
    // Per-snapshot adjustment: if a LIVE holding has
    // acquiredAt <= snap.t but the snapshot's embedded household
    // doesn't contain it (snapshot was recorded BEFORE the user
    // added the holding), add the holding's valueUSD to this
    // snapshot's anchor NW. Without this, snapshots recorded
    // before a backdated entry produce chart anchors that ignore
    // the holding — even though the user claims it existed then.
    function adjustForBackdated(snap: Snapshot): number {
      let extra = 0;
      if (!liveHousehold || !snap.household) return extra;
      const snapIds = new Set<string>();
      for (const acct of snap.household.accounts) {
        for (const h of acct.holdings ?? []) {
          snapIds.add(h.id);
        }
      }
      for (const acct of liveHousehold.accounts) {
        for (const h of acct.holdings ?? []) {
          if (snapIds.has(h.id)) continue;
          const acquiredAt =
            "acquiredAt" in h
              ? (h.acquiredAt as number | null | undefined)
              : null;
          if (acquiredAt == null || acquiredAt > snap.t) continue;
          if (!Number.isFinite(h.valueUSD) || h.valueUSD <= 0) continue;
          extra += h.valueUSD;
        }
      }
      return extra;
    }
    const anchors: Anchor[] = sorted.map((s) => ({
      t: s.t,
      netWorthUSD: s.netWorthUSD + adjustForBackdated(s),
    }));
    // Add the live anchor. Two cases:
    //   1. There's no snapshot at the last-bucket t: append the
    //      live anchor at the right edge.
    //   2. There IS a snapshot at (or after) the last-bucket t:
    //      the live anchor OVERRIDES it at the right edge — live
    //      headline NW is authoritative for "now" even if the
    //      most recent snapshot row has a stale value.
    if (liveAnchorEnabled) {
      // Drop any snapshots whose t >= lastBucketT — they'd
      // either be redundant (== lastBucketT) or post-date the
      // visible window (> lastBucketT), and either way the live
      // anchor should win at the right edge.
      while (
        anchors.length > 0 &&
        anchors[anchors.length - 1].t >= (lastBucketT as number)
      ) {
        anchors.pop();
      }
      anchors.push({
        t: lastBucketT as number,
        netWorthUSD: liveNetWorth as number,
      });
    }
    // User-reported visual bug: chart looked like a staircase —
    // flat plateaus between adjacent snapshots interrupted by
    // abrupt vertical steps. Root cause: the previous algorithm
    // forced EVERY bucket whose t >= snap.t to that snap's
    // recorded NW until the next snap arrived. The smoother
    // semantic: anchors are points the chart MUST pass through;
    // between two anchors, blend linearly so the line connects
    // them without inventing a flat run.
    out = series.map((p) => {
      // Find surrounding anchors: `lo` = latest anchor with t <=
      // p.t, `hi` = earliest anchor with t >= p.t.
      let lo: Anchor | null = null;
      let hi: Anchor | null = null;
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i].t <= p.t) lo = anchors[i];
        if (anchors[i].t >= p.t && hi === null) hi = anchors[i];
        if (hi !== null) break;
      }
      // Bucket pre-dates every anchor: use reconstructed value.
      if (lo === null) return p;
      // Bucket post-dates every anchor (shouldn't happen when
      // live anchor is enabled and lastBucketT is the rightmost,
      // but guard).
      if (hi === null) return { t: p.t, netWorthUSD: lo.netWorthUSD };
      // Bucket exactly at an anchor: pin.
      if (hi.t === lo.t) {
        return { t: p.t, netWorthUSD: lo.netWorthUSD };
      }
      // Strictly between two anchors: linear interpolation on the
      // time axis. (lo.t < p.t < hi.t guaranteed by the search.)
      const span = hi.t - lo.t;
      const frac = (p.t - lo.t) / span;
      const nw =
        lo.netWorthUSD + (hi.netWorthUSD - lo.netWorthUSD) * frac;
      return { t: p.t, netWorthUSD: nw };
    });
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
