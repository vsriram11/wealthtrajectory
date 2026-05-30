#!/usr/bin/env node
/**
 * Refresh historical price data for the ETF universe and upload to
 * Vercel Blob in 32 hash-sharded JSON files.
 *
 * Output: 32 files at `quote-history/shard-NN.json` (NN ∈ 00..31)
 * served from Vercel Blob's CDN. Each shard ~30-40 tickers ≈
 * 2-3 MB raw, ~500-800 KB gzipped. Client maps ticker → shard via
 * the same hash function in `lib/data/historyShards.ts`, fetches
 * only the shards covering its actual holdings.
 *
 * Free-tier safety:
 *  - Writes: 32 per refresh × 12 refreshes/year = 384/yr → well
 *    under 2000/mo cap.
 *  - Reads (origin ops): only on CDN miss/refill, ~20 regions × 32
 *    shards = 640 ops per global cache refresh.
 *  - Transfer: ~25 MB origin per global refresh.
 *
 * Run: `npx tsx scripts/refresh-history.ts` (sets `BLOB_READ_WRITE_TOKEN`
 * from env). GitHub Action wires this up monthly.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { put } from "@vercel/blob";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const browserHeaders = () => ({
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
});

const NUM_SHARDS = 32;
const HISTORY_RANGE = "10y";
const HISTORY_INTERVAL = "1d";
const FETCH_SPACING_MS = 200; // polite throttle, ~5 req/s
const UNIVERSE_PATH = resolve(process.cwd(), "data", "etf-universe.json");

/**
 * Deterministic shard hash. MUST match `lib/data/historyShards.ts`'s
 * `shardForSymbol`. Simple FNV-1a so JS + Node agree byte-for-byte.
 */
function shardForSymbol(symbol: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % NUM_SHARDS;
}

type HistoryPoint = [number, number]; // [t_ms, price]
type ShardPayload = Record<string, HistoryPoint[]>;

async function fetchHistory(symbol: string): Promise<HistoryPoint[] | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${HISTORY_RANGE}&interval=${HISTORY_INTERVAL}`;
  try {
    const res = await fetch(url, { headers: browserHeaders() });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    if (ts.length === 0 || closes.length === 0) return null;
    const out: HistoryPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const p = closes[i];
      if (typeof p === "number" && Number.isFinite(p) && p > 0) {
        out.push([ts[i] * 1000, p]);
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function main() {
  // Stage 1: load the universe.
  const universeRaw = await readFile(UNIVERSE_PATH, "utf8");
  const { tickers } = JSON.parse(universeRaw) as { tickers: string[] };
  console.log(`Universe: ${tickers.length} tickers`);

  // Stage 2: bucket by shard before fetching (so we don't have to
  // resort later AND so a partial run still produces complete
  // shards for the tickers it covered).
  const shards: ShardPayload[] = Array.from({ length: NUM_SHARDS }, () => ({}));
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    const shardIdx = shardForSymbol(t);
    const history = await fetchHistory(t);
    if (history) shards[shardIdx][t] = history;
    if (i % 50 === 0 && i > 0) {
      const filled = shards.reduce((s, sh) => s + Object.keys(sh).length, 0);
      console.log(
        `  ${i}/${tickers.length} processed, ${filled} populated`,
      );
    }
    await new Promise((r) => setTimeout(r, FETCH_SPACING_MS));
  }
  const totalPopulated = shards.reduce((s, sh) => s + Object.keys(sh).length, 0);
  console.log(`Total populated: ${totalPopulated}/${tickers.length}`);

  // Stage 3: upload each shard to Vercel Blob. Long cache header
  // (a year, the file's also content-addressable via the
  // generatedAt timestamp inside the payload — clients re-fetch
  // when the URL changes via deploy).
  console.log(`Uploading ${NUM_SHARDS} shards to Vercel Blob…`);
  const blobUrls: Array<{ shard: number; url: string; size: number }> = [];
  const generatedAt = Date.now();
  for (let i = 0; i < NUM_SHARDS; i++) {
    const payload = JSON.stringify({ generatedAt, tickers: shards[i] });
    const size = Buffer.byteLength(payload, "utf8");
    // Pad shard index for stable URL ordering.
    const name = `quote-history/shard-${String(i).padStart(2, "0")}.json`;
    const { url } = await put(name, payload, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false, // stable URL → CDN cache stays warm
      cacheControlMaxAge: 60 * 60 * 24 * 30, // 30 days
      allowOverwrite: true,
    });
    blobUrls.push({ shard: i, url, size });
    console.log(`  shard ${i}: ${(size / 1024).toFixed(0)} KB → ${url}`);
  }

  // Stage 4: write a manifest pointing at the blob URLs. This is
  // ALSO uploaded so the API route can discover the shard URLs at
  // runtime without hard-coding them.
  const manifest = {
    generatedAt,
    numShards: NUM_SHARDS,
    range: HISTORY_RANGE,
    interval: HISTORY_INTERVAL,
    shards: blobUrls,
  };
  const { url: manifestUrl } = await put(
    "quote-history/manifest.json",
    JSON.stringify(manifest, null, 2),
    {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24, // 1 day — manifest changes per refresh
      allowOverwrite: true,
    },
  );
  console.log(`Manifest uploaded: ${manifestUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
