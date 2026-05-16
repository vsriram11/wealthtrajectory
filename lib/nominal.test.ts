import { describe, expect, it } from "vitest";
import { nominalToReal, realToNominal } from "@/lib/nominal";

describe("nominal/real conversions", () => {
  it("realToNominal preserves $ when years=0", () => {
    expect(realToNominal(1_000_000, 0.03, 0)).toBe(1_000_000);
  });

  it("realToNominal: $1M real → ~$1.344M nominal at 3% / 10y", () => {
    const n = realToNominal(1_000_000, 0.03, 10);
    expect(n).toBeGreaterThan(1_343_000);
    expect(n).toBeLessThan(1_345_000);
  });

  it("nominalToReal is inverse of realToNominal", () => {
    const r = nominalToReal(realToNominal(1_000_000, 0.04, 15), 0.04, 15);
    expect(r).toBeCloseTo(1_000_000, 0);
  });

  it("realToNominal: 0% inflation = identity", () => {
    expect(realToNominal(500_000, 0, 25)).toBe(500_000);
  });
});
