import { NextRequest } from "next/server";

import {
  NUM_HISTORY_SHARDS,
  pickTrailingRange,
  shardForSymbol,
  type HistoryManifest,
  type ShardPayload,
} from "@/lib/data/historyShards";

export const runtime = "nodejs";

const UA_VARIATIONS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

/**
 * Full browser-style header set for Yahoo Finance fetches.
 *
 * Vercel's serverless function IPs are heavily throttled by Yahoo's
 * WAF (every Vercel tenant scrapes Yahoo through the same IP pools).
 * From cleaner residential / GitHub-Action IPs, just a UA header is
 * enough to get 200s reliably — but on Vercel IPs the WAF demands
 * the full browser fingerprint (Sec-Fetch-*, Sec-CH-UA-*, full
 * Accept-* triplet) before relenting. Adding these is the
 * highest-leverage fix we can make to the dynamic-fetch path: it
 * doesn't avoid the IP problem entirely but materially shifts the
 * success rate.
 *
 * Sec-Fetch-Site=same-site claims the request originates from a
 * finance.yahoo.com subdomain — paired with the Origin / Referer
 * already set, it's the same fingerprint the real browser sends
 * when finance.yahoo.com client-side code fetches query2.
 */
function browserHeaders(ua: string): Record<string, string> {
  return {
    "User-Agent": ua,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://finance.yahoo.com/",
    Origin: "https://finance.yahoo.com",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Sec-CH-UA":
      '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    DNT: "1",
  };
}

/**
 * Module-level Yahoo session state. The cookie+crumb dance with
 * fc.yahoo.com → getcrumb establishes a session the WAF treats more
 * leniently. Cached per warm Vercel instance; re-established on
 * cold start or 24h staleness.
 */
let yahooSession: {
  cookie: string;
  crumb: string;
  fetchedAt: number;
} | null = null;
const YAHOO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function getYahooSession(
  ua: string,
): Promise<{ cookie: string; crumb: string } | null> {
  if (
    yahooSession &&
    Date.now() - yahooSession.fetchedAt < YAHOO_SESSION_TTL_MS
  ) {
    return { cookie: yahooSession.cookie, crumb: yahooSession.crumb };
  }
  try {
    const cookieRes = await fetch("https://fc.yahoo.com/", {
      headers: browserHeaders(ua),
      // Don't follow redirects — we just want the Set-Cookie headers.
      redirect: "manual",
    });
    const setCookies: string[] = [];
    cookieRes.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") setCookies.push(v);
    });
    if (setCookies.length === 0) return null;
    const cookie = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    const crumbRes = await fetch(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { ...browserHeaders(ua), Cookie: cookie },
      },
    );
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 32) return null; // sanity check
    yahooSession = { cookie, crumb, fetchedAt: Date.now() };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

// ── Static historical-price cache ────────────────────────────────
//
// Top-1000-by-AUM ETFs (plus the app's preset symbols) have their
// 10y daily history pre-fetched and uploaded to Vercel Blob as 32
// hash-shards by a monthly GitHub Action. The route consults the
// static cache FIRST: a hit returns instantly via Vercel's CDN
// (no upstream dependency, no rate-limit risk) and the rare
// trailing-days gap is filled by a small dynamic Yahoo call.
//
// The manifest URL lives in NEXT_PUBLIC_QUOTE_HISTORY_MANIFEST.
// When unset, we fall back to DEFAULT_MANIFEST_URL below — the
// project's well-known Vercel Blob URL. Without that fallback,
// every fresh Vercel deployment would silently skip the static
// cache and hammer Yahoo / Finnhub (user-reported on Production
// after PR #18: "VOO and MSFT return finnhub: no candle history
// | yahoo: 429" — env var was set on Preview but not Production,
// so Production never saw the cache).
//
// Forks of this repo should override the env var with their own
// Vercel Blob URL, or delete the constant if they want the
// dynamic fallback behavior.
const DEFAULT_MANIFEST_URL =
  "https://yr2lktc5f9ujt0cn.public.blob.vercel-storage.com/quote-history/manifest.json";
const QUOTE_HISTORY_MANIFEST_URL =
  process.env.NEXT_PUBLIC_QUOTE_HISTORY_MANIFEST || DEFAULT_MANIFEST_URL;

