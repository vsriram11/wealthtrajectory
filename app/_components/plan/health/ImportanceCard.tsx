"use client";

/**
 * Per-member "what matters" importance editor.
 *
 * Each member ranks a fixed set of plan factors (premium / mental
 * health / mental-health coverage / out-of-network / dental / vision
 * / …) on a 0–10 slider. The score that {@link scorePlan} applies
 * to each plan is a weighted average of factor evaluations using
 * these weights — so a spouse who cares about mental-health
 * coverage will rank plans differently from a breadwinner who cares
 * mostly about premium.
 *
 * The weights live per-member rather than per-plan so each person
 * can compare candidate plans through their own lens without
 * conflating views.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  HEALTH_PLAN_FACTORS,
  HEALTH_PLAN_FACTOR_META,
  type HealthImportanceWeights,
  type HealthPlanFactor,
} from "@/lib/health/healthPlans";

const COLLAPSED_COUNT = 6;

export function ImportanceCard({
  memberId,
  weights,
}: {
  memberId: string;
  weights: HealthImportanceWeights;
}) {
  const setWeight = useAppStore((s) => s.setHealthImportanceWeight);
  const [expanded, setExpanded] = useState(false);

  // Show top N + collapse rest behind a "More factors" toggle so
  // the card stays scannable on first load.
  const visibleFactors = expanded
    ? HEALTH_PLAN_FACTORS
    : HEALTH_PLAN_FACTORS.slice(0, COLLAPSED_COUNT);

  const weightSum = HEALTH_PLAN_FACTORS.reduce(
    (acc, f) => acc + (weights[f] ?? 0),
    0,
  );

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">
            What matters to you
          </div>
          <div className="text-[10px] text-text-dim">
            Renormalized — only ratios matter
          </div>
        </div>
        <div className="mt-0.5 text-[11px] text-text-dim">
          Drag each factor 0–10. Plan scores below use a weighted
          average that auto-normalizes to 100%.
        </div>

        <ul className="mt-3 space-y-2">
          {visibleFactors.map((factor) => (
            <FactorSlider
              key={factor}
              factor={factor}
              value={weights[factor] ?? 0}
              onChange={(v) => setWeight(memberId, factor, v)}
            />
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-text-muted active:opacity-70 hover:text-text"
        >
          {expanded ? "Show fewer factors" : "More factors…"}
        </button>

        {weightSum <= 0 && (
          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[11px] text-amber-300">
            Rate at least one factor above 0 to see plan scores.
          </div>
        )}
      </div>
    </section>
  );
}

function FactorSlider({
  factor,
  value,
  onChange,
}: {
  factor: HealthPlanFactor;
  value: number;
  onChange: (v: number) => void;
}) {
  const meta = HEALTH_PLAN_FACTOR_META[factor];
  // Slider lives in 0–10 integer space for ergonomics; we store
  // the value as 0–1 internally.
  const sliderValue = Math.round(value * 10);
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-text">{meta.label}</span>
        <span className="num text-[11px] text-text-muted">
          {sliderValue}/10
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value) / 10)}
        className="mt-1 w-full accent-accent"
        aria-label={meta.label}
      />
      <div className="text-[10px] leading-snug text-text-dim">{meta.hint}</div>
    </li>
  );
}
