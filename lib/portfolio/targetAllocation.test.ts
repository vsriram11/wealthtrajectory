import { describe, expect, it } from "vitest";
import { TARGET_PRESETS, computeDrift } from "@/lib/portfolio/targetAllocation";
import type { Household } from "@/lib/types";

function cashHousehold(parts: Record<string, number>): Household {
  // Build a household with one cash-style account per part, value as specified.
  const memberId = "m1";
  return {
    id: "t",
    members: [{ id: memberId, displayName: "You" }],
    accounts: Object.entries(parts).map(([id, value]) => ({
      id,
      category: "BROKERAGE" as const,
      displayName: id,
      ownerId: memberId,
      monthlyContributionUSD: 0,
      holdings: [
        {
          kind: "cash" as const,
          id: `${id}-c`,
          valueUSD: value,
          expectedRealCAGR: 0,
          geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
        },
      ],
    })),
    liabilities: [],
  };
}

describe("computeDrift", () => {
  it("100% cash household vs 60/40 target shows full drift", () => {
    const h = cashHousehold({ a: 100_000 });
    const out = computeDrift(h, { equity: 0.6, bond: 0.4 });
    expect(out.totalUSD).toBe(100_000);
    const cash = out.drifts.find((d) => d.klass === "cash")!;
    const equity = out.drifts.find((d) => d.klass === "equity")!;
    const bond = out.drifts.find((d) => d.klass === "bond")!;
    expect(cash.currentShare).toBe(1);
    expect(cash.targetShare).toBe(0);
    expect(cash.driftUSD).toBe(100_000); // sell all cash
    expect(equity.driftUSD).toBe(-60_000); // buy $60K equity
    expect(bond.driftUSD).toBe(-40_000); // buy $40K bond
  });

  it("totalImbalanceUSD is half the absolute drift sum", () => {
    const h = cashHousehold({ a: 100_000 });
    const out = computeDrift(h, { equity: 0.6, bond: 0.4 });
    // Sum of abs = 100K (cash) + 60K (equity) + 40K (bond) = 200K. Half = 100K.
    expect(out.totalImbalanceUSD).toBe(100_000);
  });

  it("on-target portfolio reports zero drift", () => {
    const h = cashHousehold({ a: 100_000 });
    const out = computeDrift(h, { cash: 1 });
    expect(out.totalImbalanceUSD).toBe(0);
    for (const d of out.drifts) {
      expect(Math.abs(d.driftUSD)).toBeLessThan(0.01);
    }
  });

  it("partial target (sums < 1) is honored as-is — implicit 0 elsewhere", () => {
    const h = cashHousehold({ a: 100_000 });
    // Target only equity at 50% — the other 50% is implicitly 0
    const out = computeDrift(h, { equity: 0.5 });
    const equity = out.drifts.find((d) => d.klass === "equity")!;
    const cash = out.drifts.find((d) => d.klass === "cash")!;
    expect(equity.targetShare).toBe(0.5);
    expect(cash.targetShare).toBe(0); // implicit
    // Drift: cash 100% over (target 0), equity 50% under (target 50)
    expect(equity.driftUSD).toBe(-50_000);
  });
});

describe("TARGET_PRESETS", () => {
  it("each preset's weights are non-negative and sum to ~1.0", () => {
    // Two invariants every preset must satisfy. Non-negativity
    // is required by the drift / sum math (negatives would
    // produce phantom NW). Sum ≈ 1 makes the preset a valid
    // target allocation rather than partial / over-100% — the
    // UI dial would behave non-deterministically if presets
    // didn't normalize.
    for (const preset of TARGET_PRESETS) {
      let sum = 0;
      for (const [, weight] of Object.entries(preset.target)) {
        expect(weight).toBeGreaterThanOrEqual(0);
        sum += weight ?? 0;
      }
      expect(sum).toBeCloseTo(1.0, 6);
    }
  });

  it("preset shapes use valid AssetClass keys (compile-time enforced; runtime safety net)", () => {
    const valid = new Set([
      "equity",
      "bond",
      "cash",
      "crypto",
      "commodity",
      "real_estate",
      "private_stock",
      "other",
    ]);
    for (const preset of TARGET_PRESETS) {
      for (const key of Object.keys(preset.target)) {
        expect(valid.has(key)).toBe(true);
      }
    }
  });
});