const STATIC_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
type ManifestCache = { manifest: HistoryManifest; fetchedAt: number };
let manifestCache: ManifestCache | null = null;
// Single-flight guard: concurrent requests to load the manifest
// share one in-flight fetch instead of racing N parallel fetches
// against the Blob CDN (Vercel-Blob counts these as billable ops).
let manifestInflight: Promise<HistoryManifest | null> | null = null;

async function loadManifest(): Promise<HistoryManifest | null> {
  const manifestUrl = QUOTE_HISTORY_MANIFEST_URL;
  if (!manifestUrl) return null;
  if (
    manifestCache &&
    Date.now() - manifestCache.fetchedAt < STATIC_CACHE_TTL_MS
  ) {
    return manifestCache.manifest;
  }
  if (manifestInflight) return manifestInflight;
  manifestInflight = (async () => {
    try {
      const res = await fetch(manifestUrl, {
        next: { revalidate: 86400 },
      });
      if (!res.ok) return null;
      const manifest = (await res.json()) as HistoryManifest;
      if (
        !manifest ||
        !Array.isArray(manifest.shards) ||
        manifest.numShards !== NUM_HISTORY_SHARDS ||
        typeof manifest.generatedAt !== "number"
      ) {
        return null;
      }
      manifestCache = { manifest, fetchedAt: Date.now() };
      return manifest;
    } catch {
      return null;
    } finally {
      manifestInflight = null;
    }
  })();
  return manifestInflight;
}

const shardCache = new Map<number, { payload: ShardPayload; fetchedAt: number }>();
// Per-shard single-flight guard — same logic as manifestInflight,
// scoped per shard so unrelated shard requests can still proceed
// concurrently.
const shardInflight = new Map<number, Promise<ShardPayload | null>>();

async function loadShard(
  manifest: HistoryManifest,
  shardIdx: number,
): Promise<ShardPayload | null> {
  const cached = shardCache.get(shardIdx);
  if (cached && Date.now() - cached.fetchedAt < STATIC_CACHE_TTL_MS) {
    return cached.payload;
  }
  const existing = shardInflight.get(shardIdx);
  if (existing) return existing;
  const entry = manifest.shards.find((s) => s.shard === shardIdx);
  if (!entry) return null;
  const promise = (async () => {
    try {
      const res = await fetch(entry.url, { next: { revalidate: 86400 } });
      if (!res.ok) return null;
      const payload = (await res.json()) as ShardPayload;
      if (
        !payload ||
        payload.tickers === null ||
        typeof payload.tickers !== "object" ||
        Array.isArray(payload.tickers) ||
        typeof payload.generatedAt !== "number"
      ) {
        return null;
      }
      shardCache.set(shardIdx, { payload, fetchedAt: Date.now() });
      return payload;
    } catch {
      return null;
    } finally {
      shardInflight.delete(shardIdx);
    }
  })();
  shardInflight.set(shardIdx, promise);
  return promise;
}

/**
 * Fetch the trailing window of daily prices from Yahoo to splice
 * onto the static-cache baseline. Window size scales with shard
 * age (see pickTrailingRange) so an overdue cron run doesn't
 * leave a hole between the shard's last day and today.
 *
 * Returns null on any failure — caller falls through to "serve
 * cache without trailing splice." Cache-without-trailing is still
 * useful: the chart's history is correct up to the last shard
 * point, and the headline NW just sits on the slightly-stale
 * currentPrice until the next refresh.
 */
async function fetchTrailingFromYahoo(
  symbol: string,
  shardGeneratedAt: number,
): Promise<Array<{ t: number; p: number }> | null> {
  const session = await getYahooSession(UA_VARIATIONS[0]);
  const yahooRange = pickTrailingRange(shardGeneratedAt);
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${yahooRange}&interval=1d`;
  for (const host of HOSTS) {
    for (const ua of UA_VARIATIONS) {
      try {
        const headers = browserHeaders(ua);
        if (session) headers.Cookie = session.cookie;
        const res = await fetch(`https://${host}${path}`, {
          headers,
          next: { revalidate: 3600 }, // 1h edge cache on the trailing window
        });
        if (!res.ok) continue;
        const json = (await res.json()) as YahooChart;
        const result = json.chart?.result?.[0];
        if (!result) continue;
        const ts = result.timestamp ?? [];
        const closes = result.indicators?.adjclose?.[0]?.adjclose ?? [];
        if (ts.length === 0 || closes.length === 0) continue;
        const out: Array<{ t: number; p: number }> = [];
        for (let i = 0; i < ts.length; i++) {
          const p = closes[i];
          if (typeof p === "number" && Number.isFinite(p) && p > 0) {
            out.push({ t: ts[i] * 1000, p });
          }
        }
        if (out.length > 0) return out;
      } catch {
        continue;
      }
    }
  }
  return null;
}

