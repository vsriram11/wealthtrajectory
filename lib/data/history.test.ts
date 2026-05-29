import { describe, expect, it } from "vitest";
import { DEMO_HOUSEHOLD } from "@/lib/demo";
import {
  memberFilteredSnapshots,
  overlaySnapshots,
  rangeStartMs,
  reconstructHistory,
  uniqueSymbols,
  type HistoryPoint,
} from "@/lib/data/history";
import type { Snapshot } from "@/lib/persistence/persistence";
import type { Quote } from "@/lib/data/quotes";
import { priceAt } from "@/lib/data/quotes";
import { householdNetWorth, type Household } from "@/lib/types";

describe("rangeStartMs", () => {
  const now = new Date("2026-05-10T12:00:00Z").getTime();

  it("1M is roughly 30 days back", () => {
    const t = rangeStartMs("1M", now);
    expect(now - t).toBeGreaterThan(27 * 86400000);
    expect(now - t).toBeLessThan(33 * 86400000);
  });

  it("YTD aligns to Jan 1 of the current year", () => {
    const t = rangeStartMs("YTD", now);
    expect(new Date(t).getUTCFullYear()).toBe(2026);
    expect(new Date(t).getUTCMonth()).toBe(0);
    expect(new Date(t).getUTCDate()).toBe(1);
  });

  it("ALL returns 0 (sentinel)", () => {
    expect(rangeStartMs("ALL", now)).toBe(0);
  });
});

describe("priceAt", () => {
  const quote: Quote = {
    symbol: "TEST",
    currentPrice: 100,
    currency: "USD",
    name: "Test",
    history: [
      { t: 1_000, p: 50 },
      { t: 2_000, p: 60 },
      { t: 3_000, p: 80 },
    ],
    fetchedAt: 0,
  };

  it("clamps before-history to first point", () => {
    expect(priceAt(quote, 0)).toBe(50);
  });

  it("clamps after-history to last point", () => {
    expect(priceAt(quote, 5_000)).toBe(80);
  });

  it("returns price at-or-before the queried time", () => {
    expect(priceAt(quote, 2_500)).toBe(60);
  });
});

describe("uniqueSymbols", () => {
  it("returns only live (non-manual, non-cash) symbols", () => {
    const symbols = uniqueSymbols(DEMO_HOUSEHOLD);
    // The demo household pins these specific tickers (see
    // lib/demo.ts). uniqueSymbols must surface them — they're the
    // ones the price-refresh button will hit on first sync. If a
    // refactor accidentally filters out equities, this catches it.
    expect(symbols).toContain("VOO");
    expect(symbols).toContain("BND");
    // No dupes — uniqueSymbols is the de-dupe boundary feeding the
    // quotes API.
    expect(new Set(symbols).size).toBe(symbols.length);
    // No cash / synthetic symbols — those are not live-priceable.
    for (const sym of symbols) {
      expect(sym).not.toBe("CASH");
      expect(sym).not.toBe("");
    }
  });

  it("includes commodity ETFs when not manual-priced", () => {
    // Synthetic household with a commodity ticker (GLD).
    const h: import("@/lib/types").Household = {
      id: "hh",
      members: [{ id: "m1", displayName: "Test" }],
      accounts: [
        {
          id: "a1",
          displayName: "Test",
          category: "BROKERAGE",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "commodity",
              id: "h1",
              symbol: "GLD",
              shares: 100,
              lastPriceUSD: 230,
              lastPricedAt: null,
              isManualPrice: false,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 23_000,
              expectedRealCAGR: 0.01,
            },
          ],
        },
      ],
      liabilities: [],
    };
    expect(uniqueSymbols(h)).toContain("GLD");
  });

  it("excludes manual-priced commodities (jewelry, bars)", () => {
    const h: import("@/lib/types").Household = {
      id: "hh",
      members: [{ id: "m1", displayName: "Test" }],
      accounts: [
        {
          id: "a1",
          displayName: "Test",
          category: "BROKERAGE",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "commodity",
              id: "h1",
              symbol: "Gold jewelry",
              shares: 1,
              lastPriceUSD: 5_000,
              lastPricedAt: null,
              isManualPrice: true,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 5_000,
              expectedRealCAGR: 0.01,
            },
          ],
        },
      ],
      liabilities: [],
    };
    expect(uniqueSymbols(h)).not.toContain("Gold jewelry");
    expect(uniqueSymbols(h)).not.toContain("GOLD JEWELRY");
  });

  it("includes live-priceable crypto ETFs (IBIT, FBTC) but not native coins", () => {
    const h: import("@/lib/types").Household = {
      id: "hh",
      members: [{ id: "m1", displayName: "Test" }],
      accounts: [
        {
          id: "a1",
          displayName: "Test",
          category: "BROKERAGE",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "crypto",
              id: "h1",
              symbol: "IBIT", // live-priceable ETF
              shares: 100,
              lastPriceUSD: 40,
              lastPricedAt: null,
              isManualPrice: false,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 4_000,
              expectedRealCAGR: 0.05,
            },
            {
              kind: "crypto",
              id: "h2",
              symbol: "BTC", // native coin, manual
              shares: 0.5,
              lastPriceUSD: 90_000,
              lastPricedAt: Date.now(),
              isManualPrice: true,
              enteredAsShares: true,
              acquiredAt: null,
              valueUSD: 45_000,
              expectedRealCAGR: 0.05,
            },
          ],
        },
      ],
      liabilities: [],
    };
    const syms = uniqueSymbols(h);
    expect(syms).toContain("IBIT");
    expect(syms).not.toContain("BTC");
  });
});

