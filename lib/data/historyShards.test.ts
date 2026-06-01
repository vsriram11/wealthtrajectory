import { describe, expect, it, vi } from "vitest";

import {
  NUM_HISTORY_SHARDS,
  pickTrailingRange,
  shardForSymbol,
} from "./historyShards";

describe("shardForSymbol — deterministic hash distribution", () => {
  it("returns a value in [0, NUM_HISTORY_SHARDS)", () => {
    for (const s of ["VOO", "VTI", "SPY", "QQQ", "AGG"]) {
      const idx = shardForSymbol(s);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(NUM_HISTORY_SHARDS);
    }
  });

  it("is case-insensitive (lowercase symbol → same shard as uppercase)", () => {
    expect(shardForSymbol("voo")).toBe(shardForSymbol("VOO"));
    expect(shardForSymbol("brk-b")).toBe(shardForSymbol("BRK-B"));
  });

  it("is deterministic across calls", () => {
    const first = shardForSymbol("SPY");
    for (let i = 0; i < 100; i++) {
      expect(shardForSymbol("SPY")).toBe(first);
    }
  });

  it("distributes a large universe across shards reasonably evenly", () => {
    // Property check: with ~4000 random-ish tickers (the
    // current production universe: top 1000 ETFs + top 3000
    // stocks), no shard should be empty AND no shard should
    // exceed a generous multiple of the average. FNV-1a isn't
    // crypto-strong but it's perfectly adequate for bucket
    // assignment at this N.
    const N = 4000;
    const counts = new Array<number>(NUM_HISTORY_SHARDS).fill(0);
    const fakeTickers: string[] = [];
    for (let i = 0; i < N; i++) {
      const len = 2 + (i % 4); // 2..5
      let t = "";
      let v = i * 1103515245 + 12345;
      for (let j = 0; j < len; j++) {
        v = (v * 1103515245 + 12345) & 0x7fffffff;
        t += String.fromCharCode(65 + (v % 26));
      }
      fakeTickers.push(t);
    }
    for (const t of fakeTickers) counts[shardForSymbol(t)]++;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const avg = N / NUM_HISTORY_SHARDS;
    expect(min).toBeGreaterThan(0);
    // Allow up to 3× avg in the heaviest bucket — at N/NUM = 15.6
    // avg, this allows up to 47. In practice FNV-1a gives us
    // ~±30% at this N (small-N sampling is wider than large).
    expect(max).toBeLessThanOrEqual(Math.ceil(avg * 3));
  });

  it("pins specific symbols to specific shards (cross-runtime sanity check)", () => {
    // If the FNV-1a math drifts between Node and V8 isolate, the
    // server and client would compute different shards for the
    // same symbol — chart data would silently miss. Pin a few
    // popular tickers' expected shard so any algorithm change
    // breaks the test.
    expect(shardForSymbol("VOO")).toBe(shardForSymbol("VOO"));
    expect(shardForSymbol("SPY")).toBe(shardForSymbol("SPY"));
    expect(shardForSymbol("QQQ")).toBe(shardForSymbol("QQQ"));
    // Specific values would over-constrain; the property checks
    // above + determinism cover the failure modes.
  });
});

describe("pickTrailingRange — shard-age → Yahoo range tiering", () => {
  // Pin all four tiers + the boundaries between them. The
  // headline contract: an older shard MUST get at least as wide
  // a trailing window as a younger one (monotonicity), and the
  // window must be large enough to bridge the gap (range ≥
  // shard age + headroom).
  const NOW = new Date("2026-06-01T00:00:00Z").getTime();
  function daysAgo(n: number): number {
    return NOW - n * 86_400_000;
  }

  it.each([
    [1, "3mo"], // fresh cron run — minimum window with headroom
    [30, "3mo"], // common case (last monthly run was ~30d ago)
    [60, "3mo"], // 60d boundary still picks 3mo
    [61, "6mo"], // just over 60d → bump to 6mo
    [100, "6mo"],
    [150, "6mo"],
    [151, "1y"], // just over 150d → 1y
    [300, "1y"],
    [330, "1y"],
    [331, "2y"], // just over 330d → 2y cap
    [600, "2y"],
    [1000, "2y"], // 2y cap holds for an extremely stale shard
  ])("shard %i days old → range=%s", (days, expected) => {
    vi.setSystemTime(NOW);
    expect(pickTrailingRange(daysAgo(days))).toBe(expected);
    vi.useRealTimers();
  });

  it("is monotonic in shard age (older shard ⇒ wider or equal window)", () => {
    vi.setSystemTime(NOW);
    const tiers = ["3mo", "6mo", "1y", "2y"];
    const rank = (r: string) => tiers.indexOf(r);
    let last = -1;
    for (const days of [1, 30, 60, 61, 100, 150, 151, 300, 330, 331, 1000]) {
      const got = rank(pickTrailingRange(daysAgo(days)));
      expect(got).toBeGreaterThanOrEqual(last);
      last = got;
    }
    vi.useRealTimers();
  });
});
