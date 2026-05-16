import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { applyScenario, runScenarios } from "@/lib/insights/scenarios";

describe("applyScenario", () => {
  it("multiplies contributions when contributionMultiplier is given", () => {
    const { household: h } = applyScenario(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, {
      contributionMultiplier: 2,
    });
    const totalBefore = DEMO_HOUSEHOLD.accounts.reduce(
      (s, a) => s + a.monthlyContributionUSD,
      0,
    );
    const totalAfter = h.accounts.reduce(
      (s, a) => s + a.monthlyContributionUSD,
      0,
    );
    expect(totalAfter).toBeCloseTo(totalBefore * 2, 2);
  });

  it("adds cagrDelta to every plain (non-composition-wrapper) holding's expected real CAGR", () => {
    // Composition wrappers (NTSX, GDE, etc.) get their blended CAGR
    // re-derived from per-leg deltas — covered in a separate
    // composition-aware suite below. This test pins the simple
    // case: a plain holding's CAGR shifts by exactly cagrDelta.
    const { household: h } = applyScenario(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, {
      cagrDelta: 0.02,
    });
    for (let i = 0; i < DEMO_HOUSEHOLD.accounts.length; i++) {
      const before = DEMO_HOUSEHOLD.accounts[i];
      const after = h.accounts[i];
      for (let j = 0; j < before.holdings.length; j++) {
        const beforeH = before.holdings[j];
        const isWrapper =
          (beforeH.kind === "equity" ||
            beforeH.kind === "bond" ||
            beforeH.kind === "crypto" ||
            beforeH.kind === "commodity") &&
          beforeH.composition != null &&
          beforeH.composition.length > 0;
        if (isWrapper) continue;
        expect(after.holdings[j].expectedRealCAGR).toBeCloseTo(
          beforeH.expectedRealCAGR + 0.02,
          5,
        );
      }
    }
  });

  it("overrides assumptions when supplied", () => {
    const { assumptions: a } = applyScenario(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      {
        withdrawalRate: 0.03,
        targetNetWorthUSD: 5_000_000,
        legacyFloorUSD: 1_000_000,
      },
    );
    expect(a.withdrawalRate).toBe(0.03);
    expect(a.targetNetWorthUSD).toBe(5_000_000);
    expect(a.legacyFloorUSD).toBe(1_000_000);
  });

  it("leaves assumptions untouched when no overrides supplied", () => {
    const { assumptions: a } = applyScenario(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      {},
    );
    expect(a).toEqual(DEMO_ASSUMPTIONS);
  });
});

describe("applyScenario immutability", () => {
  it("does not mutate the baseline household or assumptions (deep)", () => {
    // Full structural snapshot before the call. The previous
    // version of this test only checked `monthlyContributionUSD`
    // and `withdrawalRate` — a regression that mutated, say,
    // `legacyFloorUSD`, `holdings[*].expectedRealCAGR`, or any
    // other field would have passed undetected. With a 3-knob
    // override hitting contributions / CAGR / withdrawal, every
    // touched + adjacent path must stay clean on the originals.
    const householdSnap = structuredClone(DEMO_HOUSEHOLD);
    const assumptionsSnap = structuredClone(DEMO_ASSUMPTIONS);
    applyScenario(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, {
      contributionMultiplier: 5,
      cagrDelta: -0.5,
      withdrawalRate: 0.01,
    });
    expect(DEMO_HOUSEHOLD).toEqual(householdSnap);
    expect(DEMO_ASSUMPTIONS).toEqual(assumptionsSnap);
  });
});

