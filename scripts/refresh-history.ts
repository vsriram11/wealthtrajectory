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

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { list, put, del } from "@vercel/blob";

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
// Start at Dec 1 2005 to give the chart "All" view 20+ years of
// history AND a full quarter of dividend data BEFORE 2006 begins
// (most large-cap ETFs pay quarterly Q4 dividends in Dec — a
// Jan 1 2007 cutoff would clip the 2006 Q4 distribution). Tickers
// that didn't exist that far back (TQQQ started 2010, BITO 2021,
// etc.) simply have data from their inception. Yahoo returns
// whatever's available within the window.
const HISTORY_PERIOD1_SEC = Math.floor(
  new Date("2005-12-01T00:00:00Z").getTime() / 1000,
);
const HISTORY_INTERVAL = "1d";
const FETCH_SPACING_MS = 200; // polite throttle, ~5 req/s
const UNIVERSE_PATH = resolve(process.cwd(), "data", "etf-universe.json");

// Resume-checkpoint path + freshness rules.
//
// The fetch loop is the slowest stage (~13 min for 4000 tickers
// at 200ms throttle). When the upload stage subsequently fails
// (storage quota, blob API hiccup, etc.), we want re-runs to skip
// the Yahoo round-trip and resume at upload. The checkpoint
// captures validated shards + corporate-action streams to a local
// JSON file; the next run loads it and jumps straight to pre-GC +
// upload.
//
// TTL: 24h. Prices stale beyond that → force fresh fetch.
// Universe hash: rejects checkpoint when etf-universe.json has
//   changed since the checkpoint was written (otherwise we'd
//   publish a stale ticker set).
// File: tmp/ is gitignored. ~520 MB at full universe; fits local
//   disk easily, not committed.
const CHECKPOINT_PATH = resolve(
  process.cwd(),
  "tmp",
  "refresh-checkpoint.json",
);
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

type HistoryPoint = [number, number]; // [t_ms, price]
type DividendEvent = [number, number]; // [t_ms, amount_per_share]
type SplitEvent = [number, number, number]; // [t_ms, numerator, denominator]

type TickerShard = Record<string, HistoryPoint[]>;
type DividendShard = Record<string, DividendEvent[]>;
type SplitShard = Record<string, SplitEvent[]>;

/**
 * Bundled fetch result from a single Yahoo /v8/finance/chart call
 * with `events=div,split` — prices AND corporate-action streams
 * in one round-trip. A ticker with no dividend/split history
 * (e.g., most leveraged ETFs) returns empty arrays, not null.
 */
