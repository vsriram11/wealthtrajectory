"use client";

import { useMemo } from "react";
import { useAllocationView } from "@/lib/portfolio/useAllocationView";
import {
  computeLeveragedEquityBuckets,
  type DeleverageStrategy,
  type NonRecognizedLeveragedHolding,
} from "@/lib/portfolio/leveragedEquity";
import { formatUSDCompact } from "@/lib/format";

/**
 * Warning card for non-recognized leveraged equity positions.
 *
 * Triggers when the user holds equity with leverage > 1.0 whose
 * ticker is NOT in `RECOGNIZED_2X_EQUITY_TICKERS` (SSO / SPUU / QLD).
 * Groups affected holdings by the at-retirement deleveraging
 * strategy the MC stress test models:
 *
 *   - 3x S&P 500 (UPRO / SPXL) → 2x S&P (SSO / SPUU)
 *   - 3x Nasdaq-100 (TQQQ)     → 2x Nasdaq-100 (QLD)
 *   - Sector / narrow-index    → diversified to 1x broad equity
 *
 * Each strategy gets per-group language explaining what the model
 * assumes. Per-holding rows show the value AND — for positions in
 * taxable accounts — the capital-gains tax that the stress test
 * subtracts from starting NW.
 *
 * Renders nothing when no affected holdings exist.
 */
export function LeveragedAllocationWarningCard() {
  // Shared allocation view: household is already aged-forward by
  // `appliedFutureYears` when the user has time-traveled the page.
  // Leveraged ETFs compound aggressively (3x daily-reset on the
  // RYTNX series, +9pt drag depending on volatility regime), so
  // tax-at-restructure differs materially between today and +5y /
  // +10y. The hook also surfaces the same `appliedFutureYears`
  // value for the header chip below.
  //
  // INTENTIONAL: this card shows the full pre-bucket-funding
  // leveraged exposure + restructure tax. The MC card's
  // cash-bucket override (which may consume some leveraged
  // holdings for cash, reducing the deleveraging numbers) is a
  // PER-RUN scenario; this card reflects the user's portfolio
  // as-configured. So the deleveraging tax shown here may exceed
  // what the MC simulator ultimately deducts. That's fine: this
  // card answers "what's the AT-RETIREMENT restructure tax for
  // my LEVERAGED ETFs?", not "what tax fires inside the MC
  // simulator's bucket-funded scenario?". Documented in
  // `computeLeveragedEquityBuckets`'s `consumedByBucketFunding`
  // param doc.
  const { household, assumptions, appliedFutureYears } = useAllocationView();
  const buckets = useMemo(
    () =>
      computeLeveragedEquityBuckets(
        household,
        assumptions.retirementTaxRate,
      ),
    [household, assumptions.retirementTaxRate],
  );

  if (buckets.nonRecognizedHoldings.length === 0) return null;

  // Group holdings by deleveraging strategy. Each strategy gets its
  // own framed section so the user can see at a glance which
  // positions are being deleveraged vs diversified.
  const grouped = groupByStrategy(buckets.nonRecognizedHoldings);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/5 p-4 text-amber-200">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-medium">
            Leveraged ETFs in retirement are very risky
          </div>
          {appliedFutureYears != null && appliedFutureYears > 0 && (
            <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
              future +{appliedFutureYears}y
            </span>
          )}
        </div>
        <div className="mt-2 text-[12px] leading-snug text-amber-200/90">
          3x daily-reset ETFs have catastrophic survival rates in
          historical sequences like 1929–32, 1937, and 1973–74. To
          stress-test honestly, the Monte Carlo models a retirement-
          date restructure for each of these holdings — see the
          per-group recommendations below. The capital-gains tax for
          that restructure is subtracted from starting NW (only for
          positions in taxable accounts).
        </div>
        <div className="mt-2 text-[11px] leading-snug text-amber-200/70">
          Multi-asset capital-efficient wrappers like{" "}
          <span className="font-mono">NTSX</span> (90/60 stocks/bonds),{" "}
          <span className="font-mono">GDE</span> (90/90 stocks/gold),{" "}
          <span className="font-mono">RSSB</span> /{" "}
          <span className="font-mono">RSST</span> (100/100 return-stacked),
          and <span className="font-mono">AVGE</span> are intentionally NOT
          flagged here. Their mild leverage is offset by diversification
          across asset classes, they&apos;re designed for long-term
          holding, and the simulator decomposes them across the right
          per-class return series via their composition spec — no
          restructure, no tax hit.
        </div>

        {/* Top-line summary: total affected value + total tax hit. */}
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80">
              Total affected
            </div>
            <div className="num text-sm font-semibold text-amber-100">
              {formatUSDCompact(buckets.nonRecognizedLeveragedUSD)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80">
              Tax hit on deleveraging
            </div>
            <div className="num text-sm font-semibold text-amber-100">
              {formatUSDCompact(buckets.deleveragingTaxHitUSD)}
              <span className="ml-1 text-[10px] font-normal text-amber-300/70">
                @ {((assumptions.retirementTaxRate ?? 0.2) * 100).toFixed(0)}%
                rate, 100% gain assumed
              </span>
            </div>
          </div>
        </div>

        {/* Per-strategy sections. Each one has its own framing
            explaining the recommendation + the list of affected
            holdings + per-holding tax. */}
        {grouped["to-2x-spy"].length > 0 && (
          <StrategyGroup
            heading="3x S&P 500 → 2x S&P 500"
            recommendation="Modeled as deleveraged to a 2x S&P 500 equivalent (SSO or SPUU) at retirement. Keeps similar long-term return potential with materially lower drawdown risk in stagflation-era sequences."
            holdings={grouped["to-2x-spy"]}
          />
        )}
        {grouped["to-2x-nasdaq"].length > 0 && (
          <StrategyGroup
            heading="3x Nasdaq-100 → 2x Nasdaq-100"
            recommendation="Modeled as deleveraged to QLD (2x Nasdaq-100) at retirement. The stress test uses the 2x SPY return series as the closest available proxy — Nasdaq-100 has been more volatile than S&P 500 historically, so the modeled result may slightly understate true Nasdaq sequence risk."
            holdings={grouped["to-2x-nasdaq"]}
          />
        )}
        {grouped["diversify-to-1x"].length > 0 && (
          <StrategyGroup
            heading="Sector / narrow leverage → 1x broad equity"
            recommendation="Modeled as fully diversified into 1x broad-market equity at retirement. Sector-leveraged ETFs (semiconductors, financials, biotech, etc.) and narrow-index leverage have catastrophic multi-decade survival; we can't honestly project them, and recommending a continued hold in retirement would be irresponsible."
            holdings={grouped["diversify-to-1x"]}
          />
        )}

        <div className="mt-3 text-[11px] leading-snug text-amber-200/70">
          These positions still count in your tracked net worth and
          current allocation views — the modeled restructure (and tax
          hit) only applies inside the historical Monte Carlo stress
          test on the Projections page.
        </div>
      </div>
    </section>
  );
}

