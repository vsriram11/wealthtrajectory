import Dexie, { type Table } from "dexie";

export type QuoteHistoryPoint = { t: number; p: number };

export type Quote = {
  symbol: string;
  currentPrice: number;
  currency: string;
  name: string | null;
  history: QuoteHistoryPoint[];
  fetchedAt: number;
  unavailable?: boolean;
  /**
   * Diagnostic reason captured from the upstream API route when
   * the fetch fell through to `unavailable: true`. Concatenates
   * Finnhub + Yahoo failure reasons (e.g. "finnhub: no
   * FINNHUB_API_KEY env var | yahoo: query1 returned 401
   * Unauthorized"). Surfaced in the time-travel banner so users
   * can diagnose why historical prices aren't loading without
   * opening DevTools.
   */
  error?: string;
};

type QuoteRow = { symbol: string; quote: Quote };

class QuoteDB extends Dexie {
  quotes!: Table<QuoteRow, string>;

  constructor() {
    super("WealthTrajectoryQuotes");
    this.version(1).stores({ quotes: "symbol" });
  }
}

let db: QuoteDB | null = null;
function getDB(): QuoteDB | null {
  if (typeof window === "undefined") return null;
  if (!db) {
    try {
      db = new QuoteDB();
    } catch (e) {
      console.warn("WealthTrajectory: quote DB unavailable", e);
      return null;
    }
  }
  return db;
}

const TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

const inflight = new Map<string, Promise<Quote | null>>();
const memCache = new Map<string, Quote>();

/**
 * A cache entry is usable only if it has a positive price AND isn't
 * flagged unavailable. Past bug: when /api/quote returned
 * `currentPrice: 0` (upstream rate-limited, Finnhub ETF gap, etc.)
 * we wrote that zero to memCache + IndexedDB for 23h, and every
 * subsequent getQuote returned it. PriceRefresher's `> 0` guard
 * then rejected the apply, so holdings stayed pinned to the
 * preset's referencePriceUSD forever. Treat zero / unavailable
 * cache entries as expired so we re-fetch.
 */
function isUsableQuote(q: Quote | null | undefined): q is Quote {
  return !!q && q.currentPrice > 0 && !q.unavailable;
}

export type GetQuoteOptions = {
  /**
   * "5y" (default) requests the standard 5-year daily history.
   * "max" fetches the full available history (Yahoo: symbol
   * inception, often 20-40+ years; Finnhub: 30y). Used by
   * time-travel mode for backdates older than 5 years ago.
   *
   * Cache behavior: a "max" fetch overwrites the cached entry
   * for that symbol (max is a strict superset of 5y, so all
   * subsequent reads benefit). The cache key is unchanged.
   */
  range?: "5y" | "max";
};

export async function getQuote(
  symbolRaw: string,
  opts: GetQuoteOptions = {},
): Promise<Quote | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  const wantMax = opts.range === "max";

  // Cache hit acceptance: if caller wants "max" but the cached
  // history covers only ~5y, we should refetch. Use the cached
  // history span as the proxy for "what range did we last
  // fetch." If the oldest point is < 6 years ago AND wantMax,
  // bypass cache to upgrade to a wider window.
  //
  // ALSO: any cached entry with EMPTY history is treated as
  // not-fresh regardless of range. Empty-history entries get
  // written when /api/quote returns currentPrice from Finnhub
  // but no candle data (Finnhub free tier doesn't include
  // /stock/candle, so this is the common-case failure mode when
  // the static cache isn't reachable). Before this guard, those
  // empty entries would sit in IDB for 23h and short-circuit
  // every getQuote — the chart would have no series to draw and
  // would fall back to CAGR-only back-projection (smooth, no
  // daily volatility). User-reported on the home History chart
  // after PR #19's cache fix deployed: every refetch was
  // returning the pre-fix empty-history IDB entry and the chart
  // never got the real prices.
  const SIX_YEARS_MS = 6 * 365 * 24 * 60 * 60 * 1000;
  const cacheCoversMax = (q: Quote): boolean => {
    if (q.history.length === 0) return false;
    if (!wantMax) return true;
    return Date.now() - q.history[0].t > SIX_YEARS_MS;
  };

  const fromMem = memCache.get(symbol);
  if (
    isUsableQuote(fromMem) &&
    Date.now() - fromMem.fetchedAt < TTL_MS &&
    cacheCoversMax(fromMem)
  ) {
    return fromMem;
  }

  const cached = await readCache(symbol);
  if (
    isUsableQuote(cached) &&
    Date.now() - cached.fetchedAt < TTL_MS &&
    cacheCoversMax(cached)
  ) {
    memCache.set(symbol, cached);
    return cached;
  }

  // Inflight dedup keyed by (symbol, range) — two callers
  // requesting different ranges simultaneously shouldn't
  // cross-pollute.
  const inflightKey = wantMax ? `${symbol}:max` : symbol;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey)!;
  const promise = fetchFresh(symbol, opts).finally(() =>
    inflight.delete(inflightKey),
  );
  inflight.set(inflightKey, promise);
  const fresh = await promise;
  if (fresh) {
    if (isUsableQuote(fresh)) {
      memCache.set(symbol, fresh);
      // Only persist to IDB when there's actual history. An
      // empty-history quote (currentPrice OK but candle endpoint
      // failed — typical of the Finnhub-only fallback path)
      // would otherwise sit in IDB for 23h and short-circuit
      // future getQuote calls, starving the chart of the price
      // series it needs. The in-memory cache still gets
      // populated so within-session callers that just need
      // currentPrice (PriceRefresher) don't pay an extra fetch.
      if (fresh.history.length > 0) {
        void writeCache(symbol, fresh);
      }
      return fresh;
    }
    // Fresh fetch came back UNAVAILABLE (Yahoo 429, Finnhub down,
    // etc.). Prefer the IDB-cached quote if we have one — even a
    // stale baseline is more useful than refusing outright,
    // especially for time-travel mode where the historical prices
    // we need are already in the cached payload. Without this
    // fallback, a transient upstream blip turns popular tickers
    // like TQQQ/VOO/VTI into "Symbols failed" banners despite
    // their full history sitting in IDB.
    //
    // Only when both fresh AND cached have no usable data do we
    // hand back the unavailable response so PriceRefresher can
    // surface its diagnostic message.
    if (cached) return cached;
    return fresh;
  }
  if (cached) return cached;
  return null;
}