type FetchedHistory = {
  prices: HistoryPoint[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
};

async function fetchHistory(
  symbol: string,
  attempt = 1,
): Promise<FetchedHistory | null> {
  const period2 = Math.floor(Date.now() / 1000);
  // `events=div,split` adds Yahoo's `events.dividends` +
  // `events.splits` objects to the response alongside the
  // existing price series. One call, three data streams.
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${HISTORY_PERIOD1_SEC}&period2=${period2}&interval=${HISTORY_INTERVAL}&events=div,split`;
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
          events?: {
            dividends?: Record<
              string,
              { amount?: number; date?: number }
            >;
            splits?: Record<
              string,
              {
                date?: number;
                numerator?: number;
                denominator?: number;
              }
            >;
          };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const closes = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    if (ts.length === 0 || closes.length === 0) return null;
    const prices: HistoryPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const p = closes[i];
      if (typeof p === "number" && Number.isFinite(p) && p > 0) {
        prices.push([ts[i] * 1000, p]);
      }
    }
    if (prices.length === 0) return null;

    // Parse corporate-action events. Yahoo keys both maps by
    // unix-second timestamp string; the inner objects also carry
    // `date` (same value as the key) — we use `date` when present,
    // fall back to the key. Drop anything non-finite / non-positive
    // rather than poison the stream.
    const dividends: DividendEvent[] = [];
    const divMap = result.events?.dividends ?? {};
    for (const [key, ev] of Object.entries(divMap)) {
      const tsec = typeof ev.date === "number" ? ev.date : Number(key);
      const amt = ev.amount;
      if (
        Number.isFinite(tsec) &&
        tsec > 0 &&
        typeof amt === "number" &&
        Number.isFinite(amt) &&
        amt > 0
      ) {
        dividends.push([tsec * 1000, amt]);
      }
    }
    dividends.sort((a, b) => a[0] - b[0]);

    const splits: SplitEvent[] = [];
    const splitMap = result.events?.splits ?? {};
    for (const [key, ev] of Object.entries(splitMap)) {
      const tsec = typeof ev.date === "number" ? ev.date : Number(key);
      const num = ev.numerator;
      const den = ev.denominator;
      if (
        Number.isFinite(tsec) &&
        tsec > 0 &&
        typeof num === "number" &&
        Number.isFinite(num) &&
        num > 0 &&
        typeof den === "number" &&
        Number.isFinite(den) &&
        den > 0
      ) {
        splits.push([tsec * 1000, num, den]);
      }
    }
    splits.sort((a, b) => a[0] - b[0]);

    return { prices, dividends, splits };
  } catch {
    return null;
  }
}

/**
 * Composite prior-shard state: prices + dividends + splits, each
 * already bucketed by shard index. Refresh merges per-stream so
 * a Yahoo failure on this run doesn't drop prior corporate-action
 * data either.
 */
type PriorShardState = {
  tickers: TickerShard[];
  dividends: DividendShard[];
  splits: SplitShard[];
};

/**
 * Fetch the previously-published manifest + shards so we can merge
 * any tickers that fail to refetch this run. Without this, a
 * single Yahoo 429 silently DROPS a ticker from the published
 * shard until next month (allowOverwrite=true publishes wholesale).
 *
 * Reads three parallel streams per shard: `tickers` (prices),
 * `dividends`, `splits`. Older shards generated before dividend
 * support landed simply lack the latter two keys — we treat them
 * as empty maps and let the current run populate them.
 *
 * The shard payload from `quote-history/manifest.json` is the
 * source of truth — but the well-known URL only resolves if a
 * prior run completed successfully. On the first ever run, no
 * manifest exists; we treat that as "nothing to merge" and proceed.
 */
async function loadPriorShards(
  blobBaseUrl: string,
): Promise<PriorShardState | null> {
  const url = `${blobBaseUrl}quote-history/manifest.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const manifest = (await res.json()) as {
      shards?: Array<{ shard: number; url: string }>;
    };
    if (!manifest.shards) return null;
    const prior: PriorShardState = {
      tickers: Array.from({ length: NUM_HISTORY_SHARDS }, () => ({})),
      dividends: Array.from({ length: NUM_HISTORY_SHARDS }, () => ({})),
      splits: Array.from({ length: NUM_HISTORY_SHARDS }, () => ({})),
    };
    for (const s of manifest.shards) {
      try {
        const r = await fetch(s.url, { cache: "no-store" });
        if (!r.ok) continue;
        const payload = (await r.json()) as {
          tickers?: TickerShard;
          dividends?: DividendShard;
          splits?: SplitShard;
        };
        if (payload.tickers && typeof payload.tickers === "object") {
          prior.tickers[s.shard] = payload.tickers;
        }
        // Optional keys — older shards (pre-dividend-support) won't
        // have them. Defaulting to {} keeps backward compat.
        if (payload.dividends && typeof payload.dividends === "object") {
          prior.dividends[s.shard] = payload.dividends;
        }
        if (payload.splits && typeof payload.splits === "object") {
          prior.splits[s.shard] = payload.splits;
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
  shards: TickerShard[],
  dividendShards: DividendShard[],
  splitShards: SplitShard[],
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

  // Corporate-action shape check: dividend events must be
  // [t_ms, amount_per_share] with positive finite values; split
  // events must be [t_ms, num, den] with positive finite ratios.
  // These can't be FATAL on "low count" because most ETFs have no
  // splits in 20y and many leveraged products don't pay dividends
  // — but malformed events would later crash the consumer code,
  // so a single bad event aborts.
  let totalDividendEvents = 0;
  let totalSplitEvents = 0;
  let badEvents = 0;
  for (const shard of dividendShards) {
    for (const events of Object.values(shard)) {
      totalDividendEvents += events.length;
      for (const ev of events) {
        if (
          !Array.isArray(ev) ||
          ev.length !== 2 ||
          !Number.isFinite(ev[0]) ||
          ev[0] <= 0 ||
          !Number.isFinite(ev[1]) ||
          ev[1] <= 0
        ) {
          badEvents++;
        }
      }
    }
  }
  for (const shard of splitShards) {
    for (const events of Object.values(shard)) {
      totalSplitEvents += events.length;
      for (const ev of events) {
        if (
          !Array.isArray(ev) ||
          ev.length !== 3 ||
          !Number.isFinite(ev[0]) ||
          ev[0] <= 0 ||
          !Number.isFinite(ev[1]) ||
          ev[1] <= 0 ||
          !Number.isFinite(ev[2]) ||
          ev[2] <= 0
        ) {
          badEvents++;
        }
      }
    }
  }
  if (badEvents > 0) {
    fatal.push(
      `${badEvents} dividend/split events are malformed — refusing to publish`,
    );
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
    summary: `${total} tickers, ${totalPoints.toLocaleString()} price points, ${totalDividendEvents.toLocaleString()} dividends, ${totalSplitEvents.toLocaleString()} splits, ${pathologicallyShort} sparse, ${nonFiniteValues + badEvents} bad`,
  };
}

/**
 * Deterministic hash of the universe ticker list — used to detect
 * etf-universe.json changes between a checkpoint write and a
 * subsequent resume attempt. If the universe has shifted (new
 * tickers added, old ones dropped), the checkpoint's shard set
 * is wrong for the current run; reject and re-fetch.
 *
 * FNV-1a 32-bit — same family as shardForSymbol, but operates on
 * the whole sorted list so reorderings don't false-positive.
 */
function universeHash(tickers: string[]): string {
  const sorted = [...tickers].sort();
  let h = 0x811c9dc5;
  for (const t of sorted) {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // Separator byte (0x1f, "unit separator") so ["AB","C"] and
    // ["A","BC"] hash differently.
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

type Checkpoint = {
  createdAt: number;
  universeHash: string;
  shards: TickerShard[];
  dividendShards: DividendShard[];
  splitShards: SplitShard[];
};

async function loadCheckpoint(
  expectedHash: string,
): Promise<Checkpoint | null> {
  let raw: string;
  try {
    raw = await readFile(CHECKPOINT_PATH, "utf8");
  } catch {
    return null; // no checkpoint, normal case
  }
  let cp: Checkpoint;
  try {
    cp = JSON.parse(raw) as Checkpoint;
  } catch (e) {
    console.warn(
      `Checkpoint at ${CHECKPOINT_PATH} is corrupted (${e instanceof Error ? e.message : e}); ignoring.`,
    );
    return null;
  }
  // Sanity-check the structural shape — if any of these fail the
  // checkpoint is unusable and we fall back to a fresh fetch.
  if (
    typeof cp.createdAt !== "number" ||
    typeof cp.universeHash !== "string" ||
    !Array.isArray(cp.shards) ||
    cp.shards.length !== NUM_HISTORY_SHARDS ||
    !Array.isArray(cp.dividendShards) ||
    cp.dividendShards.length !== NUM_HISTORY_SHARDS ||
    !Array.isArray(cp.splitShards) ||
    cp.splitShards.length !== NUM_HISTORY_SHARDS
  ) {
    console.warn("Checkpoint shape invalid; ignoring.");
    return null;
  }
  if (Date.now() - cp.createdAt > CHECKPOINT_TTL_MS) {
    console.log(
      `Checkpoint is ${Math.round((Date.now() - cp.createdAt) / 3600_000)}h old (> 24h TTL); ignoring.`,
    );
    return null;
  }
  if (cp.universeHash !== expectedHash) {
    console.log(
      "Checkpoint universe hash mismatch (etf-universe.json changed); ignoring.",
    );
    return null;
  }
  return cp;
}

async function saveCheckpoint(
  uHash: string,
  shards: TickerShard[],
  dividendShards: DividendShard[],
  splitShards: SplitShard[],
): Promise<void> {
  const cp: Checkpoint = {
    createdAt: Date.now(),
    universeHash: uHash,
    shards,
    dividendShards,
    splitShards,
  };
  await mkdir(resolve(CHECKPOINT_PATH, ".."), { recursive: true });
  const payload = JSON.stringify(cp);
  await writeFile(CHECKPOINT_PATH, payload);
  console.log(
    `Checkpoint saved: ${(payload.length / 1024 / 1024).toFixed(0)} MB at ${CHECKPOINT_PATH}`,
  );
}

async function deleteCheckpoint(): Promise<void> {
  try {
    await unlink(CHECKPOINT_PATH);
    console.log("Checkpoint cleared (publish succeeded).");
  } catch {
    /* not present is fine */
  }
}

async function main() {
  // Stage 1: load the universe.
  const universeRaw = await readFile(UNIVERSE_PATH, "utf8");
  const { tickers } = JSON.parse(universeRaw) as { tickers: string[] };
  console.log(`Universe: ${tickers.length} tickers`);
  const uHash = universeHash(tickers);

  // Stage 1.5: check for a resume checkpoint. If a recent run got
  // through validation but failed during upload, the checkpoint
  // holds the validated shard set — we can skip Stages 2-3 entirely
  // and resume at pre-GC + upload.
  const checkpoint = await loadCheckpoint(uHash);
  if (checkpoint) {
    const ageMin = Math.round((Date.now() - checkpoint.createdAt) / 60_000);
    const tickerCount = checkpoint.shards.reduce(
      (s, sh) => s + Object.keys(sh).length,
      0,
    );
    console.log(
      `Resuming from checkpoint (${ageMin} min old, ${tickerCount} tickers). Skipping Yahoo fetch.`,
    );
  }

  // Stage 2: prior-shard fetch (so we can merge tickers that fail
  // to refetch this run instead of dropping them wholesale). Loads
  // prices + dividends + splits in parallel — each stream merges
  // independently.
  //
  // Skipped on resume: the checkpoint already contains the merged
  // shard set; we don't need the prior state to seed anything.
  const blobBaseUrl = process.env.NEXT_PUBLIC_QUOTE_HISTORY_BLOB_BASE;
  let priorState: PriorShardState | null = null;
  if (!checkpoint && blobBaseUrl) {
    console.log(`Loading prior shards from ${blobBaseUrl}…`);
    priorState = await loadPriorShards(blobBaseUrl);
    if (priorState) {
      const priorCount = priorState.tickers.reduce(
        (s, sh) => s + Object.keys(sh).length,
        0,
      );
      const priorDivCount = priorState.dividends.reduce(
        (s, sh) => s + Object.keys(sh).length,
        0,
      );
      console.log(
        `  → ${priorCount} prior tickers loaded (${priorDivCount} with prior dividend data)`,
      );
    } else {
      console.log(`  → no prior manifest (first run, or fetch failed)`);
    }
  }

  // Stage 3: fetch + bucket by shard. Start from prior contents so
  // tickers we fail to refetch this run keep their last-good data
  // (prices AND corporate-action streams).
  //
  // On resume: the checkpoint's shards ARE the validated set; drop
  // them straight into the working buffers and skip the Yahoo loop.
  const shards: TickerShard[] = checkpoint
    ? checkpoint.shards
    : priorState
      ? priorState.tickers.map((s) => ({ ...s }))
      : Array.from({ length: NUM_HISTORY_SHARDS }, () => ({}));
  const dividendShards: DividendShard[] = checkpoint
    ? checkpoint.dividendShards
    : priorState
    ? priorState.dividends.map((s) => ({ ...s }))
    : Array.from({ length: NUM_HISTORY_SHARDS }, () => ({}));
  const splitShards: SplitShard[] = checkpoint
    ? checkpoint.splitShards
    : priorState
    ? priorState.splits.map((s) => ({ ...s }))
    : Array.from({ length: NUM_HISTORY_SHARDS }, () => ({}));
  if (!checkpoint) {
    let refreshedCount = 0;
    let failedCount = 0;
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const shardIdx = shardForSymbol(t);
      const fetched = await fetchHistory(t);
      if (fetched) {
        shards[shardIdx][t] = fetched.prices;
        // Always replace dividend/split streams (don't try to merge
        // incrementally): the full window is refetched each run so
        // the freshly-parsed list is canonical for the [period1, now]
        // range. Empty arrays are still meaningful — they say "we
        // checked and this ticker has no dividends/splits."
        dividendShards[shardIdx][t] = fetched.dividends;
        splitShards[shardIdx][t] = fetched.splits;
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
  }

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
  const priorTickerCount = priorState
    ? priorState.tickers.reduce((s, sh) => s + Object.keys(sh).length, 0)
    : 0;
  const validation = validateShards(
    shards,
    dividendShards,
    splitShards,
    priorTickerCount,
  );
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

  // Stage 3.6: SAVE CHECKPOINT (only if we actually fetched this
  // run — on resume we already have a checkpoint and re-saving
  // would just rewrite the same 520 MB blob for no benefit).
  if (!checkpoint) {
    await saveCheckpoint(uHash, shards, dividendShards, splitShards);
  }

  // Stage 4: PRE-GC + PUBLISH.
  //
  // Storage constraint: with dividends + splits added and the
  // history window extended back to Dec 2005, the new generation
  // is ~520 MB on its own. The prior generation is ~510 MB.
  // Together they'd exceed the Vercel Hobby 1 GB cap, so the
  // "upload first, swap manifest, then GC" pattern doesn't fit.
  //
  // Instead we GC the prior generation BEFORE uploading the new
  // one. Trade-off: there's a ~5-minute window where the live
  // manifest still references the just-deleted shard URLs → those
  // GETs 404. Mitigations during the gap:
  //   - The client-side IDB cache (lib/data/quotes.ts) returns
  //     last-known prices when the upstream/static fetch fails,
  //     so popular tickers keep working from local history.
  //   - Long-tail tickers fall through to the dynamic Yahoo/
  //     Finnhub path as before — same behavior as today's cache
  //     misses, just for a few more symbols during the window.
  //   - For a personal app with one operator, the window is
  //     acceptable.
  //
  // If the upload fails partway, the manifest still references
  // deleted shards but the IDB fallback keeps the UI functional.
  // Re-running the script overwrites cleanly.
  const generatedAt = Date.now();
  console.log(
    "Pre-GC: freeing prior generation before upload (storage too tight for 2x simultaneously)…",
  );
  await garbageCollectOldGenerations(generatedAt);

  // Stage 4b: Upload every shard under a versioned prefix
  // (`quote-history/<generatedAt>/shard-NN.json`). URLs never
  // collide with the previously-published set; the new manifest
  // (stage 5) is the only thing that makes them discoverable.
  const versionPrefix = `quote-history/${generatedAt}`;
  console.log(`Uploading ${NUM_HISTORY_SHARDS} shards under ${versionPrefix}/…`);
  const blobUrls: Array<{ shard: number; url: string; size: number }> = [];
  for (let i = 0; i < NUM_HISTORY_SHARDS; i++) {
    // Shard payload shape — IMPORTANT for back-compat:
    //   - `tickers` (required, unchanged shape) — price series.
    //     The currently-deployed route reads ONLY this field, so
    //     adding new top-level keys is invisible to it.
    //   - `dividends` / `splits` (optional) — corporate-action
    //     streams. Older code ignores; newer code reads.
    // We always write the new keys (even if both maps are empty
    // for a shard) so the published artifact is self-describing.
    const payload = JSON.stringify({
      generatedAt,
      tickers: shards[i],
      dividends: dividendShards[i],
      splits: splitShards[i],
    });
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
  console.log(`Manifest swap complete: generatedAt=${generatedAt}`);

  // Stage 6: SAFETY-NET GC.
  //
  // Pre-GC (stage 4) already deleted the prior generation before
  // upload, so under normal flow there are no orphans to clean up
  // here. This second pass is defense-in-depth: if a future change
  // introduces a different leak source (e.g., a failed upload
  // retry leaving stale shards under an unexpected prefix), this
  // catches it. Cheap — list() is one Blob op when there's nothing
  // to delete.
  await garbageCollectOldGenerations(generatedAt);

  // Stage 7: clear the resume checkpoint. The publish succeeded;
  // there's nothing to resume to. Leaving the checkpoint in place
  // would just have the next run skip fetch when prices are stale.
  await deleteCheckpoint();
}

async function garbageCollectOldGenerations(currentGen: number): Promise<void> {
  console.log("GC: scanning for stale shard generations…");
  const toDelete: string[] = [];
  let cursor: string | undefined;
  try {
    do {
      const page = await list({
        prefix: "quote-history/",
        cursor,
        limit: 1000,
      });
      for (const b of page.blobs) {
        // Keep the well-known manifest path.
        if (b.pathname === "quote-history/manifest.json") continue;
        // Keep shards under the current (just-uploaded) generation.
        if (b.pathname.startsWith(`quote-history/${currentGen}/`)) continue;
        toDelete.push(b.url);
      }
      cursor = page.cursor;
    } while (cursor);
  } catch (e) {
    console.warn(
      `GC list failed: ${e instanceof Error ? e.message : e}; storage may grow this cycle.`,
    );
    return;
  }
  if (toDelete.length === 0) {
    console.log("GC: nothing to delete; storage already clean.");
    return;
  }
  console.log(`GC: deleting ${toDelete.length} stale blobs…`);
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const chunk = toDelete.slice(i, i + BATCH);
    try {
      await del(chunk);
      deleted += chunk.length;
    } catch (e) {
      console.warn(
        `GC delete batch ${i}-${i + chunk.length} failed: ${e instanceof Error ? e.message : e}`,
      );
      // Best-effort: continue with remaining batches. A failed
      // delete leaves an orphan but doesn't corrupt the cache.
    }
  }
  console.log(`GC: deleted ${deleted}/${toDelete.length} stale blobs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
