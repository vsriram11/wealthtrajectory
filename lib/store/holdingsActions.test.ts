import { describe, expect, it } from "vitest";
import type { Holding, Scenario } from "@/lib/types";
import {
  createHoldingsActions,
  type HoldingsActionsContext,
} from "./holdingsActions";

function makeFakeStore(seed: Partial<HoldingsActionsContext> = {}) {
  let state: HoldingsActionsContext = {
    household: {
      id: "h1",
      members: [{ id: "m1", displayName: "Alex" }],
      accounts: [],
      liabilities: [],
    },
    scenarios: [],
    editingHoldingId: null,
    creatingHoldingForAccountId: null,
    ...seed,
  };
  return {
    get state() {
      return state;
    },
    set: (
      fn: (s: HoldingsActionsContext) => Partial<HoldingsActionsContext>,
    ) => {
      state = { ...state, ...fn(state) };
    },
  };
}

describe("createHolding / removeHolding", () => {
  it("adds a holding + clears the creating-modal flag", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "Roth IRA",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [],
          },
        ],
        liabilities: [],
      },
      creatingHoldingForAccountId: "acc1",
    });
    const a = createHoldingsActions(s.set);
    a.createHolding("acc1", {
      kind: "cash",
      valueUSD: 5000,
      expectedRealCAGR: 0.005,
    });
    expect(s.state.household.accounts[0].holdings).toHaveLength(1);
    expect(s.state.household.accounts[0].holdings[0].kind).toBe("cash");
    expect(s.state.creatingHoldingForAccountId).toBeNull();
  });

  it("removeHolding strips scenario refs + clears editingHoldingId if it matches", () => {
    const holding: Holding = {
      kind: "cash",
      id: "h-x",
      valueUSD: 1000,
      expectedRealCAGR: 0.005,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    };
    const scenarios: Scenario[] = [
      {
        id: "sc1",
        name: "Test",
        color: "#fff",
        overrides: { holdingCAGRs: { "h-x": 0.1, "h-keep": 0.05 } },
        createdAt: 0,
      },
    ];
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [holding],
          },
        ],
        liabilities: [],
      },
      scenarios,
      editingHoldingId: "h-x",
    });
    const a = createHoldingsActions(s.set);
    a.removeHolding("h-x");
    expect(s.state.household.accounts[0].holdings).toHaveLength(0);
    expect(s.state.scenarios[0].overrides.holdingCAGRs).toEqual({
      "h-keep": 0.05,
    });
    expect(s.state.editingHoldingId).toBeNull();
  });

  it("removeHolding leaves editingHoldingId alone when it doesn't match", () => {
    const s = makeFakeStore({ editingHoldingId: "h-other" });
    const a = createHoldingsActions(s.set);
    a.removeHolding("h-nonexistent");
    expect(s.state.editingHoldingId).toBe("h-other");
  });
});

