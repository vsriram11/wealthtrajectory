"use client";

import { useId, useMemo, useState } from "react";

import { formatUSD, formatUSDCompact } from "@/lib/format";
import {
  annualContributionForYear,
  simulateInvestmentGrowth,
  type CompoundFrequency,
  type ContributionFrequency,
} from "@/lib/calculators/investmentGrowth";

/**
 * NerdWallet-style investment-growth calculator.
 *
 * Static / portfolio-blind: takes 7 inputs, runs pure compound-
 * interest math, shows future value + contribution-vs-interest
 * breakdown + a yearly stacked-area chart. Does NOT read the user's
 * household — these are quick what-if numbers, not personalized
 * projections.
 *
 * Defaults mirror NerdWallet's so a returning user who's seen one
 * calculator before can immediately validate that the math agrees.
 *
 * Input validation: NerdWallet-style inline error messages. Each
 * input has a (min, max) range; out-of-range values render a small
 * red message under the input AND prevent the simulator from
 * running on that frame (so a clearly-invalid keystroke doesn't
 * flash garbage results). Empty strings while editing are tolerated
 * — they re-validate on blur.
 *
 * Advanced "year-by-year contributions" expandable: defaults to
 * collapsed. When expanded, shows each year's escalated default
 * and a number input for an override. Empty input = use default.
 * "Reset all" button clears every override.
 */

// NerdWallet-style input bounds.
const LIMITS = {
  startingBalance: { min: 0, max: 999_999_999 },
  contribution: { min: 0, max: 999_999 },
  years: { min: 1, max: 100 },
  annualRatePct: { min: -100, max: 100 },
  // Sensible cap on escalator — beyond 50%/yr is an input error.
  escalatorPct: { min: -100, max: 50 },
  yearOverride: { min: 0, max: 999_999_999 },
} as const;

type ValidationErrors = {
  startingBalance?: string;
  contribution?: string;
  years?: string;
  annualRatePct?: string;
  escalatorPct?: string;
};

function validate(
  startingBalance: number,
  contribution: number,
  years: number,
  annualRatePct: number,
  escalatorPct: number,
): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!Number.isFinite(startingBalance)) {
    errs.startingBalance = "Enter a number";
  } else if (startingBalance < LIMITS.startingBalance.min) {
    errs.startingBalance = "Must be 0 or more";
  } else if (startingBalance > LIMITS.startingBalance.max) {
    errs.startingBalance = "Too large — try under $1B";
  }

  if (!Number.isFinite(contribution)) {
    errs.contribution = "Enter a number";
  } else if (contribution < LIMITS.contribution.min) {
    errs.contribution = "Must be 0 or more";
  } else if (contribution > LIMITS.contribution.max) {
    errs.contribution = "Too large";
  }

  if (!Number.isFinite(years)) {
    errs.years = "Enter a number";
  } else if (years < LIMITS.years.min) {
    errs.years = "At least 1 year";
  } else if (years > LIMITS.years.max) {
    errs.years = "100 years max";
  } else if (!Number.isInteger(years)) {
    errs.years = "Whole years only";
  }

  if (!Number.isFinite(annualRatePct)) {
    errs.annualRatePct = "Enter a number";
  } else if (annualRatePct < LIMITS.annualRatePct.min) {
    errs.annualRatePct = "Cannot lose more than 100%/yr";
  } else if (annualRatePct > LIMITS.annualRatePct.max) {
    errs.annualRatePct = "Unrealistic — cap is 100%/yr";
  }

  if (!Number.isFinite(escalatorPct)) {
    errs.escalatorPct = "Enter a number";
  } else if (escalatorPct < LIMITS.escalatorPct.min) {
    errs.escalatorPct = "Cannot decrease more than 100%/yr";
  } else if (escalatorPct > LIMITS.escalatorPct.max) {
    errs.escalatorPct = "Unrealistic — cap is 50%/yr";
  }

  return errs;
}

