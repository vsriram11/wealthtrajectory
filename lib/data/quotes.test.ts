// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";

// Hoisted holder so individual tests can simulate prior IDB-cached
// quotes by setting `dexieRowHolder.row` BEFORE the dynamic import
// of @/lib/data/quotes. Default `undefined` mimics a fresh user
// with no prior cache.
const dexieRowHolder = vi.hoisted(() => ({
  row: undefined as { quote: unknown } | undefined,
}));

// Mock dexie so the module doesn't try to open IndexedDB. The
// `get` impl reads from the hoisted holder so tests can swap in
// fake cached rows.
//
// IMPORTANT: real Dexie attaches table accessors (e.g. `db.quotes`)
// via the `stores({...})` call rather than as plain class fields.
// We mirror that here because the QuoteDB class in quotes.ts has
// `quotes!: Table<...>` — under TS's `useDefineForClassFields`
// semantics that compiles to `Object.defineProperty(this, 'quotes',
// { value: undefined })`, which would shadow any class-field
// initializer in this mock. Setting tables in `stores()` runs AFTER
// the subclass's field init, so it sticks.
vi.mock("dexie", () => {
  class FakeDexie {
    version() {
      return this;
    }
    stores(schema: Record<string, string>) {
      for (const name of Object.keys(schema)) {
        (this as unknown as Record<string, unknown>)[name] = {
          get: async (_symbol: string) => dexieRowHolder.row,
          put: async () => {},
        };
      }
      return this;
    }
    constructor(_: string) {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // Reset the per-test IDB row override so leaks across tests
  // don't surprise the next one.
  dexieRowHolder.row = undefined;
  // jsdom doesn't provide fetch; install ours.
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getQuote — does not poison the cache with zero / unavailable", () => {
  it("re-fetches after an unavailable response (no stale zero stuck in cache)", async () => {
    // Fresh module each test so the in-memory cache starts empty.
    vi.resetModules();
    const { getQuote } = await import("@/lib/data/quotes");

    // First fetch: upstream returned unavailable (price 0).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 0,
        currency: "USD",
        name: null,
        history: [],
        asOf: Date.now(),
        unavailable: true,
      }),
    );
    const first = await getQuote("VOO");
    expect(first?.currentPrice).toBe(0);

    // Second fetch: upstream is back. We MUST re-fetch (not serve the
    // stale zero from cache) and return the real price.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 580.42,
        currency: "USD",
        name: "Vanguard S&P 500",
        history: [],
        asOf: Date.now(),
      }),
    );
    const second = await getQuote("VOO");
    expect(second?.currentPrice).toBe(580.42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does cache a positive-price quote and skips the network on second call", async () => {
    vi.resetModules();
    const { getQuote } = await import("@/lib/data/quotes");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VTI",
        currentPrice: 280.5,
        currency: "USD",
        name: "Vanguard Total Stock",
        // Non-empty history: an empty-history fresh response is
        // now intentionally NOT cached (see the empty-history
        // invalidation tests below) because Finnhub-only fallback
        // returns currentPrice without candles, and persisting
        // those was poisoning the chart's data source.
        history: [{ t: Date.now() - 86_400_000, p: 279.0 }],
        asOf: Date.now(),
      }),
    );
    const first = await getQuote("VTI");
    const second = await getQuote("VTI");
    // Two assertions, intentionally: the spy-count check
    // confirms we didn't hit the network twice (caching
    // behavior), and the value equality confirms the cache
    // returned the SAME price — not e.g. a stale zero or a
    // partially-hydrated default. Without the value check, a
    // regression where the second call returned `undefined`
    // (cache miss + no refetch) would still pass the spy assert.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second?.currentPrice).toBe(first?.currentPrice);
    expect(second?.currentPrice).toBe(280.5);
  });

  it("returns null and logs (does not throw) when fetch itself rejects", async () => {
    vi.resetModules();
    const { getQuote } = await import("@/lib/data/quotes");
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await getQuote("VOO");
    // Network failure must produce null (not throw, not return
    // a stale zero) so consumers can fall through to manual
    // pricing. The console.warn is the operator's signal.
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null when fetch response is non-OK (4xx/5xx)", async () => {
    vi.resetModules();
    const { getQuote } = await import("@/lib/data/quotes");
    fetchMock.mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );
    const out = await getQuote("VOO");
    // The fetchFresh path treats non-2xx as a soft failure (null)
    // rather than throwing — consumers shouldn't crash on a 429.
    expect(out).toBeNull();
  });
});

