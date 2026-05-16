const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Explicit min + max fractional digits. Node 20 ICU and recent
// browsers disagree on how compact notation renders trailing
// zeros when only `maximumFractionDigits` is set (one yields
// "$0", the other "$0.0") — a hydration mismatch caught by the
// E2E smoke test. Pinning both bounds removes the runtime
// divergence.
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const pct0 = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const pct2 = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

export const formatUSD = (n: number) => usd0.format(n);
export const formatUSDCompact = (n: number) => usdCompact.format(n);
export const formatPercent = (n: number) => pct.format(n);
export const formatPercent0 = (n: number) => pct0.format(n);
/**
 * Two-decimal percent. Use for APRs / interest rates / fees where
 * "9.99%" reads more precisely than "10%". Most user-facing percents
 * should use `formatPercent` (1 decimal) instead.
 */
export const formatPercent2 = (n: number) => pct2.format(n);

/**
 * Compact percent for ultra-tight spaces (tab subtitles, 3×3 cells)
 * where we still want decimal fidelity but don't want a trailing "%"
 * eating pixels. Always 1 decimal. e.g. 0.634 → "63.4".
 */
export const formatPercentTight = (n: number) => (n * 100).toFixed(1);

export const formatMonthYear = (d: Date) => monthYear.format(d);

export function formatLeverage(n: number): string {
  return `${n.toFixed(n >= 10 ? 0 : 2)}x`;
}

export function formatYearsMonths(months: number): string {
  if (months <= 0) return "now";
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr${y === 1 ? "" : "s"}`;
  return `${y} yr${y === 1 ? "" : "s"} ${m} mo`;
}