export async function getCachedQuote(symbolRaw: string): Promise<Quote | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  const fromMem = memCache.get(symbol);
  if (fromMem) return fromMem;
  const cached = await readCache(symbol);
  if (cached) memCache.set(symbol, cached);
  return cached;
}

async function fetchFresh(
  symbol: string,
  opts: GetQuoteOptions = {},
): Promise<Quote | null> {
  try {
    const qs = opts.range === "max" ? "?range=max" : "";
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}${qs}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Omit<Quote, "fetchedAt"> & {
      asOf?: number;
      unavailable?: boolean;
      error?: string;
    };
    return {
      symbol: data.symbol,
      currentPrice: data.currentPrice ?? 0,
      currency: data.currency ?? "USD",
      name: data.name ?? null,
      history: Array.isArray(data.history) ? data.history : [],
      fetchedAt: data.asOf ?? Date.now(),
      unavailable: data.unavailable === true,
      ...(typeof data.error === "string" ? { error: data.error } : {}),
    };
  } catch (e) {
    console.warn(`quote fetch failed for ${symbol}`, e);
    return null;
  }
}

async function readCache(symbol: string): Promise<Quote | null> {
  const handle = getDB();
  if (!handle) return null;
  try {
    const row = await handle.quotes.get(symbol);
    return row?.quote ?? null;
  } catch (e) {
    console.warn("quote read failed", e);
    return null;
  }
}

async function writeCache(symbol: string, quote: Quote): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.quotes.put({ symbol, quote });
  } catch (e) {
    console.warn("quote write failed", e);
  }
}

export async function refreshQuotes(
  symbols: string[],
): Promise<Record<string, Quote | null>> {
  const out: Record<string, Quote | null> = {};
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
    Boolean,
  );
  await Promise.all(
    unique.map(async (s) => {
      out[s] = await getQuote(s);
    }),
  );
  return out;
}

/**
 * Seed the in-memory + IDB caches with a quote loaded from elsewhere
 * (e.g. the per-user Drive cache). No network call, no TTL check —
 * the caller is responsible for freshness.
 */
export async function primeCache(quote: Quote): Promise<void> {
  const symbol = quote.symbol.toUpperCase();
  memCache.set(symbol, quote);
  await writeCache(symbol, quote);
}

/**
 * Result discriminator so callers can distinguish "exact" vs
 * "clamped to nearest endpoint" — important for backdated lookups
 * where clamping to the 5-year-old earliest sample would silently
 * lie about prices from 6+ years ago. Round-5 audit BLOCK: the
 * previous return-just-a-number signature gave callers no way to
 * know they got the oldest-sample clamp.
 */
export type PriceAtResult = {
  price: number;
  /** True when atMs fell outside [h[0].t, h[N-1].t]. */
  clamped: boolean;
};

/**
 * Binary-search the history array for the closing price at or
 * before atMs. Returns the price + a `clamped` flag indicating
 * whether atMs was outside the available history window.
 *
 * Callers wanting strict "data unavailable for this date" semantics
 * should treat `clamped === true` as null.
 */
export function priceAtDetailed(
  quote: Quote,
  atMs: number,
): PriceAtResult | null {
  const h = quote.history;
  if (h.length === 0) return null;
  // Strict inequality on the boundary: an exact match against the
  // first or last sample is INSIDE the available window — flagging
  // it `clamped` makes the historical-price flow skip a valid
  // sample (R2 audit HIGH). Only out-of-window lookups clamp.
  if (atMs < h[0].t) return { price: h[0].p, clamped: true };
  if (atMs > h[h.length - 1].t)
    return { price: h[h.length - 1].p, clamped: true };
  let lo = 0;
  let hi = h.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (h[mid].t <= atMs) lo = mid;
    else hi = mid;
  }
  // After the loop, `hi` may be the exact-end match; otherwise
  // `lo` is the at-or-before index. Pick whichever is exactly
  // atMs first; fall back to lo (the standard at-or-before).
  return {
    price: h[hi].t <= atMs ? h[hi].p : h[lo].p,
    clamped: false,
  };
}

/**
 * Back-compat wrapper for legacy callers. Returns just the price,
 * including clamp cases. New code should use priceAtDetailed when
 * the clamp distinction matters (historical-price application for
 * time-travel sessions).
 */
export function priceAt(quote: Quote, atMs: number): number | null {
  const r = priceAtDetailed(quote, atMs);
  return r === null ? null : r.price;
}
