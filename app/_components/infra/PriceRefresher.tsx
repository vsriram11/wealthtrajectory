"use client";

import { useEffect, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { uniqueSymbols } from "@/lib/data/history";
import { getQuote } from "@/lib/data/quotes";

// 1-second spacing between *network* calls keeps any single browser
// session well under Finnhub's 60-calls-per-minute API key limit when
// we're warming up a brand-new account. Cache hits (memCache → IDB →
// Vercel edge) finish in single-digit milliseconds and should NOT
// trigger this sleep — that's what made adding a new ticker feel
// like nothing happened: the new symbol sat at the tail of a queue
// that was sleep-padding through every already-cached symbol.
const NETWORK_SPACING_MS = 1000;
// Anything finishing faster than this was almost certainly served
// from cache (memory or HTTP edge). Conservative — even fast 4G
// pings rarely round-trip in under ~80ms.
const NETWORK_THRESHOLD_MS = 60;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function PriceRefresher() {
  const household = useAppStore((s) => s.household);
  const applyLivePrice = useAppStore((s) => s.applyLivePrice);

  // Track per-holding identity (not just the unique symbol set) so
  // adding a SECOND VOO doesn't skip the refresh — the previous
  // implementation memoized on unique symbols, so duplicate adds
  // inherited the preset's referencePriceUSD permanently because
  // the effect's dependency never changed. Using holding IDs makes
  // every newly-added holding a key change → effect re-fires →
  // getQuote returns the cached price (no network round-trip for
  // already-fetched symbols) → applyLivePrice updates the fresh
  // holding too.
  //
  // We deliberately omit lastPricedAt from the key so each successful
  // applyLivePrice doesn't itself cause a cascade.
  const holdingsKey = useMemo(() => {
    const ids: string[] = [];
    for (const a of household.accounts) {
      for (const h of a.holdings) {
        // Mirror uniqueSymbols() — equity / bond / commodity + live-
        // priceable crypto are all stock-market ETFs in the quote
        // pipeline's eyes. isManualPrice opts out (native crypto
        // BTC/ETH, custom jewelry/bars, manually-entered overrides).
        if (
          h.kind !== "equity" &&
          h.kind !== "bond" &&
          h.kind !== "commodity" &&
          h.kind !== "crypto"
        )
          continue;
        if (h.isManualPrice) continue;
        ids.push(`${h.symbol.toUpperCase()}:${h.id}`);
      }
    }
    return ids.sort().join("|");
  }, [household.accounts]);

  useEffect(() => {
    const symbols = uniqueSymbols(household);
    if (symbols.length === 0) return;
    let cancelled = false;
    void (async () => {
      let lastWasNetwork = false;
      for (const s of symbols) {
        if (cancelled) return;
        if (lastWasNetwork) await sleep(NETWORK_SPACING_MS);
        const t0 =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const q = await getQuote(s);
        const elapsed =
          (typeof performance !== "undefined"
            ? performance.now()
            : Date.now()) - t0;
        lastWasNetwork = elapsed > NETWORK_THRESHOLD_MS;
        if (cancelled) return;
        if (q && q.currentPrice > 0) {
          applyLivePrice(s, q.currentPrice, q.fetchedAt);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey, applyLivePrice]);

  return null;
}
