import { describe, expect, it } from "vitest";

import {
  DEMO_HOUSEHOLD,
  DEMO_ASSUMPTIONS,
  isDemoHouseholdStrict,
} from "./demo";
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

describe("isDemoHouseholdStrict", () => {
  // The sync layer (AuthHydrator initial push, CloudSyncer auto-
  // push, pushToDrive) uses this signal to refuse uploading a
  // verbatim demo seed over real Drive data. False positives push
  // the demo seed and overwrite the user's real backup; false
  // negatives leave demo data sitting in Drive forever. Pin both
  // directions tightly.

  it("returns true for the unmodified DEMO_HOUSEHOLD seed", () => {
    expect(isDemoHouseholdStrict(DEMO_HOUSEHOLD)).toBe(true);
  });

  it("returns true after PriceRefresher-style holding price drift", () => {
    // Holdings get their `valueUSD` mutated on every price refresh.
    // That must NOT count as user customization — otherwise a fresh
    // tab that just refreshed prices would push the seed to Drive.
    const drifted: typeof DEMO_HOUSEHOLD = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) =>
          "valueUSD" in h ? { ...h, valueUSD: h.valueUSD * 1.05 } : h,
        ),
      })),
    };
    expect(isDemoHouseholdStrict(drifted)).toBe(true);
  });

  it("returns false when a member is renamed", () => {
    // The user's framing: if they haven't even changed Alex/Sam to
    // their own names, it's clearly still demo data.
    const renamed = {
      ...DEMO_HOUSEHOLD,
      members: DEMO_HOUSEHOLD.members.map((m, i) =>
        i === 0 ? { ...m, displayName: "Alexis" } : m,
      ),
    };
    expect(isDemoHouseholdStrict(renamed)).toBe(false);
  });

  it("returns false when a member's age changes", () => {
    const aged = {
      ...DEMO_HOUSEHOLD,
      members: DEMO_HOUSEHOLD.members.map((m, i) =>
        i === 0 ? { ...m, age: (m.age ?? 0) + 1 } : m,
      ),
    };
    expect(isDemoHouseholdStrict(aged)).toBe(false);
  });

  it("returns false when a member's incomeUSD changes", () => {
    const reincomed = {
      ...DEMO_HOUSEHOLD,
      members: DEMO_HOUSEHOLD.members.map((m, i) =>
        i === 0 ? { ...m, incomeUSD: (m.incomeUSD ?? 0) + 1_000 } : m,
      ),
    };
    expect(isDemoHouseholdStrict(reincomed)).toBe(false);
  });

  it("returns false when an account is renamed", () => {
    const renamed = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.map((a, i) =>
        i === 0 ? { ...a, displayName: a.displayName + " (joint)" } : a,
      ),
    };
    expect(isDemoHouseholdStrict(renamed)).toBe(false);
  });

  it("returns false when an account is added", () => {
    const added = {
      ...DEMO_HOUSEHOLD,
      accounts: [...DEMO_HOUSEHOLD.accounts, DEMO_HOUSEHOLD.accounts[0]],
    };
    expect(isDemoHouseholdStrict(added)).toBe(false);
  });

  it("returns false when a holding is added to an account", () => {
    const added = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.map((a, i) =>
        i === 0
          ? { ...a, holdings: [...a.holdings, a.holdings[0]] }
          : a,
      ),
    };
    expect(isDemoHouseholdStrict(added)).toBe(false);
  });

  it("returns false when household ID is rewritten", () => {
    const idChanged = { ...DEMO_HOUSEHOLD, id: "user-household-1" };
    expect(isDemoHouseholdStrict(idChanged)).toBe(false);
  });

  it("returns false for an empty household", () => {
    expect(
      isDemoHouseholdStrict({
        id: "anything",
        members: [],
        accounts: [],
        liabilities: [],
      }),
    ).toBe(false);
  });

  // Audit R3 (Layer 1/2/3): the pre-fix strict-demo check only
  // compared liability/holding ARRAY LENGTHS — never individual
  // field values within them. That left several legitimate user
  // customizations undetected, silently blocking the user's edits
  // from being pushed to Drive (CloudSyncer gate trips, no push,
  // no UX indication that sync is stuck).

  it("returns false when an account's monthlyContributionUSD is edited", () => {
    // Pre-fix: a user who bumps their 401k contribution from $1958
    // → $2000/mo (most-common edit during a salary review) was
    // still strict-demo. CloudSyncer skipped the push; the edit
    // stayed local-only forever.
    const customized = {
      ...DEMO_HOUSEHOLD,
      accounts: DEMO_HOUSEHOLD.accounts.map((a, i) =>
        i === 0
          ? { ...a, monthlyContributionUSD: a.monthlyContributionUSD + 42 }
          : a,
      ),
    };
    expect(isDemoHouseholdStrict(customized)).toBe(false);
  });

  it("returns false when a liability balance is edited", () => {
    // Pre-fix: paying down student loan / auto loan / credit card
    // counted as customization in spirit, but only the count was
    // checked. A user who edits balances to reflect their actual
    // debt was still strict-demo from the check's perspective.
    const customized = {
      ...DEMO_HOUSEHOLD,
      liabilities: DEMO_HOUSEHOLD.liabilities.map((l, i) =>
        i === 0 ? { ...l, balanceUSD: l.balanceUSD - 1_000 } : l,
      ),
    };
    expect(isDemoHouseholdStrict(customized)).toBe(false);
  });

  it("returns false when a liability is renamed", () => {
    const customized = {
      ...DEMO_HOUSEHOLD,
      liabilities: DEMO_HOUSEHOLD.liabilities.map((l, i) =>
        i === 0 ? { ...l, name: l.name + " (paid off)" } : l,
      ),
    };
    expect(isDemoHouseholdStrict(customized)).toBe(false);
  });

  it("returns false when a liability is replaced with a different one (same count)", () => {
    // Edge: user deletes the demo auto loan and adds their own
    // personal loan. Count stays at 3 — pre-fix this looked
    // identical to the seed.
    const customized = {
      ...DEMO_HOUSEHOLD,
      liabilities: DEMO_HOUSEHOLD.liabilities.map((l, i) =>
        i === 0
          ? {
              ...l,
              id: "user-personal-loan",
              name: "Personal loan",
              balanceUSD: 5_000,
            }
          : l,
      ),
    };
    expect(isDemoHouseholdStrict(customized)).toBe(false);
  });
});
