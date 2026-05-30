#!/usr/bin/env node
/**
 * Build the static ETF universe: top ~1000 US-listed ETFs by AUM,
 * plus an override set (the app's preset + demo tickers, ensuring
 * those are always covered even if their AUM falls outside the top
 * 1000).
 *
 * Sources:
 *  - Nasdaq's screener API for the full US ETF universe (~4500
 *    rows). Free, public, no auth.
 *  - Yahoo's v7/finance/quote batch endpoint for netAssets (AUM)
 *    enrichment. Requires cookie + crumb auth — script handles
 *    that handshake.
 *
 * Output: `data/etf-universe.json` of shape
 *   { generatedAt: number, tickers: string[] }
 *
 * Cadence: run quarterly or whenever the seed list drifts. The
 * downstream `refresh-history.ts` consumes the file.
 *
 * Run: `npx tsx scripts/build-etf-universe.ts`
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

const TOP_N = 1000;
const BATCH_SIZE = 50;
const OUTPUT_PATH = resolve(process.cwd(), "data", "etf-universe.json");

// Always-include tickers: demo + preset symbols. Sourced once from
// the codebase (run `npm run dump-preset-tickers` if/when this list
// drifts — for now hardcoded so the script has no codebase dep).
const ALWAYS_INCLUDE = [
  "AGG", "AVGE", "AVUV", "BIB", "BITO", "BITX", "BND", "BNDX", "BOIL", "DBC",
  "DIG", "DPST", "EMB", "ETHA", "ETHE", "FAS", "FBTC", "FNGU", "GBTC", "GDE",
  "GLD", "GLDM", "GUSH", "HYG", "IAU", "IBIT", "IEF", "IJR", "IWD", "JNUG",
  "LABU", "LQD", "MIDU", "MVV", "NTSE", "NTSI", "NTSX", "NUGT", "NVDL",
  "PDBC", "QLD", "QQQ", "QQQM", "ROM", "RSSB", "RSST", "RSSY", "SCHB", "SCHD",
  "SCHF", "SCHG", "SCHH", "SCHM", "SCHO", "SCHP", "SCHQ", "SCHA", "SCHC", "SCHE",
  "SPY", "SVXY", "TLT", "TMF", "TQQQ", "UPRO", "URTY", "USD", "VEA", "VGT",
  "VHT", "VIG", "VOO", "VTI", "VTV", "VUG", "VWO", "VXUS",
];

async function fetchNasdaqUniverse(): Promise<string[]> {
  console.log("Fetching Nasdaq ETF universe…");
  const res = await fetch(
    "https://api.nasdaq.com/api/screener/etf?download=true",
    {
      headers: browserHeaders({ Accept: "application/json" }),
    },
  );
  if (!res.ok) {
    throw new Error(`Nasdaq returned ${res.status}`);
  }
  const json = (await res.json()) as {
    data: { data: { rows: Array<{ symbol: string }> } };
  };
  const rows = json.data?.data?.rows ?? [];
  // Symbols may contain dots / dashes (e.g., BRK.B). Yahoo expects
  // dashes for class shares; normalize.
  const tickers = rows
    .map((r) => r.symbol?.trim()?.toUpperCase().replace(/\./g, "-"))
    .filter((t): t is string => !!t && /^[A-Z][A-Z0-9-]*$/.test(t));
  console.log(`  → ${tickers.length} ETFs from Nasdaq`);
  return tickers;
}

async function getYahooSession(): Promise<{ cookie: string; crumb: string }> {
  const cookieRes = await fetch("https://fc.yahoo.com/", {
    headers: browserHeaders(),
    redirect: "manual",
  });
  const setCookies: string[] = [];
  cookieRes.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") setCookies.push(v);
  });
  if (setCookies.length === 0) {
    throw new Error("Yahoo session: no Set-Cookie returned");
  }
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: browserHeaders({ Cookie: cookie }),
    },
  );
  if (!crumbRes.ok) throw new Error(`Yahoo crumb: HTTP ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 32) {
    throw new Error(`Yahoo crumb: bogus response "${crumb.slice(0, 40)}"`);
  }
  return { cookie, crumb };
}

type AumRow = { symbol: string; netAssets: number };

async function fetchAumBatch(
  symbols: string[],
  session: { cookie: string; crumb: string },
): Promise<AumRow[]> {
  const url = new URL("https://query2.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("fields", "symbol,netAssets,longName,quoteType");
  url.searchParams.set("crumb", session.crumb);
  const res = await fetch(url.toString(), {
    headers: browserHeaders({ Cookie: session.cookie }),
  });
  if (!res.ok) {
    throw new Error(`Yahoo quote batch ${symbols[0]}…: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    quoteResponse?: {
      result?: Array<{ symbol?: string; netAssets?: number }>;
    };
  };
  const rows = json.quoteResponse?.result ?? [];
  return rows
    .filter(
      (r): r is { symbol: string; netAssets: number } =>
        !!r.symbol && typeof r.netAssets === "number" && r.netAssets > 0,
    )
    .map((r) => ({ symbol: r.symbol, netAssets: r.netAssets }));
}

async function enrichWithAum(
  tickers: string[],
  session: { cookie: string; crumb: string },
): Promise<AumRow[]> {
  console.log(
    `Enriching ${tickers.length} tickers with AUM via Yahoo batch (${BATCH_SIZE}/batch)…`,
  );
  const out: AumRow[] = [];
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    try {
      const enriched = await fetchAumBatch(batch, session);
      out.push(...enriched);
    } catch (e) {
      console.warn(
        `  batch ${i}-${i + BATCH_SIZE - 1} failed: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (i % 500 === 0 && i > 0) {
      console.log(`  …${i}/${tickers.length} processed, ${out.length} with AUM`);
    }
    // Polite throttle: 200ms between batches → ~5 req/s → well
    // under Yahoo's per-IP limit even from shared infra.
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`  → ${out.length} tickers enriched with positive AUM`);
  return out;
}

async function main() {
  // Stage 1: get the universe.
  const universe = await fetchNasdaqUniverse();

  // Stage 2: AUM enrichment.
  const session = await getYahooSession();
  const enriched = await enrichWithAum(universe, session);

  // Stage 3: sort by AUM, take top N.
  enriched.sort((a, b) => b.netAssets - a.netAssets);
  const top = enriched.slice(0, TOP_N).map((r) => r.symbol);
  console.log(`Top by AUM: ${top.length} tickers`);
  console.log(
    `  largest: ${enriched[0].symbol} ($${(enriched[0].netAssets / 1e9).toFixed(1)}B)`,
  );
  console.log(
    `  smallest in top ${TOP_N}: ${enriched[TOP_N - 1]?.symbol} ($${
      enriched[TOP_N - 1]
        ? (enriched[TOP_N - 1].netAssets / 1e9).toFixed(2)
        : "n/a"
    }B)`,
  );

  // Stage 4: merge with always-include set. Normalize each
  // entry through the same dot→dash rewrite the Nasdaq path
  // uses (so e.g. BRK.B + BRK-B don't both appear as separate
  // tickers and confuse the shard hash).
  const normalize = (t: string) => t.trim().toUpperCase().replace(/\./g, "-");
  const merged = new Set<string>(top.map(normalize));
  for (const t of ALWAYS_INCLUDE) merged.add(normalize(t));
  const finalList = [...merged].sort();
  console.log(
    `Final universe: ${finalList.length} tickers (top ${TOP_N} by AUM ∪ ${ALWAYS_INCLUDE.length} always-include)`,
  );

  // Stage 5: write to disk.
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: Date.now(),
        source: "nasdaq + yahoo v7/quote netAssets, sorted desc",
        tickerCount: finalList.length,
        tickers: finalList,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
