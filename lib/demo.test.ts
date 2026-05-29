import { describe, expect, it } from "vitest";

import { DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS } from "./demo";
import { householdNetWorth } from "./types";

/**
 * Round-4 (audit R4) regression tests for the demo seed data. The
 * audit caught a $930k self-inflicted NW understatement (real-estate
 * equity holdings tracked correctly per the `RealEstateHolding`
 * convention, BUT the mortgage was ALSO entered as a separate
 * liability, double-counting the debt against NW). These tests pin
 * the no-double-count invariant so future demo-data edits can't
 * silently reintroduce the bug.
 */
describe("DEMO_HOUSEHOLD — no liability double-counts real-estate equity", () => {
  it("for every levered real_estate holding, no Liability has a name matching /mortgage/i", () => {
    // The convention (lib/types.ts:481+): `valueUSD` on a
    // real_estate holding stores EQUITY (net of mortgage), and the
    // `leverage` field captures the gross-vs-equity ratio. So a
    // mortgage MUST NOT be entered as a separate liability for any
    // property already tracked as a levered equity holding —
    // otherwise the debt is subtracted twice from NW.
    const realEstateHoldings = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings.map((h) => ({ h, ownerId: a.ownerId })))
      .filter((row) => row.h.kind === "real_estate");

    if (realEstateHoldings.length === 0) return; // no RE → nothing to check

    const mortgageLiabilities = DEMO_HOUSEHOLD.liabilities.filter((l) =>
      /mortgage/i.test(l.name),
    );

    for (const { h, ownerId } of realEstateHoldings) {
      if (h.kind !== "real_estate") continue;
      if (h.leverage <= 1) continue; // owned outright — mortgage liability is fine
      // No mortgage-named liability may share the same owner as a
      // levered RE holding.
      const conflicting = mortgageLiabilities.filter(
        (l) => l.ownerId === ownerId,
      );
      expect(conflicting).toEqual([]);
    }
  });

  it("demo NW is positive (sanity)", () => {
    const nw = householdNetWorth(DEMO_HOUSEHOLD);
    expect(nw).toBeGreaterThan(0);
  });

  it("demo has at least one real_estate holding to exercise the leverage cascade", () => {
    const reCount = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings)
      .filter((h) => h.kind === "real_estate").length;
    expect(reCount).toBeGreaterThan(0);
  });

  it("demo exercises multi-member rollup (more than one member)", () => {
    expect(DEMO_HOUSEHOLD.members.length).toBeGreaterThan(1);
  });

  it("demo assumptions object is consistent (target > 0, withdrawal rate in [0, 1])", () => {
    expect(DEMO_ASSUMPTIONS.targetNetWorthUSD).toBeGreaterThan(0);
    expect(DEMO_ASSUMPTIONS.withdrawalRate).toBeGreaterThan(0);
    expect(DEMO_ASSUMPTIONS.withdrawalRate).toBeLessThanOrEqual(1);
  });

  it("HSA monthly contribution reflects the 2025 family HDHP limit (~$712.50/mo)", () => {
    // R5 demo audit pin: previously $350/mo (self-only-ish) silently
    // halved the demo's HSA-as-stealth-IRA story. Family HDHP HSA
    // limit for 2025 is $8,550/yr → $712.50/mo. We allow some range
    // so a future indexing tick (~$8,750 in 2026, etc.) doesn't
    // force test churn, but enforce that we're not back at the
    // pre-fix $350.
    const hsa = DEMO_HOUSEHOLD.accounts.find((a) => a.category === "HSA");
    expect(hsa).toBeDefined();
    expect(hsa!.monthlyContributionUSD).toBeGreaterThanOrEqual(700);
    expect(hsa!.monthlyContributionUSD).toBeLessThanOrEqual(800);
  });

  it("at least one demo holding sets excludeFromCashBucketSale (feature showcase)", () => {
    // R5 demo audit pin: the opt-out flag was previously not
    // exercised anywhere in the demo, so a new user touring the
    // showcase never saw the "user opt-out" bucket in the tax-impact
    // panel. Pin that at least one holding opts out so a future demo
    // edit that strips the flag is caught.
    const optedOut = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings)
      .filter(
        (h) =>
          "excludeFromCashBucketSale" in h &&
          h.excludeFromCashBucketSale === true,
      );
    expect(optedOut.length).toBeGreaterThan(0);
  });
});