type StaticCacheHit = {
  quote: ParsedQuote;
  shardGeneratedAt: number;
  trailingSpliced: boolean;
  /**
   * Corporate-action streams from the shard payload (added in the
   * dividend-history work). Surfaced on cache hits so consumers
   * like TickerLookup can compute dividend yield, total-return
   * CAGR, and a split-adjusted history without a second fetch.
   * Empty arrays when the ticker has no events in the cached
   * window or when the shard predates dividend support.
   */
  dividends: Array<{ t: number; amount: number }>;
  splits: Array<{ t: number; numerator: number; denominator: number }>;
};

/**
 * Diagnostic enum surfaced via the API response so a single curl
 * tells you WHY the static cache wasn't used on a given request.
 * Avoids the "configure something invisible, redeploy, wonder why
 * it doesn't work" feedback loop.
 */
type StaticCacheStatus =
  | "hit"
  | "no_env_var"
  | "manifest_fetch_failed"
  | "shard_fetch_failed"
  | "symbol_not_in_shard"
  | "shard_history_empty";

type StaticCacheResult =
  | { status: "hit"; hit: StaticCacheHit }
  | { status: Exclude<StaticCacheStatus, "hit"> };

async function tryStaticCache(
  symbol: string,
  range: "5y" | "max",
): Promise<StaticCacheResult> {
  const manifestUrl = QUOTE_HISTORY_MANIFEST_URL;
  if (!manifestUrl) return { status: "no_env_var" };
  const manifest = await loadManifest();
  if (!manifest) return { status: "manifest_fetch_failed" };
  const shardIdx = shardForSymbol(symbol);
  const shard = await loadShard(manifest, shardIdx);
  if (!shard) return { status: "shard_fetch_failed" };
  const history = shard.tickers[symbol];
  if (!history || history.length === 0) {
    return { status: "symbol_not_in_shard" };
  }

  // Splice fresh trailing prices onto the cached baseline. The
  // shard was generated up to ~30 days ago (monthly cron); the
  // trailing fetch from Yahoo covers the gap so the chart's right
  // edge and the headline NW are current. If the trailing fetch
  // fails (Yahoo rate limit, network), we still return the cached
  // baseline — better than falling all the way through to a fully
  // dynamic fetch that probably ALSO fails.
  let merged: Array<{ t: number; p: number }>;
  let mergedCurrent: number | null;
  const trailing = await fetchTrailingFromYahoo(symbol, shard.generatedAt);
  if (trailing && trailing.length > 0) {
    // Dedupe by UTC day, not exact timestamp. Yahoo can shift a
    // given trading day's epoch slightly across endpoints/ranges,
    // and we'd see duplicate same-day points if we filtered by
    // exact equality. Drop any cached point whose UTC day matches
    // ANY trailing point's UTC day; append the entire trailing
    // window.
    const trailingDays = new Set(
      trailing.map((p) => Math.floor(p.t / 86_400_000)),
    );
    merged = history
      .filter(([t]) => !trailingDays.has(Math.floor(t / 86_400_000)))
      .map(([t, p]) => ({ t, p }))
      .concat(trailing);
    mergedCurrent = trailing[trailing.length - 1].p;
  } else {
    // Trailing fetch failed. We can still return the cached
    // history (useful for the chart) but MUST NOT claim the last
    // shard point as the current price — it could be 30+ days
    // stale. Set currentPrice to null so the client falls back
    // to its own live-price refresh path; the chart still gets
    // the historical baseline.
    merged = history.map(([t, p]) => ({ t, p }));
    mergedCurrent = null;
  }

  // Clamp to the requested range.
  const now = Date.now();
  const cutoff =
    range === "max" ? 0 : now - 5 * 365 * 24 * 60 * 60 * 1000;
  const clamped = merged.filter((p) => p.t >= cutoff);
  if (clamped.length === 0) return { status: "shard_history_empty" };

  // Pull this ticker's dividend + split events from the shard. The
  // keys are optional (older shards predate dividend support; we
  // default to []), and the events are stored as packed tuples —
  // unpack to { t, amount } / { t, numerator, denominator } for
  // the API surface so consumers don't have to know the tuple
  // layout. Clamp to the same range window as `clamped` above.
  const rawDividends = shard.dividends?.[symbol] ?? [];
  const dividends = rawDividends
    .filter(([t]) => t >= cutoff)
    .map(([t, amount]) => ({ t, amount }));
  const rawSplits = shard.splits?.[symbol] ?? [];
  const splits = rawSplits
    .filter(([t]) => t >= cutoff)
    .map(([t, numerator, denominator]) => ({ t, numerator, denominator }));

  return {
    status: "hit",
    hit: {
      quote: {
        symbol,
        currentPrice: mergedCurrent,
        currency: "USD",
        name: null,
        history: clamped,
      },
      shardGeneratedAt: shard.generatedAt,
      trailingSpliced: !!trailing && trailing.length > 0,
      dividends,
      splits,
    },
  };
}

