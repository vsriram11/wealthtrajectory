import { describe, expect, it } from "vitest";

import { planBucketFunding } from "./bucketFunding";
import {
  castAccountId,
  castHoldingId,
  castHouseholdId,
  castMemberId,
} from "@/lib/entityIds";
import type { Account, Holding, Household } from "@/lib/types";

const M1 = castMemberId("m1");

function holding(
  partial: Partial<Holding> & { kind: Holding["kind"] },
): Holding {
  const id =
    partial.id ?? castHoldingId(`h-${Math.random().toString(36).slice(2, 8)}`);
  const valueUSD = partial.valueUSD ?? 100_000;
  const expectedRealCAGR =
    "expectedRealCAGR" in partial && partial.expectedRealCAGR != null
      ? partial.expectedRealCAGR
      : 0;
  const acquiredAt =
    "acquiredAt" in partial && partial.acquiredAt !== undefined
      ? partial.acquiredAt
      : null;
  // Spread the partial WITHOUT its `kind` (we set kind explicitly
  // per branch). TS otherwise complains about duplicate-key writes.
  const { kind: _kind, ...partialNoKind } = partial;
  void _kind;
  // Per-kind defaults are spread first; `partialNoKind` overrides
  // last so the caller can selectively replace any field.
  switch (partial.kind) {
    case "equity":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "equity",
        symbol: "SPY",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        leverage: 1,
        styleBox: {
          LARGE_VALUE: 0,
          LARGE_BLEND: 1,
          LARGE_GROWTH: 0,
          MID_VALUE: 0,
          MID_BLEND: 0,
          MID_GROWTH: 0,
          SMALL_VALUE: 0,
          SMALL_BLEND: 0,
          SMALL_GROWTH: 0,
        },
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
        ...partialNoKind,
      };
    case "bond":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "bond",
        symbol: "BND",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        leverage: 1,
        averageDurationYears: 6,
        bondType: { GOVT: 0.5, CORPORATE: 0.5 },
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
        ...partialNoKind,
      };
    case "cash":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        kind: "cash",
        geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
        ...partialNoKind,
      };
    case "real_estate":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "real_estate",
        name: "Home",
        leverage: 1,
        ...partialNoKind,
      };
    case "commodity":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "commodity",
        symbol: "GLD",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        ...partialNoKind,
      };
    case "crypto":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "crypto",
        symbol: "BTC",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        ...partialNoKind,
      };
    case "private_stock":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "private_stock",
        symbol: "STARTUP",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        leverage: 1,
        preferredRoundPricePerShareUSD: null,
        ...partialNoKind,
      };
    case "other":
      return {
        id,
        valueUSD,
        expectedRealCAGR,
        acquiredAt,
        kind: "other",
        name: "Misc",
        ...partialNoKind,
      };
  }
}

function account(
  partial: Pick<Account, "category"> & Partial<Account>,
  holdings: Holding[],
): Account {
  return {
    id: castAccountId(
      `a-${partial.category}-${Math.random().toString(36).slice(2, 6)}`,
    ),
    displayName: `${partial.category}`,
    ownerId: M1,
    monthlyContributionUSD: 0,
    ...partial,
    holdings,
  };
}

function household(accounts: Account[]): Household {
  return {
    id: castHouseholdId("h"),
    members: [{ id: M1, displayName: "Alex" }],
    accounts,
    liabilities: [],
  };
}

