"use client";

import { useMemo, useRef, useState } from "react";

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
  // Inception detection: the static cache window starts Dec 1
  // 2005; if the ticker's first datapoint is later than that, the
  // ticker's actual inception is what we surface to the user
  // (rather than padding the chart with a flat pre-inception
  // segment). For tickers that genuinely span the full window we
  // suppress the line — no useful information to add.
  const STATIC_CACHE_START_MS = Date.UTC(2005, 11, 1); // Dec 1 2005
  const isPostCacheInception =
    data.history.length > 0 &&
    data.history[0].t > STATIC_CACHE_START_MS + 30 * 86_400_000;

  return (
    <div className="mt-4 space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text num">{symbol}</h2>
          <div className="text-[11px] text-text-dim">
            {isPostCacheInception ? (
              <>
                Inception {new Date(data.history[0].t).toLocaleDateString()}{" "}
                · data through{" "}
                {new Date(data.lastPoint.t).toLocaleDateString()} ·{" "}
                {data.history.length.toLocaleString()} daily points
              </>
            ) : (
              <>
                Data through{" "}
                {new Date(data.lastPoint.t).toLocaleDateString()} ·{" "}
                {data.history.length.toLocaleString()} daily points
              </>
            )}
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          realValue={
            stats.realPriceCAGR != null
              ? `${(stats.realPriceCAGR * 100).toFixed(2)}% real`
              : null
          }
        />
        <StatCard
          label="Annual CAGR (total return)"
          value={
            stats.totalReturnCAGR != null
              ? `${(stats.totalReturnCAGR * 100).toFixed(2)}%`
              : "—"
          }
          sub="price + reinvested dividends"
          realValue={
            stats.realTotalReturnCAGR != null
              ? `${(stats.realTotalReturnCAGR * 100).toFixed(2)}% real`
              : null
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
  realValue,
}: {
  label: string;
  value: string;
  sub: string;
  /**
   * Optional inflation-adjusted version of the headline value.
   * Rendered as a smaller, dimmer line just under the nominal
   * figure so the two are visually paired without competing —
   * the user wanted the real CAGR "smartly placed below the
   * nominal in those cards" rather than as its own card.
   */
  realValue?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="mt-0.5 num text-base font-semibold text-text">
        {value}
      </div>
      {realValue && (
        <div className="num text-[11px] text-text-muted">{realValue}</div>
      )}
      <div className="mt-0.5 text-[10px] text-text-dim">{sub}</div>
    </div>
  );
}