describe("acquiredAt backdating", () => {
  it("excludes a holding from periods before its acquired date", () => {
    const fixedNow = new Date("2026-05-10T12:00:00Z").getTime();
    const monthAgo = fixedNow - 30 * 24 * 60 * 60 * 1000;

    const accounts = DEMO_HOUSEHOLD.accounts.map((a, i) => {
      if (i !== 0) return a;
      return {
        ...a,
        holdings: a.holdings.map((h) =>
          h.kind === "equity"
            ? { ...h, acquiredAt: monthAgo + 5 * 86_400_000 }
            : h,
        ),
      };
    });
    const householdEarly = { ...DEMO_HOUSEHOLD, accounts };
    const householdNoBackdate = DEMO_HOUSEHOLD;

    const earlySeries = reconstructHistory(
      householdEarly,
      {},
      "1M",
      fixedNow,
    );
    const fullSeries = reconstructHistory(
      householdNoBackdate,
      {},
      "1M",
      fixedNow,
    );

    expect(earlySeries[0].netWorthUSD).toBeLessThan(
      fullSeries[0].netWorthUSD,
    );
  });
});

describe("overlaySnapshots", () => {
  const base: HistoryPoint[] = [
    { t: 100, netWorthUSD: 1000 },
    { t: 200, netWorthUSD: 1100 },
    { t: 300, netWorthUSD: 1200 },
    { t: 400, netWorthUSD: 1300 },
  ];

  it("returns the base series untouched when no snapshots are supplied", () => {
    expect(overlaySnapshots(base, [])).toEqual(base);
  });

  it("uses most-recent at-or-before snapshot when one exists", () => {
    const snapshots: Snapshot[] = [{ t: 250, netWorthUSD: 1234 }];
    const out = overlaySnapshots(base, snapshots);
    // First two points are before the snapshot — back-projected values stay.
    expect(out[0].netWorthUSD).toBe(1000);
    expect(out[1].netWorthUSD).toBe(1100);
    // Points at or after t=250 take the snapshot value.
    expect(out[2].netWorthUSD).toBe(1234);
    expect(out[3].netWorthUSD).toBe(1234);
  });

  it("walks forward through multiple snapshots", () => {
    const snapshots: Snapshot[] = [
      { t: 150, netWorthUSD: 5000 },
      { t: 350, netWorthUSD: 9000 },
    ];
    const out = overlaySnapshots(base, snapshots);
    expect(out[0].netWorthUSD).toBe(1000); // before first snapshot
    expect(out[1].netWorthUSD).toBe(5000); // t=200 ≥ 150
    expect(out[2].netWorthUSD).toBe(5000); // t=300 ≥ 150
    expect(out[3].netWorthUSD).toBe(9000); // t=400 ≥ 350
  });

  it("ignores zero / negative-NW snapshots so a stale auto-recorded $0 doesn't flatline the chart", () => {
    // Regression for the May-11-shows-$0 bug: a zero-NW snapshot
    // recorded by an early auto-snapshot run (before household
    // hydrated) used to poison every chart bucket at-or-after its
    // timestamp.
    const snapshots: Snapshot[] = [
      { t: 200, netWorthUSD: 1500 },
      { t: 380, netWorthUSD: 0 }, // bad row that shouldn't apply
    ];
    const out = overlaySnapshots(base, snapshots);
    expect(out[0].netWorthUSD).toBe(1000);
    expect(out[1].netWorthUSD).toBe(1500);
    expect(out[2].netWorthUSD).toBe(1500);
    // Bucket at t=400 must keep the good 1500 overlay, NOT swap in 0.
    expect(out[3].netWorthUSD).toBe(1500);
  });

  it("ignores negative-NW snapshots too (a household briefly underwater)", () => {
    const out = overlaySnapshots(base, [
      { t: 250, netWorthUSD: -50 },
    ]);
    // No usable snapshots → series unchanged.
    expect(out).toEqual(base);
  });

  it("pins today's last bucket to liveNetWorth when supplied", () => {
    // Snapshot at the last bucket's date overlay-replaces it, which
    // previously could drop the right edge to a stale value. With
    // liveNetWorth supplied, today is authoritatively pinned.
    const snapshots: Snapshot[] = [{ t: 400, netWorthUSD: 0.01 }]; // sneaky non-zero
    const out = overlaySnapshots(base, snapshots, 9999);
    // First three points pass through unchanged (snapshot is at t=400
    // so no buckets before that get overlay-replaced).
    expect(out[0].netWorthUSD).toBe(1000);
    expect(out[1].netWorthUSD).toBe(1100);
    expect(out[2].netWorthUSD).toBe(1200);
    // ...the LAST bucket would be overlay-replaced to 0.01, but
    // liveNetWorth pin authoritatively wins.
    expect(out[3].netWorthUSD).toBe(9999);
    expect(out[3].t).toBe(400);
  });

  it("liveNetWorth pin overrides even a normal snapshot overlay on today's bucket", () => {
    const snapshots: Snapshot[] = [{ t: 350, netWorthUSD: 7777 }];
    const out = overlaySnapshots(base, snapshots, 12345);
    // Buckets 200/300 are before t=350, stay as base; bucket 400 would
    // normally be overlay-replaced to 7777, but liveNetWorth wins.
    expect(out[3].netWorthUSD).toBe(12345);
  });

  it("liveNetWorth ignored when not finite", () => {
    const out = overlaySnapshots(base, [], NaN);
    expect(out).toEqual(base);
  });
});

