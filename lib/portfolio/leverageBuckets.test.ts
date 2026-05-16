import { describe, expect, it } from "vitest";
import {
  filterHouseholdByClass,
  leverageBuckets,
} from "@/lib/portfolio/leverageBuckets";
import type { Holding, Household } from "@/lib/types";

const m = { id: "m1", displayName: "M" };

function holding(
  kind: Holding["kind"],
  face: number,
  leverage?: number,
  extras: Partial<Record<string, unknown>> = {},
): Holding {
  const base: Record<string, unknown> = {
    id: `h-${Math.random().toString(36).slice(2, 8)}`,
    symbol: "TEST",
    shares: 1,
    lastPriceUSD: face,
    lastPricedAt: null,
    isManualPrice: true,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD: face,
    expectedRealCAGR: 0.05,
    leverage: leverage ?? 1,
    ...extras,
  };
  switch (kind) {
    case "equity":
      return { ...base, kind: "equity", styleBox: {}, geography: {} } as Holding;
    case "bond":
      return {
        ...base,
        kind: "bond",
        bondType: {},
        geography: {},
        averageDurationYears: 5,
      } as Holding;
    case "cash":
      return {
        kind: "cash",
        id: base.id as string,
        valueUSD: face,
        expectedRealCAGR: 0,
        geography: {},
      } as Holding;
    case "real_estate":
      return {
        kind: "real_estate",
        id: base.id as string,
        name: "House",
        valueUSD: face,
        expectedRealCAGR: 0.02,
        leverage: leverage ?? 1,
        isPrimaryResidence: true,
        acquiredAt: null,
      } as Holding;
    default:
      return { ...base, kind } as Holding;
  }
}

function household(...hs: Holding[]): Household {
  return {
    id: "hh",
    members: [m],
    accounts: [
      {
        id: "a1",
        displayName: "A",
        category: "BROKERAGE",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: hs,
      },
    ],
    liabilities: [],
  };
}

