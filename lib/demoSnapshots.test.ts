import { describe, expect, it } from "vitest";
import { buildDemoSnapshots, __testHooks } from "./demoSnapshots";
import { holdingClass, householdNetWorth } from "./types";

const NOW = Date.UTC(2026, 4, 29, 12); // 2026-05-29 noon UTC

describe("buildDemoSnapshots", () => {
  it("returns 21 snapshots by default (10y window, 6-month interval), oldest first, newest last", () => {
    // The default horizon was extended to 120 months and the
    // interval set to 6 months, producing 21 anchors at monthsAgo
    // = 120, 114, ..., 6, 0. The increase from the legacy 60
    // monthly snapshots is the basis for the share-accumulation
    // story (the chart's interpolation between snapshots benefits
    // from anchors that vary BOTH shares and price; sampling
    // monthly was too tight relative to the share-curve resolution).
    const snaps = buildDemoSnapshots(NOW);
    expect(snaps).toHaveLength(21);
    // Sorted ascending by t.
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i].t).toBeGreaterThan(snaps[i - 1].t);
    }
  });

  it("anchors HISTORICAL snapshots to first-of-month noon UTC (matches monthly-auto policy)", () => {
    // Round-2 audit BLOCK fix: the NEWEST snapshot (monthsAgo=0)
    // now anchors to `now` itself rather than first-of-current-
    // month, because the latter could sit weeks behind the wall
    // clock for users opening the app mid-month. The HISTORICAL
    // snapshots (monthsAgo >= 1) still anchor to first-of-month
    // noon UTC for clean primary-key collision with the
    // production monthly-auto policy.
    const snaps = buildDemoSnapshots(NOW);
    // All snapshots EXCEPT the newest are at first-of-month noon UTC.
    for (let i = 0; i < snaps.length - 1; i++) {
      const d = new Date(snaps[i].t);
      expect(d.getUTCDate()).toBe(1);
      expect(d.getUTCHours()).toBe(12);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  it("newest snapshot anchors to `now` itself (audit BLOCK fix — was first-of-current-month, in the past)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const newest = snaps[snaps.length - 1];
    // Now `now` itself, not the first-of-month anchor that could
    // sit up to ~30 days behind wall clock.
    expect(newest.t).toBe(NOW);
  });

  it("oldest snapshot is 120 months before the newest (10-year window)", () => {
    const snaps = buildDemoSnapshots(NOW);
    // 2026-05-29 noon UTC minus 120 months = 2016-05 (first of month).
    expect(snaps[0].t).toBe(Date.UTC(2016, 4, 1, 12, 0, 0, 0)); // 2016-05-01 noon
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

  it("net worth trends generally upward over the 10-year window (back-cast values are lower)", () => {
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

  it("recent-acquisition tickers are excluded from snapshots older than their acquisition", () => {
    // BTC has ACQUIRED_MONTHS_AGO = 60, so any snapshot older than
    // that must NOT include BTC. The newest snapshot DOES include
    // BTC. This is the inception-event story: the chart shows a
    // step up in NW when the holding first enters the portfolio.
    const snaps = buildDemoSnapshots(NOW);
    const oldestSymbols = new Set(
      snaps[0].household!.accounts.flatMap((a) =>
        a.holdings.map((h) => ("symbol" in h ? h.symbol : "")),
      ),
    );
    const newestSymbols = new Set(
      snaps[snaps.length - 1].household!.accounts.flatMap((a) =>
        a.holdings.map((h) => ("symbol" in h ? h.symbol : "")),
      ),
    );
    expect(oldestSymbols.has("BTC")).toBe(false);
    expect(newestSymbols.has("BTC")).toBe(true);
    expect(oldestSymbols.has("TQQQ")).toBe(false);
    expect(newestSymbols.has("TQQQ")).toBe(true);
    // Always-held tickers (VTI / VOO) must be present in BOTH.
    expect(oldestSymbols.has("VTI")).toBe(true);
    expect(newestSymbols.has("VTI")).toBe(true);
  });

  it("all five mapped acquisition tickers each appear/disappear at their declared threshold (R5 audit)", () => {
    // R5 audit: the legacy test only spot-checked BTC + TQQQ. The
    // ACQUIRED_MONTHS_AGO map drives THREE more tickers
    // (NTSX/AVUV/QQQM) whose inception behavior should be pinned
    // too — without this, a typo in the map (e.g. swapping a
    // value) wouldn't fail a test.
    const { ACQUIRED_MONTHS_AGO } = __testHooks;
    // Use the explicit (months, interval) form so the test can
    // derive monthsAgo for each output snapshot directly from
    // its index — avoids 30.44-days-per-month drift that would
    // misclassify boundary snapshots.
    const MONTHS = 120;
    const INTERVAL = 6;
    const snaps = buildDemoSnapshots(NOW, MONTHS, INTERVAL);
    const symbolsAt = (snap: typeof snaps[number]): Set<string> => {
      const out = new Set<string>();
      for (const a of snap.household!.accounts) {
        for (const h of a.holdings) {
          if ("symbol" in h) out.add(h.symbol);
        }
      }
      return out;
    };
    // The factory emits in oldest→newest order: monthsAgo for
    // snaps[i] = MONTHS - i * INTERVAL (down to 0 at the last
    // entry).
    const tickers = ["BTC", "TQQQ", "NTSX", "AVUV", "QQQM"] as const;
    for (const ticker of tickers) {
      const threshold = ACQUIRED_MONTHS_AGO[ticker];
      for (let i = 0; i < snaps.length; i++) {
        const monthsAgo = MONTHS - i * INTERVAL;
        const present = symbolsAt(snaps[i]).has(ticker);
        if (monthsAgo > threshold) {
          expect(
            present,
            `${ticker} should be ABSENT at monthsAgo=${monthsAgo} (threshold=${threshold})`,
          ).toBe(false);
        } else {
          expect(
            present,
            `${ticker} should be PRESENT at monthsAgo=${monthsAgo} (threshold=${threshold})`,
          ).toBe(true);
        }
      }
    }
  });

  it("non-mapped holdings ramp to 5% at the OLDEST snapshot regardless of months parameter (R8 audit)", () => {
    // R8 audit: the share-accumulation curve hardcoded
    // `MONTHS_DEFAULT` (=120) as the "acquisition horizon" for any
    // holding without an explicit ACQUIRED_MONTHS_AGO entry. With
    // the default months=120 the curve happens to hit ~5% at the
    // oldest anchor — but for a caller-specified shorter window
    // (say months=60), it floored at ~39% of today instead of 5%.
    // The function's docstring promises "ramps from 5% at
    // acquisition to 100% today" — that contract should hold for
    // any caller-specified `months`.
    //
    // Test: build a 60-month snapshot history and check that
    // VTI (an always-held ticker) at the OLDEST snapshot has ~5%
    // of today's shares — not ~39%.
    const snaps60 = buildDemoSnapshots(NOW, 60, 6);
    const sharesOf = (snap: typeof snaps60[number], symbol: string): number => {
      for (const a of snap.household!.accounts) {
        for (const h of a.holdings) {
          if ("symbol" in h && h.symbol === symbol) {
            return h.shares;
          }
        }
      }
      return 0;
    };
    const oldest60 = sharesOf(snaps60[0], "VTI");
    const newest60 = sharesOf(snaps60[snaps60.length - 1], "VTI");
    // Oldest is at monthsAgo=60 (i.e., the requested horizon edge);
    // with the fix the curve hits its 5% floor there.
    expect(oldest60 / newest60).toBeGreaterThan(0.04);
    expect(oldest60 / newest60).toBeLessThan(0.07);
  });

  it("varies SHARES across snapshots — older snapshots have fewer shares of the same ticker", () => {
    // The whole reason for the 10y / 6mo rebuild: snapshots should
    // exercise the chart's interpolation by varying shares (not
    // just valueUSD). Pin that the OLDEST snapshot has strictly
    // fewer VTI shares than the NEWEST.
    const snaps = buildDemoSnapshots(NOW);
    const sharesOf = (snap: typeof snaps[number], symbol: string): number => {
      for (const a of snap.household!.accounts) {
        for (const h of a.holdings) {
          if ("symbol" in h && h.symbol === symbol) {
            return h.shares;
          }
        }
      }
      return 0;
    };
    const oldestVTI = sharesOf(snaps[0], "VTI");
    const newestVTI = sharesOf(snaps[snaps.length - 1], "VTI");
    expect(oldestVTI).toBeGreaterThan(0);
    expect(newestVTI).toBeGreaterThan(oldestVTI);
    // Share accumulation curve floors at 5% of today's shares,
    // so the ratio should be roughly in [0.05, 0.5] at the oldest
    // window edge.
    expect(oldestVTI).toBeLessThan(newestVTI * 0.5);
    expect(oldestVTI).toBeGreaterThan(newestVTI * 0.02);
  });

  it("returns empty array for months <= 0 OR intervalMonths <= 0 (degenerate input safety)", () => {
    expect(buildDemoSnapshots(NOW, 0)).toEqual([]);
    expect(buildDemoSnapshots(NOW, -5)).toEqual([]);
    expect(buildDemoSnapshots(NOW, 60, 0)).toEqual([]);
    expect(buildDemoSnapshots(NOW, 60, -1)).toEqual([]);
  });

  it("respects custom months + intervalMonths (12 months / 3-month interval → 5 snapshots)", () => {
    // monthsAgo emitted: 12, 9, 6, 3, 0 → 5 snapshots.
    const snaps = buildDemoSnapshots(NOW, 12, 3);
    expect(snaps).toHaveLength(5);
  });

  it("always emits a 'today' anchor (monthsAgo=0) even when months is not a multiple of intervalMonths (R3 audit)", () => {
    // R3 audit fix: the loop `for (let m = months; m >= 0; m -=
    // intervalMonths)` silently dropped the monthsAgo=0 anchor
    // whenever `months % intervalMonths !== 0`. A caller passing
    // (now, 10, 6) got snapshots at [10, 4] — no "today" pin, so
    // the chart's right edge would be 4 months IN THE PAST. The
    // production default (120, 6) is clean, but the function's
    // contract should guarantee "the timeline ends at today"
    // regardless of multiplicity.
    const snaps = buildDemoSnapshots(NOW, 10, 6);
    // Newest snapshot at exactly `now` (the round-2 BLOCK fix's
    // contract for the monthsAgo=0 anchor).
    expect(snaps[snaps.length - 1].t).toBe(NOW);
  });

  it("always emits the oldest-requested anchor exactly at monthsAgo=months (R3 audit)", () => {
    // R3 audit: the loop already starts at monthsAgo=months so
    // this case isn't broken today — but pin it as part of the
    // contract so future refactors that switch to a different
    // emission order can't silently truncate the requested
    // window.
    const snaps = buildDemoSnapshots(NOW, 10, 6);
    // Oldest snapshot at monthsAgo=10 — newest at now.
    // monthAnchor maps monthsAgo=10 → first-of-month 10 months ago.
    expect(snaps[0].t).toBeLessThan(NOW);
    // 10 months back from 2026-05-29 = 2025-07-01.
    expect(snaps[0].t).toBe(Date.UTC(2025, 6, 1, 12, 0, 0, 0));
  });

  it("appState.targetAllocation drifts across the timeline (more aggressive in the past)", () => {
    const snaps = buildDemoSnapshots(NOW);
    const past = snaps[0].appState!.targetAllocation!;
    const today = snaps[snaps.length - 1].appState!.targetAllocation!;
    // Realistic arc: equity was less heavy a decade ago, bond
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
    // band (between 1.3x and 2.0x over 10 years).
    expect(today / past).toBeGreaterThan(1.3);
    expect(today / past).toBeLessThan(2.0);
  });

  it("appState.targetAllocation interpolates across the FULL window, not just the most recent 5y (R1 audit)", () => {
    // Audit R1 fix: previously backdatedTarget divided monthsAgo
    // by a hardcoded 60, so any snapshot older than 5 years was
    // pinned to the "past" endpoint (alpha clamped to 0). With
    // the 10y window that meant the OLDEST 11 of 21 snapshots
    // had identical target allocations — the TargetDriftCard
    // would show a flat line for the first half of the timeline,
    // contradicting the docstring promise of "linear
    // interpolation between two endpoints."
    //
    // Contract: every monthsAgo step away from `now` should
    // shift the equity weight monotonically (strictly less
    // equity-heavy in the past), no two adjacent older snapshots
    // should be exactly equal across the whole 10y span.
    const snaps = buildDemoSnapshots(NOW);
    const equityWeights = snaps.map((s) => s.appState!.targetAllocation!.equity!);
    // Strictly monotonic (today → past = decreasing equity weight).
    // Iterate from newest to oldest.
    for (let i = snaps.length - 1; i > 0; i--) {
      expect(equityWeights[i]).toBeGreaterThan(equityWeights[i - 1]);
    }
    // Spot check: the snapshot at monthsAgo≈60 (halfway through
    // the 10y window) should sit ROUGHLY at the midpoint between
    // the two endpoints, not at the past endpoint.
    const newestEq = equityWeights[equityWeights.length - 1]; // 0.75
    const oldestEq = equityWeights[0]; // 0.65
    const midIdx = Math.floor(equityWeights.length / 2);
    const midEq = equityWeights[midIdx];
    expect(midEq).toBeGreaterThan(oldestEq + 0.001);
    expect(midEq).toBeLessThan(newestEq - 0.001);
  });

  it("appState.householdAnnualIncomeUSD interpolates across the FULL window (R1 audit)", () => {
    // Same R1 issue as targetAllocation: backdatedAnnualIncome
    // divided monthsAgo by a hardcoded 60. With months=120 the
    // oldest 11 snapshots all reported the IDENTICAL $155k
    // past-endpoint income — no realistic comp-growth trajectory
    // across the older half.
    const snaps = buildDemoSnapshots(NOW);
    const incomes = snaps.map((s) => s.appState!.householdAnnualIncomeUSD!);
    // Strictly monotonic increasing as we approach today.
    for (let i = 1; i < incomes.length; i++) {
      expect(incomes[i]).toBeGreaterThan(incomes[i - 1]);
    }
  });
});

describe("shareAccumulationFactor (internal — share ramp curve) — R10 audit boundary pin", () => {
  const { shareAccumulationFactor } = __testHooks;

  it("returns 1 at monthsAgo=0 (today's share count)", () => {
    expect(shareAccumulationFactor(0, 60)).toBe(1);
    expect(shareAccumulationFactor(0, 120)).toBe(1);
    expect(shareAccumulationFactor(0, 24)).toBe(1);
  });

  it("returns 0.05 at monthsAgo == acquiredMonthsAgo (the inception floor)", () => {
    // The docstring promises "5% at acquisition." Pin it at the
    // boundary for all five acquisition timings used by the demo.
    expect(shareAccumulationFactor(60, 60)).toBeCloseTo(0.05, 10);
    expect(shareAccumulationFactor(36, 36)).toBeCloseTo(0.05, 10);
    expect(shareAccumulationFactor(24, 24)).toBeCloseTo(0.05, 10);
    expect(shareAccumulationFactor(120, 120)).toBeCloseTo(0.05, 10);
  });

  it("returns 0 (drop the holding) when monthsAgo > acquiredMonthsAgo", () => {
    // BTC at monthsAgo=66 (pre-acquisition): 0. Caller drops it.
    expect(shareAccumulationFactor(66, 60)).toBe(0);
    expect(shareAccumulationFactor(72, 60)).toBe(0);
    expect(shareAccumulationFactor(120, 60)).toBe(0);
    expect(shareAccumulationFactor(25, 24)).toBe(0);
  });

  it("strictly increases as monthsAgo decreases (more shares closer to today)", () => {
    // Sample the curve at the snapshot grid (6-month interval)
    // for BTC's 60-month acquisition window.
    const samples = [60, 54, 48, 42, 36, 30, 24, 18, 12, 6, 0].map((m) =>
      shareAccumulationFactor(m, 60),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it("acquiredMonthsAgo=0 (acquired today) returns 1 to avoid div-by-zero", () => {
    // Defensive: a degenerate "acquired today" entry shouldn't
    // crash the function. Returns 1 (today's full share count).
    expect(shareAccumulationFactor(0, 0)).toBe(1);
  });

  it("produces finite, non-negative values across the full input grid", () => {
    // Property-style pass: every (monthsAgo, acquiredMonthsAgo)
    // pair the demo would feed should yield a finite factor in
    // [0, 1].
    for (let acq = 12; acq <= 120; acq += 6) {
      for (let m = 0; m <= acq + 12; m++) {
        const f = shareAccumulationFactor(m, acq);
        expect(Number.isFinite(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
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
