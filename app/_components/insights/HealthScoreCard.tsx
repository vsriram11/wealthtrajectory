"use client";

import { useMemo } from "react";
import { computeHealthScore } from "@/lib/health/healthScore";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";

/**
 * Portfolio health score: 0-100 composite that grades the plan
 * across four pillars (progress to target, tax-bucket
 * diversification, liquidity, leverage safety). Designed for the
 * "is my plan in good shape?" at-a-glance question.
 *
 * Each pillar contributes equally (25%). The pillar rows below the
 * headline explain WHY each pillar is what it is, so the score is
 * actionable rather than mysterious.
 *
 * Hidden on empty households or unreachable targets.
 */
export function HealthScoreCard() {
  const { household, assumptions } = useActiveProjection();
  const score = useMemo(
    () => computeHealthScore(household, assumptions),
    [household, assumptions],
  );

  if (!score) return null;
  if (household.accounts.length === 0) return null;

  // Tone the headline by overall bucket.
  const tone =
    score.overall >= 75
      ? "text-positive"
      : score.overall >= 50
        ? "text-accent"
        : score.overall >= 25
          ? "text-amber-300"
          : "text-negative";

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">
            Plan health
          </div>
          <div className={`num text-3xl font-semibold ${tone}`}>
            {score.overall}
            <span className="ml-0.5 text-sm text-text-dim">/100</span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <PillarRow
            label="Progress to target"
            value={score.progress}
            explanation={score.explanations.progress}
          />
          <PillarRow
            label="Tax diversification"
            value={score.diversification}
            explanation={score.explanations.diversification}
          />
          <PillarRow
            label="Liquidity"
            value={score.liquidity}
            explanation={score.explanations.liquidity}
          />
          <PillarRow
            label="Leverage safety"
            value={score.leverageSafety}
            explanation={score.explanations.leverageSafety}
          />
        </div>

        <div className="mt-3 text-[10px] text-text-dim">
          Composite of the four pillars (equal weight). Not financial
          advice — just a quick read on plan robustness.
        </div>
      </div>
    </section>
  );
}

function PillarRow({
  label,
  value,
  explanation,
}: {
  label: string;
  value: number;
  explanation: string;
}) {
  const fillPct = Math.max(0, Math.min(100, value));
  const fillColor =
    value >= 75
      ? "bg-positive/70"
      : value >= 50
        ? "bg-accent/70"
        : value >= 25
          ? "bg-amber-300/70"
          : "bg-negative/70";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="text-text">{label}</span>
        <span className="num text-text-muted">{value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
        <div
          className={`h-full ${fillColor}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-text-dim">{explanation}</div>
    </div>
  );
}