describe("leverageBuckets — four-way face split", () => {
  it("returns zero buckets for an empty household", () => {
    const r = leverageBuckets(household());
    expect(r.totalFaceUSD).toBe(0);
    expect(r.buckets.map((b) => b.faceUSD)).toEqual([0, 0, 0, 0]);
    expect(r.buckets.map((b) => b.share)).toEqual([0, 0, 0, 0]);
  });

  it("ordering: low, mid, high, re_levered (stable for the UI)", () => {
    const r = leverageBuckets(household());
    expect(r.buckets.map((b) => b.key)).toEqual([
      "low",
      "mid",
      "high",
      "re_levered",
    ]);
  });

  it("cash always lands in the 0–1x bucket", () => {
    const r = leverageBuckets(household(holding("cash", 100_000)));
    expect(r.buckets[0].faceUSD).toBe(100_000);
    expect(r.buckets[0].share).toBe(1);
  });

  it("1× stocks land in 0–1x (inclusive of 1x)", () => {
    const r = leverageBuckets(
      household(holding("equity", 50_000, 1)),
    );
    expect(r.buckets[0].faceUSD).toBe(50_000);
    expect(r.buckets[1].faceUSD).toBe(0);
    expect(r.buckets[2].faceUSD).toBe(0);
  });

  it("1.5× wrapper (NTSX-style) lands in 1–2x", () => {
    const r = leverageBuckets(
      household(holding("equity", 100_000, 1.5)),
    );
    expect(r.buckets[0].faceUSD).toBe(0);
    expect(r.buckets[1].faceUSD).toBe(100_000);
    expect(r.buckets[2].faceUSD).toBe(0);
  });

  it("exactly 2× lands in 2x+ (boundary is inclusive)", () => {
    const r = leverageBuckets(
      household(holding("equity", 30_000, 2)),
    );
    expect(r.buckets[2].faceUSD).toBe(30_000);
    expect(r.buckets[1].faceUSD).toBe(0);
  });

  it("3× ETF (TQQQ-style) lands in 2x+", () => {
    const r = leverageBuckets(
      household(holding("equity", 10_000, 3)),
    );
    expect(r.buckets[2].faceUSD).toBe(10_000);
    expect(r.buckets[2].share).toBe(1);
  });

  it("mixed portfolio: face values + shares add up", () => {
    const r = leverageBuckets(
      household(
        holding("cash", 20_000),
        holding("equity", 60_000, 1),
        holding("equity", 10_000, 1.5),
        holding("equity", 10_000, 3),
      ),
    );
    expect(r.totalFaceUSD).toBe(100_000);
    expect(r.buckets[0].faceUSD).toBe(80_000); // cash + 1×
    expect(r.buckets[1].faceUSD).toBe(10_000);
    expect(r.buckets[2].faceUSD).toBe(10_000);
    expect(r.buckets[0].share).toBeCloseTo(0.8);
    expect(r.buckets[1].share).toBeCloseTo(0.1);
    expect(r.buckets[2].share).toBeCloseTo(0.1);
  });

  it("paid-off real estate lands in 0–1× (no mortgage = no extra risk)", () => {
    const r = leverageBuckets(
      household(holding("real_estate", 200_000, 1)),
    );
    expect(r.buckets[0].faceUSD).toBe(200_000); // low
    expect(r.buckets[3].faceUSD).toBe(0); // re_levered
  });

  it("ANY mortgaged real estate lands in its own re_levered bucket — never in 1–2× or 2×+", () => {
    // 1.5× LTV mortgage → would have been mid; now re_levered.
    // 5× LTV mortgage → would have been high; now re_levered.
    // Both go to the same bucket because mortgage leverage has
    // fundamentally different risk dynamics than leveraged ETFs:
    // lower vol, fixed-rate, no margin calls.
    const r = leverageBuckets(
      household(
        holding("real_estate", 100_000, 1.5),
        holding("real_estate", 50_000, 5),
      ),
    );
    expect(r.buckets[1].faceUSD).toBe(0); // mid empty
    expect(r.buckets[2].faceUSD).toBe(0); // high empty
    expect(r.buckets[3].faceUSD).toBe(150_000); // re_levered = sum
  });

  it("composes: real estate (mortgaged) plus leveraged ETFs go to separate buckets", () => {
    const r = leverageBuckets(
      household(
        holding("equity", 10_000, 3), // TQQQ → high
        holding("real_estate", 80_000, 5), // mortgage → re_levered
      ),
    );
    expect(r.buckets[2].faceUSD).toBe(10_000); // high
    expect(r.buckets[3].faceUSD).toBe(80_000); // re_levered
    expect(r.totalFaceUSD).toBe(90_000);
  });

  it("skips zero / negative face values defensively", () => {
    const r = leverageBuckets(
      household(
        holding("equity", 0, 1),
        holding("equity", -100, 2),
        holding("equity", 50_000, 1),
      ),
    );
    expect(r.totalFaceUSD).toBe(50_000);
  });
});

describe("filterHouseholdByClass — per-tab scope", () => {
  it("ALL leaves household untouched", () => {
    const hh = household(
      holding("equity", 60_000, 1),
      holding("bond", 40_000, 1),
    );
    expect(filterHouseholdByClass(hh, "ALL")).toBe(hh);
  });

  it("equity tab drops bonds", () => {
    const hh = household(
      holding("equity", 60_000, 1),
      holding("bond", 40_000, 1),
    );
    const eq = filterHouseholdByClass(hh, "equity");
    const holdings = eq.accounts.flatMap((a) => a.holdings);
    expect(holdings.length).toBe(1);
    expect(holdings[0].kind).toBe("equity");
  });

  it("composes with leverageBuckets to scope per tab", () => {
    const hh = household(
      holding("equity", 60_000, 1),
      holding("equity", 10_000, 3),
      holding("bond", 40_000, 1),
    );
    // ALL: $110k total, 70k low + 0 mid + 10k high
    const all = leverageBuckets(filterHouseholdByClass(hh, "ALL"));
    expect(all.totalFaceUSD).toBe(110_000);
    expect(all.buckets[2].faceUSD).toBe(10_000);
    // equity-only: $70k total, 60k low + 0 mid + 10k high
    const eqOnly = leverageBuckets(filterHouseholdByClass(hh, "equity"));
    expect(eqOnly.totalFaceUSD).toBe(70_000);
    expect(eqOnly.buckets[0].faceUSD).toBe(60_000);
    expect(eqOnly.buckets[2].faceUSD).toBe(10_000);
    // bond-only: just the 40k 1× bond
    const bondOnly = leverageBuckets(filterHouseholdByClass(hh, "bond"));
    expect(bondOnly.totalFaceUSD).toBe(40_000);
    expect(bondOnly.buckets[0].faceUSD).toBe(40_000);
  });
});