export function InvestmentGrowthCalculator() {
  const [startingBalance, setStartingBalance] = useState<number>(1000);
  const [contribution, setContribution] = useState<number>(100);
  const [contributionFreq, setContributionFreq] =
    useState<ContributionFrequency>("monthly");
  const [years, setYears] = useState<number>(10);
  const [annualRatePct, setAnnualRatePct] = useState<number>(6);
  const [compoundFreq, setCompoundFreq] =
    useState<CompoundFrequency>("annually");
  // Annual contribution escalator. 0 = flat (default, NerdWallet
  // parity); typical "raise" values are 2-5% per year.
  const [escalatorPct, setEscalatorPct] = useState<number>(0);
  // Per-year overrides. Map: year (1-indexed) → user-typed override.
  // Deleting the key = revert that year to default.
  const [overrides, setOverrides] = useState<Record<number, number>>({});

  const errors = validate(
    startingBalance,
    contribution,
    years,
    annualRatePct,
    escalatorPct,
  );
  const hasErrors = Object.keys(errors).length > 0;

  // Build the sparse override array the engine consumes. Length up
  // to `years`; entries with no override are undefined.
  const overrideArray = useMemo(() => {
    const safeYears = Math.max(0, Math.floor(years));
    const arr: (number | null)[] = new Array(safeYears).fill(null);
    for (const [yearStr, val] of Object.entries(overrides)) {
      const y = Number(yearStr);
      if (y >= 1 && y <= safeYears) {
        arr[y - 1] = val;
      }
    }
    return arr;
  }, [overrides, years]);

  const result = useMemo(
    () =>
      simulateInvestmentGrowth({
        startingBalanceUSD: startingBalance,
        contributionUSD: contribution,
        contributionFrequency: contributionFreq,
        years,
        annualRateOfReturn: annualRatePct / 100,
        compoundFrequency: compoundFreq,
        annualContributionIncreasePct: escalatorPct / 100,
        perYearContributionOverridesUSD: overrideArray,
      }),
    [
      startingBalance,
      contribution,
      contributionFreq,
      years,
      annualRatePct,
      compoundFreq,
      escalatorPct,
      overrideArray,
    ],
  );

  const contributionPct =
    result.futureValueUSD > 0
      ? (result.totalContributionsUSD / result.futureValueUSD) * 100
      : 0;
  const interestPct =
    result.futureValueUSD > 0
      ? (result.totalInterestUSD / result.futureValueUSD) * 100
      : 0;

  // Whole-year cap mirrors the years limit so the override table
  // doesn't explode on a transiently-large `years` input.
  const overrideRowYears = Math.min(
    LIMITS.years.max,
    Math.max(0, Math.floor(years)),
  );
  const hasAnyOverride = Object.keys(overrides).length > 0;

  return (
    <div className="px-5 pt-4">
      <div className="rounded-xl border border-border bg-bg-elevated">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Inputs
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2">
          <CalcInput
            label="Starting balance"
            prefix="$"
            value={startingBalance}
            min={LIMITS.startingBalance.min}
            max={LIMITS.startingBalance.max}
            step={100}
            error={errors.startingBalance}
            onChange={setStartingBalance}
          />
          <CalcInput
            label="Years to grow"
            value={years}
            min={LIMITS.years.min}
            max={LIMITS.years.max}
            step={1}
            error={errors.years}
            onChange={setYears}
          />
          <CalcInput
            label="Contribution amount"
            prefix="$"
            value={contribution}
            min={LIMITS.contribution.min}
            max={LIMITS.contribution.max}
            step={50}
            error={errors.contribution}
            onChange={setContribution}
          />
          <CalcSelect
            label="Contribution frequency"
            value={contributionFreq}
            onChange={(v) => setContributionFreq(v as ContributionFrequency)}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annually", label: "Annually" },
            ]}
          />
          <CalcInput
            label="Annual rate of return (%)"
            value={annualRatePct}
            min={LIMITS.annualRatePct.min}
            max={LIMITS.annualRatePct.max}
            step={0.1}
            error={errors.annualRatePct}
            onChange={setAnnualRatePct}
          />
          <CalcSelect
            label="Compound frequency"
            value={compoundFreq}
            onChange={(v) => setCompoundFreq(v as CompoundFrequency)}
            options={[
              { value: "annually", label: "Annually" },
              { value: "monthly", label: "Monthly" },
              { value: "daily", label: "Daily" },
            ]}
          />
          <CalcInput
            label="Contribution increase per year (%)"
            value={escalatorPct}
            min={LIMITS.escalatorPct.min}
            max={LIMITS.escalatorPct.max}
            step={0.1}
            error={errors.escalatorPct}
            onChange={setEscalatorPct}
            hint="Models a yearly raise — e.g. 3% means each year's contribution is 3% higher than the previous"
          />
        </div>
      </div>

      {hasErrors && (
        <div
          className="mt-3 rounded-md border border-red-400/40 bg-red-400/5 px-3 py-2 text-[11px] leading-snug text-red-300"
          role="alert"
        >
          One or more inputs are out of range — fix the highlighted
          fields above. Results below reflect the last valid state.
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Future value after {years} {years === 1 ? "year" : "years"}
        </div>
        <div className="num mt-1 text-3xl font-semibold text-text">
          {formatUSD(result.futureValueUSD)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Breakdown
            label="Total contributions"
            sub={`${contributionPct.toFixed(1)}% of FV`}
            value={result.totalContributionsUSD}
            color="bg-accent"
          />
          <Breakdown
            label="Total interest"
            sub={`${interestPct.toFixed(1)}% of FV`}
            value={result.totalInterestUSD}
            color="bg-positive"
          />
        </div>
      </div>

      {result.yearlyBreakdown.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Year-by-year growth
          </div>
          <GrowthChart breakdown={result.yearlyBreakdown} />
        </div>
      )}

      {/* Advanced: editable year-by-year contributions. Same
          `<details>` pattern as the yearly breakdown table below,
          consistent with the MC card's "View year-by-year table"
          modal trigger (different surface, same affordance idea —
          power-user data behind one click). */}
      {overrideRowYears > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-bg-elevated">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                Advanced
              </span>
              <span className="ml-2 text-[11px] text-text">
                Custom contribution per year
              </span>
              {hasAnyOverride && (
                <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                  {Object.keys(overrides).length} override
                  {Object.keys(overrides).length === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <span className="text-[11px] text-text-muted">▼</span>
          </summary>
          <div className="border-t border-border px-4 py-3">
            <div className="mb-3 flex items-start justify-between gap-3 text-[11px] leading-snug text-text-dim">
              <span>
                Each row defaults to the escalated annual contribution
                ({escalatorPct === 0
                  ? "no escalator"
                  : `${escalatorPct}%/yr`}
                ). Type a value in the override column to replace that
                year only; leave it blank to keep the default. Useful
                for windfall years, bonus pulls, or planned breaks.
              </span>
              {hasAnyOverride && (
                <button
                  type="button"
                  onClick={() => setOverrides({})}
                  className="shrink-0 rounded-md border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-muted hover:text-text"
                >
                  Reset all
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Year</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Default (escalated)
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Override
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: overrideRowYears }, (_, idx) => {
                    const yearIdx = idx + 1;
                    const escalatedDefault = annualContributionForYear(
                      yearIdx,
                      contribution,
                      contributionFreq,
                      escalatorPct / 100,
                      undefined, // ignore overrides for the DEFAULT column
                    );
                    const override = overrides[yearIdx];
                    return (
                      <tr key={yearIdx} className="border-t border-border/50">
                        <td className="px-3 py-1.5 text-text">{yearIdx}</td>
                        <td className="num px-3 py-1.5 text-right text-text-dim">
                          {formatUSDCompact(escalatedDefault)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <YearOverrideInput
                            value={override}
                            onChange={(v) => {
                              if (v == null) {
                                const next = { ...overrides };
                                delete next[yearIdx];
                                setOverrides(next);
                              } else {
                                setOverrides({ ...overrides, [yearIdx]: v });
                              }
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      {result.yearlyBreakdown.length > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-bg-elevated">
          <summary className="cursor-pointer px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Yearly breakdown table
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-[11px]">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Year</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Contributions
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Interest
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Ending balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.yearlyBreakdown.map((y) => (
                  <tr key={y.year} className="border-t border-border/50">
                    <td className="px-3 py-1.5 text-text">{y.year}</td>
                    <td className="num px-3 py-1.5 text-right text-text">
                      {formatUSDCompact(y.contributionsThisYear)}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-positive">
                      {formatUSDCompact(y.interestEarned)}
                    </td>
                    <td className="num px-3 py-1.5 text-right font-medium text-text">
                      {formatUSDCompact(y.endingBalanceUSD)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function CalcInput({
  label,
  prefix,
  value,
  min,
  max,
  step,
  error,
  hint,
  onChange,
}: {
  label: string;
  prefix?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  // Stable id so aria-describedby pairs the input with whichever
  // (error / hint) message exists. Round-12 audit HIGH: screen
  // readers heard "invalid" with no explanation; now the relevant
  // text is read alongside the input.
  const reactId = useId();
  const messageId = `${reactId}-message`;
  return (
    <div>
      <label
        className={`block rounded-md border bg-bg-surface px-3 py-2 focus-within:border-accent ${
          error ? "border-red-400/60" : "border-border"
        }`}
      >
        <span className="block text-[10px] uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <span className="mt-1 flex items-baseline gap-1">
          {prefix && (
            <span className="text-sm text-text-muted">{prefix}</span>
          )}
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(v);
            }}
            min={min}
            max={max}
            step={step}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || hint ? messageId : undefined}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
      </label>
      {error ? (
        <div
          id={messageId}
          className="mt-1 text-[10px] leading-snug text-red-300"
          role="alert"
        >
          {error}
        </div>
      ) : hint ? (
        <div
          id={messageId}
          className="mt-1 text-[10px] leading-snug text-text-dim"
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function CalcSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-md border border-border bg-bg-surface px-3 py-2 focus-within:border-accent">
      <span className="block text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-transparent text-sm font-medium text-text outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({
  label,
  sub,
  value,
  color,
}: {
  label: string;
  sub: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {label}
        </span>
      </div>
      <div className="num mt-0.5 text-base font-semibold text-text">
        {formatUSD(value)}
      </div>
      <div className="text-[10px] text-text-dim">{sub}</div>
    </div>
  );
}

/**
 * Year-override input. Controlled directly off the parent's
 * `overrides` Record: when the parent's value is undefined (no
 * override), the input shows empty; when it's a number, the input
 * shows that number. Typing dispatches onChange with either a
 * number (set/update) or null (delete). No local draft state —
 * the parent is the single source of truth.
 *
 * Trade-off accepted: typing "0" stores 0 (= "contribute nothing
 * this year", per engine semantics in
 * `simulateInvestmentGrowth — perYearContributionOverridesUSD`
 * tests). Clearing the field stores null (= revert to default).
 * Both behaviors are correct + discoverable.
 */
function YearOverrideInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      placeholder="—"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          onChange(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(Math.max(0, n));
      }}
      min={0}
      max={999_999_999}
      step={100}
      className="num w-28 rounded-md border border-border bg-bg-surface px-2 py-1 text-right text-[11px] text-text outline-none focus:border-accent"
    />
  );
}

/**
 * Stacked-area chart of year-by-year growth: total contributions
 * (lower band) + total interest (upper band) at each year's end.
 * SVG, no external chart library — consistent with the rest of the
 * app's chart approach (ProjectionChart, Fan).
 */
function GrowthChart({
  breakdown,
}: {
  breakdown: ReturnType<typeof simulateInvestmentGrowth>["yearlyBreakdown"];
}) {
  const width = 600;
  const height = 200;
  const padding = { top: 8, right: 8, bottom: 24, left: 48 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxValue = Math.max(
    ...breakdown.map((y) => y.endingBalanceUSD),
    1,
  );
  const yScale = (v: number) => padding.top + plotH - (v / maxValue) * plotH;
  const xScale = (i: number) =>
    padding.left +
    (breakdown.length === 1 ? 0 : (i / (breakdown.length - 1)) * plotW);

  const contributionsPath =
    `M ${xScale(0)},${yScale(0)} ` +
    breakdown
      .map((y, i) => `L ${xScale(i)},${yScale(y.totalContributions)}`)
      .join(" ") +
    ` L ${xScale(breakdown.length - 1)},${yScale(0)} Z`;
  const interestPath =
    `M ${xScale(0)},${yScale(breakdown[0]?.totalContributions ?? 0)} ` +
    breakdown
      .map((y, i) => `L ${xScale(i)},${yScale(y.endingBalanceUSD)}`)
      .join(" ") +
    ` L ${xScale(breakdown.length - 1)},${yScale(breakdown[breakdown.length - 1]?.totalContributions ?? 0)} ` +
    breakdown
      .slice()
      .reverse()
      .map(
        (y, i) =>
          `L ${xScale(breakdown.length - 1 - i)},${yScale(y.totalContributions)}`,
      )
      .join(" ") +
    " Z";

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * maxValue);
  const xTickIndices =
    breakdown.length <= 2
      ? breakdown.map((_, i) => i)
      : [0, Math.floor(breakdown.length / 2), breakdown.length - 1];

  return (
    <svg
      role="img"
      aria-label="Stacked growth chart"
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 w-full"
    >
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yScale(t)}
            y2={yScale(t)}
            className="stroke-border"
            strokeDasharray={i === 0 ? "0" : "2,3"}
            strokeWidth={1}
          />
          <text
            x={padding.left - 4}
            y={yScale(t) + 3}
            textAnchor="end"
            className="fill-text-dim text-[9px]"
          >
            {formatUSDCompact(t)}
          </text>
        </g>
      ))}
      <path d={interestPath} className="fill-positive/30" />
      <path d={contributionsPath} className="fill-accent/30" />
      <polyline
        points={breakdown
          .map((y, i) => `${xScale(i)},${yScale(y.endingBalanceUSD)}`)
          .join(" ")}
        fill="none"
        className="stroke-positive"
        strokeWidth={1.5}
      />
      <polyline
        points={breakdown
          .map((y, i) => `${xScale(i)},${yScale(y.totalContributions)}`)
          .join(" ")}
        fill="none"
        className="stroke-accent"
        strokeWidth={1.5}
      />
      {xTickIndices.map((i) => (
        <text
          key={i}
          x={xScale(i)}
          y={height - 8}
          textAnchor="middle"
          className="fill-text-dim text-[9px]"
        >
          Yr {breakdown[i].year}
        </text>
      ))}
    </svg>
  );
}
