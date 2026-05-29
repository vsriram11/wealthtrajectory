import { describe, expect, it } from "vitest";
import { buildDemoSnapshots, __testHooks } from "./demoSnapshots";
import { holdingClass, householdNetWorth } from "./types";

const NOW = Date.UTC(2026, 4, 29, 12); // 2026-05-29 noon UTC

describe("buildDemoSnapshots", () => {
  it("returns 60 snapshots by default, oldest first, newest last", () => {
    const snaps = buildDemoSnapshots(NOW);
    expect(snaps).toHaveLength(60);
    // Sorted ascending by t.
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i].t).toBeGreaterThan(snaps[i - 1].t);
    }
  });

  it("anchors each snapshot to first-of-month at noon UTC (matches monthly-auto policy)", () => {
    const snaps = buildDemoSnapshots(NOW);
    for (const s of snaps) {
      const d = new Date(s.t);
      expect(d.getUTCDate()).toBe(1);
      expect(d.getUTCHours()).toBe(12);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  it("newest snapshot anchors to the current calendar month at first-of-month noon UTC", () => {
    const snaps = buildDemoSnapshots(NOW);
    const newest = snaps[snaps.length - 1];
    expect(newest.t).toBe(Date.UTC(2026, 4, 1, 12, 0, 0, 0)); // 2026-05-01 noon
  });

  it("oldest snapshot is 59 months before the newest (5-year window)", () => {
    const snaps = buildDemoSnapshots(NOW);
    expect(snaps[0].t).toBe(Date.UTC(2021, 5, 1, 12, 0, 0, 0)); // 2021-06-01 noon
  });

  it("each snapshot carries a full household + appState (per-member views work historically)", () => {
    const snaps = buildDemoSnapshots(NOW);
    for (const s of snaps) {
      expect(s.household).toBeDefined();
      expect(s.household!.members.length).toBeGreaterThan(0);
      expect(s.household!.accounts.length).toBeGreaterThan(0);
      expect(s.appState).toBeDefined();
      expect(s.appState!.assumptions).toBeDefined();
      expect(s.appState!.budgetItems).toBeDefined();
    }
  });

  it("net worth at newest snapshot ≈ today's DEMO_HOUSEHOLD net worth (factor=1 at monthsAgo=0)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const newest = snaps[snaps.length - 1];
    // Engine asserts classBackFactor(monthsAgo=0)=1, so the
    // newest snapshot equals DEMO_HOUSEHOLD exactly.
    const expected = householdNetWorth(newest.household!);
    expect(newest.netWorthUSD).toBe(expected);
  });

  it("net worth trends generally upward over the 5-year window (back-cast values are lower)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const oldest = snaps[0];
    const newest = snaps[snaps.length - 1];
    // Allow for some noise but the back-cast trajectory should
    // be meaningfully lower than today.
    expect(oldest.netWorthUSD).toBeLessThan(newest.netWorthUSD * 0.9);
  });

  it("is deterministic — same `now` produces identical snapshot values across calls", () => {
    const a = buildDemoSnapshots(NOW);
    const b = buildDemoSnapshots(NOW);
    expect(a.map((s) => s.netWorthUSD)).toEqual(b.map((s) => s.netWorthUSD));
    expect(a.map((s) => s.t)).toEqual(b.map((s) => s.t));
  });

  it("liabilities are NOT back-scaled (kept identical across the timeline)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const oldestLiab = snaps[0].household!.liabilities;
    const newestLiab = snaps[snaps.length - 1].household!.liabilities;
    expect(oldestLiab).toEqual(newestLiab);
  });

  it("preserves per-member ownership chains across the timeline (account.ownerId stable)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const newestOwners = snaps[snaps.length - 1].household!.accounts.map(
      (a) => a.ownerId,
    );
    const oldestOwners = snaps[0].household!.accounts.map((a) => a.ownerId);
    expect(oldestOwners).toEqual(newestOwners);
  });

  it("preserves holding ids across the timeline (per-position CAGR queries work)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const idsFromSnap = (i: number) =>
      snaps[i].household!.accounts.flatMap((a) =>
        a.holdings.map((h) => h.id),
      );
    expect(idsFromSnap(0)).toEqual(idsFromSnap(snaps.length - 1));
  });

  it("returns empty array for months <= 0 (degenerate input safety)", () => {
    expect(buildDemoSnapshots(NOW, 0)).toEqual([]);
    expect(buildDemoSnapshots(NOW, -5)).toEqual([]);
  });

  it("respects a custom months parameter (12 months → 12 snapshots)", () => {
    const snaps = buildDemoSnapshots(NOW, 12);
    expect(snaps).toHaveLength(12);
  });

  it("appState.targetAllocation drifts across the timeline (more aggressive in the past)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const past = snaps[0].appState!.targetAllocation!;
    const today = snaps[snaps.length - 1].appState!.targetAllocation!;
    // Realistic arc: equity was less heavy 5 years ago, bond
    // weight was higher. Today's target is more equity-tilted.
    expect(past.equity!).toBeLessThan(today.equity!);
    expect(past.bond!).toBeGreaterThan(today.bond!);
    // Every per-class weight should be finite, non-negative,
    // and the total should sum to 1 (within float tolerance).
    for (const cls of Object.keys(today)) {
      expect(Number.isFinite(today[cls as keyof typeof today]!)).toBe(true);
      expect(today[cls as keyof typeof today]!).toBeGreaterThanOrEqual(0);
    }
    const totalToday = Object.values(today).reduce((s, v) => s + (v ?? 0), 0);
    expect(totalToday).toBeCloseTo(1, 6);
  });

  it("appState.householdAnnualIncomeUSD trends up over the timeline (modeled comp growth)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const past = snaps[0].appState!.householdAnnualIncomeUSD!;
    const today = snaps[snaps.length - 1].appState!.householdAnnualIncomeUSD!;
    expect(past).toBeLessThan(today);
    // Ratio should be in the "plausible compensation growth"
    // band (between 1.3x and 2.0x over 5 years).
    expect(today / past).toBeGreaterThan(1.3);
    expect(today / past).toBeLessThan(2.0);
  });
});