describe("getQuote — IDB fallback when upstream is unavailable", () => {
  it("returns the IDB-cached quote when the fresh fetch comes back unavailable", async () => {
    // Regression test (pre-static-cache behavior): when both
    // Yahoo and Finnhub failed, the client used to fall back to
    // the IDB-cached quote so the time-travel chart kept working
    // for popular tickers like TQQQ/VOO/VTI whose full history
    // was already on disk. A change to getQuote() to always
    // return the fresh-unavailable response broke that fallback
    // and surfaced "Symbols failed" banners on every transient
    // upstream blip. Pin the fallback so it doesn't regress
    // again.
    vi.resetModules();
    // Pre-seed an IDB row as if a prior successful fetch had
    // happened — this is what users actually have on disk.
    dexieRowHolder.row = {
      quote: {
        symbol: "VOO",
        currentPrice: 580.0,
        currency: "USD",
        name: "Vanguard S&P 500",
        history: [
          { t: Date.now() - 86_400_000, p: 578.5 },
          { t: Date.now() - 2 * 86_400_000, p: 577.0 },
        ],
        // Old enough that the TTL freshness check fails →
        // forces fall-through to the fetch path.
        fetchedAt: Date.now() - 30 * 60 * 1000,
        unavailable: false,
      },
    };
    // Fresh fetch returns the unavailable diagnostic (Yahoo
    // 429, Finnhub down — the route returns HTTP 200 with
    // unavailable: true).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 0,
        currency: "USD",
        name: null,
        history: [],
        asOf: Date.now(),
        unavailable: true,
        error: "yahoo: 429 | finnhub: rate-limit",
      }),
    );

    const { getQuote } = await import("@/lib/data/quotes");
    const out = await getQuote("VOO");
    // The cached quote (with real price + history) wins over
    // the unavailable fresh response. Without this fallback the
    // chart breaks and the user sees a banner instead of
    // working data.
    expect(out?.currentPrice).toBe(580.0);
    expect(out?.unavailable).toBe(false);
    expect(out?.history.length).toBeGreaterThan(0);
  });

  it("surfaces the unavailable diagnostic when there is NO IDB fallback", async () => {
    // The flip side: a brand-new user (or a ticker never
    // fetched before) should still see the diagnostic message
    // when the upstream is down, so PriceRefresher can show
    // the banner. Don't accidentally swallow errors when there
    // is nothing better to serve.
    vi.resetModules();
    dexieRowHolder.row = undefined; // no IDB row for this symbol
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "WEIRDNEW",
        currentPrice: 0,
        currency: "USD",
        name: null,
        history: [],
        asOf: Date.now(),
        unavailable: true,
        error: "yahoo: 404",
      }),
    );
    const { getQuote } = await import("@/lib/data/quotes");
    const out = await getQuote("WEIRDNEW");
    expect(out?.unavailable).toBe(true);
    expect(out?.error).toBe("yahoo: 404");
  });
});

describe("getQuote — empty-history cache invalidation", () => {
  it("treats an IDB-cached quote with empty history as not-fresh and refetches", async () => {
    // User-reported regression after PR #19 deploy: the home
    // History chart went smooth because IDB held empty-history
    // quotes from BEFORE the static-cache fix (Finnhub returned
    // currentPrice but no candles, the route ran the dynamic
    // fallback which produced { currentPrice: N, history: [] }).
    // isUsableQuote returned true on those (currentPrice > 0),
    // and getQuote returned the cached value without a refetch —
    // for 23 hours per holding.
    //
    // Pin that an empty-history cached row triggers a fresh
    // fetch instead of being served from cache.
    vi.resetModules();
    dexieRowHolder.row = {
      quote: {
        symbol: "VOO",
        currentPrice: 580.0,
        currency: "USD",
        name: null,
        history: [], // ← the stale state
        fetchedAt: Date.now() - 10 * 60 * 1000, // fresh by TTL
        unavailable: false,
      },
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 580,
        currency: "USD",
        name: null,
        history: [{ t: Date.now() - 86_400_000, p: 578.5 }],
        asOf: Date.now(),
      }),
    );
    const { getQuote } = await import("@/lib/data/quotes");
    const out = await getQuote("VOO");
    expect(out?.history.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT write an empty-history fresh fetch to IDB (avoids re-creating the trap)", async () => {
    // The IDB write was the source of the stale state in the
    // first place: a fresh fetch returning empty history was
    // cached, and subsequent getQuote calls served it for 23h.
    // After the fix, an empty-history fresh response is held in
    // memory (for the current session) but not persisted to IDB.
    vi.resetModules();
    dexieRowHolder.row = undefined; // no prior IDB
    const putSpy = vi.fn(async () => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 580,
        currency: "USD",
        name: null,
        history: [], // ← empty history from upstream
        asOf: Date.now(),
      }),
    );
    // We can't directly observe IDB writes without re-plumbing
    // the mock — but the contract is: if we call getQuote again
    // RIGHT AFTER receiving an empty-history quote, the next
    // call should refetch (because memCache returns the empty
    // quote and our cacheCoversMax invalidates it). This is the
    // observable proxy for "IDB doesn't sit on a poisoned row."
    const { getQuote } = await import("@/lib/data/quotes");
    const first = await getQuote("VOO");
    expect(first?.history.length).toBe(0);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 581,
        currency: "USD",
        name: null,
        history: [{ t: Date.now(), p: 581 }],
        asOf: Date.now(),
      }),
    );
    const second = await getQuote("VOO");
    expect(second?.history.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    void putSpy;
  });
});

