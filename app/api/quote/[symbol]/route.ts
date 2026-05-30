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

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase().slice(0, 12);
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