describe("classBackFactor (internal — drawdown + growth math)", () => {
  const { classBackFactor } = __testHooks;

  it("returns 1 at monthsAgo=0 (today)", () => {
    expect(classBackFactor("equity", 0)).toBe(1);
    expect(classBackFactor("crypto", 0)).toBe(1);
    expect(classBackFactor("cash", 0)).toBe(1);
  });

  it("compounds DOWN with monthsAgo for positive-growth classes", () => {
    // Past values are lower than today (averaged over the noise).
    // Take a small sample at monthsAgo=12, 36 and verify direction.
    const e0 = classBackFactor("equity", 0);
    const e36 = classBackFactor("equity", 36);
    expect(e36).toBeLessThan(e0);
  });

  it("applies a drawdown dip near monthsAgo=24 (bell envelope)", () => {
    // Crypto has DRAWDOWN_DEPTH 0.65 → there should be a visible
    // dip at monthsAgo=24 relative to monthsAgo=12.
    const c12 = classBackFactor("crypto", 12);
    const c24 = classBackFactor("crypto", 24);
    // c24 is ~1 drawdown-window below the smooth trajectory, so
    // it should be meaningfully less than the value 12 months
    // later (closer to today) which is past the drawdown.
    expect(c24).toBeLessThan(c12);
  });
});

describe("classBackFactor — defensive bounds", () => {
  const { classBackFactor } = __testHooks;

  it("never produces a negative back-factor even with extreme inputs", () => {
    // Sample widely across all classes — the engine's Math.max
    // floor at 0.01 should prevent negatives.
    const classes = [
      "equity",
      "bond",
      "cash",
      "crypto",
      "commodity",
      "real_estate",
      "private_stock",
      "other",
    ] as const;
    for (const cls of classes) {
      for (let m = 0; m <= 60; m++) {
        const f = classBackFactor(cls, m);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(f)).toBe(true);
      }
    }
  });
});

describe("AssetClass coverage — all classes seen in snapshots produce real values", () => {
  it("every holding in every snapshot has a finite, non-negative valueUSD", () => {
    const snaps = buildDemoSnapshots(NOW);
    for (const s of snaps) {
      for (const a of s.household!.accounts) {
        for (const h of a.holdings) {
          expect(Number.isFinite(h.valueUSD)).toBe(true);
          expect(h.valueUSD).toBeGreaterThanOrEqual(0);
          // holdingClass should resolve cleanly.
          const cls = holdingClass(h);
          expect(typeof cls).toBe("string");
        }
      }
    }
  });
});
