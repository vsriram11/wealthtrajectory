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

export async function getQuote(symbolRaw: string): Promise<Quote | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  const fromMem = memCache.get(symbol);
  if (
    isUsableQuote(fromMem) &&
    Date.now() - fromMem.fetchedAt < TTL_MS
  ) {
    return fromMem;
  }

  const cached = await readCache(symbol);
  if (
    isUsableQuote(cached) &&
    Date.now() - cached.fetchedAt < TTL_MS
  ) {
    memCache.set(symbol, cached);
    return cached;
  }

  if (inflight.has(symbol)) return inflight.get(symbol)!;
  const promise = fetchFresh(symbol).finally(() => inflight.delete(symbol));
  inflight.set(symbol, promise);
  const fresh = await promise;
  if (fresh) {
    // Only persist a quote that actually contains a real price.
    // Caching zero / unavailable would poison subsequent reads.
    if (isUsableQuote(fresh)) {
      memCache.set(symbol, fresh);
      void writeCache(symbol, fresh);
    }
    return fresh;
  }
  // Last-resort: a cached quote we previously decided was stale. Still
  // better than nothing for the caller to display, but we don't
  // re-warm memCache with it.
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

async function fetchFresh(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Omit<Quote, "fetchedAt"> & {
      asOf?: number;
      unavailable?: boolean;
    };
    return {
      symbol: data.symbol,
      currentPrice: data.currentPrice ?? 0,
      currency: data.currency ?? "USD",
      name: data.name ?? null,
      history: Array.isArray(data.history) ? data.history : [],
      fetchedAt: data.asOf ?? Date.now(),
      unavailable: data.unavailable === true,
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

export function priceAt(quote: Quote, atMs: number): number | null {
  const h = quote.history;
  if (h.length === 0) return null;
  if (atMs <= h[0].t) return h[0].p;
  if (atMs >= h[h.length - 1].t) return h[h.length - 1].p;
  let lo = 0;
  let hi = h.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (h[mid].t <= atMs) lo = mid;
    else hi = mid;
  }
  return h[lo].p;
}
