"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { getAccessToken } from "@/lib/sync/googleAuth";
import {
  loadQuoteCache,
  saveQuoteCache,
  type QuoteCache,
} from "@/lib/sync/googleDrive";
import { uniqueSymbols } from "@/lib/data/history";
import { getQuote, primeCache } from "@/lib/data/quotes";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// 1-second spacing between upstream fetches keeps any single browser
// session under Finnhub's 60-calls-per-minute key limit. Returning users
// hit the Drive cache and skip this entirely; new-user backfill of e.g.
// 5 tickers takes ~5s.
const FETCH_SPACING_MS = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * On user sign-in (or each load while signed in), reconcile the per-user
 * Drive-stored quote cache with our local Dexie cache and refresh any
 * stale or missing tickers from upstream. Then push the merged cache
 * back to Drive so other devices and future sessions skip the network.
 */
export function QuoteCloudSync() {
  const user = useAppStore((s) => s.user);
  const household = useAppStore((s) => s.household);
  // Quote cache lives on Drive and is shared across devices for the
  // same user. Encrypt it under the user's passphrase whenever
  // encryption is enabled — otherwise the ticker list + 5y price
  // history would leak portfolio composition (the most fingerprintable
  // metadata in the app) despite the encryption promise on /security.
  const driveEncryptionEnabled = useAppStore((s) => s.driveEncryptionEnabled);
  const passphrase = useAppStore((s) => s.encryptionPassphrase);

  useEffect(() => {
    if (!user) return;
    // Fail-closed: if the user opted into encryption but no
    // passphrase is loaded in memory (e.g. fresh tab, hasn't
    // entered it yet), skip the quote sync entirely. The
    // EncryptionUnlockBanner will prompt; quote sync resumes
    // automatically on the next render after unlock.
    if (driveEncryptionEnabled && !passphrase) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (cancelled) return;
        const remote = await loadQuoteCache(token, passphrase);
        const symbols = uniqueSymbols(household);
        if (symbols.length === 0) return;

        // Seed local from remote
        const merged: QuoteCache = remote ?? {
          schema: 1,
          bySymbol: {},
        };
        if (remote) {
          for (const [sym, entry] of Object.entries(remote.bySymbol)) {
            primeCache({
              symbol: sym,
              currentPrice: entry.currentPrice ?? 0,
              currency: "USD",
              name: entry.name,
              history: entry.history,
              fetchedAt: entry.fetchedAt,
            });
          }
        }

        let mutated = false;
        let firstNetworkFetch = true;
        for (const symbol of symbols) {
          const cached = merged.bySymbol[symbol];
          const stale =
            !cached || Date.now() - cached.fetchedAt > ONE_DAY_MS;
          if (!stale) continue;
          if (!firstNetworkFetch) await sleep(FETCH_SPACING_MS);
          firstNetworkFetch = false;
          const fresh = await getQuote(symbol);
          if (cancelled) return;
          if (fresh && (fresh.currentPrice > 0 || fresh.history.length > 0)) {
            merged.bySymbol[symbol] = {
              currentPrice: fresh.currentPrice,
              name: fresh.name,
              history: fresh.history,
              fetchedAt: fresh.fetchedAt,
            };
            mutated = true;
          }
        }

        if (mutated) {
          await saveQuoteCache(token, merged, passphrase);
        }
      } catch {
        /* silent — Yahoo/Finnhub failures already surface in HistoryView */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, household.accounts.length, driveEncryptionEnabled, passphrase]);

  return null;
}
