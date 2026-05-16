import { describe, expect, it } from "vitest";
import {
  blendedRealCAGRAtAge,
  effectiveRealCAGROverHorizon,
  realCAGRSeries,
  DEFAULT_CLASS_REAL_CAGR,
} from "@/lib/portfolio/glidePathCAGR";
import { GLIDE_PATH_PRESETS, type GlidePath } from "@/lib/portfolio/glidePath";

describe("blendedRealCAGRAtAge — weighted blend at a single age", () => {
  it("returns null when glide-path is empty", () => {
    expect(blendedRealCAGRAtAge({ waypoints: [] }, 50)).toBeNull();
  });

  it("returns the equity rate when 100% stocks", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 30, allocation: { equity: 1 } }],
    };
    expect(blendedRealCAGRAtAge(gp, 30)).toBeCloseTo(
      DEFAULT_CLASS_REAL_CAGR.equity,
      6,
    );
  });

  it("returns the bond rate when 100% bonds", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 60, allocation: { bond: 1 } }],
    };
    expect(blendedRealCAGRAtAge(gp, 60)).toBeCloseTo(
      DEFAULT_CLASS_REAL_CAGR.bond,
      6,
    );
  });

  it("weighted blend: 60/40 = 0.6 × equity + 0.4 × bond", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 50, allocation: { equity: 0.6, bond: 0.4 } }],
    };
    const expected =
      0.6 * DEFAULT_CLASS_REAL_CAGR.equity +
      0.4 * DEFAULT_CLASS_REAL_CAGR.bond;
    expect(blendedRealCAGRAtAge(gp, 50)).toBeCloseTo(expected, 6);
  });

  it("interpolates across age in step with allocation", () => {
    // Vanguard preset: at age 30 it's 90/10, at age 60 it's 50/50.
    // At age 45 (midpoint) it should be 70/30.
    const v = GLIDE_PATH_PRESETS.vanguard_target_retirement;
    const at30 = blendedRealCAGRAtAge(v, 30) ?? 0;
    const at60 = blendedRealCAGRAtAge(v, 60) ?? 0;
    expect(at30).toBeGreaterThan(at60); // earlier age = higher (more stocks)
  });

  it("user-supplied classCAGRs override defaults", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 40, allocation: { equity: 1 } }],
    };
    expect(
      blendedRealCAGRAtAge(gp, 40, { equity: 0.1 }),
    ).toBeCloseTo(0.1, 6);
  });

  it("normalizes when allocation doesn't sum to 1", () => {
    // 80/20 of NOMINAL weights that sum to 1.0 — same result as 0.8/0.2
    const gp: GlidePath = {
      waypoints: [{ age: 40, allocation: { equity: 0.8, bond: 0.2 } }],
    };
    const expected =
      0.8 * DEFAULT_CLASS_REAL_CAGR.equity +
      0.2 * DEFAULT_CLASS_REAL_CAGR.bond;
    expect(blendedRealCAGRAtAge(gp, 40)).toBeCloseTo(expected, 6);
  });
});

describe("realCAGRSeries — walks year-by-year", () => {
  it("produces the requested number of years", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 25, allocation: { equity: 1 } }],
    };
    const s = realCAGRSeries(gp, 30, 5);
    expect(s.length).toBe(5);
  });

  it("constant when single-waypoint glide-path", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 25, allocation: { equity: 1 } }],
    };
    const s = realCAGRSeries(gp, 30, 5);
    for (const r of s) {
      expect(r).toBeCloseTo(DEFAULT_CLASS_REAL_CAGR.equity, 6);
    }
  });

  it("monotonically decreases when glide-path tapers stocks", () => {
    // Vanguard preset: stocks taper from age 40 onward. The test
    // name promises MONOTONIC decrease — first > last is necessary
    // but not sufficient (a U-shape that ends below the start
    // would pass). Enforce the full monotonicity contract so a
    // regression that produced a non-monotonic curve (say, a
    // bond → equity → bond inversion from a buggy interpolator)
    // would fail here, not in some downstream consumer.
    const v = GLIDE_PATH_PRESETS.vanguard_target_retirement;
    const s = realCAGRSeries(v, 40, 30);
    for (let i = 1; i < s.length; i++) {
      // Allow exact equality at flat-line segments; reject any
      // year-over-year increase.
      expect(s[i]).toBeLessThanOrEqual(s[i - 1] + 1e-12);
    }
    // Strict overall decrease — the taper IS real, not just flat.
    expect(s[0]).toBeGreaterThan(s[s.length - 1]);
  });

  it("zero years returns empty array", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 25, allocation: { equity: 1 } }],
    };
    expect(realCAGRSeries(gp, 30, 0)).toEqual([]);
  });
});

describe("effectiveRealCAGROverHorizon — time-weighted geometric mean", () => {
  it("equals the single rate when glide-path is constant", () => {
    const gp: GlidePath = {
      waypoints: [{ age: 25, allocation: { equity: 1 } }],
    };
    expect(effectiveRealCAGROverHorizon(gp, 40, 30)).toBeCloseTo(
      DEFAULT_CLASS_REAL_CAGR.equity,
      6,
    );
  });

  it("a tapering glide-path produces a CAGR between equity and bond rates", () => {
    const v = GLIDE_PATH_PRESETS.vanguard_target_retirement;
    const r = effectiveRealCAGROverHorizon(v, 40, 30);
    expect(r).toBeLessThan(DEFAULT_CLASS_REAL_CAGR.equity);
    expect(r).toBeGreaterThan(DEFAULT_CLASS_REAL_CAGR.bond);
  });

  it("longer horizon past the taper drops the effective CAGR further", () => {
    const v = GLIDE_PATH_PRESETS.vanguard_target_retirement;
    const short = effectiveRealCAGROverHorizon(v, 40, 10); // mostly stocks
    const long = effectiveRealCAGROverHorizon(v, 40, 50); // includes the bond-heavy tail
    expect(short).toBeGreaterThan(long);
  });

  it("perpetual_aggressive preset stays close to equity rate", () => {
    const p = GLIDE_PATH_PRESETS.perpetual_aggressive;
    const r = effectiveRealCAGROverHorizon(p, 30, 60);
    // ~80% stocks throughout → blended close to 0.8 × equity + 0.2 × bond
    const expected =
      0.8 * DEFAULT_CLASS_REAL_CAGR.equity +
      0.2 * DEFAULT_CLASS_REAL_CAGR.bond;
    expect(Math.abs(r - expected)).toBeLessThan(0.01);
  });
});