describe("per-holding setters", () => {
  function seedHolding(holding: Holding) {
    return makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [holding],
          },
        ],
        liabilities: [],
      },
    });
  }

  it("setHoldingCAGR updates the rate on the matching holding only", () => {
    const s = seedHolding({
      kind: "cash",
      id: "h1",
      valueUSD: 1000,
      expectedRealCAGR: 0.005,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    });
    const a = createHoldingsActions(s.set);
    a.setHoldingCAGR("h1", 0.04);
    expect(s.state.household.accounts[0].holdings[0].expectedRealCAGR).toBe(
      0.04,
    );
  });

  it("setHoldingLeverage flips bondLeverageIsManual for bonds only", () => {
    const s = seedHolding({
      kind: "bond",
      id: "h1",
      symbol: "BND",
      shares: 100,
      lastPriceUSD: 75,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: 7500,
      expectedRealCAGR: 0.015,
      leverage: 1,
      bondLeverageIsManual: false,
      bondType: { GOVT: 0.5, CORPORATE: 0.5 },
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      averageDurationYears: 7,
    });
    const a = createHoldingsActions(s.set);
    a.setHoldingLeverage("h1", 2);
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "bond") throw new Error("narrow");
    expect(h.leverage).toBe(2);
    expect(h.bondLeverageIsManual).toBe(true);
  });

  it("setHoldingDuration is a no-op on non-bond kinds", () => {
    const cash: Holding = {
      kind: "cash",
      id: "h1",
      valueUSD: 1000,
      expectedRealCAGR: 0.005,
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
    };
    const s = seedHolding(cash);
    const a = createHoldingsActions(s.set);
    a.setHoldingDuration("h1", 10);
    expect(s.state.household.accounts[0].holdings[0]).toEqual(cash);
  });

  it("resetBondLeverageToAuto recomputes leverage from duration", () => {
    const s = seedHolding({
      kind: "bond",
      id: "h1",
      symbol: "MID",
      shares: 100,
      lastPriceUSD: 100,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: 10000,
      expectedRealCAGR: 0.015,
      leverage: 2, // manually inflated
      bondLeverageIsManual: true,
      bondType: { GOVT: 1, CORPORATE: 0 },
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      averageDurationYears: 5,
    });
    const a = createHoldingsActions(s.set);
    a.resetBondLeverageToAuto("h1");
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "bond") throw new Error("narrow");
    expect(h.bondLeverageIsManual).toBe(false);
    // Duration 5 → auto leverage 0.5 (mid-range of the
    // bondLeverageFromDuration piecewise curve).
    expect(h.leverage).toBeCloseTo(0.5, 6);
  });

  it("setHoldingIsPrimaryResidence applies ONLY to real_estate", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "real_estate",
                id: "re",
                name: "Home",
                valueUSD: 500000,
                expectedRealCAGR: 0.02,
                acquiredAt: null,
                leverage: 1,
                isPrimaryResidence: false,
              },
              {
                kind: "cash",
                id: "cash",
                valueUSD: 1000,
                expectedRealCAGR: 0.005,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.setHoldingIsPrimaryResidence("re", true);
    a.setHoldingIsPrimaryResidence("cash", true);
    const re = s.state.household.accounts[0].holdings[0];
    const cash = s.state.household.accounts[0].holdings[1];
    expect((re as { isPrimaryResidence: boolean }).isPrimaryResidence).toBe(
      true,
    );
    expect(
      (cash as { isPrimaryResidence?: unknown }).isPrimaryResidence,
    ).toBeUndefined();
  });

  it("setHoldingIsIlliquid does not touch private_stock (always illiquid)", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "private_stock",
                id: "ps",
                symbol: "Acme",
                shares: 100,
                lastPriceUSD: 1,
                lastPricedAt: null,
                isManualPrice: true,
                enteredAsShares: true,
                acquiredAt: null,
                valueUSD: 100,
                expectedRealCAGR: 0,
                leverage: 1,
                preferredRoundPricePerShareUSD: null,
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.setHoldingIsIlliquid("ps", false);
    const h = s.state.household.accounts[0].holdings[0];
    expect((h as { isIlliquid?: unknown }).isIlliquid).toBeUndefined();
  });
});