// ── Module-level state (persists across requests within a warm Vercel
// function instance; resets on cold start). Two structures:
//   - finnhubCallTimestamps: rolling window of recent Finnhub calls
//     used to enforce a per-instance rate cap that stays under
//     Finnhub's 60-calls-per-minute API key limit.
//   - lru: in-memory cache of recent successful responses, used as a
//     graceful-degradation fallback when both upstream sources fail.
const finnhubCallTimestamps: number[] = [];
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 55; // leave headroom under Finnhub's 60/min

function canCallFinnhub(): boolean {
  const now = Date.now();
  while (
    finnhubCallTimestamps.length > 0 &&
    finnhubCallTimestamps[0] < now - RATE_WINDOW_MS
  ) {
    finnhubCallTimestamps.shift();
  }
  return finnhubCallTimestamps.length < RATE_LIMIT;
}

function recordFinnhubCall(): void {
  finnhubCallTimestamps.push(Date.now());
}

const lru = new Map<string, ParsedQuote>();
const LRU_MAX = 500;

function lruGet(symbol: string): ParsedQuote | null {
  const v = lru.get(symbol);
  if (v) {
    lru.delete(symbol);
    lru.set(symbol, v);
    return v;
  }
  return null;
}

function lruSet(symbol: string, value: ParsedQuote): void {
  if (lru.has(symbol)) lru.delete(symbol);
  lru.set(symbol, value);
  while (lru.size > LRU_MAX) {
    const first = lru.keys().next().value;
    if (first) lru.delete(first);
    else break;
  }
}