describe("reconstructHistory", () => {
  const fixedNow = new Date("2026-05-10T12:00:00Z").getTime();

  it("synthesizes a back-projected curve from each holding's CAGR when no quotes are supplied", () => {
    const series = reconstructHistory(DEMO_HOUSEHOLD, {}, "1M", fixedNow);
    expect(series.length).toBeGreaterThan(2);
    // Curve, not a flat line: many distinct values across the window.
    const values = new Set(series.map((p) => Math.round(p.netWorthUSD)));
    expect(values.size).toBeGreaterThan(1);
    // Positive CAGRs in the demo holdings ⇒ past < present.
    const first = series[0].netWorthUSD;
    const last = series[series.length - 1].netWorthUSD;
    expect(first).toBeLessThan(last);
  });

  it("zero-CAGR household back-projects to a flat curve at current NW", () => {
    // Edge case: a household with every holding's expectedRealCAGR
    // set to 0 should produce a flat back-projected curve. Without
    // this test, a regression that always assumed positive CAGR
    // (e.g. dividing by CAGR somewhere) would only surface on
    // exotic real-world data.
    const flat: import("@/lib/types").Household = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) =>
          h.kind === "cash"
            ? h
            : { ...h, expectedRealCAGR: 0 },
        ),
      })),
    };
    const series = reconstructHistory(flat, {}, "1M", fixedNow);
    expect(series.length).toBeGreaterThan(2);
    const first = series[0].netWorthUSD;
    const last = series[series.length - 1].netWorthUSD;
    // Allow a few-cent drift from cash-yield holdings + float
    // noise; the curve must be flat in real terms.
    expect(Math.abs(first - last) / Math.max(1, last)).toBeLessThan(0.001);
  });

  it("reflects price changes when quotes are provided", () => {
    const earlyPrice = 100;
    const latePrice = 200;
    const monthBefore = fixedNow - 30 * 24 * 60 * 60 * 1000;
    const fakeQuote: Quote = {
      symbol: "VOO",
      currentPrice: latePrice,
      currency: "USD",
      name: "VOO",
      history: [
        { t: monthBefore, p: earlyPrice },
        { t: fixedNow, p: latePrice },
      ],
      fetchedAt: 0,
    };
    const seriesWithoutQuotes = reconstructHistory(
      DEMO_HOUSEHOLD,
      {},
      "1M",
      fixedNow,
    );
    const seriesWithQuotes = reconstructHistory(
      DEMO_HOUSEHOLD,
      { VOO: fakeQuote },
      "1M",
      fixedNow,
    );
    const earlyFlat = seriesWithoutQuotes[0].netWorthUSD;
    const earlyAdj = seriesWithQuotes[0].netWorthUSD;
    expect(earlyAdj).toBeLessThan(earlyFlat);
  });

  it("uses rich snapshot composition for periods at-or-after a snapshot", () => {
    const fixedNow = new Date("2024-06-15T00:00:00Z").getTime();
    const sixMonthsAgo = new Date("2024-01-01T00:00:00Z").getTime();
    // A "past" household with just half the demo's accounts.
    const past: Household = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.slice(0, 1),
    };
    const series = reconstructHistory(
      DEMO_HOUSEHOLD,
      {},
      "1Y",
      fixedNow,
      [
        {
          t: sixMonthsAgo,
          netWorthUSD: householdNetWorth(past),
          household: past,
        },
      ],
    );
    // A point clearly after the snapshot uses the snapshot's
    // composition. Since `past` has fewer accounts, the NW around
    // that timestamp must be lower than what the full-household
    // reconstruction would produce.
    const fullSeries = reconstructHistory(
      DEMO_HOUSEHOLD,
      {},
      "1Y",
      fixedNow,
    );
    // Pick a bucket a few weeks after the snapshot — squarely inside
    // the snapshot window.
    const target = sixMonthsAgo + 30 * 24 * 60 * 60 * 1000;
    const richBucket = closest(series, target);
    const fullBucket = closest(fullSeries, target);
    expect(richBucket.netWorthUSD).toBeLessThan(fullBucket.netWorthUSD);
  });
});

