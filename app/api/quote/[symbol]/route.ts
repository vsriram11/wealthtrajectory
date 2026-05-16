import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA_VARIATIONS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

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

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase().slice(0, 12);
  if (!/^[A-Z0-9.\-^]+$/.test(symbol)) {
    return json({ error: "invalid symbol" }, 400);
  }

  let parsed = await tryFinnhub(symbol);
  let source = "finnhub";

  if (!parsed) {
    parsed = await tryYahoo(symbol);
    if (parsed) source = "yahoo";
  }

  if (parsed) {
    lruSet(symbol, parsed);
    return json(
      { ...parsed, source, asOf: Date.now() },
      200,
      {
        // Historical daily closes never change retroactively; current
        // price changes intraday but a 24h staleness is fine for a
        // long-term wealth planner. stale-while-revalidate keeps users
        // unblocked for a week even if both upstreams are down.
        "Cache-Control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
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
      },
      200,
      {
        // Shorter cache so the next request retries upstream sooner.
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=3600",
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
  return json(
    {
      symbol,
      currentPrice: null,
      currency: "USD",
      name: null,
      history: [],
      unavailable: true,
      asOf: Date.now(),
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

async function tryFinnhub(symbol: string): Promise<ParsedQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  // Per-instance rate limit safety belt: pretend the call failed if
  // we'd otherwise overshoot the upstream cap. Caller falls through
  // to Yahoo or LRU.
  if (!canCallFinnhub()) return null;

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
    if (!quoteRes.ok) return null;
    const q = (await quoteRes.json()) as { c?: number; pc?: number; t?: number };
    if (typeof q.c !== "number" || q.c <= 0) return null;
    currentPrice = q.c;
  } catch {
    return null;
  }

  try {
    if (canCallFinnhub()) {
      recordFinnhubCall();
      const profRes = await fetch(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${enc}&token=${key}`,
        { next: { revalidate: 86400 } },
      );
      if (profRes.ok) {
        const p = (await profRes.json()) as {
          name?: string;
          currency?: string;
        };
        name = p.name ?? null;
        if (p.currency) currency = p.currency;
      }
    }
  } catch {
    /* skip */
  }

  const history: Array<{ t: number; p: number }> = [];
  try {
    if (canCallFinnhub()) {
      recordFinnhubCall();
      const now = Math.floor(Date.now() / 1000);
      const fiveYrAgo = now - 5 * 365 * 24 * 60 * 60;
      const candleRes = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${enc}&resolution=D&from=${fiveYrAgo}&to=${now}&token=${key}`,
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
    symbol,
    currentPrice,
    currency,
    name,
    history,
  };
}

async function tryYahoo(symbol: string): Promise<ParsedQuote | null> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&includePrePost=false`;
  for (const host of HOSTS) {
    for (const ua of UA_VARIATIONS) {
      try {
        const res = await fetch(`https://${host}${path}`, {
          headers: {
            "User-Agent": ua,
            Accept: "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://finance.yahoo.com/",
            Origin: "https://finance.yahoo.com",
          },
          next: { revalidate: 86400 },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as YahooChart;
        if (data.chart?.error) continue;
        const result = data.chart?.result?.[0];
        if (!result) continue;
        const parsed = parseYahoo(symbol, result);
        if (parsed) return parsed;
      } catch {
        /* try next */
      }
    }
  }
  return null;
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
