/**
 * Derive a default leverage value for a bond holding from its
 * average duration (years).
 *
 * Why: most users add a bond ETF (BND, SHY, TLT, SGOV) by symbol
 * and expect sane defaults — but a flat `leverage: 1` for everything
 * misrepresents reality. SGOV (~0.3y duration) behaves like cash:
 * its rate-sensitivity contributes essentially zero to portfolio
 * volatility, so treating it as 1× full exposure overstates risk
 * in stress tests + drift. BND (~6.5y) sits in the middle. Long-
 * duration treasuries (~17y+) are full-exposure.
 *
 * Piecewise-linear mapping, anchored at three points:
 *   d ≤ 0.5y   → 0    (T-bills / floating-rate, effectively cash)
 *   d = 5y     → 0.5  (intermediate aggregate)
 *   d ≥ 8y    → 1     (long unleveraged bonds)
 *
 * Truly leveraged bond products (TMF at 3x, EDV-via-futures, etc.)
 * are kept above this default via the `bondLeverageIsManual` flag
 * on `BondHolding`: any explicit user override or preset that
 * specifies a leverage above the duration-derived value marks the
 * holding as manual, freezing leverage until the user clicks
 * "Reset to auto".
 *
 * This function is engine-pure: no store / IO. Tested in
 * bondLeverage.test.ts.
 */
export function bondLeverageFromDuration(duration: number): number {
  if (Number.isNaN(duration)) return 0;
  if (duration <= 0.5) return 0;
  if (duration >= 8) return 1;
  if (duration <= 5) {
    // 0.5 → 5y spans 0 → 0.5x
    return ((duration - 0.5) / 4.5) * 0.5;
  }
  // 5 → 8y spans 0.5 → 1.0x
  return 0.5 + ((duration - 5) / 3) * 0.5;
}

/**
 * True when the given leverage value matches what auto-derivation
 * would produce for this duration (within a small tolerance). Used
 * on holding creation to decide whether an explicit preset leverage
 * (e.g. TMF's 3x) should mark the holding as manual vs auto.
 */
export function leverageMatchesDuration(
  leverage: number,
  duration: number,
  tolerance = 0.02,
): boolean {
  return Math.abs(leverage - bondLeverageFromDuration(duration)) <= tolerance;
}