function PriceChart({
  history,
}: {
  history: ReadonlyArray<{ t: number; p: number }>;
}) {
  // SVG dimensions chosen so the chart looks crisp at typical
  // mobile + desktop widths. The right gutter (RIGHT_PAD) leaves
  // room for the y-axis label on the rightmost tick without
  // crowding the line. The bottom gutter (BOTTOM_PAD) holds the
  // x-axis date labels.
  const W = 800;
  const H = 260;
  const LEFT_PAD = 4;
  const RIGHT_PAD = 4;
  const TOP_PAD = 8;
  const BOTTOM_PAD = 28;
  const PLOT_W = W - LEFT_PAD - RIGHT_PAD;
  const PLOT_H = H - TOP_PAD - BOTTOM_PAD;

  const chartGeometry = useMemo(() => {
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
    const x = (t: number) => LEFT_PAD + ((t - tMin) / tSpan) * PLOT_W;
    const y = (p: number) =>
      TOP_PAD + (1 - (p - pMin) / pSpan) * PLOT_H;
    let d = `M ${x(history[0].t).toFixed(1)} ${y(history[0].p).toFixed(1)}`;
    for (let i = 1; i < history.length; i++) {
      d += ` L ${x(history[i].t).toFixed(1)} ${y(history[i].p).toFixed(1)}`;
    }
    // Pick ~5 date tick positions evenly across the window. Date
    // labels render at the bottom of the chart.
    const TICK_COUNT = 5;
    const tickTimes: number[] = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      tickTimes.push(tMin + (i / (TICK_COUNT - 1)) * (tMax - tMin));
    }
    return { d, x, y, tMin, tMax, pMin, pMax, tickTimes };
    // PLOT_W and PLOT_H are derived from module-level constants so
    // they're stable across renders; lint wants them in the dep
    // array anyway for completeness.
  }, [history, PLOT_W, PLOT_H]);

  // Hover / touch tracking. When the pointer moves across the
  // chart, find the history point with the closest timestamp and
  // surface its date + price in an overlay. SVG coordinates need
  // to map back to data, so we capture the container's bounding
  // rect for the math.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!chartGeometry) {
    return (
      <div className="rounded-md border border-border bg-bg-elevated px-3 py-6 text-center text-[11px] text-text-dim">
        Not enough data points to draw a chart.
      </div>
    );
  }

  const { d, x, y, tMin, tMax, tickTimes } = chartGeometry;

  const handleMove = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Map the pointer's pixel X to the SVG's user-space X. The SVG
    // uses preserveAspectRatio="none" + viewBox=W, so user-space X
    // = pointer-rel-X × (W / rect.width).
    const userX = ((clientX - rect.left) / rect.width) * W;
    // Map user-space X back to a timestamp.
    const fracX = Math.max(0, Math.min(1, (userX - LEFT_PAD) / PLOT_W));
    const targetT = tMin + fracX * (tMax - tMin);
    // Binary-search for closest history point.
    let lo = 0;
    let hi = history.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (history[mid].t < targetT) lo = mid + 1;
      else hi = mid;
    }
    // Prefer the closer of (lo-1, lo).
    if (lo > 0) {
      const a = Math.abs(history[lo - 1].t - targetT);
      const b = Math.abs(history[lo].t - targetT);
      if (a < b) lo = lo - 1;
    }
    setHoverIdx(lo);
  };

  const clearHover = () => setHoverIdx(null);
  const hoverPoint = hoverIdx != null ? history[hoverIdx] : null;
  const hoverX = hoverPoint ? x(hoverPoint.t) : null;
  const hoverY = hoverPoint ? y(hoverPoint.p) : null;

  return (
    <div className="rounded-md border border-border bg-bg-elevated p-2">
      {hoverPoint && (
        <div className="mb-1 flex items-baseline justify-between text-[11px]">
          <span className="text-text-dim">
            {new Date(hoverPoint.t).toLocaleDateString()}
          </span>
          <span className="num font-medium text-text">
            {formatUSD(hoverPoint.p)}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="relative w-full select-none"
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={clearHover}
        onTouchStart={(e) => {
          if (e.touches[0]) handleMove(e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) handleMove(e.touches[0].clientX);
        }}
        onTouchEnd={clearHover}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-56 w-full"
          role="img"
          aria-label="Price history chart"
          preserveAspectRatio="none"
        >
          {/* Plot line */}
          <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" />
          {/* X-axis date labels */}
          {tickTimes.map((t, i) => {
            const tx = x(t);
            // Format compactly: "MMM YY" for windows > 1y, else
            // "MMM D" for shorter ranges.
            const spanYears =
              (tMax - tMin) / (365.25 * 24 * 60 * 60 * 1000);
            const date = new Date(t);
            const label =
              spanYears >= 1.5
                ? date.toLocaleDateString("en-US", {
                    month: "short",
                    year: "2-digit",
                  })
                : date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
            // Anchor middle ticks centered, first tick at start,
            // last tick at end so labels don't clip outside the
            // plot area.
            const anchor =
              i === 0 ? "start" : i === tickTimes.length - 1 ? "end" : "middle";
            return (
              <text
                key={i}
                x={tx}
                y={H - 8}
                textAnchor={anchor}
                fontSize="11"
                fill="currentColor"
                opacity="0.5"
              >
                {label}
              </text>
            );
          })}
          {/* Hover indicator: vertical guide line + filled point */}
          {hoverX != null && hoverY != null && (
            <>
              <line
                x1={hoverX}
                x2={hoverX}
                y1={TOP_PAD}
                y2={H - BOTTOM_PAD}
                stroke="currentColor"
                strokeOpacity="0.4"
                strokeDasharray="2 3"
                strokeWidth="1"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r="3.5"
                fill="currentColor"
                stroke="white"
                strokeWidth="1"
              />
            </>
          )}
        </svg>
      </div>
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
  realPriceCAGR: number | null;
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

  // Real CAGRs — divide the cumulative wealth multiple by the
  // cumulative inflation factor over the same window, then
  // annualize. We compute it for BOTH price-only and total-return
  // so each stat card can show the inflation-adjusted variant
  // directly beneath its nominal figure (per user request).
  const cumulativeInflation = inflationFactor(first.t, last.t);
  const realTotalReturnCAGR =
    totalReturnMultiple > 0 && cumulativeInflation != null && cumulativeInflation > 0
      ? Math.pow(totalReturnMultiple / cumulativeInflation, 1 / years) - 1
      : null;
  const realPriceCAGR =
    priceMultiple > 0 && cumulativeInflation != null && cumulativeInflation > 0
      ? Math.pow(priceMultiple / cumulativeInflation, 1 / years) - 1
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
    realPriceCAGR,
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
