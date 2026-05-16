"use client";

import { useMemo } from "react";
import { projectIndependence } from "@/lib/projection/independence";
import { realToNominal } from "@/lib/nominal";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { householdNetWorth } from "@/lib/types";
import { formatUSDCompact } from "@/lib/format";

/**
 * Real-to-nominal sanity-check card. The whole projection engine
 * works in *real* dollars — that's the right default because
 * purchasing power is what retirement is about. But "$2M" in 25
 * years sounds tiny if you don't translate it to the future-nominal
 * sticker price ($4M+ at 3% inflation). This card surfaces both
 * sides so users can calibrate without re-doing math in their head.
 *
 * Hidden when the user is already at / past Independence (no future years
 * to translate over).
 */
export function NominalEquivalentCard() {
  const { household, assumptions } = useActiveProjection();

  const projection = useMemo(
    () => projectIndependence(household, assumptions),
    [household, assumptions],
  );

  const inflationRate = assumptions.expectedInflationRate;
  const nwToday = householdNetWorth(household);
  const targetReal = assumptions.targetNetWorthUSD;
  const monthsToIndependence = projection.monthsToIndependence;

  if (monthsToIndependence == null) return null;
  if (monthsToIndependence === 0) return null;

  const years = monthsToIndependence / 12;
  const targetNominal = realToNominal(targetReal, inflationRate, years);
  const nwNominalAtIndependence = realToNominal(nwToday, inflationRate, years);

  // Phrasing: how much the dollar's purchasing power decays over the
  // accumulation period. Useful intuition independent of the targets.
  const purchasingPowerKept = 1 / Math.pow(1 + inflationRate, years);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text">
              Future-dollar equivalent
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Same purchasing power, different sticker price. At{" "}
              {(inflationRate * 100).toFixed(1)}% inflation over{" "}
              {years.toFixed(1)} years.
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Independence target"
            real={formatUSDCompact(targetReal)}
            nominal={formatUSDCompact(targetNominal)}
          />
          <Stat
            label="Today's net worth at Independence"
            real={formatUSDCompact(nwToday)}
            nominal={formatUSDCompact(nwNominalAtIndependence)}
            sub="If frozen — no growth, no contributions"
          />
        </div>

        <div className="mt-3 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-[11px] leading-snug">
          <span className="text-text-muted">
            $1 today buys roughly{" "}
            <span className="num text-text">
              {purchasingPowerKept.toFixed(2)}
            </span>{" "}
            of today&apos;s goods in {years.toFixed(0)} years.
          </span>{" "}
          <span className="text-text-dim">
            All projections elsewhere are in today&apos;s dollars — this card
            is the translation layer.
          </span>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  real,
  nominal,
  sub,
}: {
  label: string;
  real: string;
  nominal: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="num mt-0.5 text-base font-semibold text-text">
        {nominal}
      </div>
      <div className="num text-[10px] text-text-dim">
        = {real} in today&apos;s $
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-text-dim">{sub}</div>}
    </div>
  );
}