describe("planBucketFunding", () => {
  it("requested <= projected: zero amount, zero tax, empty sales", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 100_000, 0.10, 0.05, 0.20);
    expect(plan.amountToRaiseUSD).toBe(0);
    expect(plan.amountRaisedUSD).toBe(0);
    expect(plan.totalTaxOwedUSD).toBe(0);
    expect(plan.perBucket.every((b) => b.faceValueSoldUSD === 0)).toBe(true);
  });

  it("requested > projected: raises the right amount + computes tax", () => {
    // $1M portfolio, 5% cash today, request 25%. Raise $200k.
    // All non-cash is in a BROKERAGE (taxable). gainFraction=1.0,
    // taxRate=20% → tax = $40k.
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 950_000 }),
        holding({ kind: "cash", valueUSD: 50_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 1_000_000, 0.05, 0.25, 0.20);
    expect(plan.amountToRaiseUSD).toBeCloseTo(200_000, 2);
    expect(plan.amountRaisedUSD).toBeCloseTo(200_000, 2);
    expect(plan.totalTaxOwedUSD).toBeCloseTo(40_000, 2);
    expect(plan.shortfallUSD).toBe(0);
  });

  it("sells highest-leverage equity FIRST (3x → 2x → 1x ordering)", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "equity",
          symbol: "TQQQ",
          leverage: 3,
          valueUSD: 100_000,
          id: castHoldingId("h-3x"),
        }),
        holding({
          kind: "equity",
          symbol: "SSO",
          leverage: 2,
          valueUSD: 100_000,
          id: castHoldingId("h-2x"),
        }),
        holding({
          kind: "equity",
          symbol: "SPY",
          leverage: 1,
          valueUSD: 100_000,
          id: castHoldingId("h-1x"),
        }),
      ]),
    ]);
    // Need to raise $150k. Should drain TQQQ (100k) first, then 50k
    // from SSO (2x). 1x SPY untouched.
    const plan = planBucketFunding(hh, 300_000, 0, 0.5, 0.20);
    expect(plan.amountToRaiseUSD).toBeCloseTo(150_000, 2);
    const leveragedBucket = plan.perBucket.find(
      (b) => b.bucket === "leveragedEquity",
    )!;
    expect(leveragedBucket.faceValueSoldUSD).toBeCloseTo(150_000, 2);
    const regularBucket = plan.perBucket.find(
      (b) => b.bucket === "regularEquity",
    )!;
    expect(regularBucket.faceValueSoldUSD).toBe(0);
  });

  it("EXCLUDES primary residence from sales (cannot be sold)", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
        holding({ kind: "cash", valueUSD: 50_000 }),
      ]),
      account({ category: "REAL_ESTATE" }, [
        holding({
          kind: "real_estate",
          valueUSD: 800_000,
          isPrimaryResidence: true,
        }),
      ]),
    ]);
    // Total NW $950k, request bumping cash from ~5% to 50% → raise
    // ~$427k. But only $100k of equity is sellable; primary
    // residence is OFF-LIMITS even though it's $800k of paper value.
    const plan = planBucketFunding(hh, 950_000, 0.05, 0.5, 0.20);
    expect(plan.amountToRaiseUSD).toBeCloseTo(427_500, 1);
    expect(plan.amountRaisedUSD).toBeCloseTo(100_000, 1);
    expect(plan.shortfallUSD).toBeCloseTo(327_500, 1);
    expect(plan.excludedPrimaryResidenceUSD).toBe(800_000);
    expect(plan.excludedIlliquidUSD).toBe(800_000);
  });

  it("EXCLUDES private stock (illiquid by default)", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "private_stock",
          valueUSD: 500_000,
          symbol: "STARTUP",
        }),
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 600_000, 0, 0.5, 0.20);
    // Wants $300k; only equity ($100k) is sellable; private stock
    // $500k is excluded as illiquid.
    expect(plan.amountRaisedUSD).toBeCloseTo(100_000, 1);
    expect(plan.excludedIlliquidUSD).toBe(500_000);
    expect(plan.excludedPrimaryResidenceUSD).toBe(0);
  });

  it("EXCLUDES explicitly-isIlliquid holdings", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        // Manually-flagged illiquid (e.g. friend's startup parked
        // in OTHER, or restricted RSUs).
        holding({
          kind: "other",
          valueUSD: 200_000,
          isIlliquid: true,
        }),
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 300_000, 0, 0.5, 0.20);
    expect(plan.amountRaisedUSD).toBeCloseTo(100_000, 1);
    expect(plan.excludedIlliquidUSD).toBe(200_000);
  });

  it("INCLUDES non-primary real estate (rentals are sellable)", () => {
    const hh = household([
      account({ category: "REAL_ESTATE" }, [
        // Rental (not primary) — should be sellable.
        holding({
          kind: "real_estate",
          valueUSD: 300_000,
          isPrimaryResidence: false,
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 300_000, 0, 0.5, 0.20);
    expect(plan.amountRaisedUSD).toBeCloseTo(150_000, 1);
    expect(plan.excludedPrimaryResidenceUSD).toBe(0);
    const reBucket = plan.perBucket.find((b) => b.bucket === "realEstate")!;
    expect(reBucket.faceValueSoldUSD).toBeCloseTo(150_000, 1);
  });

  it("tax-advantaged accounts contribute ZERO tax (rebalancing is tax-free)", () => {
    const hh = household([
      account({ category: "TRAD_IRA" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
      account({ category: "ROTH_IRA" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
      account({ category: "HSA" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 300_000, 0, 0.5, 0.20);
    expect(plan.amountRaisedUSD).toBeCloseTo(150_000, 1);
    expect(plan.totalTaxOwedUSD).toBe(0);
  });

  it("WITHIN same leverage tier, prefers tax-advantaged FIRST (minimize tax)", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        // Taxable 1x equity — should be drained LAST within the tier.
        holding({
          kind: "equity",
          leverage: 1,
          valueUSD: 100_000,
          id: castHoldingId("h-tax-1x"),
        }),
      ]),
      account({ category: "TRAD_IRA" }, [
        // Tax-advantaged 1x equity — should be drained FIRST.
        holding({
          kind: "equity",
          leverage: 1,
          valueUSD: 100_000,
          id: castHoldingId("h-ira-1x"),
        }),
      ]),
    ]);
    // Raise $80k — comes entirely from IRA → zero tax.
    const plan = planBucketFunding(hh, 200_000, 0, 0.4, 0.20);
    expect(plan.amountRaisedUSD).toBeCloseTo(80_000, 1);
    expect(plan.totalTaxOwedUSD).toBeCloseTo(0, 1);
  });

  it("primary leverage rule TRUMPS account-type optimization", () => {
    // User explicitly said "highest leverage first" — so taxable
    // 3x is sold BEFORE tax-advantaged 1x even though the tax-
    // advantaged path is cheaper.
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "equity",
          symbol: "TQQQ",
          leverage: 3,
          valueUSD: 100_000,
          id: castHoldingId("h-tax-3x"),
        }),
      ]),
      account({ category: "TRAD_IRA" }, [
        holding({
          kind: "equity",
          leverage: 1,
          valueUSD: 100_000,
          id: castHoldingId("h-ira-1x"),
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 200_000, 0, 0.5, 0.20);
    const lev = plan.perBucket.find((b) => b.bucket === "leveragedEquity")!;
    expect(lev.faceValueSoldUSD).toBeCloseTo(100_000, 1);
    expect(lev.taxOwedUSD).toBeCloseTo(20_000, 1); // 100k × 1.0 × 0.2
  });

  it("sale-priority order: equity > bonds > commodity > RE > other", () => {
    // One holding of each type, $100k each, all in taxable. Need
    // $250k → drains 1x equity ($100k), then bonds ($100k), then
    // 50k of commodity.
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
        holding({ kind: "bond", valueUSD: 100_000 }),
        holding({ kind: "commodity", valueUSD: 100_000 }),
        holding({ kind: "real_estate", valueUSD: 100_000 }),
        holding({ kind: "crypto", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 500_000, 0, 0.5, 0.20);
    expect(plan.amountToRaiseUSD).toBeCloseTo(250_000, 1);
    expect(
      plan.perBucket.find((b) => b.bucket === "regularEquity")!
        .faceValueSoldUSD,
    ).toBeCloseTo(100_000, 1);
    expect(
      plan.perBucket.find((b) => b.bucket === "bonds")!.faceValueSoldUSD,
    ).toBeCloseTo(100_000, 1);
    expect(
      plan.perBucket.find((b) => b.bucket === "commodity")!.faceValueSoldUSD,
    ).toBeCloseTo(50_000, 1);
    expect(
      plan.perBucket.find((b) => b.bucket === "realEstate")!.faceValueSoldUSD,
    ).toBe(0);
    expect(
      plan.perBucket.find((b) => b.bucket === "otherAlts")!.faceValueSoldUSD,
    ).toBe(0);
  });

  it("gainFraction parameter scales the tax (default 1.0)", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const full = planBucketFunding(hh, 100_000, 0, 1.0, 0.20, 1.0);
    const half = planBucketFunding(hh, 100_000, 0, 1.0, 0.20, 0.5);
    expect(full.totalTaxOwedUSD).toBeCloseTo(20_000, 1);
    expect(half.totalTaxOwedUSD).toBeCloseTo(10_000, 1);
  });

  it("retirementTaxRate is clamped to [0, 0.99]", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const negative = planBucketFunding(hh, 100_000, 0, 1.0, -0.5, 1.0);
    expect(negative.totalTaxOwedUSD).toBe(0);
    const tooHigh = planBucketFunding(hh, 100_000, 0, 1.0, 5.0, 1.0);
    // Clamped to 0.99 → tax ≈ $99k on $100k sale at full gain.
    expect(tooHigh.totalTaxOwedUSD).toBeCloseTo(99_000, 1);
  });

  it("shortfall when sellable portfolio < amount-to-raise", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 50_000 }),
      ]),
      account({ category: "REAL_ESTATE" }, [
        holding({
          kind: "real_estate",
          valueUSD: 950_000,
          isPrimaryResidence: true,
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 1_000_000, 0, 0.5, 0.20);
    expect(plan.amountToRaiseUSD).toBeCloseTo(500_000, 1);
    expect(plan.amountRaisedUSD).toBeCloseTo(50_000, 1);
    expect(plan.shortfallUSD).toBeCloseTo(450_000, 1);
  });

  it("NaN/Infinity inputs degrade to a zero-amount plan", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(
      hh,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
    );
    expect(plan.amountToRaiseUSD).toBe(0);
    expect(plan.totalTaxOwedUSD).toBe(0);
  });

  it("requestedCashFraction clamped to [0, 1]", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 100_000 }),
      ]),
    ]);
    const above1 = planBucketFunding(hh, 100_000, 0, 1.5, 0.20);
    // Clamped to 1.0 → amountToRaise = 100k. Only $100k sellable
    // → raised = 100k, no shortfall.
    expect(above1.amountToRaiseUSD).toBeCloseTo(100_000, 1);
    expect(above1.amountRaisedUSD).toBeCloseTo(100_000, 1);

    const below0 = planBucketFunding(hh, 100_000, 0.05, -0.2, 0.20);
    // Clamped to 0 — requested < projected → zero plan.
    expect(below0.amountToRaiseUSD).toBe(0);
  });

  it("mixed taxable + tax-advantaged for the SAME holding kind: tax is on the taxable share only", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", leverage: 1, valueUSD: 200_000 }),
      ]),
      account({ category: "TRAD_IRA" }, [
        holding({ kind: "equity", leverage: 1, valueUSD: 200_000 }),
      ]),
    ]);
    // Raise $200k. Sorted order: IRA-1x (tax-advantaged first within
    // same leverage tier) gets drained FIRST → 200k from IRA, 0 from
    // brokerage. Tax = 0.
    const plan = planBucketFunding(hh, 400_000, 0, 0.5, 0.20);
    expect(plan.amountRaisedUSD).toBeCloseTo(200_000, 1);
    expect(plan.totalTaxOwedUSD).toBe(0);
  });

  it("perBucket array preserves the canonical priority order regardless of fill", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "bond", valueUSD: 100_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 100_000, 0, 0.5, 0.20);
    expect(plan.perBucket.map((b) => b.bucket)).toEqual([
      "leveragedEquity",
      "regularEquity",
      "bonds",
      "commodity",
      "realEstate",
      "otherAlts",
    ]);
  });

  it("short-duration bonds (≤ 1yr) count as CASH-EQUIVALENT (not sold to fund bucket)", () => {
    // User has 5% cash + 20% short-duration bonds + 75% equity.
    // Requesting 25% cash bucket = exactly the cash + short-bond
    // total. Tax should be ZERO — short bonds ARE the buffer.
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 750_000 }),
        holding({
          kind: "bond",
          averageDurationYears: 0.5, // 6mo T-bills
          valueUSD: 200_000,
        }),
        holding({ kind: "cash", valueUSD: 50_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 1_000_000, 0.05, 0.25, 0.20);
    expect(plan.shortDurationBondUSD).toBe(200_000);
    expect(plan.effectiveCashEquivalentShare).toBeCloseTo(0.25, 6);
    expect(plan.amountToRaiseUSD).toBeCloseTo(0, 1);
    expect(plan.totalTaxOwedUSD).toBe(0);
    expect(plan.sales).toHaveLength(0);
  });

  it("short bonds reduce amountToRaise but don't eliminate it when bucket request exceeds the buffer", () => {
    // Cash 5% + short bonds 10% = 15% cash-equivalent. Request 25%
    // → need to raise the missing 10% ($100k on $1M).
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({ kind: "equity", valueUSD: 850_000 }),
        holding({
          kind: "bond",
          averageDurationYears: 1,
          valueUSD: 100_000,
        }),
        holding({ kind: "cash", valueUSD: 50_000 }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 1_000_000, 0.05, 0.25, 0.20);
    expect(plan.shortDurationBondUSD).toBe(100_000);
    expect(plan.effectiveCashEquivalentShare).toBeCloseTo(0.15, 6);
    expect(plan.amountToRaiseUSD).toBeCloseTo(100_000, 1);
    expect(plan.totalTaxOwedUSD).toBeCloseTo(20_000, 1);
  });

  it("LONG-duration bonds (>1yr) are NOT cash-equivalent — they go in the sale priority list", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "bond",
          averageDurationYears: 7,
          valueUSD: 100_000,
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 100_000, 0, 0.5, 0.20);
    expect(plan.shortDurationBondUSD).toBe(0);
    // The bond IS sold to fund the bucket.
    expect(plan.amountRaisedUSD).toBeCloseTo(50_000, 1);
    const bondsBucket = plan.perBucket.find((b) => b.bucket === "bonds")!;
    expect(bondsBucket.faceValueSoldUSD).toBeCloseTo(50_000, 1);
  });

  it("excludeFromCashBucketSale flag honors the user's opt-out", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        // User wants to keep this holding (e.g. long-held high-
        // conviction position with a huge cost-basis gap).
        holding({
          kind: "equity",
          valueUSD: 200_000,
          excludeFromCashBucketSale: true,
          id: castHoldingId("h-opt-out"),
        }),
        holding({
          kind: "equity",
          valueUSD: 200_000,
          id: castHoldingId("h-sellable"),
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 400_000, 0, 0.5, 0.20);
    expect(plan.excludedUserOptOutUSD).toBe(200_000);
    // Amount to raise = $200k. Only h-sellable is available — gets
    // drained entirely.
    expect(plan.amountRaisedUSD).toBeCloseTo(200_000, 1);
    // h-opt-out NOT in the sales list.
    expect(plan.sales.find((s) => s.holdingId === "h-opt-out")).toBeUndefined();
  });

  it("excludeFromCashBucketSale prevents a holding from appearing in candidates at all", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "equity",
          valueUSD: 100_000,
          excludeFromCashBucketSale: true,
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 100_000, 0, 0.5, 0.20);
    expect(plan.sales).toHaveLength(0);
    // The opt-out is the ONLY potential sale; with it excluded,
    // shortfall is the full amount-to-raise.
    expect(plan.shortfallUSD).toBeCloseTo(50_000, 1);
  });

  it("sales list is sorted by sale priority (leverage desc) for stable UI display", () => {
    const hh = household([
      account({ category: "BROKERAGE" }, [
        holding({
          kind: "equity",
          symbol: "SPY",
          leverage: 1,
          valueUSD: 100_000,
          id: castHoldingId("h-1x"),
        }),
        holding({
          kind: "equity",
          symbol: "TQQQ",
          leverage: 3,
          valueUSD: 100_000,
          id: castHoldingId("h-3x"),
        }),
        holding({
          kind: "equity",
          symbol: "SSO",
          leverage: 2,
          valueUSD: 100_000,
          id: castHoldingId("h-2x"),
        }),
      ]),
    ]);
    const plan = planBucketFunding(hh, 300_000, 0, 0.99, 0.20);
    // Should sell all three. Sorted by leverage desc: TQQQ → SSO → SPY.
    expect(plan.sales.map((s) => s.label)).toEqual(["TQQQ", "SSO", "SPY"]);
  });
});
