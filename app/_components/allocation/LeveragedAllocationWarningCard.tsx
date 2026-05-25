"use client";

import { useMemo } from "react";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { computeLeveragedEquityBuckets } from "@/lib/portfolio/leveragedEquity";
import { formatUSDCompact } from "@/lib/format";

/**
 * Warning card for non-recognized leveraged equity positions.
 *
 * Triggers when the user holds equity with leverage > 1.0 whose
 * ticker is NOT in `RECOGNIZED_2X_EQUITY_TICKERS` (SSO / SPUU / QLD).
 * Typical offenders: TQQQ (3x Nasdaq), UPRO (3x S&P), SOXL (3x
 * semiconductors), TMF (3x long Treasuries), FAS (3x financials),
 * etc.
 *
 * Why we don't just project these backwards: 3x daily-reset
 * mechanics produce catastrophic losses in sequences like 1929-32,
 * 1937, 1973-74. Projecting honestly backwards across 1928-2000
 * isn't feasible — every reasonable model predicts portfolio
 * ruin within a few years of any of those starts. The pragmatic
 * choice is to model these positions as 1x equity for stress-
 * testing (so they still count in projections, but at unleveraged
 * volatility) and surface this approximation clearly to the user.
 *
 * Renders nothing when no affected holdings exist.
 */
export function LeveragedAllocationWarningCard() {
  const { household } = useActiveProjection();
  const buckets = useMemo(
    () => computeLeveragedEquityBuckets(household),
    [household],
  );

  if (buckets.nonRecognizedHoldings.length === 0) return null;

  const totalAffected = buckets.nonRecognizedLeveragedUSD;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/5 p-4 text-amber-200">
        <div className="text-sm font-medium">
          Leveraged ETFs in retirement are very risky
        </div>
        <div className="mt-2 text-[12px] leading-snug text-amber-200/90">
          Historically, only 2x S&P 500 funds (SSO, SPUU) and 2x
          Nasdaq-100 (QLD) have survived multi-decade retirement
          sequences with intense volatility. Holdings other than
          these three tickers are treated as if they were 1x
          stocks for Monte Carlo projections — 3x daily-reset ETFs
          have catastrophic survival rates in historical sequences
          like 1929-32, 1937, and 1973-74, and projecting their
          returns backwards isn&apos;t honest.
        </div>
        <div className="mt-3 text-[11px] uppercase tracking-wider text-amber-300/80">
          Affected — {formatUSDCompact(totalAffected)} total
        </div>
        <ul className="mt-1.5 space-y-1">
          {buckets.nonRecognizedHoldings
            .slice()
            .sort((a, b) => b.valueUSD - a.valueUSD)
            .map((h) => (
              <li
                key={`${h.accountId}:${h.holdingId}`}
                className="flex items-center justify-between text-[12px] text-amber-100"
              >
                <span className="font-mono">
                  {h.symbol}{" "}
                  <span className="text-amber-300/70">
                    ({h.leverage.toFixed(1)}×)
                  </span>
                </span>
                <span>{formatUSDCompact(h.valueUSD)}</span>
              </li>
            ))}
        </ul>
        <div className="mt-3 text-[11px] leading-snug text-amber-200/70">
          These positions still count in your tracked net worth and
          current allocation views — they&apos;re only flattened to
          1x equity for the historical Monte Carlo stress test.
          Consider whether a 2x SPY equivalent (SSO / SPUU / QLD)
          fits your plan better.
        </div>
      </div>
    </section>
  );
}
