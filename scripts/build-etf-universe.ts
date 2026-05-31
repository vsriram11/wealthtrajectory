#!/usr/bin/env node
/**
 * Build the static history universe: top ~1000 US-listed ETFs by
 * AUM + top ~3000 US-listed stocks by market cap + always-include
 * (app preset + demo tickers), deduped. Total ~4000 tickers.
 *
 * Why include individual stocks: users add specific positions
 * (MSFT, AAPL, etc.) beyond just ETFs. The top 3000 by market cap
 * approximately covers the Russell 3000 / VTI holdings — i.e.
 * basically every US equity people care about.
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

const TOP_N_ETFS = 1000;
const TOP_N_STOCKS = 3000;
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

/** Common ticker normalization: uppercase + dot→dash (BRK.B → BRK-B). */
function normalizeTicker(s: string): string | null {
  const t = (s ?? "").trim().toUpperCase().replace(/\./g, "-");
  return /^[A-Z][A-Z0-9-]*$/.test(t) ? t : null;
}

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
  const tickers = rows
    .map((r) => normalizeTicker(r.symbol))
    .filter((t): t is string => !!t);
  console.log(`  → ${tickers.length} ETFs from Nasdaq`);
  return tickers;
}

/**
 * Fetch + rank stocks. Nasdaq's stocks endpoint already returns
 * `marketCap` per row, so unlike the ETF path we don't need a
 * separate Yahoo enrichment — sort by mc and take top N directly.
 *
 * Response shape differs from the ETF endpoint: stocks live at
 * `data.rows`, ETFs at `data.data.rows`. Same domain, different
 * nesting depth — Nasdaq's API is inconsistent on this point.
 */
