#!/usr/bin/env node
/**
 * Refresh historical price data for the universe (top ETFs + top
 * stocks by market cap) and upload to Vercel Blob as hash-sharded
 * JSON files. Shard count + hash live in `lib/data/historyShards.ts`
 * — both the script's bucketing and the route's lookup MUST agree,
 * so they share that single source of truth.
 *
 * Output: NUM_HISTORY_SHARDS files at
 * `quote-history/<generatedAt>/shard-NNN.json` served from Vercel
 * Blob's CDN, plus a stable `quote-history/manifest.json` that
 * indexes them. Each shard at the current 256-count is ~17 tickers
 * × ~75 KB ≈ 1.3 MB raw / ~300 KB gzipped.
 *
 * Free-tier safety analysis lives in `lib/data/historyShards.ts`
 * next to NUM_HISTORY_SHARDS.
 *
 * Run: `npx tsx scripts/refresh-history.ts` (sets
 * `BLOB_READ_WRITE_TOKEN` from env). GitHub Action wires this up
 * monthly.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { put } from "@vercel/blob";

import {
  NUM_HISTORY_SHARDS,
  shardForSymbol,
} from "../lib/data/historyShards";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const browserHeaders = (extra?: Record<string, string>) => ({
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  ...(extra ?? {}),
});

// Session warm-up: even from GitHub IPs, Yahoo's WAF prefers
// requests carrying an established session cookie. Module-level
// cache so all subsequent fetches in this run share one session.
let sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string | null> {
  if (sessionCookie) return sessionCookie;
  try {
    const res = await fetch("https://fc.yahoo.com/", {
      headers: browserHeaders(),
      redirect: "manual",
    });
    const cookies: string[] = [];
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") cookies.push(v);
    });
    if (cookies.length === 0) return null;
    sessionCookie = cookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    return sessionCookie;
  } catch {
    return null;
  }
}

// Yahoo's chart endpoint accepts period1/period2 (UNIX seconds)
// for an exact start/end window — preferred over `range=10y`
// which depends on the wall-clock time the cron runs.
//
// Start at Jan 1 2007 to give the chart "All" view 17+ years of
// history. Tickers that didn't exist that far back (TQQQ started
// 2010, BITO started 2021, etc.) simply have data from their
// inception. Yahoo returns whatever's available within the window.
const HISTORY_PERIOD1_SEC = Math.floor(
  new Date("2007-01-01T00:00:00Z").getTime() / 1000,
);
const HISTORY_INTERVAL = "1d";
const FETCH_SPACING_MS = 200; // polite throttle, ~5 req/s
const UNIVERSE_PATH = resolve(process.cwd(), "data", "etf-universe.json");

type HistoryPoint = [number, number]; // [t_ms, price]
type ShardPayload = Record<string, HistoryPoint[]>;

async function fetchHistory(
  symbol: string,
  attempt = 1,
): Promise<HistoryPoint[] | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${HISTORY_PERIOD1_SEC}&period2=${period2}&interval=${HISTORY_INTERVAL}`;
  try {
    const cookie = await getSessionCookie();
    const headers = browserHeaders(cookie ? { Cookie: cookie } : undefined);
    const res = await fetch(url, { headers });
    // Retry once with backoff on transient 429/5xx — partial
    // failures previously DROPPED tickers from the shard (the
    // refresh writes wholesale overwrites). One retry catches
    // most Yahoo blips without doubling the run length.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return fetchHistory(symbol, attempt + 1);
    }
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

/**
 * Fetch the previously-published manifest + shards so we can merge
 * any tickers that fail to refetch this run. Without this, a
 * single Yahoo 429 silently DROPS a ticker from the published
 * shard until next month (allowOverwrite=true publishes wholesale).
 *
 * The shard payload from `quote-history/manifest.json` is the
 * source of truth — but the well-known URL only resolves if a
 * prior run completed successfully. On the first ever run, no
 * manifest exists; we treat that as "nothing to merge" and proceed.
 */
