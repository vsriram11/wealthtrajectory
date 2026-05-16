// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock dexie so the module doesn't try to open IndexedDB. We're only
// exercising the in-memory cache + fetchFresh path here.
vi.mock("dexie", () => {
  class FakeDexie {
    quotes = {
      get: async () => undefined,
      put: async () => {},
    };
    version() {
      return this;
    }
    stores() {
      return this;
    }
    constructor(_: string) {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
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
        history: [],
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
      history: [],
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
      history: [],
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