/* ─── Internal presentation helpers ─────────────────────────── */

type StrategyGroupName = DeleverageStrategy;

function groupByStrategy(
  holdings: NonRecognizedLeveragedHolding[],
): Record<StrategyGroupName, NonRecognizedLeveragedHolding[]> {
  const out: Record<StrategyGroupName, NonRecognizedLeveragedHolding[]> = {
    "to-2x-spy": [],
    "to-2x-nasdaq": [],
    "diversify-to-1x": [],
  };
  for (const h of holdings) out[h.deleverageStrategy].push(h);
  for (const k of Object.keys(out) as StrategyGroupName[]) {
    out[k].sort((a, b) => b.valueUSD - a.valueUSD);
  }
  return out;
}

function StrategyGroup({
  heading,
  recommendation,
  holdings,
}: {
  heading: string;
  recommendation: string;
  holdings: NonRecognizedLeveragedHolding[];
}) {
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
        {heading}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-amber-200/85">
        {recommendation}
      </div>
      <ul className="mt-2 space-y-1">
        {holdings.map((h) => (
          <li
            key={`${h.accountId}:${h.holdingId}`}
            className="flex items-center justify-between gap-2 text-[12px] text-amber-100"
          >
            <span className="font-mono">
              {h.symbol}{" "}
              <span className="text-amber-300/70">
                ({h.leverage.toFixed(1)}×)
              </span>
            </span>
            <span className="flex items-baseline gap-2 text-right">
              <span className="num">{formatUSDCompact(h.valueUSD)}</span>
              {h.inTaxableAccount ? (
                <span className="num text-[10px] text-amber-300/80">
                  −{formatUSDCompact(h.taxHitUSD)} tax
                </span>
              ) : (
                <span className="text-[10px] text-amber-300/60">
                  (tax-advantaged · no tax hit)
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
