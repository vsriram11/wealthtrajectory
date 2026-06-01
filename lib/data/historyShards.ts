/**
 * Shared shard-hash + manifest types for the static historical
 * price cache.
 *
 * The refresh script (`scripts/refresh-history.ts`) uses
 * `shardForSymbol` to bucket each ticker into one of 32 JSON files
 * on Vercel Blob. The API route + client load the matching shard
 * via the same hash function, so the routing stays deterministic
 * across server/client without any per-ticker manifest lookup.
 *
 * The manifest published alongside the shards is just the URL
 * registry — useful when blob URLs change shape (Vercel's blob
 * pathing may include account-scoped prefixes).
 */

/**
 * 256 shards: each shard ends up around 15-30 tickers from a
 * ~4000-ticker universe (top 1000 ETFs + top 3000 stocks by
 * market cap). At ~20y daily history (since Dec 2005), each
 * shard is ~1.5 MB raw / ~350 KB gzipped — small enough that a
 * typical user with 20 holdings downloads ~20 × 350 KB ≈ 7 MB
 * on first load (cached forever in IDB after).
 *
 * Dividend + split event payloads add ~1-2 KB per ticker to
 * each shard (small relative to the price series).
 *
 * Free-tier safety at 256 shards:
 *   - Writes: 256/refresh × 12 refreshes/year = 256/month. Well
 *     under the 2000/month Vercel Blob cap.
 *   - Reads (origin ops): 256 × ~20 regions per refresh ≈ 5,120/
 *     month. Under the 10k/month cap.
 *   - Blob origin transfer: 256 × 350 KB × 20 regions ≈ 1.8 GB/
 *     month. Under the 10 GB cap.
 *
 * Why 256 specifically (vs 32 or 128): with N tickers and S
 * shards, per-shard size scales as N/S. Larger N (universe
 * expansion) forces larger S to keep per-shard size small. 256
 * gives us headroom to grow the universe to ~5000 tickers
 * without ballooning per-shard download.
 *
 * Changing this constant requires a coordinated deploy: the
 * route's shardForSymbol() and the refresh script's bucketing
 * MUST use the same value. Bump in the same PR + redeploy
 * before re-running the refresh.
 */
export const NUM_HISTORY_SHARDS = 256;

/**
 * FNV-1a 32-bit hash, modulo NUM_HISTORY_SHARDS. Identical math
 * has to run in both Node (refresh script) and the V8 isolate
 * (Vercel function / browser), so we use only `Math.imul` and
 * `>>>` which are well-defined across runtimes.
 */
export function shardForSymbol(symbol: string): number {
  let h = 0x811c9dc5;
  const s = symbol.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % NUM_HISTORY_SHARDS;
}

export type ShardHistoryPoint = [number, number]; // [t_ms, adjclose]

/**
 * Cash dividend per share, in the ticker's reporting currency
 * (USD for the current universe). Tuple-packed to keep the JSON
 * compact: `[t_ms, amount]`.
 */
export type ShardDividend = [number, number]; // [t_ms, amount_per_share]

/**
 * Stock split. Tuple-packed `[t_ms, numerator, denominator]`.
 * A 2-for-1 split is `[t, 2, 1]` (holders receive 2 new shares
 * for every 1 old). Reverse splits use numerator < denominator.
 *
 * Consumers should be aware that Yahoo's `adjclose` time series
 * already factors splits + dividends into prices; this raw
 * event stream is for downstream features that want the original
 * timing (e.g., "what was your share count after this split?").
 */
export type ShardSplit = [number, number, number]; // [t_ms, numerator, denominator]

export type ShardPayload = {
  generatedAt: number;
  tickers: Record<string, ShardHistoryPoint[]>;
  /**
   * Optional: per-ticker dividend event stream since the shard's
   * start date (Dec 2005 for the production cache). Older shards
   * generated before dividend support landed will omit this key
   * entirely — readers MUST treat missing as "no dividends known
   * for any ticker in this shard", not as an error.
   */
  dividends?: Record<string, ShardDividend[]>;
  /**
   * Optional: per-ticker split event stream. Same back-compat
   * rules as `dividends` — missing key on older shards is fine.
   */
  splits?: Record<string, ShardSplit[]>;
};

export type HistoryManifest = {
  generatedAt: number;
  numShards: number;
  range: string;
  interval: string;
  shards: Array<{ shard: number; url: string; size: number }>;
};

/**
 * Pick a Yahoo Finance `range` parameter wide enough to bridge
 * "last day in the shard" → "now" with headroom, given the
 * shard's generation timestamp. Used by the API route's trailing
 * splice — when the monthly cron is on time, a 3mo window has
 * two months of slack; when the cron is overdue (user-reported
 * gaps of several months at one point), the window widens so
 * the merged chart stays gap-free.
 *
 * Capped at 2y because beyond that the trailing payload becomes
 * too heavy for what's supposed to be a small splice request.
 * If a shard ever falls > 2 years behind, the chart will have an
 * irreducible right-edge gap — but the historical part of the
 * cache is still served (better a chart with a gap than no chart
 * at all; dynamic Yahoo+Finnhub fallback is unreliable from
 * Vercel IPs, which is the whole reason the static cache exists).
 *
 * Lives in this module rather than alongside the route handler
 * because Next.js route files only allow specific exports
 * (HTTP method handlers + a small set of config keys); a
 * separate import is the path to a unit-testable helper.
 */
export function pickTrailingRange(shardGeneratedAt: number): string {
  const daysSince = (Date.now() - shardGeneratedAt) / 86_400_000;
  if (daysSince <= 60) return "3mo";
  if (daysSince <= 150) return "6mo";
  if (daysSince <= 330) return "1y";
  return "2y";
}
