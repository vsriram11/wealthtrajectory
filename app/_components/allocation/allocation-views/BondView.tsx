"use client";

import { formatPercent } from "@/lib/format";
import {
  geoScopeWeight,
  pickBondType,
  type GeoScope,
  type computePortfolio,
} from "@/lib/portfolio/portfolio";
import { BOND_TYPES, BOND_TYPE_LABELS } from "@/lib/types";

export function BondView({
  portfolio,
  scope,
}: {
  portfolio: ReturnType<typeof computePortfolio>;
  scope: GeoScope;
}) {
  if (portfolio.bond.totalUSD === 0) {
    return <div className="text-xs text-text-dim">No bond holdings yet.</div>;
  }

  const mix = pickBondType(portfolio.bond, scope);
  const scopeWeight = geoScopeWeight(portfolio.bond, scope);
  const sub =
    scope === "ALL"
      ? `${formatPercent(portfolio.classes.bondShare)} of portfolio`
      : `${formatPercent(scopeWeight * portfolio.classes.bondShare)} of portfolio · ${formatPercent(scopeWeight)} of bonds`;

  const durationYears = portfolio.bond.weightedDurationYears;
  const durationLabel =
    durationYears < 3
      ? "Short — low rate sensitivity"
      : durationYears < 10
        ? "Intermediate — moderate rate sensitivity"
        : "Long — high rate sensitivity";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-wider text-text-dim">
          Govt vs Corporate
        </div>
        <div className="text-[11px] text-text-muted">{sub}</div>
      </div>

      <div className="space-y-2.5">
        {BOND_TYPES.map((type) => {
          const weight = mix[type];
          return (
            <div key={type}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{BOND_TYPE_LABELS[type]}</span>
                <span className="num font-medium text-text">
                  {formatPercent(weight)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, weight * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {scope === "ALL" && (
        <div className="rounded-xl border border-border bg-bg-elevated p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Average duration
            </div>
            <div className="num text-lg font-semibold text-text">
              {durationYears.toFixed(1)} yrs
            </div>
          </div>
          <DurationMeter years={durationYears} />
          <div className="mt-2 text-[11px] text-text-muted">
            {durationLabel}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Horizontal meter for portfolio-weighted bond duration. Colored
 * by rate-sensitivity tier: short (green) / intermediate (blue) /
 * long (amber).
 */
function DurationMeter({ years }: { years: number }) {
  const meterMaxYears = 20;
  const pct = Math.min(100, Math.max(0, (years / meterMaxYears) * 100));
  const fillClass =
    years < 3
      ? "bg-positive"
      : years < 10
        ? "bg-accent"
        : "bg-amber-300";

  return (
    <div className="mt-2">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-bg-surface">
        <div className={`h-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-text-dim">
        <span>0y</span>
        <span>10y</span>
        <span>20y+</span>
      </div>
    </div>
  );
}
