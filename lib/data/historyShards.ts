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

export const NUM_HISTORY_SHARDS = 32;

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
