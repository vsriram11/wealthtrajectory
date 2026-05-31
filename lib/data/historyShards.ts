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
 * market cap). At ~17y daily history, each shard is ~1.3 MB raw
 * / ~300 KB gzipped — small enough that a typical user with
 * 20 holdings downloads ~20 × 300 KB ≈ 6 MB on first load
 * (cached forever in IDB after).
 *
 * Free-tier safety at 256 shards:
 *   - Writes: 256/refresh × 12 refreshes/year = 256/month. Well
 *     under the 2000/month Vercel Blob cap.
 *   - Reads (origin ops): 256 × ~20 regions per refresh ≈ 5,120/
 *     month. Under the 10k/month cap.
 *   - Blob origin transfer: 256 × 300 KB × 20 regions ≈ 1.5 GB/
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

export type ShardPayload = {
  generatedAt: number;
  tickers: Record<string, ShardHistoryPoint[]>;
};

export type HistoryManifest = {
  generatedAt: number;
  numShards: number;
  range: string;
  interval: string;
  shards: Array<{ shard: number; url: string; size: number }>;
};