describe("live-pricing flows", () => {
  it("first-fetch preserves user-entered USD value by recomputing shares", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "VOO",
                shares: 10,
                lastPriceUSD: 500,
                lastPricedAt: null,
                isManualPrice: false,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 5000,
                expectedRealCAGR: 0.07,
                leverage: 1,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.applyLivePrice("VOO", 400, 1_700_000_000_000);
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("narrow");
    expect(h.shares).toBe(12.5);
    expect(h.valueUSD).toBe(5000);
  });

  it("share-entered holdings keep shares fixed and let value float", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "VOO",
                shares: 10,
                lastPriceUSD: 500,
                lastPricedAt: null,
                isManualPrice: false,
                enteredAsShares: true,
                acquiredAt: null,
                valueUSD: 5000,
                expectedRealCAGR: 0.07,
                leverage: 1,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.applyLivePrice("VOO", 600, 1_700_000_000_000);
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("narrow");
    expect(h.shares).toBe(10);
    expect(h.valueUSD).toBe(6000);
  });

  it("historical mode recomputes valueUSD from shares × historical price (was: kept today's value)", () => {
    // User-reported bug: entering time-travel showed historical
    // prices being fetched (banner said "auto-filled: N") but
    // NW / allocation / accounts all kept showing today's
    // dollar values. Root cause: historical mode previously
    // updated lastPriceUSD + lastPricedAt only, leaving
    // valueUSD frozen at today's number.
    //
    // Share count is independent of price (if you owned N
    // shares of VOO today you owned N shares of VOO yesterday
    // too) so valueUSD at any date is shares × price-on-date.
    // This test pins the retrodiction: 10 shares of VOO @ today
    // $690 = $6900; at historical $400 it should read $4000.
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "VOO",
                shares: 10,
                lastPriceUSD: 690,
                // lastPricedAt set → not a firstFetch
                lastPricedAt: 1_700_000_000_000,
                isManualPrice: false,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 6900,
                expectedRealCAGR: 0.07,
                leverage: 1,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    // 2022-01-03 close = $400/share for VOO (made-up).
    a.applyLivePrice("VOO", 400, 1_641_168_000_000, "historical");
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("narrow");
    expect(h.shares).toBe(10); // unchanged
    expect(h.lastPriceUSD).toBe(400);
    expect(h.lastPricedAt).toBe(1_641_168_000_000);
    expect(h.valueUSD).toBe(4000); // shares × historical price
  });

  it("historical mode firstFetch preserves user-entered valueUSD (newly-added holding during session)", () => {
    // For a holding ADDED during a time-travel session, the
    // user's typed dollar value is the authoritative historical
    // value (they're saying "I had $5000 of VOO on date X").
    // We must NOT recompute valueUSD = shares × historical_price
    // (would overwrite the user's input with whatever the seed
    // shares happen to be × the fetched price). We must also
    // NOT recompute shares from value÷historical_price (the
    // original R1 audit concern — silently writes nonsense
    // shares back into the user's holding).
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "VOO",
                // Default seed shares; user typed "$5000"
                // → factory wrote shares = 5000 / today's
                // price, but we don't want to use those
                // shares to back-derive a historical value.
                shares: 7.246,
                lastPriceUSD: 690,
                lastPricedAt: null, // ← firstFetch sentinel
                isManualPrice: false,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 5000,
                expectedRealCAGR: 0.07,
                leverage: 1,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.applyLivePrice("VOO", 400, 1_641_168_000_000, "historical");
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("narrow");
    // Price metadata stamped (UI can show "as of <date>").
    expect(h.lastPriceUSD).toBe(400);
    expect(h.lastPricedAt).toBe(1_641_168_000_000);
    // User's entered dollars stay authoritative.
    expect(h.valueUSD).toBe(5000);
    expect(h.shares).toBe(7.246);
  });

  it("historical mode skips manual-priced holdings (same gate as live mode)", () => {
    // Manual-priced holdings don't participate in either live
    // or historical price application — the user's typed price
    // is sovereign.
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "TQQQ",
                shares: 100,
                lastPriceUSD: 52,
                lastPricedAt: 1_700_000_000_000,
                isManualPrice: true,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 5200,
                expectedRealCAGR: 0.07,
                leverage: 3,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.applyLivePrice("TQQQ", 30, 1_641_168_000_000, "historical");
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("narrow");
    // All four fields unchanged (manual holdings are inert
    // to the live-price pipeline in either mode).
    expect(h.shares).toBe(100);
    expect(h.lastPriceUSD).toBe(52);
    expect(h.lastPricedAt).toBe(1_700_000_000_000);
    expect(h.valueUSD).toBe(5200);
  });

  it("manual-priced holdings are skipped by applyLivePrice", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "ROTH_IRA",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "OBSCURE",
                shares: 1,
                lastPriceUSD: 100,
                lastPricedAt: null,
                isManualPrice: true,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 100,
                expectedRealCAGR: 0.07,
                leverage: 1,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.applyLivePrice("OBSCURE", 500, 1_700_000_000_000);
    expect(s.state.household.accounts[0].holdings[0].valueUSD).toBe(100);
  });

  it("convertHoldingToLive preserves shares (does NOT recompute from value÷price)", () => {
    // User-reported MAJOR bug: previously this recomputed
    // shares = value / livePrice, which silently DROPPED shares
    // when the user resumed live tracking from a manual price.
    // For TQQQ owned at 100 shares × $52 manual = $5,200,
    // switching to live ($84) used to give shares = $5,200/$84
    // = 61.9 — the user lost 38 shares.
    //
    // Resuming live tracking must preserve the share count
    // (user owns shares, not a dollar amount). valueUSD floats
    // to shares × livePrice.
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "TQQQ",
                shares: 100,
                lastPriceUSD: 52,
                lastPricedAt: 1_700_000_000_000,
                isManualPrice: true,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 5_200,
                expectedRealCAGR: 0.07,
                leverage: 3,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.convertHoldingToLive("h1" as never, 84, 1_700_000_001_000);
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("test fixture drifted");
    expect(h.isManualPrice).toBe(false);
    // CRITICAL: shares preserved at 100.
    expect(h.shares).toBe(100);
    expect(h.lastPriceUSD).toBe(84);
    // valueUSD floats to shares × live price.
    expect(h.valueUSD).toBe(8_400);
  });

  it("convertHoldingToManual flips isManualPrice + freezes value (next live-fetch skips)", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
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
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.convertHoldingToManual("h1" as never);
    const h = s.state.household.accounts[0].holdings[0];
    if (h.kind !== "equity") throw new Error("test fixture drifted");
    expect(h.isManualPrice).toBe(true);
    // Value, shares, lastPriceUSD all preserved.
    expect(h.valueUSD).toBe(50_000);
    expect(h.shares).toBe(100);
    expect(h.lastPriceUSD).toBe(500);
    // Now a live-fetch must not move it.
    a.applyLivePrice("VOO", 510, 1_700_000_001_000);
    expect(s.state.household.accounts[0].holdings[0].valueUSD).toBe(50_000);
  });
});

