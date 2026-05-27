import { describe, expect, it } from "vitest";
import {
  allocationAtAge,
  GLIDE_PATH_PRESETS,
  normalizeGlidePath,
  type GlidePath,
} from "@/lib/portfolio/glidePath";

describe("normalizeGlidePath", () => {
  it("sorts waypoints by age", () => {
    const gp: GlidePath = {
      waypoints: [
        { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
        { age: 30, allocation: { equity: 0.9, bond: 0.1 } },
        { age: 45, allocation: { equity: 0.7, bond: 0.3 } },
      ],
    };
    const normalized = normalizeGlidePath(gp);
    expect(normalized.waypoints.map((w) => w.age)).toEqual([30, 45, 60]);
  });

  it("does not mutate the input (deep — order + per-waypoint contents preserved)", () => {
    const gp: GlidePath = {
      waypoints: [
        { age: 60, allocation: { equity: 0.5 } },
        { age: 30, allocation: { equity: 0.9 } },
      ],
    };
    const snap = structuredClone(gp);
    normalizeGlidePath(gp);
    // A previous version checked only `gp.waypoints[0].age`. A
    // bug that re-sorted in place + mutated allocations / added
    // waypoints / dropped fields would all have passed silently.
    // Deep equality pins the whole shape.
    expect(gp).toEqual(snap);
  });

  it("dedups same-age waypoints, keeping the last-written allocation", () => {
    const gp: GlidePath = {
      waypoints: [
        { age: 30, allocation: { equity: 0.9, bond: 0.1 } },
        { age: 65, allocation: { equity: 0.5, bond: 0.5 } },
        { age: 65, allocation: { equity: 0.6, bond: 0.4 } }, // duplicate, later
        { age: 80, allocation: { equity: 0.3, bond: 0.7 } },
      ],
    };
    const out = normalizeGlidePath(gp);
    expect(out.waypoints.map((w) => w.age)).toEqual([30, 65, 80]);
    // Later-written wins at the duplicate age.
    const at65 = out.waypoints.find((w) => w.age === 65)!;
    expect(at65.allocation.equity).toBe(0.6);
  });
});

describe("allocationAtAge — interpolation + bounds", () => {
  const gp: GlidePath = {
    waypoints: [
      { age: 30, allocation: { equity: 0.9, bond: 0.1 } },
      { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
    ],
  };

  it("returns null for an empty glide-path", () => {
    expect(allocationAtAge({ waypoints: [] }, 50)).toBeNull();
  });

  it("returns the only waypoint's allocation when there's just one", () => {
    expect(
      allocationAtAge(
        { waypoints: [{ age: 40, allocation: { equity: 0.7 } }] },
        99,
      ),
    ).toEqual({ equity: 0.7 });
  });

  it("returns first waypoint's allocation for ages at or below first", () => {
    expect(allocationAtAge(gp, 25)).toEqual({ equity: 0.9, bond: 0.1 });
    expect(allocationAtAge(gp, 30)).toEqual({ equity: 0.9, bond: 0.1 });
  });

  it("returns last waypoint's allocation for ages at or above last", () => {
    expect(allocationAtAge(gp, 60)).toEqual({ equity: 0.5, bond: 0.5 });
    expect(allocationAtAge(gp, 80)).toEqual({ equity: 0.5, bond: 0.5 });
  });

  it("interpolates linearly at the midpoint", () => {
    // age 45 = halfway between 30 (0.9) and 60 (0.5) → 0.7 equity
    const out = allocationAtAge(gp, 45);
    expect(out?.equity).toBeCloseTo(0.7, 6);
    expect(out?.bond).toBeCloseTo(0.3, 6);
  });

  it("interpolates linearly at quarter-points", () => {
    const out = allocationAtAge(gp, 37.5);
    // 25% of the way: equity = 0.9 - 0.25 × (0.9 - 0.5) = 0.8
    expect(out?.equity).toBeCloseTo(0.8, 6);
    expect(out?.bond).toBeCloseTo(0.2, 6);
  });

  it("handles classes only in one of the surrounding waypoints", () => {
    const partial: GlidePath = {
      waypoints: [
        { age: 30, allocation: { equity: 1 } },
        { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
      ],
    };
    const out = allocationAtAge(partial, 45);
    expect(out?.equity).toBeCloseTo(0.75, 6);
    // Bond went from 0 (missing) to 0.5 — interp gives 0.25.
    expect(out?.bond).toBeCloseTo(0.25, 6);
  });

  it("walks correctly through 3+ waypoints", () => {
    const three: GlidePath = {
      waypoints: [
        { age: 25, allocation: { equity: 1 } },
        { age: 65, allocation: { equity: 0.5 } },
        { age: 85, allocation: { equity: 0.3 } },
      ],
    };
    // Age 45: 20/40 of way 25→65 → 0.5 of way → 0.75
    expect(allocationAtAge(three, 45)?.equity).toBeCloseTo(0.75, 6);
    // Age 75: 10/20 of way 65→85 → 0.5 of way → 0.4
    expect(allocationAtAge(three, 75)?.equity).toBeCloseTo(0.4, 6);
  });
});

describe("GLIDE_PATH_PRESETS — sanity checks on shipped presets", () => {
  it("all presets sum to ~1 at every waypoint", () => {
    for (const [name, gp] of Object.entries(GLIDE_PATH_PRESETS)) {
      for (const w of gp.waypoints) {
        const total = Object.values(w.allocation).reduce(
          (s, v) => s + (v ?? 0),
          0,
        );
        expect(total).toBeCloseTo(1, 2);
        // Reference `name` so test failures are debuggable.
        if (Math.abs(total - 1) > 0.01) {
          throw new Error(`Preset ${name} waypoint at age ${w.age} doesn't sum to 1: ${total}`);
        }
      }
    }
  });

  it("vanguard preset starts equity-heavy and tapers", () => {
    const v = GLIDE_PATH_PRESETS.vanguard_target_retirement;
    expect(allocationAtAge(v, 30)?.equity).toBeGreaterThanOrEqual(0.85);
    expect(allocationAtAge(v, 80)?.equity).toBeLessThanOrEqual(0.4);
  });

  it("perpetual_aggressive never drops below 80% equity", () => {
    const p = GLIDE_PATH_PRESETS.perpetual_aggressive;
    for (let age = 25; age <= 95; age += 5) {
      const a = allocationAtAge(p, age);
      expect(a?.equity ?? 0).toBeGreaterThanOrEqual(0.79);
    }
  });

  it("rising_equity_pfau dips at FIRE retirement age, then climbs", () => {
    // The Pfau/Kitces U-shape: equity dips around the typical
    // FIRE retirement age (mid-40s) to mitigate sequence-of-
    // returns risk, then ramps back up as survival becomes more
    // established. The defining property is "min equity is in
    // the early-retirement window, not at the start or end."
    const r = GLIDE_PATH_PRESETS.rising_equity_pfau;
    const at30 = allocationAtAge(r, 30)?.equity ?? 0;
    const at45 = allocationAtAge(r, 45)?.equity ?? 0;
    const at80 = allocationAtAge(r, 80)?.equity ?? 0;
    // Trough at 45 is BELOW both bookends.
    expect(at45).toBeLessThan(at30);
    expect(at45).toBeLessThan(at80);
    // Late-life is HIGHER than starting equity (the "rising" half).
    expect(at80).toBeGreaterThan(at30);
    // Numerical pins on the published shape: ~40% at 45 trough,
    // ~80% at 80. Tight bounds catch silent edits to the preset.
    expect(at45).toBeCloseTo(0.4, 1);
    expect(at80).toBeCloseTo(0.8, 1);
  });

  it("conservative tapers fastest after 50", () => {
    const c = GLIDE_PATH_PRESETS.conservative;
    const at50 = allocationAtAge(c, 50)?.equity ?? 0;
    const at75 = allocationAtAge(c, 75)?.equity ?? 0;
    expect(at50 - at75).toBeGreaterThan(0.3);
  });
});
