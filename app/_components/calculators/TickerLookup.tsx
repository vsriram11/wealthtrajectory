"use client";

import { useMemo, useRef, useState } from "react";

import { inflationFactor } from "@/lib/data/cpiHistory";
import { CustomDatePicker } from "@/app/_components/ui/CustomDatePicker";

/**
 * Format a price with exactly 2 decimal places ($580.42 vs the
 * default formatUSD's 0-decimal whole-dollar style $580). Used
 * everywhere ticker prices appear — the chart's hover overlay,
 * the current-price card, the dividend per-share rows. Prices
 * are inherently decimal; rounding to whole dollars hides the
 * sub-dollar information the user is reading the chart for.
 */
const priceFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatPrice = (n: number) => priceFmt.format(n);

/** Ranges available in the Ticker lookup view. Mirrors the chip
 * row on the home History panel. */
type TickerRange = "1M" | "3M" | "6M" | "1Y" | "YTD" | "5Y" | "ALL" | "CUSTOM";

const TICKER_RANGES: TickerRange[] = ["1M", "3M", "6M", "1Y", "YTD", "5Y", "ALL", "CUSTOM"];
const TICKER_RANGE_LABELS: Record<TickerRange, string> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
  YTD: "YTD",
  "5Y": "5Y",
  ALL: "All",
  CUSTOM: "Custom",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function rangeBounds(
  range: TickerRange,
  history: ReadonlyArray<{ t: number; p: number }>,
  custom?: { start: number; end: number },
): { start: number; end: number } | null {
  if (history.length === 0) return null;
  const earliestT = history[0].t;
  const latestT = history[history.length - 1].t;
  if (range === "CUSTOM") {
    if (!custom) return null;
    const start = Math.max(custom.start, earliestT);
    const end = Math.min(custom.end, latestT);
    return start < end ? { start, end } : null;
  }
  if (range === "ALL") return { start: earliestT, end: latestT };
  let start: number;
  const end = latestT;
  if (range === "YTD") {
    const endDate = new Date(end);
    start = Date.UTC(endDate.getUTCFullYear(), 0, 1);
  } else {
    const back: Record<Exclude<TickerRange, "YTD" | "ALL" | "CUSTOM">, number> = {
      "1M": 30,
      "3M": 90,
      "6M": 180,
      "1Y": 365,
      "5Y": 365 * 5,
    };
    start = end - back[range] * MS_PER_DAY;
  }
  if (start < earliestT) start = earliestT;
  return start < end ? { start, end } : null;
}

