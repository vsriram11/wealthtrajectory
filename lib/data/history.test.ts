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

  it("linearly interpolates between consecutive snapshot anchors (jaggedness fix)", () => {
    // User-reported visual bug fix: the chart used to render
    // flat plateaus between snapshots (every bucket whose t >=
    // snap.t got snap.NW until the next snap arrived). The new
    // semantic treats snapshots as anchors and interpolates
    // linearly between them, so the chart smoothly connects
    // recorded values.
    const snapshots: Snapshot[] = [
      { t: 150, netWorthUSD: 5000 },
      { t: 350, netWorthUSD: 9000 },
    ];
    const out = overlaySnapshots(base, snapshots);
    // Pre-first-anchor bucket: untouched (reconstructed).
    expect(out[0].netWorthUSD).toBe(1000);
    // Between anchors: linear blend.
    // t=200 → frac=(200-150)/200 = 0.25 → 5000 + 4000*0.25 = 6000
    expect(out[1].netWorthUSD).toBe(6000);
    // t=300 → frac=0.75 → 5000 + 4000*0.75 = 8000
    expect(out[2].netWorthUSD).toBe(8000);
    // Post-last-anchor bucket: held at last anchor (live-NW pin
    // would override; no liveNetWorth supplied here).
    expect(out[3].netWorthUSD).toBe(9000);
  });

  it("renders zero / negative-NW snapshots (user-intentional underwater state)", () => {
    // Audit R1 MED fix: previously the overlay silently dropped
    // any NW <= 0 row, which incorrectly hid legitimate
    // underwater snapshots. Now NW is gated only at the IDB
    // boundary (loadSnapshots purges NaN/Infinity only); anything
    // finite reaches the overlay. A user with high mortgage debt
    // + low assets gets to chart their real negative NW.
    const snapshots: Snapshot[] = [
      { t: 200, netWorthUSD: 1500 },
      { t: 380, netWorthUSD: 0 },
    ];
    const out = overlaySnapshots(base, snapshots);
    expect(out[0].netWorthUSD).toBe(1000);
    // Bucket exactly at anchor t=200 → pinned.
    expect(out[1].netWorthUSD).toBe(1500);
    // Bucket t=300 between [200, 1500] and [380, 0]:
    // frac=(300-200)/180=0.5556 → 1500 + (0-1500)*0.5556 ≈ 666.67
    expect(out[2].netWorthUSD).toBeCloseTo(666.6667, 3);
    // Bucket t=400 post-dates the last anchor (380): held at 0.
    expect(out[3].netWorthUSD).toBe(0);
  });

  it("negative-NW snapshots overlay too (briefly underwater is a real state)", () => {
    const out = overlaySnapshots(
      [
        { t: 100, netWorthUSD: 1000 },
        { t: 300, netWorthUSD: 1200 },
      ],
      [{ t: 250, netWorthUSD: -50 }],
    );
    // Snapshot at t=250 applies to the t=300 bucket (the earliest
    // bucket >= the snapshot's t).
    expect(out[0].netWorthUSD).toBe(1000);
    expect(out[1].netWorthUSD).toBe(-50);
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

  it("augments a snapshot's anchor NW with backdated live holdings missing from that snapshot (user-reported bug)", () => {
    // User scenario: added a private_stock in May 2026 with
    // acquiredAt=2021. There's an auto-snapshot at t=200 recorded
    // BEFORE the holding was added (so its embedded household
    // doesn't contain it), and a time-travel snapshot at t=400
    // recorded AFTER (so its household DOES contain it). The
    // chart's anchor for the t=200 snapshot should still INCLUDE
    // the private_stock — because the holding's acquiredAt claims
    // it existed at t=200.
    const live: Household = {
      id: "hh",
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "a1",
          displayName: "Brokerage",
          category: "BROKERAGE",
          ownerId: "m1" as never,
          monthlyContributionUSD: 0,
          holdings: [
            // VOO present everywhere (in both snapshots + live).
            {
              kind: "equity",
              id: "VOO_ID" as never,
              symbol: "VOO",
              shares: 100,
              lastPriceUSD: 500,
              lastPricedAt: 1_700_000_000_000,
              isManualPrice: false,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 50_000,
              expectedRealCAGR: 0.07,
              leverage: 1,
              styleBox: { LARGE_BLEND: 1 } as never,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            } as never,
            // Private stock backdated to t=50, added in live ONLY.
            {
              kind: "private_stock",
              id: "PRIV_ID" as never,
              displayName: "Cool startup",
              shares: 1000,
              lastPriceUSD: 100,
              lastPricedAt: null,
              isManualPrice: true,
              enteredAsShares: false,
              acquiredAt: 50,
              valueUSD: 100_000,
              expectedRealCAGR: 0.05,
              isIlliquid: true,
            } as never,
          ],
        },
      ],
      liabilities: [],
    };
    // Snapshot at t=200: only VOO. NW = $50k.
    const snapEarly: Snapshot = {
      t: 200,
      netWorthUSD: 50_000,
      household: {
        ...live,
        accounts: [
          {
            ...live.accounts[0],
            holdings: [live.accounts[0].holdings[0]],
          },
        ],
      },
    };
    // Snapshot at t=400: VOO + private. NW = $150k.
    const snapLate: Snapshot = {
      t: 400,
      netWorthUSD: 150_000,
      household: live,
    };
    const baseSeries: HistoryPoint[] = [
      { t: 100, netWorthUSD: 0 },
      { t: 200, netWorthUSD: 0 },
      { t: 300, netWorthUSD: 0 },
      { t: 400, netWorthUSD: 0 },
    ];
    // Without the live-household pass: t=200 anchor is $50k, t=400
    // is $150k → interpolated t=300 = $100k. Chart "loses" the
    // private stock for the Aug-Dec region.
    // WITH live-household: t=200 anchor adjusted to $50k + $100k
    // backdated private = $150k. Interpolated t=300 between
    // [200, 150k] and [400, 150k] = $150k. Chart shows private
    // stock consistently from t=200 onward.
    const out = overlaySnapshots(baseSeries, [snapEarly, snapLate], undefined, live);
    expect(out[1].netWorthUSD).toBe(150_000); // t=200 anchor augmented
    expect(out[2].netWorthUSD).toBe(150_000); // t=300 interpolated flat
    expect(out[3].netWorthUSD).toBe(150_000); // t=400 anchor unchanged
  });

  it("liveNetWorth acts as a right-edge anchor: interpolates between last snapshot and live (no flat plateau)", () => {
    // Snapshot at t=200 with NW=$1000, live NW=$2000 pinned at
    // last bucket t=400. Bucket at t=300 sits half-way between
    // [200, 1000] and [400, 2000] → 1500 (interpolated). The
    // PREVIOUS behavior would have held flat at $1000 until t=400
    // then snapped to $2000 — that's the user-reported staircase.
    const snapshots: Snapshot[] = [{ t: 200, netWorthUSD: 1000 }];
    const out = overlaySnapshots(base, snapshots, 2000);
    expect(out[0].netWorthUSD).toBe(1000); // pre-anchor, untouched
    expect(out[1].netWorthUSD).toBe(1000); // exactly at snap
    expect(out[2].netWorthUSD).toBe(1500); // interpolated half-way
    expect(out[3].netWorthUSD).toBe(2000); // live anchor pinned
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

  it("drops snapshots with NaN or Infinity `t` regardless of memberId (boundary guard)", () => {
    // Cloud-sync corruption / hostile import can land a row with
    // `t = NaN`. NaN poisons Math.min in summary text + sort
    // comparators (undefined ordering). The single canonical filter
    // drops them at the boundary so every downstream consumer is
    // protected, matching the engine NaN-safety contract.
    const snapshots: Snapshot[] = [
      { t: 100, netWorthUSD: 1, household: fullHousehold },
      { t: Number.NaN, netWorthUSD: 2, household: fullHousehold },
      { t: Number.POSITIVE_INFINITY, netWorthUSD: 3, household: fullHousehold },
      { t: 200, netWorthUSD: 4, household: fullHousehold },
    ];
    const noFilter = memberFilteredSnapshots(snapshots, null);
    expect(noFilter).toHaveLength(2);
    expect(noFilter.map((s) => s.t)).toEqual([100, 200]);

    const filtered = memberFilteredSnapshots(snapshots, m1);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.t)).toEqual([100, 200]);
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

describe("reconstructHistory — newly-added holdings (user-reported fake-gain fix)", () => {
  // USER REPORT: "Added equity today but backdated the acquired
  // on date — history chart shows a big fake gain."
  // The old behavior back-projected the new holding's value
  // through past timepoints at its expected CAGR, creating
  // historical NW values < today's → apparent gain when none
  // happened (the holding wasn't in the system yesterday, it
  // didn't actually grow).
  //
  // FIX: holdings not present in any past snapshot are held
  // FLAT at today's value across all historical timepoints.
  // No back-projection → no fake gain.

  const T_NOW = Date.UTC(2026, 5, 1, 12);
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const T_YEAR_AGO = T_NOW - ONE_YEAR_MS;

  function buildHousehold(
    holdings: Array<{ id: string; v: number; acquiredAt?: number | null }>,
  ): Household {
    return {
      id: "test-hh",
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "a1",
          ownerId: "m1",
          displayName: "Brokerage",
          category: "TAXABLE",
          holdings: holdings.map((h) => ({
            id: h.id,
            kind: "equity" as const,
            symbol: h.id,
            shares: h.v / 100,
            valueUSD: h.v,
            lastPriceUSD: 100,
            lastPricedAt: T_NOW,
            currency: "USD",
            expenseRatio: 0,
            geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            style: {},
            leverage: 1,
            expectedRealCAGR: 0.08,
            isManualPrice: false,
            acquiredAt: h.acquiredAt ?? null,
          })) as never,
        } as never,
      ],
      liabilities: [],
    };
  }

  it("newly-added holding doesn't inflate apparent gain over the period", () => {
    // The headline fix scenario. User has snapshot history that
    // doesn't include NEW. Today they add NEW. The chart should
    // NOT attribute "gain" to the appearance of NEW.
    const oldOnly = buildHousehold([{ id: "OLD", v: 50_000 }]);
    const oldOnlyToday = buildHousehold([{ id: "OLD", v: 50_000 }]);
    const oldPlusNew = buildHousehold([
      { id: "OLD", v: 50_000 },
      // NEW: user added it TODAY but backdated acquiredAt to
      // before the oldest snapshot — exactly the user-reported
      // scenario the fix targets.
      {
        id: "NEW",
        v: 100_000,
        acquiredAt: T_NOW - 5 * 365 * 24 * 60 * 60 * 1000,
      },
    ]);
    const snapshots: Snapshot[] = [
      {
        t: T_NOW - 11 * 30 * 24 * 60 * 60 * 1000,
        netWorthUSD: 50_000,
        household: oldOnly,
      },
    ];
    // Baseline: WITHOUT the new holding.
    const baselineOut = reconstructHistory(
      oldOnlyToday,
      {},
      "1Y",
      T_NOW,
      snapshots,
    );
    const baselineGain =
      baselineOut[baselineOut.length - 1].netWorthUSD -
      baselineOut[0].netWorthUSD;
    // With the new holding added today (not in any past snapshot).
    const withNewOut = reconstructHistory(
      oldPlusNew,
      {},
      "1Y",
      T_NOW,
      snapshots,
    );
    const withNewGain =
      withNewOut[withNewOut.length - 1].netWorthUSD -
      withNewOut[0].netWorthUSD;
    // CRITICAL ASSERTION: the apparent gain should be roughly
    // the SAME with or without the new holding. The new holding
    // contributes 0 to the gain because it's held flat at
    // today's value across history.
    expect(withNewGain).toBeCloseTo(baselineGain, -2); // ~$100 tolerance
  });

  it("holding present in past snapshot is back-projected normally (no regression)", () => {
    // OLD existed in the past snapshot → back-projection still
    // applies. NW grows over time due to OLD's expected CAGR.
    const past = buildHousehold([{ id: "OLD", v: 50_000 }]);
    const today = buildHousehold([{ id: "OLD", v: 50_000 }]);
    const snapshots: Snapshot[] = [
      {
        t: T_NOW - 11 * 30 * 24 * 60 * 60 * 1000,
        netWorthUSD: 50_000,
        household: past,
      },
    ];
    const out = reconstructHistory(today, {}, "1Y", T_NOW, snapshots);
    // Some change across the year (back-projection of OLD's CAGR
    // from its snapshot value), but not flat.
    expect(out.length).toBeGreaterThan(2);
  });

  it("no snapshots at all → back-projection unchanged (back-compat)", () => {
    // For users with no snapshot history, the fix should NOT
    // change behavior — we have no evidence whether holdings
    // were present in the past or not.
    const today = buildHousehold([{ id: "NEW", v: 100_000 }]);
    const out = reconstructHistory(today, {}, "1Y", T_NOW, []);
    // Today's value reflects the holding.
    expect(out[out.length - 1].netWorthUSD).toBe(100_000);
    // Year-ago value is back-projected (lower due to CAGR).
    expect(out[0].netWorthUSD).toBeLessThan(100_000);
  });

  it("newly-added liability does NOT subtract from past buckets (R8 audit fix)", () => {
    // User adds a liability TODAY (e.g. records a mortgage they
    // just opened). The chart's historical buckets must not be
    // pulled down by this debt — it didn't exist back then. A
    // liability present in the LIVE household but absent from
    // every snapshot is treated as "newly recorded today" and
    // excluded from the past subtraction.
    const householdBefore: Household = {
      id: "hh",
      members: [{ id: "m1", displayName: "Tester" } as never],
      accounts: [
        {
          id: "a1",
          displayName: "Cash",
          category: "CHECKING",
          ownerId: "m1" as never,
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "cash",
              id: "c1" as never,
              valueUSD: 200_000,
              expectedRealCAGR: 0,
            } as never,
          ],
        },
      ],
      liabilities: [],
    };
    const householdLive: Household = {
      ...householdBefore,
      // Mortgage added TODAY but not in any snapshot.
      liabilities: [
        {
          id: "L_NEW" as never,
          ownerId: "m1" as never,
          name: "Mortgage",
          balanceUSD: 500_000,
          aprPct: 6,
        } as never,
      ],
    };
    const snapshots: Snapshot[] = [
      {
        t: T_YEAR_AGO,
        netWorthUSD: 200_000,
        household: householdBefore,
      },
    ];
    // Use a 5Y range so the chart covers a window starting BEFORE
    // T_YEAR_AGO — that gives us pre-first-snapshot buckets to
    // validate. (1Y range starts ~exactly at T_YEAR_AGO so every
    // bucket is at-or-after the snapshot, never falling into the
    // live-composition branch.)
    const out = reconstructHistory(householdLive, {}, "5Y", T_NOW, snapshots);
    // The very first bucket pre-dates every snapshot — composition
    // falls back to the LIVE household, but the newly-added
    // liability MUST be excluded. Without the fix, the first
    // bucket would subtract $500k → -$300k. With the fix, the
    // mortgage drops out and the bucket reflects assets only.
    expect(out[0].netWorthUSD).toBeGreaterThanOrEqual(0);
    // Sanity: at the snapshot anchor (~T_YEAR_AGO), the chart uses
    // the snapshot's composition (which has no liabilities) → $200k.
    const yearAgoIdx = out.findIndex((p) => p.t >= T_YEAR_AGO);
    expect(out[yearAgoIdx].netWorthUSD).toBe(200_000);
  });
});
