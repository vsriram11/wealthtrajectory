"use client";

import { useMemo, useState } from "react";

import { inflationFactor } from "@/lib/data/cpiHistory";
import { formatUSD } from "@/lib/format";

/**
 * Ticker lookup — a Google-style "<TICKER> stock chart" view that
 * draws on the static history cache (lib/data/historyShards.ts +
 * /api/quote/[symbol]). For any ticker in the cached universe
 * (top 1000 ETFs + top 3000 stocks) it surfaces:
 *
 *   - Daily price-history chart since the cache window start
 *     (Dec 2005, or the ticker's inception if later)
 *   - Current price + as-of timestamp
 *   - Trailing-12-month dividend yield
 *   - Annual nominal CAGR (price + dividends reinvested)
 *   - Annual REAL CAGR (CAGR minus realized US inflation over the
 *     same window, sourced from lib/data/cpiHistory.ts)
 *
 * Portfolio-blind by design — same philosophy as the other
 * Research-page tools. Doesn't touch the user's household.
 */
export function TickerLookup() {
  const [symbolInput, setSymbolInput] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [data, setData] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (rawSymbol: string) => {
    const cleaned = rawSymbol.trim().toUpperCase().replace(/\./g, "-").slice(0, 12);
    if (!cleaned || !/^[A-Z0-9\-^]+$/.test(cleaned)) {
      setError("Enter a valid ticker (letters / numbers / hyphen).");
      return;
    }
    setLoading(true);
    setError(null);
    setSymbol(cleaned);
    try {
      const res = await fetch(
        `/api/quote/${encodeURIComponent(cleaned)}?range=max`,
      );
      if (!res.ok) {
        setError(`Lookup failed (HTTP ${res.status}).`);
        setData(null);
        return;
      }
      const json = (await res.json()) as RawTickerResponse;
      if (json.unavailable || !json.history || json.history.length === 0) {
        setError(
          json.error ??
            `No data available for ${cleaned}. Cached universe covers the top ~1000 ETFs + top ~3000 stocks.`,
        );
        setData(null);
        return;
      }
      const parsed = parseTickerData(cleaned, json);
      setData(parsed);
    } catch (e) {
      setError(`Lookup error: ${e instanceof Error ? e.message : String(e)}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="px-5 pt-3 pb-6">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleLookup(symbolInput);
        }}
      >
        <label className="flex flex-col gap-1 text-[11px] text-text-muted">
          <span>Ticker symbol</span>
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="e.g. VOO, AAPL, BRK-B"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="characters"
            className="w-40 rounded-md border border-border-strong bg-bg-elevated px-2 py-1.5 text-[13px] uppercase text-text outline-none focus:border-accent"
            aria-label="Ticker symbol to look up"
          />
        </label>
        <button
          type="submit"
          disabled={loading || symbolInput.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
        >
          {loading ? "Loading…" : "Look up"}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-[12px] text-negative"
        >
          {error}
        </div>
      )}

      {data && symbol && (
        <TickerView symbol={symbol} data={data} />
      )}

      {!data && !error && !loading && (
        <p className="mt-4 max-w-prose text-[12px] leading-relaxed text-text-dim">
          Enter a ticker to see its price history, dividend yield,
          and nominal + real annual CAGR. Data is drawn from the
          local static cache (top 1000 ETFs + top 3000 stocks by
          market cap; daily prices + quarterly dividends since
          December 2005). Real CAGR uses realized US CPI as the
          inflation deflator.
        </p>
      )}
    </section>
  );
}

function TickerView({
  symbol,
  data,
}: {
  symbol: string;
  data: TickerData;
}) {
  const stats = useMemo(() => computeStats(data), [data]);

  return (
    <div className="mt-4 space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text num">{symbol}</h2>
          <div className="text-[11px] text-text-dim">
            Data through{" "}
            {new Date(data.lastPoint.t).toLocaleDateString()} ·{" "}
            {data.history.length.toLocaleString()} daily points
          </div>
        </div>
        {data.currentPrice != null && (
          <div className="text-right">
            <div className="num text-2xl font-semibold text-text">
              {formatUSD(data.currentPrice)}
            </div>
            <div className="text-[11px] text-text-dim">Current</div>
          </div>
        )}
      </header>

      <PriceChart history={data.history} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Dividend yield (TTM)"
          value={
            stats.dividendYield != null
              ? `${(stats.dividendYield * 100).toFixed(2)}%`
              : "—"
          }
          sub={
            stats.ttmDividendsPerShare != null
              ? `${formatUSD(stats.ttmDividendsPerShare)}/share`
              : "no dividends in trailing year"
          }
        />
        <StatCard
          label="Annual CAGR (price)"
          value={
            stats.priceCAGR != null
              ? `${(stats.priceCAGR * 100).toFixed(2)}%`
              : "—"
          }
          sub={`${stats.years.toFixed(1)} yr window`}
        />
        <StatCard
          label="Annual CAGR (total return)"
          value={
            stats.totalReturnCAGR != null
              ? `${(stats.totalReturnCAGR * 100).toFixed(2)}%`
              : "—"
          }
          sub="price + reinvested dividends"
        />
        <StatCard
          label="Annual real CAGR"
          value={
            stats.realTotalReturnCAGR != null
              ? `${(stats.realTotalReturnCAGR * 100).toFixed(2)}%`
              : "—"
          }
          sub={
            stats.cumulativeInflation != null
              ? `inflation × ${stats.cumulativeInflation.toFixed(2)} over window`
              : "CPI window unavailable"
          }
        />
      </div>

      {data.dividends.length > 0 && (
        <details className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[12px] text-text-muted">
          <summary className="cursor-pointer text-text">
            Dividend history ({data.dividends.length} events)
          </summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto pr-1">
            {[...data.dividends]
              .reverse()
              .slice(0, 40)
              .map((d, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between text-[11px]"
                >
                  <span>{new Date(d.t).toLocaleDateString()}</span>
                  <span className="num text-text">
                    {formatUSD(d.amount)}/share
                  </span>
                </li>
              ))}
            {data.dividends.length > 40 && (
              <li className="pt-1 text-[10px] text-text-dim">
                (showing newest 40 of {data.dividends.length})
              </li>
            )}
          </ul>
        </details>
      )}

      {data.splits.length > 0 && (
        <details className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[12px] text-text-muted">
          <summary className="cursor-pointer text-text">
            Split history ({data.splits.length} events)
          </summary>
          <ul className="mt-2 space-y-0.5 pr-1">
            {data.splits.map((s, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between text-[11px]"
              >
                <span>{new Date(s.t).toLocaleDateString()}</span>
                <span className="num text-text">
                  {s.numerator}-for-{s.denominator}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="mt-0.5 num text-base font-semibold text-text">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-text-dim">{sub}</div>
    </div>
  );
}

function PriceChart({
  history,
}: {
  history: ReadonlyArray<{ t: number; p: number }>;
}) {
  const W = 800;
  const H = 200;
  const PAD = 4;
  const path = useMemo(() => {
    if (history.length < 2) return null;
    const tMin = history[0].t;
    const tMax = history[history.length - 1].t;
    const tSpan = Math.max(1, tMax - tMin);
    let pMin = Infinity;
    let pMax = -Infinity;
    for (const pt of history) {
      if (pt.p < pMin) pMin = pt.p;
      if (pt.p > pMax) pMax = pt.p;
    }
    const pSpan = Math.max(1e-9, pMax - pMin);
    const x = (t: number) => PAD + ((t - tMin) / tSpan) * (W - 2 * PAD);
    const y = (p: number) => H - PAD - ((p - pMin) / pSpan) * (H - 2 * PAD);
    let d = `M ${x(history[0].t).toFixed(1)} ${y(history[0].p).toFixed(1)}`;
    for (let i = 1; i < history.length; i++) {
      d += ` L ${x(history[i].t).toFixed(1)} ${y(history[i].p).toFixed(1)}`;
    }
    return d;
  }, [history]);

  if (!path) {
    return (
      <div className="rounded-md border border-border bg-bg-elevated px-3 py-6 text-center text-[11px] text-text-dim">
        Not enough data points to draw a chart.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-bg-elevated p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-48 w-full"
        role="img"
        aria-label="Price history chart"
        preserveAspectRatio="none"
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

// ── Types + computation ─────────────────────────────────────────

type TickerData = {
  currentPrice: number | null;
  history: ReadonlyArray<{ t: number; p: number }>;
  dividends: ReadonlyArray<{ t: number; amount: number }>;
  splits: ReadonlyArray<{ t: number; numerator: number; denominator: number }>;
  lastPoint: { t: number; p: number };
};

type RawTickerResponse = {
  currentPrice?: number | null;
  history?: Array<{ t: number; p: number }>;
  dividends?: Array<{ t: number; amount: number }>;
  splits?: Array<{ t: number; numerator: number; denominator: number }>;
  unavailable?: boolean;
  error?: string;
};

function parseTickerData(
  symbol: string,
  json: RawTickerResponse,
): TickerData {
  void symbol;
  const history = Array.isArray(json.history) ? [...json.history] : [];
  history.sort((a, b) => a.t - b.t);
  const dividends = Array.isArray(json.dividends) ? [...json.dividends] : [];
  dividends.sort((a, b) => a.t - b.t);
  const splits = Array.isArray(json.splits) ? [...json.splits] : [];
  splits.sort((a, b) => a.t - b.t);
  const lastPoint = history[history.length - 1];
  return {
    currentPrice:
      typeof json.currentPrice === "number" && json.currentPrice > 0
        ? json.currentPrice
        : lastPoint?.p ?? null,
    history,
    dividends,
    splits,
    lastPoint,
  };
}

type Stats = {
  years: number;
  priceCAGR: number | null;
  totalReturnCAGR: number | null;
  realTotalReturnCAGR: number | null;
  cumulativeInflation: number | null;
  dividendYield: number | null;
  ttmDividendsPerShare: number | null;
};

function computeStats(data: TickerData): Stats {
  const { history, dividends, currentPrice } = data;
  const first = history[0];
  const last = history[history.length - 1];
  const years = Math.max(
    1 / 365,
    (last.t - first.t) / (365.25 * 24 * 60 * 60 * 1000),
  );

  const priceMultiple = last.p / first.p;
  const priceCAGR =
    priceMultiple > 0 ? Math.pow(priceMultiple, 1 / years) - 1 : null;

  // Total-return approximation: reinvest each dividend at the
  // close on its ex-date. Accumulate a share-count multiplier from
  // 1.0; final wealth multiple = (last price / first price) ×
  // share multiplier. Doesn't model spread/taxes/timing; close
  // enough for the back-of-envelope research view.
  let shareMultiplier = 1;
  for (const d of dividends) {
    // Use the close on the ex-date (or the next available close).
    const priceOnEx = priceAtOrAfter(history, d.t);
    if (priceOnEx == null || priceOnEx <= 0) continue;
    shareMultiplier *= 1 + d.amount / priceOnEx;
  }
  const totalReturnMultiple = priceMultiple * shareMultiplier;
  const totalReturnCAGR =
    totalReturnMultiple > 0
      ? Math.pow(totalReturnMultiple, 1 / years) - 1
      : null;

  // Real CAGR — divide the cumulative wealth multiple by the
  // cumulative inflation factor over the same window, then
  // annualize.
  const cumulativeInflation = inflationFactor(first.t, last.t);
  const realTotalReturnCAGR =
    totalReturnMultiple > 0 && cumulativeInflation != null && cumulativeInflation > 0
      ? Math.pow(totalReturnMultiple / cumulativeInflation, 1 / years) - 1
      : null;

  // TTM dividend yield: sum dividends in the trailing 365 days,
  // divide by current price.
  const ttmCutoff = last.t - 365 * 24 * 60 * 60 * 1000;
  const ttmDividendsPerShare = dividends
    .filter((d) => d.t >= ttmCutoff)
    .reduce((acc, d) => acc + d.amount, 0);
  const dividendYield =
    currentPrice != null && currentPrice > 0 && ttmDividendsPerShare > 0
      ? ttmDividendsPerShare / currentPrice
      : ttmDividendsPerShare > 0
        ? null
        : 0;

  return {
    years,
    priceCAGR,
    totalReturnCAGR,
    realTotalReturnCAGR,
    cumulativeInflation,
    dividendYield,
    ttmDividendsPerShare: ttmDividendsPerShare > 0 ? ttmDividendsPerShare : null,
  };
}

/**
 * Binary search for the price on the given timestamp or the next
 * available trading day. Returns null when the timestamp is after
 * the last available point.
 */
function priceAtOrAfter(
  history: ReadonlyArray<{ t: number; p: number }>,
  t: number,
): number | null {
  if (history.length === 0) return null;
  let lo = 0;
  let hi = history.length - 1;
  if (history[hi].t < t) return null;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (history[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return history[lo].p;
}
