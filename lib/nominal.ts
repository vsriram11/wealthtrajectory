/**
 * Real-to-nominal helpers. The whole projection engine works in
 * real (today's) dollars — that's the right default for retirement
 * math because purchasing power is what matters. But seeing what a
 * "$2M target" actually translates to in future-nominal dollars
 * helps users calibrate (sticker-shock or relief, depending).
 *
 * Formula: nominal = real × (1 + i)^years.
 * Inverse: real = nominal / (1 + i)^years.
 */

export function realToNominal(
  realUSD: number,
  inflationRate: number,
  years: number,
): number {
  if (!Number.isFinite(realUSD)) return realUSD;
  if (years <= 0) return realUSD;
  return realUSD * Math.pow(1 + inflationRate, years);
}

export function nominalToReal(
  nominalUSD: number,
  inflationRate: number,
  years: number,
): number {
  if (!Number.isFinite(nominalUSD)) return nominalUSD;
  if (years <= 0) return nominalUSD;
  return nominalUSD / Math.pow(1 + inflationRate, years);
}