async function fetchTopStocksByMarketCap(topN: number): Promise<string[]> {
  console.log(`Fetching top ${topN} stocks by market cap from Nasdaq…`);
  const res = await fetch(
    "https://api.nasdaq.com/api/screener/stocks?download=true",
    {
      headers: browserHeaders({ Accept: "application/json" }),
    },
  );
  if (!res.ok) {
    throw new Error(`Nasdaq stocks returned ${res.status}`);
  }
  const json = (await res.json()) as {
    data: { rows: Array<{ symbol: string; marketCap?: string }> };
  };
  const rows = json.data?.rows ?? [];
  const ranked = rows
    .map((r) => {
      const mcRaw = (r.marketCap ?? "").replace(/[$,\s]/g, "");
      const mc = Number(mcRaw);
      const sym = normalizeTicker(r.symbol);
      return sym && Number.isFinite(mc) && mc > 0
        ? { symbol: sym, marketCap: mc }
        : null;
    })
    .filter((r): r is { symbol: string; marketCap: number } => r != null)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, topN);
  console.log(
    `  → ${ranked.length} stocks (largest: ${ranked[0]?.symbol} $${(ranked[0]?.marketCap / 1e9).toFixed(0)}B; #${topN}: ${ranked[topN - 1]?.symbol} $${(ranked[topN - 1]?.marketCap / 1e9).toFixed(1)}B)`,
  );
  return ranked.map((r) => r.symbol);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry-with-backoff wrapper for transient Yahoo errors. The
 * crumb / quote endpoints regularly 429 from shared CI IPs
 * (GitHub Actions runners are heavily throttled by Yahoo's WAF,
 * same as Vercel's). A handful of seconds of backoff usually
 * clears the rolling window; we try 5 attempts with exponential
 * backoff before giving up.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry on 429 / 5xx. Permanent errors (parse failure,
      // 404, malformed response) bubble immediately.
      if (!/HTTP (429|5\d\d)/.test(msg)) throw e;
      if (attempt === maxAttempts) break;
      const backoffMs = 1000 * Math.pow(2, attempt); // 2, 4, 8, 16, 32s
      console.warn(
        `  ${label} attempt ${attempt}/${maxAttempts} failed (${msg}); retrying in ${backoffMs}ms…`,
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
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
  const res = await withRetry(`AUM batch ${symbols[0]}…`, async () => {
    const r = await fetch(url.toString(), {
      headers: browserHeaders({ Cookie: session.cookie }),
    });
    if (!r.ok) {
      throw new Error(
        `Yahoo quote batch ${symbols[0]}…: HTTP ${r.status}`,
      );
    }
    return r;
  });
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
  //
  // Yahoo's session/quote endpoints rate-limit shared CI IPs
  // hard (GitHub Actions runners + Vercel are both flagged).
  // If we can't establish a session at all, fall back to KEEPING
  // the existing universe.json: it was built from a recent
  // successful run, the top ETFs by AUM are stable across months,
  // and the downstream refresh-history step doesn't need crumb
  // auth. A transient Yahoo outage shouldn't fail the entire
  // pipeline.
  let session: { cookie: string; crumb: string } | null = null;
  try {
    session = await withRetry("Yahoo session", getYahooSession);
  } catch (e) {
    console.warn(
      `Yahoo session unreachable after retries (${e instanceof Error ? e.message : e}); keeping existing universe.json without re-ranking.`,
    );
  }

  if (!session) {
    // Verify the existing file is at least readable + sane; if
    // not, fail loud so the operator notices.
    try {
      const existing = JSON.parse(
        await (await import("node:fs/promises")).readFile(OUTPUT_PATH, "utf8"),
      ) as { tickers?: string[] };
      if (!existing.tickers || existing.tickers.length < 100) {
        throw new Error(`existing universe.json has only ${existing.tickers?.length ?? 0} tickers — refusing to keep`);
      }
      console.log(
        `Keeping existing universe (${existing.tickers.length} tickers); no rewrite this run.`,
      );
      return;
    } catch (e) {
      throw new Error(
        `Yahoo session failed AND existing universe.json unusable: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  const enriched = await enrichWithAum(universe, session);

  // Stage 3: sort ETFs by AUM, take top N.
  if (enriched.length === 0) {
    console.warn(
      "AUM enrichment returned 0 results (Yahoo rate-limited every batch); keeping existing universe.",
    );
    return;
  }
  enriched.sort((a, b) => b.netAssets - a.netAssets);
  const topEtfs = enriched.slice(0, TOP_N_ETFS).map((r) => r.symbol);
  console.log(`Top ETFs by AUM: ${topEtfs.length}`);
  console.log(
    `  largest: ${enriched[0].symbol} ($${(enriched[0].netAssets / 1e9).toFixed(1)}B)`,
  );
  console.log(
    `  smallest in top ${TOP_N_ETFS}: ${enriched[TOP_N_ETFS - 1]?.symbol} ($${
      enriched[TOP_N_ETFS - 1]
        ? (enriched[TOP_N_ETFS - 1].netAssets / 1e9).toFixed(2)
        : "n/a"
    }B)`,
  );

  // Stage 4: fetch top stocks by market cap. Nasdaq already
  // reports market cap per row — no separate Yahoo enrichment
  // needed for this list.
  const topStocks = await fetchTopStocksByMarketCap(TOP_N_STOCKS);

  // Stage 5: merge {top ETFs} ∪ {top stocks} ∪ {always-include},
  // deduped. normalizeTicker (used by both ETF + stock fetchers)
  // is the canonical form; re-apply to the always-include list
  // so BRK.B / BRK-B don't both appear as separate entries.
  const merged = new Set<string>();
  for (const t of topEtfs) merged.add(t);
  for (const t of topStocks) merged.add(t);
  for (const t of ALWAYS_INCLUDE) {
    const n = normalizeTicker(t);
    if (n) merged.add(n);
  }
  const finalList = [...merged].sort();
  console.log(
    `Final universe: ${finalList.length} tickers (${topEtfs.length} ETFs ∪ ${topStocks.length} stocks ∪ ${ALWAYS_INCLUDE.length} always-include)`,
  );

  // Stage 6: write to disk.
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: Date.now(),
        source:
          "top ETFs (nasdaq + yahoo v7/quote netAssets) ∪ top stocks (nasdaq marketCap)",
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