async function loadPriorShards(
  blobBaseUrl: string,
): Promise<ShardPayload[] | null> {
  const url = `${blobBaseUrl}quote-history/manifest.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const manifest = (await res.json()) as {
      shards?: Array<{ shard: number; url: string }>;
    };
    if (!manifest.shards) return null;
    const prior: ShardPayload[] = Array.from(
      { length: NUM_HISTORY_SHARDS },
      () => ({}),
    );
    for (const s of manifest.shards) {
      try {
        const r = await fetch(s.url, { cache: "no-store" });
        if (!r.ok) continue;
        const payload = (await r.json()) as {
          tickers?: ShardPayload;
        };
        if (payload.tickers && typeof payload.tickers === "object") {
          prior[s.shard] = payload.tickers;
        }
      } catch {
        // Skip; this shard contributes no prior data.
      }
    }
    return prior;
  } catch {
    return null;
  }
}

/**
 * Pre-upload sanity check on the in-memory shard set. Distinguishes
 * FATAL conditions (would actively serve worse data than the prior
 * manifest — abort, don't publish) from WARNINGS (small issues that
 * should be visible in the logs but don't justify holding the whole
 * refresh).
 *
 * Tunable thresholds err on the SOFT side: false positives waste
 * one cron run; false negatives publish bad data. Better to skip
 * an occasional refresh than to corrupt the cache.
 */
function validateShards(
  shards: ShardPayload[],
  priorTickerCount: number,
): { fatal: string[]; warnings: string[]; summary: string } {
  const fatal: string[] = [];
  const warnings: string[] = [];

  const total = shards.reduce((s, sh) => s + Object.keys(sh).length, 0);
  let pathologicallyShort = 0;
  let nonFiniteValues = 0;
  let totalPoints = 0;
  for (const shard of shards) {
    for (const points of Object.values(shard)) {
      totalPoints += points.length;
      if (points.length < 30) pathologicallyShort++;
      for (const pt of points) {
        if (
          !Array.isArray(pt) ||
          pt.length !== 2 ||
          !Number.isFinite(pt[0]) ||
          pt[0] <= 0 ||
          !Number.isFinite(pt[1]) ||
          pt[1] <= 0
        ) {
          nonFiniteValues++;
        }
      }
    }
  }

  // FATAL: catastrophic fetch loss. If we have far fewer tickers
  // than the prior run, something went badly wrong (Yahoo blanket
  // 429, parser regression, etc.). Threshold: lose more than 20%
  // of prior coverage = abort.
  if (priorTickerCount > 0 && total < priorTickerCount * 0.8) {
    fatal.push(
      `ticker coverage dropped from ${priorTickerCount} → ${total} (${((1 - total / priorTickerCount) * 100).toFixed(1)}% loss; > 20% triggers abort)`,
    );
  }

  // FATAL: any non-finite or non-positive data point — these
  // would crash the chart's binary search or produce NaN NW
  // values for users.
  if (nonFiniteValues > 0) {
    fatal.push(
      `${nonFiniteValues} data points are non-finite / non-positive — refusing to publish`,
    );
  }

  // FATAL: absolute floor. Even a brand-new install should not
  // produce fewer than 100 tickers — anything less means fetch
  // catastrophically failed.
  if (total < 100) {
    fatal.push(
      `total tickers ${total} < absolute floor (100); fetch failure suspected`,
    );
  }

  // WARN: holdings with very few data points. Could be a brand-
  // new ticker (legit — only 30 days of history) or a fetch
  // partial failure (only some points returned). Surface for
  // visibility but don't block.
  if (pathologicallyShort > total * 0.05) {
    warnings.push(
      `${pathologicallyShort} tickers (${((pathologicallyShort / total) * 100).toFixed(1)}%) have < 30 data points`,
    );
  }

  return {
    fatal,
    warnings,
    summary: `${total} tickers, ${totalPoints.toLocaleString()} data points, ${pathologicallyShort} sparse, ${nonFiniteValues} bad`,
  };
}

async function main() {
  // Stage 1: load the universe.
  const universeRaw = await readFile(UNIVERSE_PATH, "utf8");
  const { tickers } = JSON.parse(universeRaw) as { tickers: string[] };
  console.log(`Universe: ${tickers.length} tickers`);

  // Stage 2: prior-shard fetch (so we can merge tickers that fail
  // to refetch this run instead of dropping them wholesale).
  const blobBaseUrl = process.env.NEXT_PUBLIC_QUOTE_HISTORY_BLOB_BASE;
  let priorShards: ShardPayload[] | null = null;
  if (blobBaseUrl) {
    console.log(`Loading prior shards from ${blobBaseUrl}…`);
    priorShards = await loadPriorShards(blobBaseUrl);
    if (priorShards) {
      const priorCount = priorShards.reduce(
        (s, sh) => s + Object.keys(sh).length,
        0,
      );
      console.log(`  → ${priorCount} prior tickers loaded`);
    } else {
      console.log(`  → no prior manifest (first run, or fetch failed)`);
    }
  }

  // Stage 3: fetch + bucket by shard. Start from prior contents so
  // tickers we fail to refetch this run keep their last-good data.
  const shards: ShardPayload[] = priorShards
    ? priorShards.map((s) => ({ ...s }))
    : Array.from({ length: NUM_HISTORY_SHARDS }, () => ({}));
  let refreshedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    const shardIdx = shardForSymbol(t);
    const history = await fetchHistory(t);
    if (history) {
      shards[shardIdx][t] = history;
      refreshedCount++;
    } else {
      // Keep prior data for this ticker if we have it; only counts
      // as failed if the ticker is entirely missing now.
      if (!(t in shards[shardIdx])) failedCount++;
    }
    if (i % 50 === 0 && i > 0) {
      console.log(
        `  ${i}/${tickers.length} processed (refreshed=${refreshedCount}, missing=${failedCount})`,
      );
    }
    await new Promise((r) => setTimeout(r, FETCH_SPACING_MS));
  }
  const totalPopulated = shards.reduce(
    (s, sh) => s + Object.keys(sh).length,
    0,
  );
  console.log(
    `Refreshed: ${refreshedCount}/${tickers.length}, missing: ${failedCount}, total in shards (with prior merges): ${totalPopulated}`,
  );

  // Stage 3.5: PRE-UPLOAD VALIDATION.
  //
  // Don't push corrupted data over a known-good prior version.
  // Rate-limited runs, parser bugs, or stale JSON in the prior
  // manifest could leave the in-memory shards in a degraded state
  // that's WORSE than not refreshing. Concrete failure modes
  // we're checking for:
  //   - Catastrophic fetch loss (e.g., Yahoo rate-limited every
  //     single ticker for the entire run; shard set is mostly
  //     empty or has < the universe size — strong signal something
  //     went wrong rather than just an off month).
  //   - Non-finite or negative prices smuggled in via a parser
  //     edge case.
  //   - Per-ticker histories that are pathologically short
  //     (single data point, all-zero series, etc.).
  //   - Significant regression vs the prior shard set's coverage.
  //
  // On hard failure: abort BEFORE the atomic manifest swap. The
  // prior manifest stays live; users continue getting the
  // last-good cache. On soft warnings: log + proceed (the new
  // data is mostly good, log lets the operator notice).
  const priorTickerCount = priorShards
    ? priorShards.reduce((s, sh) => s + Object.keys(sh).length, 0)
    : 0;
  const validation = validateShards(shards, priorTickerCount);
  if (validation.fatal.length > 0) {
    console.error("FATAL pre-upload validation failures:");
    for (const f of validation.fatal) console.error(`  - ${f}`);
    console.error(
      "Aborting upload. Prior manifest at quote-history/manifest.json stays live.",
    );
    process.exit(2);
  }
  if (validation.warnings.length > 0) {
    console.warn("Pre-upload validation warnings (proceeding):");
    for (const w of validation.warnings) console.warn(`  - ${w}`);
  }
  console.log(
    `Validation passed: ${validation.summary} (proceeding with upload)`,
  );

  // Stage 4: ATOMIC PUBLISH.
  //
  // Upload every shard FIRST under a versioned prefix
  // (`quote-history/<generatedAt>/shard-NN.json`) — those URLs
  // never collide with the previously-published set. Only THEN
  // upload the manifest at the well-known path
  // `quote-history/manifest.json` pointing at the new versioned
  // URLs.
  //
  // If the job crashes / is cancelled mid-shard-upload, the
  // manifest is still pointing at the previous version's URLs and
  // clients keep getting consistent old data. Without versioning,
  // a partial overwrite leaves clients seeing a Frankenstein mix
  // of old + new shards.
  const generatedAt = Date.now();
  const versionPrefix = `quote-history/${generatedAt}`;
  console.log(`Uploading ${NUM_HISTORY_SHARDS} shards under ${versionPrefix}/…`);
  const blobUrls: Array<{ shard: number; url: string; size: number }> = [];
  for (let i = 0; i < NUM_HISTORY_SHARDS; i++) {
    const payload = JSON.stringify({ generatedAt, tickers: shards[i] });
    const size = Buffer.byteLength(payload, "utf8");
    // 3-digit zero-padding accommodates up to 999 shards;
    // current cap is 256.
    const name = `${versionPrefix}/shard-${String(i).padStart(3, "0")}.json`;
    const { url } = await put(name, payload, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365, // 1y (URLs are versioned, never collide)
      allowOverwrite: true,
    });
    blobUrls.push({ shard: i, url, size });
    if (i % 8 === 0) {
      console.log(`  shard ${i}: ${(size / 1024).toFixed(0)} KB`);
    }
  }

  // Stage 5: atomically swap the manifest. This is the SINGLE
  // moment of cutover — readers see either the entire prior
  // version OR the entire new version, never a mix.
  const manifest = {
    generatedAt,
    numShards: NUM_HISTORY_SHARDS,
    range: `period1=${HISTORY_PERIOD1_SEC} (${new Date(HISTORY_PERIOD1_SEC * 1000).toISOString().slice(0, 10)})`,
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
      // Short TTL on the manifest itself — clients must pick up
      // a new version promptly. The versioned shard URLs they
      // point at can have long TTLs (they're immutable).
      cacheControlMaxAge: 60 * 5, // 5 min
      allowOverwrite: true,
    },
  );
  console.log(`Manifest uploaded: ${manifestUrl}`);
  console.log(`Atomic swap complete: generatedAt=${generatedAt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