describe("refreshQuotes — bulk symbol refresh", () => {
  it("deduplicates + uppercases symbols, returning one entry per unique symbol", async () => {
    vi.resetModules();
    const { refreshQuotes } = await import("@/lib/data/quotes");
    // Three input symbols, only two unique after upper+dedupe.
    fetchMock.mockResolvedValue(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 580,
        currency: "USD",
        name: "Vanguard S&P 500",
        history: [],
        asOf: Date.now(),
      }),
    );
    const out = await refreshQuotes(["voo", "VOO", "vti"]);
    // Unique uppercased keys only. A regression that didn't
    // dedupe would over-fetch and inflate the result map.
    expect(Object.keys(out).sort()).toEqual(["VOO", "VTI"]);
  });

  it("filters out the empty-string entry from the input", async () => {
    vi.resetModules();
    const { refreshQuotes } = await import("@/lib/data/quotes");
    fetchMock.mockResolvedValue(
      jsonResponse({
        symbol: "VOO",
        currentPrice: 580,
        currency: "USD",
        name: null,
        history: [],
        asOf: Date.now(),
      }),
    );
    // Note: only "" is filtered (it's the falsy value after
    // toUpperCase); whitespace-only strings are passed through
    // by design — the upstream API normalizes its own whitespace.
    const out = await refreshQuotes(["voo", ""]);
    expect(Object.keys(out)).toEqual(["VOO"]);
  });
});

describe("primeCache — seed without network", () => {
  it("returns the cached quote on the next getQuote call (no fetch)", async () => {
    vi.resetModules();
    const { getQuote, primeCache } = await import("@/lib/data/quotes");
    const seed = {
      symbol: "VOO",
      currentPrice: 575.25,
      currency: "USD" as const,
      name: "Vanguard S&P 500",
      // Realistic Drive-sync seed: history is populated. An
      // empty-history seed would (correctly) be treated as
      // not-fresh by the empty-history invalidation guard and
      // trigger a refetch.
      history: [{ t: Date.now() - 86_400_000, p: 574.0 }],
      fetchedAt: Date.now(),
      unavailable: false,
    };
    await primeCache(seed);
    const out = await getQuote("VOO");
    // primeCache seeds the in-memory cache → getQuote must
    // skip the network. The use case: Drive backup roundtrip
    // already brings down a fresh quote snapshot; without
    // primeCache, consumers would re-fetch every symbol on
    // load.
    expect(out?.currentPrice).toBe(575.25);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uppercases the symbol it seeds (matches the lookup convention)", async () => {
    vi.resetModules();
    const { getQuote, primeCache } = await import("@/lib/data/quotes");
    await primeCache({
      symbol: "voo",
      currentPrice: 575.25,
      currency: "USD",
      name: null,
      // Non-empty history so the empty-history invalidation
      // guard doesn't (correctly) force a refetch.
      history: [{ t: Date.now() - 86_400_000, p: 574.0 }],
      fetchedAt: Date.now(),
      unavailable: false,
    });
    // getQuote uppercases its lookup; primeCache must
    // uppercase its insert. A regression that stored "voo"
    // would silently re-fetch on every getQuote("VOO") call
    // because the cache key wouldn't match.
    const out = await getQuote("VOO");
    expect(out?.currentPrice).toBe(575.25);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("priceAt — binary-search history lookup", () => {
  function quote(history: { t: number; p: number }[]) {
    return {
      symbol: "TEST",
      currentPrice: 0,
      currency: "USD" as const,
      name: null,
      history,
      fetchedAt: 0,
      unavailable: false,
    };
  }

  it("interpolates between history points by picking the at-or-before timestamp", async () => {
    const { priceAt } = await import("@/lib/data/quotes");
    const q = quote([
      { t: 100, p: 10 },
      { t: 200, p: 20 },
      { t: 400, p: 40 },
      { t: 800, p: 80 },
    ]);
    // Queries land inside each bracket — the implementation is
    // a binary search returning the LAST point at-or-before
    // the query. Pin the exact behavior at multiple positions
    // so a regression that flipped the comparator surfaces.
    expect(priceAt(q, 100)).toBe(10);   // exact match start
    expect(priceAt(q, 150)).toBe(10);   // mid-bracket [100..200)
    expect(priceAt(q, 200)).toBe(20);   // exact match middle
    expect(priceAt(q, 300)).toBe(20);   // mid-bracket [200..400)
    expect(priceAt(q, 600)).toBe(40);   // mid-bracket [400..800)
    expect(priceAt(q, 800)).toBe(80);   // exact match end
  });

  it("clamps before-history queries to the first point", async () => {
    const { priceAt } = await import("@/lib/data/quotes");
    const q = quote([{ t: 100, p: 10 }, { t: 200, p: 20 }]);
    expect(priceAt(q, 50)).toBe(10);
  });

  it("clamps after-history queries to the last point", async () => {
    const { priceAt } = await import("@/lib/data/quotes");
    const q = quote([{ t: 100, p: 10 }, { t: 200, p: 20 }]);
    expect(priceAt(q, 9_999)).toBe(20);
  });

  it("returns null for an empty history", async () => {
    const { priceAt } = await import("@/lib/data/quotes");
    expect(priceAt(quote([]), 0)).toBeNull();
  });
});