describe("setHoldingComposition / setHoldingCommodityBreakdown", () => {
  it("setting composition re-derives expectedRealCAGR from the weighted leg blend", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "equity",
                id: "h1",
                symbol: "NTSX",
                shares: 10,
                lastPriceUSD: 60,
                lastPricedAt: null,
                isManualPrice: false,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 600,
                expectedRealCAGR: 0.05, // stale, should be re-derived
                leverage: 1.5,
                styleBox: { LARGE_BLEND: 1 } as never,
                geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    // 90% equity @ 7% + 60% bonds @ 1.5% → blended 7.2%
    a.setHoldingComposition("h1", [
      { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
      { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
    ]);
    expect(
      s.state.household.accounts[0].holdings[0].expectedRealCAGR,
    ).toBeCloseTo(0.072, 4);
  });

  it("setting commodity breakdown to null removes it", () => {
    const s = makeFakeStore({
      household: {
        id: "h1",
        members: [{ id: "m1", displayName: "Alex" }],
        accounts: [
          {
            id: "acc1",
            displayName: "x",
            category: "BROKERAGE",
            ownerId: "m1",
            monthlyContributionUSD: 0,
            holdings: [
              {
                kind: "commodity",
                id: "h1",
                symbol: "GLD",
                shares: 10,
                lastPriceUSD: 200,
                lastPricedAt: null,
                isManualPrice: false,
                enteredAsShares: false,
                acquiredAt: null,
                valueUSD: 2000,
                expectedRealCAGR: 0.01,
                breakdown: {
                  metalsShare: 1,
                  metals: { GOLD: 1 } as never,
                  energyAg: {} as never,
                },
              },
            ],
          },
        ],
        liabilities: [],
      },
    });
    const a = createHoldingsActions(s.set);
    a.setHoldingCommodityBreakdown("h1", null);
    expect(
      (s.state.household.accounts[0].holdings[0] as { breakdown?: unknown })
        .breakdown,
    ).toBeUndefined();
  });
});