describe("runScenarios", () => {
  it("higher contributions reach Independence sooner than baseline", () => {
    const baseRun = runScenarios(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [
      {
        id: "1",
        name: "Same",
        color: "#000",
        overrides: {},
        createdAt: 0,
      },
    ])[0];
    const aggressive = runScenarios(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [
      {
        id: "2",
        name: "More savings",
        color: "#000",
        overrides: { contributionMultiplier: 1.5 },
        createdAt: 0,
      },
    ])[0];
    expect(aggressive.projection.monthsToIndependence).not.toBeNull();
    expect(baseRun.projection.monthsToIndependence).not.toBeNull();
    expect(aggressive.projection.monthsToIndependence!).toBeLessThan(
      baseRun.projection.monthsToIndependence!,
    );
  });

  it("higher target makes Independence later or unreachable", () => {
    const harder = runScenarios(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [
      {
        id: "h",
        name: "Higher target",
        color: "#000",
        overrides: { targetNetWorthUSD: 10_000_000 },
        createdAt: 0,
      },
    ])[0];
    const baseline = runScenarios(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS, [
      { id: "b", name: "Same", color: "#000", overrides: {}, createdAt: 0 },
    ])[0];
    // Two valid outcomes: (1) target so high that Independence is
    // unreachable inside the projection window — null — or (2)
    // reachable but strictly later than baseline. Anything else
    // (sooner, equal, or baseline unreachable while harder
    // succeeds) is a regression.
    expect(baseline.projection.monthsToIndependence).not.toBeNull();
    if (harder.projection.monthsToIndependence === null) {
      // Outcome (1) — unreachable. Expected when the target is set
      // beyond what the projection horizon can produce.
      return;
    }
    expect(harder.projection.monthsToIndependence).toBeGreaterThan(
      baseline.projection.monthsToIndependence!,
    );
  });
});

describe("applyScenario — composition-aware cagrDelta (Round-1 fix)", () => {
  function ntsxLike(): import("@/lib/types").EquityHolding {
    return {
      kind: "equity",
      id: "ntsx",
      symbol: "NTSX",
      shares: 100,
      lastPriceUSD: 50,
      lastPricedAt: null,
      isManualPrice: false,
      enteredAsShares: false,
      acquiredAt: null,
      valueUSD: 5_000,
      expectedRealCAGR: 0.072,
      leverage: 1.5,
      styleBox: { LARGE_VALUE: 0, LARGE_BLEND: 1, LARGE_GROWTH: 0, MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0, SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0 },
      geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
      composition: [
        { kind: "equity", weight: 0.9, expectedRealCAGR: 0.07 },
        { kind: "bond", weight: 0.6, expectedRealCAGR: 0.015 },
      ],
    };
  }

  it("propagates cagrDelta to each composition leg and re-derives wrapper", () => {
    const memberId = "m1";
    const household: import("@/lib/types").Household = {
      id: "t",
      members: [{ id: memberId, displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "B",
          ownerId: memberId,
          holdings: [ntsxLike()],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_000_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };

    const { household: next } = applyScenario(household, assumptions, {
      cagrDelta: 0.01,
    });
    const h = next.accounts[0].holdings[0];
    if (h.kind !== "equity" || !h.composition) throw new Error("expected composition");
    expect(h.composition[0].expectedRealCAGR).toBeCloseTo(0.08, 5);
    expect(h.composition[1].expectedRealCAGR).toBeCloseTo(0.025, 5);
    // Wrapper re-derives via blend: 0.9 × 8% + 0.6 × 2.5% = 0.087
    expect(h.expectedRealCAGR).toBeCloseTo(0.087, 5);
  });

  it("non-composition holdings still get cagrDelta on the wrapper scalar", () => {
    const memberId = "m1";
    const household: import("@/lib/types").Household = {
      id: "t",
      members: [{ id: memberId, displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "B",
          ownerId: memberId,
          holdings: [
            {
              kind: "equity",
              id: "voo",
              symbol: "VOO",
              shares: 100,
              lastPriceUSD: 500,
              lastPricedAt: null,
              isManualPrice: false,
              enteredAsShares: false,
              acquiredAt: null,
              valueUSD: 50_000,
              expectedRealCAGR: 0.07,
              leverage: 1,
              styleBox: { LARGE_VALUE: 0, LARGE_BLEND: 1, LARGE_GROWTH: 0, MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0, SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0 },
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
          monthlyContributionUSD: 0,
        },
      ],
      liabilities: [],
    };
    const assumptions: import("@/lib/types").Assumptions = {
      targetNetWorthUSD: 1_000_000,
      withdrawalRate: 0.04,
      legacyFloorUSD: 0,
      drawdownHorizonYears: 30,
      expectedInflationRate: 0.03,
    };
    const { household: next } = applyScenario(household, assumptions, {
      cagrDelta: 0.01,
    });
    expect(next.accounts[0].holdings[0].expectedRealCAGR).toBeCloseTo(0.08, 5);
  });
});