function clampHistory<T extends { t: number }>(
  history: ReadonlyArray<T>,
  bounds: { start: number; end: number },
): T[] {
  return history.filter((p) => p.t >= bounds.start && p.t <= bounds.end);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function msFromIso(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

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
  const [range, setRange] = useState<TickerRange>("ALL");
  const [customStart, setCustomStart] = useState<string>(() =>
    data.history.length > 0
      ? isoFromMs(data.history[0].t)
      : isoFromMs(Date.UTC(2010, 0, 1)),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    isoFromMs(data.lastPoint.t),
  );
  const customRangeBounds = useMemo(() => {
    if (range !== "CUSTOM") return undefined;
    const s = msFromIso(customStart);
    const e = msFromIso(customEnd);
    if (s == null || e == null || s >= e) return undefined;
    return { start: s, end: e };
  }, [range, customStart, customEnd]);

  // Filter the dataset to the selected range. The chart, stat
  // cards (CAGR, dividend yield TTM), and dividend list all read
  // from the SAME filtered slice so any switch is consistent.
  const rangedData = useMemo<TickerData>(() => {
    const bounds = rangeBounds(range, data.history, customRangeBounds);
    if (!bounds) return data;
    const history = clampHistory(data.history, bounds);
    const dividends = data.dividends.filter(
      (d) => d.t >= bounds.start && d.t <= bounds.end,
    );
    const splits = data.splits.filter(
      (s) => s.t >= bounds.start && s.t <= bounds.end,
    );
    return {
      ...data,
      history,
      dividends,
      splits,
      lastPoint: history[history.length - 1] ?? data.lastPoint,
    };
  }, [data, range, customRangeBounds]);

  // Pass the FULL dividend list (not just range-filtered) so the
  // TTM-dividend lookup can reach back 12 months from the range's
  // endpoint even when that endpoint sits less than a year into
  // the range. Same reasoning for full history: dividend yield
  // divides by the price AT THE ENDPOINT, and for some windows
  // that price isn't otherwise needed.
  const stats = useMemo(
    () => computeStats(rangedData, data.dividends, data.history),
    [rangedData, data.dividends, data.history],
  );
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
              {formatPrice(data.currentPrice)}
            </div>
            <div className="text-[11px] text-text-dim">Current</div>
          </div>
        )}
      </header>

      {/* Range selector — same chip pattern as the home History
          panel. Switching range updates BOTH the chart and the
          stat cards (dividend yield TTM, CAGR price + total
          return, real variants), so the stats always describe
          the window the user is looking at. */}
      <div
        role="tablist"
        aria-label="Ticker range"
        className="no-scrollbar flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-surface p-1"
      >
        {TICKER_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={range === r}
            onClick={() => setRange(r)}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
              range === r
                ? "bg-accent text-bg"
                : "text-text-muted hover:text-text"
            }`}
          >
            {TICKER_RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      {range === "CUSTOM" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[11px]">
          <CustomDatePicker
            label="From"
            value={customStart}
            max={customEnd}
            onChange={setCustomStart}
            ariaLabel="Custom range start date"
          />
          <CustomDatePicker
            label="To"
            value={customEnd}
            min={customStart}
            max={isoFromMs(data.lastPoint.t)}
            onChange={setCustomEnd}
            ariaLabel="Custom range end date"
          />
          {!customRangeBounds && (
            <span className="text-amber-300">
              Pick a valid range (start before end)
            </span>
          )}
        </div>
      )}

      <PriceChart history={rangedData.history} />

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
              ? `${formatPrice(stats.ttmDividendsPerShare)}/share`
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

      {rangedData.dividends.length > 0 && (
        <details className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[12px] text-text-muted">
          <summary className="cursor-pointer text-text">
            Dividend history ({rangedData.dividends.length} events in range)
          </summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto pr-1">
            {[...rangedData.dividends]
              .reverse()
              .slice(0, 40)
              .map((d, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between text-[11px]"
                >
                  <span>{new Date(d.t).toLocaleDateString()}</span>
                  <span className="num text-text">
                    {formatPrice(d.amount)}/share
                  </span>
                </li>
              ))}
            {rangedData.dividends.length > 40 && (
              <li className="pt-1 text-[10px] text-text-dim">
                (showing newest 40 of {rangedData.dividends.length})
              </li>
            )}
          </ul>
        </details>
      )}

      {rangedData.splits.length > 0 && (
        <details className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[12px] text-text-muted">
          <summary className="cursor-pointer text-text">
            Split history ({rangedData.splits.length} events in range)
          </summary>
          <ul className="mt-2 space-y-0.5 pr-1">
            {rangedData.splits.map((s, i) => (
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

      {/* Calendar-year table — uses the FULL history + dividends
          regardless of the range selection above. Per user
          request: "regardless of the selected date range, includes
          a calendar year dividend yield, price return (nominal +
          real), total return (nominal + real)." Stable reference
          table for scanning year-by-year behavior. */}
      <CalendarYearTable history={data.history} dividends={data.dividends} />
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

function CalendarYearTable({
  history,
  dividends,
}: {
  history: ReadonlyArray<{ t: number; p: number }>;
  dividends: ReadonlyArray<{ t: number; amount: number }>;
}) {
  const rows = useMemo(
    () => computeCalendarYearStats(history, dividends),
    [history, dividends],
  );
  if (rows.length === 0) return null;
  // Newest year on top — matches how users scan stock data
  // dashboards (latest first; older years scroll into view).
  const display = [...rows].reverse();
  return (
    <section className="rounded-lg border border-border bg-bg-elevated">
      <header className="border-b border-border px-3 py-2">
        <h3 className="text-[11px] uppercase tracking-wider text-text-dim">
          Calendar year returns
        </h3>
        <p className="mt-0.5 text-[10px] text-text-dim">
          Independent of the range selector above. The most recent
          year is YTD when the data series ends before December 31.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead className="text-[10px] uppercase tracking-wider text-text-dim">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">Year</th>
              <th className="px-3 py-2 text-right font-medium">Div yield</th>
              <th className="px-3 py-2 text-right font-medium">Price (nom)</th>
              <th className="px-3 py-2 text-right font-medium">Price (real)</th>
              <th className="px-3 py-2 text-right font-medium">Total (nom)</th>
              <th className="px-3 py-2 text-right font-medium">Total (real)</th>
            </tr>
          </thead>
          <tbody>
            {display.map((row) => (
              <tr
                key={row.year}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-3 py-1.5 text-left font-medium text-text">
                  {row.year}
                  {row.partial && (
                    <span className="ml-1 text-[9px] uppercase text-text-dim">
                      YTD
                    </span>
                  )}
                </td>
                <td className="num px-3 py-1.5 text-right text-text">
                  {fmtPct(row.dividendYield)}
                </td>
                <td className="num px-3 py-1.5 text-right text-text">
                  {fmtPct(row.priceReturnNominal)}
                </td>
                <td className="num px-3 py-1.5 text-right text-text-muted">
                  {fmtPct(row.priceReturnReal)}
                </td>
                <td className="num px-3 py-1.5 text-right text-text">
                  {fmtPct(row.totalReturnNominal)}
                </td>
                <td className="num px-3 py-1.5 text-right text-text-muted">
                  {fmtPct(row.totalReturnReal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
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
            {formatPrice(hoverPoint.p)}
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

function computeStats(
  data: TickerData,
  allDividends: ReadonlyArray<{ t: number; amount: number }> = data.dividends,
  fullHistory: ReadonlyArray<{ t: number; p: number }> = data.history,
): Stats {
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

  // Total-return approximation: reinvest each dividend in the
  // SELECTED RANGE at the close on its ex-date. Accumulate a
  // share-count multiplier from 1.0; final wealth multiple =
  // (last price / first price) × share multiplier over the range.
  // Doesn't model spread/taxes/timing; close enough for the
  // back-of-envelope research view.
  let shareMultiplier = 1;
  for (const d of dividends) {
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

  // TTM dividend yield: trailing 12 months from the RANGE
  // ENDPOINT (per user request — "ttm to be from endpoint of that
  // date range"). The 12-month window may sit ENTIRELY before the
  // range start (e.g. range = "1M") so we look at the full
  // dividend list, not just range-filtered, for TTM aggregation.
  // The yield divides by the price AT THE ENDPOINT (last.p) so a
  // historical-endpoint range reflects that day's yield, not
  // today's yield against a stale TTM payout sum.
  const ttmCutoff = last.t - 365 * 24 * 60 * 60 * 1000;
  const ttmDividendsPerShare = allDividends
    .filter((d) => d.t > ttmCutoff && d.t <= last.t)
    .reduce((acc, d) => acc + d.amount, 0);
  // Endpoint price: if the range ends at the live "today",
  // use the freshest live currentPrice; otherwise use the
  // historical close on the endpoint date. This is exactly
  // what the user sees in the chart's right-edge bar.
  const endIsLive =
    fullHistory.length > 0 &&
    last.t >= fullHistory[fullHistory.length - 1].t;
  const endpointPrice =
    endIsLive && currentPrice != null && currentPrice > 0
      ? currentPrice
      : last.p;
  const dividendYield =
    endpointPrice > 0 && ttmDividendsPerShare > 0
      ? ttmDividendsPerShare / endpointPrice
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
 * One row of the calendar-year metrics table. Returned per
 * complete year covered by the ticker's history, plus a YTD row
 * when the most recent year is incomplete.
 *
 * Conventions for partial / YTD rows: the period is the available
 * window inside that year (Jan 1 → last data point, or first data
 * point → Dec 31 for a ticker whose inception falls mid-year).
 * Returns are period returns, NOT annualized — the row's label is
 * "YTD" so the user knows it's a partial-year figure.
 */
export type CalendarYearRow = {
  /** Calendar year. */
  year: number;
  /** True when the row covers only part of the year (inception or YTD). */
  partial: boolean;
  /** Sum of cash dividends / opening price for the period. */
  dividendYield: number | null;
  /** (endPrice / startPrice) - 1. */
  priceReturnNominal: number | null;
  /** Nominal price return deflated by realized US CPI over the period. */
  priceReturnReal: number | null;
  /** Price return + dividend reinvestment at ex-date close. */
  totalReturnNominal: number | null;
  /** Nominal total return deflated by realized US CPI over the period. */
  totalReturnReal: number | null;
};

/**
 * Compute per-calendar-year price + total-return + dividend yield
 * rows from a ticker's full daily history and dividend stream.
 *
 * Pure / inputs-only — exported for unit testing without rendering
 * the React component. Uses lib/data/cpiHistory.ts for the
 * inflation deflator so real returns line up with the rest of the
 * app's real-vs-nominal math.
 *
 * Why this exists in addition to the range-driven stat cards:
 * the user wanted "calendar year" metrics that DON'T change when
 * the range chip selection changes — a stable reference table
 * the user can scan to see how the ticker behaved across years
 * without flipping ranges.
 */
export function computeCalendarYearStats(
  history: ReadonlyArray<{ t: number; p: number }>,
  dividends: ReadonlyArray<{ t: number; amount: number }>,
): CalendarYearRow[] {
  if (history.length < 2) return [];

  const firstYear = new Date(history[0].t).getUTCFullYear();
  const lastYear = new Date(history[history.length - 1].t).getUTCFullYear();

  // Bucket history points + dividends by calendar year once, in a
  // single pass — avoids an O(years × points) re-walk per row.
  const histByYear = new Map<number, Array<{ t: number; p: number }>>();
  for (const pt of history) {
    const y = new Date(pt.t).getUTCFullYear();
    let bucket = histByYear.get(y);
    if (!bucket) {
      bucket = [];
      histByYear.set(y, bucket);
    }
    bucket.push(pt);
  }
  const divsByYear = new Map<number, Array<{ t: number; amount: number }>>();
  for (const d of dividends) {
    const y = new Date(d.t).getUTCFullYear();
    let bucket = divsByYear.get(y);
    if (!bucket) {
      bucket = [];
      divsByYear.set(y, bucket);
    }
    bucket.push(d);
  }

  const rows: CalendarYearRow[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const yearHistory = histByYear.get(year);
    if (!yearHistory || yearHistory.length < 2) continue;
    const start = yearHistory[0];
    const end = yearHistory[yearHistory.length - 1];
    // A row is "partial" when either endpoint is interior to the
    // calendar year — i.e., the ticker started after Jan 1 or
    // the data series ends before Dec 31 (the YTD case for the
    // most recent year).
    const yearStartMs = Date.UTC(year, 0, 1);
    const yearEndCutoffMs = Date.UTC(year + 1, 0, 1);
    const FEW_DAYS_MS = 7 * 86_400_000;
    const partial =
      start.t - yearStartMs > FEW_DAYS_MS ||
      yearEndCutoffMs - end.t > FEW_DAYS_MS;

    const priceMultiple = start.p > 0 ? end.p / start.p : null;
    const priceReturnNominal =
      priceMultiple != null ? priceMultiple - 1 : null;

    // Total return: reinvest each dividend in the year at the
    // close on or just after its ex-date (matches the in-range
    // total-return convention). Share multiplier ≥ 1.
    let shareMultiplier = 1;
    const yearDivs = divsByYear.get(year) ?? [];
    for (const d of yearDivs) {
      const priceOnEx = priceAtOrAfter(yearHistory, d.t);
      if (priceOnEx == null || priceOnEx <= 0) continue;
      shareMultiplier *= 1 + d.amount / priceOnEx;
    }
    const totalReturnMultiple =
      priceMultiple != null ? priceMultiple * shareMultiplier : null;
    const totalReturnNominal =
      totalReturnMultiple != null ? totalReturnMultiple - 1 : null;

    // Dividend yield: sum of cash dividends paid in the year /
    // opening price. The opening-price denominator (vs.
    // closing or average) makes consecutive years comparable
    // — it's the figure most ETF data sources publish.
    const ttmCash = yearDivs.reduce((s, d) => s + d.amount, 0);
    const dividendYield = start.p > 0 ? ttmCash / start.p : null;

    // Real returns: divide the cumulative wealth multiple by the
    // cumulative CPI factor for the period, then subtract 1.
    // Inflation factor can be null for years outside the CPI
    // series; surface as null rather than fall through to the
    // nominal figure.
    const inflFactor = inflationFactor(start.t, end.t);
    const priceReturnReal =
      priceMultiple != null && inflFactor != null && inflFactor > 0
        ? priceMultiple / inflFactor - 1
        : null;
    const totalReturnReal =
      totalReturnMultiple != null && inflFactor != null && inflFactor > 0
        ? totalReturnMultiple / inflFactor - 1
        : null;

    rows.push({
      year,
      partial,
      dividendYield,
      priceReturnNominal,
      priceReturnReal,
      totalReturnNominal,
      totalReturnReal,
    });
  }
  return rows;
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
