import { describe, expect, it } from "vitest";
import { growthVelocity } from "@/lib/projection/growthVelocity";
import type { Snapshot } from "@/lib/persistence/persistence";

const DAY = 24 * 60 * 60 * 1000;

function snap(t: number, netWorthUSD: number): Snapshot {
  return { t, netWorthUSD };
}

describe("growthVelocity", () => {
  it("returns null when too few snapshots", () => {
    expect(growthVelocity([])).toBeNull();
    expect(growthVelocity([snap(0, 100)])).toBeNull();
  });

  it("emits 30d / 90d / 1y / lifetime windows when data covers them", () => {
    const now = Date.UTC(2025, 0, 1);
    const snaps = [
      snap(now - 400 * DAY, 100_000),
      snap(now - 95 * DAY, 110_000),
      snap(now - 35 * DAY, 120_000),
      snap(now - 5 * DAY, 125_000),
    ];
    const g = growthVelocity(snaps, now);
    expect(g).not.toBeNull();
    const labels = g!.windows.map((w) => w.window);
    expect(labels).toContain("30d");
    expect(labels).toContain("90d");
    expect(labels).toContain("1y");
    expect(labels).toContain("lifetime");
  });

  it("annualized return is positive for monotonic growth", () => {
    const now = Date.UTC(2025, 0, 1);
    const snaps = [
      snap(now - 365 * DAY, 100_000),
      snap(now, 110_000),
    ];
    const g = growthVelocity(snaps, now);
    const lifetime = g!.windows.find((w) => w.window === "lifetime")!;
    // 10% over 365 days → ~10% annualized
    expect(lifetime.annualizedReturn).toBeGreaterThan(0.09);
    expect(lifetime.annualizedReturn).toBeLessThan(0.11);
  });

  it("annualized return is negative for drawdown", () => {
    const now = Date.UTC(2025, 0, 1);
    const snaps = [
      snap(now - 365 * DAY, 100_000),
      snap(now, 80_000),
    ];
    const g = growthVelocity(snaps, now);
    const lifetime = g!.windows.find((w) => w.window === "lifetime")!;
    expect(lifetime.annualizedReturn).toBeLessThan(0);
  });

  it("uses snapshot AT-OR-BEFORE the cutoff", () => {
    const now = Date.UTC(2025, 0, 1);
    // Earliest snap is 100 days old; cutoff for 30d is 30 days ago.
    // No 30d snapshot exists → only lifetime / 90d should emit.
    const snaps = [snap(now - 100 * DAY, 100_000), snap(now, 110_000)];
    const g = growthVelocity(snaps, now);
    const labels = g!.windows.map((w) => w.window);
    expect(labels).toContain("30d"); // 100d-old snapshot is at-or-before 30d ago
    expect(labels).toContain("90d");
    expect(labels).toContain("lifetime");
  });

  it("does NOT annualize sub-week windows (Math.pow ratio explodes otherwise)", () => {
    const now = Date.UTC(2025, 0, 1);
    // A few hours between two snapshots with a meaningful $ delta.
    // Without the sub-week floor, Math.pow(ratio, 365/days) would
    // render hundreds of digits — useless as a percentage but the
    // $ delta is still informative, so we keep it.
    const snaps = [
      snap(now - 4 * 60 * 60 * 1000, 1_000_000),
      snap(now, 1_500_000),
    ];
    const g = growthVelocity(snaps, now);
    const lifetime = g!.windows.find((w) => w.window === "lifetime")!;
    // Delta $ is still useful and rendered.
    expect(lifetime.deltaUSD).toBe(500_000);
    // But annualized is suppressed.
    expect(lifetime.annualizedReturn).toBeNull();
  });

  it("clamps absurd annualized returns at the 10x (1000%) ceiling", () => {
    const now = Date.UTC(2025, 0, 1);
    // 100k → 200k over exactly the floor (7 days). Annualized would
    // be 2^(365/7) ≈ 7e15. Clamp must hold.
    const snaps = [snap(now - 7 * DAY, 100_000), snap(now, 200_000)];
    const g = growthVelocity(snaps, now);
    const lifetime = g!.windows.find((w) => w.window === "lifetime")!;
    expect(lifetime.annualizedReturn).toBe(10);
  });

  it("filters non-positive / non-finite snapshots", () => {
    const now = Date.UTC(2025, 0, 1);
    const snaps = [
      snap(now - 365 * DAY, 0),
      snap(now - 200 * DAY, NaN),
      snap(now - 100 * DAY, 100_000),
      snap(now, 110_000),
    ];
    const g = growthVelocity(snaps, now);
    expect(g).not.toBeNull();
    const lifetime = g!.windows.find((w) => w.window === "lifetime")!;
    // Lifetime starts at the first VALID snapshot (100 days ago, 100k)
    expect(lifetime.startUSD).toBe(100_000);
  });
});