function closest(series: HistoryPoint[], t: number): HistoryPoint {
  let best = series[0];
  let bestDist = Math.abs(series[0].t - t);
  for (const p of series) {
    const d = Math.abs(p.t - t);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

describe("memberFilteredSnapshots (Round-5 fix)", () => {
  const m1 = "mem-1";
  const m2 = "mem-2";
  const fullHousehold = {
    id: "h",
    members: [
      { id: m1, displayName: "You" },
      { id: m2, displayName: "Spouse" },
    ],
    accounts: [
      {
        id: "a1",
        category: "BROKERAGE" as const,
        displayName: "You-B",
        ownerId: m1,
        monthlyContributionUSD: 0,
        holdings: [
          {
            kind: "cash" as const,
            id: "c1",
            valueUSD: 100_000,
            expectedRealCAGR: 0,
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
          },
        ],
      },
      {
        id: "a2",
        category: "BROKERAGE" as const,
        displayName: "Spouse-B",
        ownerId: m2,
        monthlyContributionUSD: 0,
        holdings: [
          {
            kind: "cash" as const,
            id: "c2",
            valueUSD: 300_000,
            expectedRealCAGR: 0,
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
          },
        ],
      },
    ],
    liabilities: [],
  };

  it("returns snapshots unchanged when memberId is null", () => {
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 400_000, household: fullHousehold },
    ];
    expect(memberFilteredSnapshots(snapshots, null)).toEqual(snapshots);
  });

  it("filters rich snapshots' households and recomputes NW per-member", () => {
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 400_000, household: fullHousehold },
    ];
    const out = memberFilteredSnapshots(snapshots, m1);
    expect(out).toHaveLength(1);
    expect(out[0].netWorthUSD).toBe(100_000); // only m1's slice
    expect(out[0].household?.accounts).toHaveLength(1);
    expect(out[0].household?.accounts[0].ownerId).toBe(m1);
  });

  it("drops legacy NW-only snapshots when memberId is set (can't attribute)", () => {
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 50_000 }, // legacy
      { t: 200, netWorthUSD: 400_000, household: fullHousehold }, // rich
    ];
    const out = memberFilteredSnapshots(snapshots, m1);
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe(200);
  });

  it("returns the SAME array reference when memberId is null (pass-through identity)", () => {
    // Reference-stable pass-through matters for memoization
    // downstream: a fresh array every render would invalidate every
    // React.memo'd consumer. Pin the identity contract so a future
    // "clean up" that spreads the array doesn't silently regress it.
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 400_000, household: fullHousehold },
    ];
    expect(memberFilteredSnapshots(snapshots, null)).toBe(snapshots);
  });

  it("keeps a rich snapshot for a member with zero owned accounts (NW becomes 0)", () => {
    // The user added a third member (`m3`) but they own nothing. A
    // snapshot recorded after their creation has them in the
    // member list but no accounts → filtered NW = 0. Keep the row
    // so the user sees "snapshot exists, m3 had $0 here" rather
    // than "snapshot mysteriously vanished from the panel."
    const m3 = "mem-3";
    const householdWithEmptyMember = {
      ...fullHousehold,
      members: [...fullHousehold.members, { id: m3, displayName: "Kid" }],
    };
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 400_000, household: householdWithEmptyMember },
    ];
    const out = memberFilteredSnapshots(snapshots, m3);
    expect(out).toHaveLength(1);
    expect(out[0].netWorthUSD).toBe(0);
    expect(out[0].household?.accounts).toHaveLength(0);
  });

  it("keeps a rich snapshot whose stored household pre-dates the selected member (NW=0)", () => {
    // Edge case: user created member m3 AFTER capturing a 2022
    // snapshot. The snapshot's stored household has no m3 at all.
    // `filterHousehold` returns an empty slice (no member entry,
    // no accounts) → NW = 0. We keep the row for parity with the
    // empty-owned-accounts case; the consuming UI surface decides
    // whether to filter out zero-NW rows.
    const m3 = "mem-3";
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 400_000, household: fullHousehold }, // no m3
    ];
    const out = memberFilteredSnapshots(snapshots, m3);
    expect(out).toHaveLength(1);
    expect(out[0].netWorthUSD).toBe(0);
  });
});