type RouteParams = { params: Promise<{ symbol: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { symbol: raw } = await params;
  // Normalize: uppercase + dot→dash (Yahoo accepts both, but the
  // static cache shards key tickers in dash form to match Nasdaq's
  // canonical representation — without this rewrite, BRK.B
  // requests hash to a different shard than BRK-B is stored under
  // and silently miss the static cache).
  const symbol = raw.toUpperCase().replace(/\./g, "-").slice(0, 12);
  if (!/^[A-Z0-9.\-^]+$/.test(symbol)) {
    return json({ error: "invalid symbol" }, 400);
  }

  // Optional ?range=max query: fetch the maximum available
  // history from upstream instead of the default 5 years. Used
  // by the time-travel mode's historical-price flow when the
  // user backdates to a date older than 5 years ago. The wider
  // payload is ~3-10x larger but caches identically (per-symbol
  // LRU + IDB), so subsequent requests pay nothing extra.
  const range = req.nextUrl.searchParams.get("range") === "max" ? "max" : "5y";

  // FAST PATH — static historical cache.
  //
  // For the top ~1000 US ETFs by AUM (plus the app's preset
  // symbols), full 10y daily history is pre-fetched into Vercel
  // Blob shards via a monthly GitHub Action and served from the
  // CDN. A hit here returns in tens of ms, avoids any upstream
  // dependency, and bypasses Vercel's IP-class rate-limit
  // entirely. A miss (long-tail tickers, brand-new symbols) falls
  // through to the Yahoo+Finnhub path as before.
  const cacheResult = await tryStaticCache(symbol, range);
  // Serve a shard hit regardless of shardGeneratedAt age. The
  // historical prices in the shard don't expire — AAPL's close
  // on 2024-03-15 is the same fact whether the shard was
  // generated yesterday or six months ago. Earlier versions of
  // this route gated cache hits behind a 5-week staleness check
  // and fell back to dynamic Yahoo+Finnhub when the cron lagged;
  // that turned a small recency gap into a full outage (Vercel
  // IPs get 429'd by Yahoo, which is the whole reason the static
  // cache exists). The trailing-splice now widens its window
  // based on shard age (see pickTrailingRange) so the merged
  // chart stays gap-free up to a 2-year-old shard; beyond that
  // there's an irreducible right-edge gap but the bulk of the
  // history is still correct.
  const staticCacheStatus: StaticCacheStatus = cacheResult.status;
  if (cacheResult.status === "hit") {
    const hit = cacheResult.hit;
    // CURRENT PRICE FRESHENING.
    //
    // The static cache + trailing-splice gives us a 10y daily
    // history ending at the most recent CLOSE. But the headline
    // NW wants an INTRADAY price — the difference is the day's
    // move so far, which the user notices immediately as
    // "NW dropped/jumped on reload."
    //
    // Quickly try Finnhub for the freshest intraday quote. If
    // it answers, override the trailing-derived currentPrice
    // (which is yesterday's close). If Finnhub fails, fall
    // back to whatever the static-cache hit gave us.
    let currentPrice = hit.quote.currentPrice;
    const finnhub = await tryFinnhub(symbol, "5y");
    if (
      finnhub.ok &&
      finnhub.quote.currentPrice != null &&
      finnhub.quote.currentPrice > 0
    ) {
      currentPrice = finnhub.quote.currentPrice;
    }
    const finalQuote: ParsedQuote = { ...hit.quote, currentPrice };
    // DON'T poison the LRU when trailing failed — currentPrice is
    // null in that case and the LRU fallback path serves it as
    // "lru-fallback" which would propagate the null indefinitely.
    if (hit.trailingSpliced || currentPrice != null) {
      lruSet(symbol, finalQuote);
    }
    return json(
      {
        ...finalQuote,
        cachedFromStatic: true,
        // Surfaces staleness to the client: how old is the shard
        // we served from? UI can show a "data through MM/DD"
        // badge or warn if the cron has fallen far behind.
        shardGeneratedAt: hit.shardGeneratedAt,
        trailingSpliced: hit.trailingSpliced,
        // Corporate-action streams from the shard payload. Empty
        // arrays when the ticker has no events in the window or
        // when the shard predates dividend support. Consumers
        // like TickerLookup use these for yield + total-return
        // calculations; the headline-NW path ignores them.
        dividends: hit.dividends,
        splits: hit.splits,
        staticCacheStatus: "hit",
        fetchedAt: Date.now(),
      },
      200,
      {
        // Edge cache duration depends on whether Finnhub
        // succeeded — when the response carries an intraday
        // price, we want it to expire faster so the next fetch
        // picks up market movement; when it doesn't, longer is
        // fine.
        //
        // Trailing-spliced + intraday: 5 min edge cache.
        // Trailing-failed (currentPrice fallback to null): 30s.
        "Cache-Control": hit.trailingSpliced
          ? "public, s-maxage=300, stale-while-revalidate=3600"
          : "public, s-maxage=30, stale-while-revalidate=300",
        // CDN-tagged so a force-refresh can invalidate per-symbol
        // (Vercel `revalidateTag` API).
        "Cache-Tag": `quote:${symbol}`,
      },
    );
  }

  // Track upstream diagnostic reasons so the response payload
  // carries an `error` string when both fail — surfaced in the
  // UI banner so the user can diagnose (Yahoo IP blocked, no
  // Finnhub key, rate-limited, etc).
  //
  // FALLBACK STRATEGY (refined after user-reported "0 history
  // points" bug):
  //   Finnhub free tier provides /quote (current price) but
  //   /stock/candle requires paid tier → free-tier requests
  //   silently return empty history. Yahoo is the only free
  //   source for history.
  //
  //   1. Try Finnhub. If it gives us a current price BUT empty
  //      history, treat as PARTIAL success and ALSO try Yahoo.
  //   2. Yahoo's full quote (price + history) wins on success.
  //   3. If Yahoo fails but Finnhub gave a current price, use
  //      Finnhub's partial quote (better than nothing for live
  //      NW; historical CAGR back-projection takes over).
  //   4. If both fail entirely, surface both reasons + serve LRU.
  const finnhubResult = await tryFinnhub(symbol, range);
  let parsed: ParsedQuote | null = null;
  let source = "finnhub";
  let finnhubReason: string | null = null;
  let yahooReason: string | null = null;
  let yahooResult: UpstreamResult | null = null;
  if (finnhubResult.ok) {
    parsed = finnhubResult.quote;
    // Partial-success path: Finnhub gave us current price but
    // empty history. Try Yahoo for the history; if Yahoo
    // succeeds, prefer its full quote.
    if (parsed.history.length === 0) {
      yahooResult = await tryYahoo(symbol, range);
      if (yahooResult.ok && yahooResult.quote.history.length > 0) {
        parsed = yahooResult.quote;
        source = "yahoo";
      } else if (!yahooResult.ok) {
        yahooReason = yahooResult.reason;
        finnhubReason =
          "finnhub: current price OK but candle endpoint returned no history (likely free-tier limitation — /stock/candle requires paid tier)";
      } else {
        // Yahoo succeeded but also had no history — rare.
        // Keep Finnhub's partial quote; record both partial
        // statuses for diagnostic.
        finnhubReason =
          "finnhub: current price OK but no history (free-tier candle limitation)";
        yahooReason = "yahoo: response OK but history empty";
      }
    }
  } else {
    finnhubReason = finnhubResult.reason;
    yahooResult = await tryYahoo(symbol, range);
    if (yahooResult.ok) {
      parsed = yahooResult.quote;
      source = "yahoo";
    } else {
      yahooReason = yahooResult.reason;
    }
  }

  if (parsed) {
    lruSet(symbol, parsed);
    // Surface partial-failure diagnostics on the success path
    // too. The user-reported scenario: Finnhub gave us current
    // price but empty history, Yahoo (the only free history
    // source) also failed. The chart's historical view will
    // then fail with `priceAt returned null` — and the user
    // deserves to see WHY (rate limited / paid tier / etc),
    // not a generic "0 history points" message.
    const partialErrorParts: string[] = [];
    if (finnhubReason) partialErrorParts.push(finnhubReason);
    if (yahooReason) partialErrorParts.push(yahooReason);
    const partialError =
      partialErrorParts.length > 0 && parsed.history.length === 0
        ? partialErrorParts.join(" | ")
        : undefined;
    return json(
      {
        ...parsed,
        source,
        asOf: Date.now(),
        // Surface the static-cache status even on the dynamic
        // path — tells you whether the cache was bypassed because
        // it wasn't configured (no_env_var), the manifest fetch
        // failed (manifest_fetch_failed), or the symbol simply
        // isn't in the universe (symbol_not_in_shard). One curl
        // diagnoses the whole pipeline.
        staticCacheStatus,
        ...(partialError ? { error: partialError } : {}),
      },
      200,
      {
        // Historical daily closes never change retroactively; current
        // price changes intraday but a 24h staleness is fine for a
        // long-term wealth planner. stale-while-revalidate keeps users
        // unblocked for a week even if both upstreams are down.
        // `public` is fine here — the response carries no user-specific
        // data, just the ticker's market price.
        "Cache-Control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
        "Cache-Tag": `quote:${symbol}`,
      },
    );
  }

  // Both upstreams failed (rate limited, blocked, etc.). Serve from the
  // per-instance LRU if we have anything for this ticker.
  const fallback = lruGet(symbol);
  if (fallback) {
    return json(
      {
        ...fallback,
        source: "lru-fallback",
        asOf: Date.now(),
        staticCacheStatus,
      },
      200,
      {
        // `private` on the LRU fallback path: the per-instance LRU
        // is request-affinitive (may hold different data on
        // different Vercel edge instances), and `public, s-maxage`
        // would let shared proxies / CDNs propagate a stale
        // fallback to every user — including indefinitely if
        // upstream stays down. `private, max-age` keeps the
        // staleness scoped to the requesting browser; next request
        // retries upstream cleanly.
        "Cache-Control":
          "private, max-age=300, stale-while-revalidate=3600",
      },
    );
  }

  // Truly nothing to serve. Return 200 with an explicit
  // `unavailable: true` payload rather than a 5xx status:
  //
  //   - The SERVICE handled the request fine; the UPSTREAM data
  //     is what's missing. A 5xx misrepresents this and tells
  //     browsers + monitoring tools we have a backend bug.
  //   - The client (lib/quotes.ts) already inspects
  //     `unavailable` and treats it as "no live price". User-
  //     visible behavior is identical.
  //   - 5xx triggers a browser console "Failed to load resource"
  //     error, which Lighthouse counts as a best-practices
  //     violation. With six ticker fetches per home page load
  //     that was dropping the score below the 0.95 gate.
  //
  // no-store cache so a future request retries upstream
  // immediately rather than serving this empty payload back.
  // Compose the diagnostic error message — both upstream
  // reasons separated by ` | ` so the UI can show both.
  const errorParts: string[] = [];
  if (finnhubReason) errorParts.push(finnhubReason);
  if (yahooReason) errorParts.push(yahooReason);
  const error =
    errorParts.length > 0
      ? errorParts.join(" | ")
      : "unknown — both upstream attempts returned ok=false with no reason";
  return json(
    {
      symbol,
      currentPrice: null,
      currency: "USD",
      name: null,
      history: [],
      unavailable: true,
      error,
      asOf: Date.now(),
      staticCacheStatus,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

type ParsedQuote = {
  symbol: string;
  currentPrice: number | null;
  currency: string;
  name: string | null;
  history: Array<{ t: number; p: number }>;
};

/**
 * Result discriminator: success returns the parsed quote;
 * failure returns a diagnostic reason. Surfaced via the
 * `unavailable: true` payload + propagated to the UI banner so
 * the user can see EXACTLY why a price lookup failed (which is
 * critical when scrapers get blocked by upstream — Yahoo
 * actively blocks Vercel IP ranges, Finnhub free tier rate-
 * limits, etc).
 */
type UpstreamResult =
  | { ok: true; quote: ParsedQuote }
  | { ok: false; reason: string };

async function tryFinnhub(
  symbol: string,
  range: "5y" | "max" = "5y",
): Promise<UpstreamResult> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { ok: false, reason: "finnhub: no FINNHUB_API_KEY env var" };
  if (!canCallFinnhub())
    return { ok: false, reason: "finnhub: rate-limit safety belt (≥55/min)" };

  const enc = encodeURIComponent(symbol);
  let currentPrice: number | null = null;
  let name: string | null = null;
  let currency = "USD";

  try {
    recordFinnhubCall();
    const quoteRes = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${enc}&token=${key}`,
      { next: { revalidate: 3600 } },
    );
    if (!quoteRes.ok) {
      return {
        ok: false,
        reason: `finnhub: quote ${quoteRes.status} ${quoteRes.statusText}`,
      };
    }
    const q = (await quoteRes.json()) as { c?: number; pc?: number; t?: number };
    if (typeof q.c !== "number" || q.c <= 0) {
      return {
        ok: false,
        reason: `finnhub: quote returned c=${JSON.stringify(q.c)} (invalid symbol?)`,
      };
    }
    currentPrice = q.c;
  } catch (e) {
    return {
      ok: false,
      reason: `finnhub: quote fetch threw — ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // PROFILE FETCH SKIPPED. Was using a slot of the 60/min
  // Finnhub free-tier budget for nice-to-have `name` + currency.
  // Tripled per-symbol call cost and contributed to the
  // user-reported "finnhub: rate-limit safety belt (≥55/min)"
  // errors. Names come from the preset registry / user's own
  // nickname; currency defaults to USD.
  void name;
  void currency;

  // HISTORY FETCH: only attempted for the default 5y range. For
  // range="max" Finnhub's free tier returns 403 (paid tier needed)
  // — wasting a budget slot AND silently producing empty history,
  // which then masked Yahoo from being tried. Saving 1 call per
  // symbol on max-range requests roughly halves Finnhub usage
  // during time-travel sessions.
  const history: Array<{ t: number; p: number }> = [];
  const shouldTryHistory = range !== "max";
  try {
    if (shouldTryHistory && canCallFinnhub()) {
      recordFinnhubCall();
      const now = Math.floor(Date.now() / 1000);
      const fromOffsetSec = 5 * 365 * 24 * 60 * 60;
      const fromTs = now - fromOffsetSec;
      const candleRes = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${enc}&resolution=D&from=${fromTs}&to=${now}&token=${key}`,
        { next: { revalidate: 86400 } },
      );
      if (candleRes.ok) {
        const c = (await candleRes.json()) as {
          s?: string;
          c?: number[];
          t?: number[];
        };
        if (c.s === "ok" && c.c && c.t && c.c.length === c.t.length) {
          for (let i = 0; i < c.t.length; i++) {
            const px = c.c[i];
            const ts = c.t[i];
            if (typeof px === "number" && px > 0 && Number.isFinite(px)) {
              history.push({ t: ts * 1000, p: px });
            }
          }
        }
      }
    }
  } catch {
    /* no history is fine */
  }

  return {
    ok: true,
    quote: {
      symbol,
      currentPrice,
      currency,
      name,
      history,
    },
  };
}

async function tryYahoo(
  symbol: string,
  range: "5y" | "max" = "5y",
): Promise<UpstreamResult> {
  // Yahoo's range=max goes back to symbol inception (often
  // 20-40+ years for major equities). Default 5y for live
  // refresh; max for time-travel sessions.
  const yahooRange = range === "max" ? "max" : "5y";
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${yahooRange}&interval=1d&includePrePost=false`;
  // Track the LAST observed failure across all 4 (host × UA)
  // attempts so the caller has a concrete reason to surface.
  // Yahoo blocks Vercel IP ranges aggressively, so the typical
  // failure is a 401/403/429 — surfacing the status code makes
  // it instantly diagnosable.
  let lastReason = "yahoo: no attempt made";
  // Warm a Yahoo session once per cold start. Yahoo's WAF treats
  // requests with an established session cookie + crumb materially
  // more leniently than naked-IP fetches — measurably increases
  // 200s on Vercel's shared IP pool.
  const session = await getYahooSession(UA_VARIATIONS[0]);
  for (const host of HOSTS) {
    for (const ua of UA_VARIATIONS) {
      try {
        // 429-retry path: when Yahoo returns "Too Many Requests"
        // on the first attempt, wait briefly + retry once. Vercel's
        // shared IP pool gets rate-limited aggressively by Yahoo
        // across all users on the same warm instance; a single
        // 750ms backoff often gets us through the next rate
        // window (Yahoo's tier is per-rolling-second).
        // User reported: "21 holdings all 429."
        const headers = browserHeaders(ua);
        if (session) headers.Cookie = session.cookie;
        let res = await fetch(`https://${host}${path}`, {
          headers,
          next: { revalidate: 86400 },
        });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 750));
          res = await fetch(`https://${host}${path}`, {
            headers,
            next: { revalidate: 86400 },
          });
        }
        if (!res.ok) {
          lastReason = `yahoo: ${host} returned ${res.status} ${res.statusText}`;
          continue;
        }
        let data: YahooChart;
        try {
          data = (await res.json()) as YahooChart;
        } catch (e) {
          lastReason = `yahoo: ${host} returned non-JSON — ${e instanceof Error ? e.message : String(e)}`;
          continue;
        }
        if (data.chart?.error) {
          lastReason = `yahoo: ${host} chart.error ${data.chart.error.code}: ${data.chart.error.description}`;
          continue;
        }
        const result = data.chart?.result?.[0];
        if (!result) {
          lastReason = `yahoo: ${host} returned empty chart.result`;
          continue;
        }
        const parsed = parseYahoo(symbol, result);
        if (parsed) return { ok: true, quote: parsed };
        lastReason = `yahoo: ${host} parse failed (no close prices in payload)`;
      } catch (e) {
        lastReason = `yahoo: ${host} fetch threw — ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  return { ok: false, reason: lastReason };
}

type YahooChart = {
  chart: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        currency?: string;
        symbol?: string;
        longName?: string;
        shortName?: string;
      };
      timestamp?: number[];
      indicators?: {
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
};

function parseYahoo(
  symbol: string,
  result: NonNullable<YahooChart["chart"]["result"]>[number],
): ParsedQuote | null {
  const timestamps = result.timestamp ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const meta = result.meta ?? {};

  const history: Array<{ t: number; p: number }> = [];
  for (let i = 0; i < timestamps.length; i++) {
    const p = adj[i] ?? close[i];
    if (typeof p === "number" && p > 0 && Number.isFinite(p)) {
      history.push({ t: timestamps[i] * 1000, p });
    }
  }
  if (history.length === 0 && meta.regularMarketPrice == null) return null;

  return {
    symbol,
    currentPrice: meta.regularMarketPrice ?? null,
    currency: meta.currency ?? "USD",
    name: meta.longName ?? meta.shortName ?? null,
    history,
  };
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
