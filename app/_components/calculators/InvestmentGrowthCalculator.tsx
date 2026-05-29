"use client";

import { useMemo, useState } from "react";

import { formatUSD, formatUSDCompact } from "@/lib/format";
import {
  simulateInvestmentGrowth,
  type CompoundFrequency,
  type ContributionFrequency,
} from "@/lib/calculators/investmentGrowth";

/**
 * NerdWallet-style investment-growth calculator.
 *
 * Static / portfolio-blind: takes 6 inputs, runs pure compound-
 * interest math, shows future value + contribution-vs-interest
 * breakdown + a yearly stacked-area chart. Does NOT read the user's
 * household — these are quick what-if numbers, not personalized
 * projections.
 *
 * Default values mirror the NerdWallet defaults so a returning user
 * who's seen one calculator before can immediately validate that
 * the math agrees.
 */
export function InvestmentGrowthCalculator() {
  const [startingBalance, setStartingBalance] = useState<number>(1000);
  const [contribution, setContribution] = useState<number>(100);
  const [contributionFreq, setContributionFreq] =
    useState<ContributionFrequency>("monthly");
  const [years, setYears] = useState<number>(10);
  const [annualRatePct, setAnnualRatePct] = useState<number>(6);
  const [compoundFreq, setCompoundFreq] =
    useState<CompoundFrequency>("annually");

  const result = useMemo(
    () =>
      simulateInvestmentGrowth({
        startingBalanceUSD: startingBalance,
        contributionUSD: contribution,
        contributionFrequency: contributionFreq,
        years,
        annualRateOfReturn: annualRatePct / 100,
        compoundFrequency: compoundFreq,
      }),
    [
      startingBalance,
      contribution,
      contributionFreq,
      years,
      annualRatePct,
      compoundFreq,
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
            min={0}
            step={100}
            onChange={setStartingBalance}
          />
          <CalcInput
            label="Years to grow"
            value={years}
            min={0}
            max={100}
            step={1}
            onChange={setYears}
          />
          <CalcInput
            label="Contribution amount"
            prefix="$"
            value={contribution}
            min={0}
            step={50}
            onChange={setContribution}
          />
          <CalcSelect
            label="Contribution frequency"
            value={contributionFreq}
            onChange={(v) =>
              setContributionFreq(v as ContributionFrequency)
            }
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annually", label: "Annually" },
            ]}
          />
          <CalcInput
            label="Annual rate of return (%)"
            value={annualRatePct}
            min={-100}
            max={100}
            step={0.1}
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
        </div>
      </div>

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

      {result.yearlyBreakdown.length > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-bg-elevated">
          <summary className="cursor-pointer px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Yearly breakdown table
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-[11px]">
              <thead className="text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Contributions
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Interest
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
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
  onChange,
}: {
  label: string;
  prefix?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-md border border-border bg-bg-surface px-3 py-2">
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
          className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
        />
      </span>
    </label>
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
    <label className="block rounded-md border border-border bg-bg-surface px-3 py-2">
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
    padding.left + (breakdown.length === 1 ? 0 : (i / (breakdown.length - 1)) * plotW);

  // Two polylines: contributions baseline + ending balance top.
  // Area between them = interest. Fill the contributions band
  // accent-colored, the interest band positive-colored.
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

  // Y-axis gridlines at 25/50/75/100% of max.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * maxValue);
  // X-axis labels: first, last, and 1-2 in the middle.
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
      {/* Grid */}
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
      {/* Stacked areas */}
      <path d={interestPath} className="fill-positive/30" />
      <path d={contributionsPath} className="fill-accent/30" />
      {/* Top line (ending balance) */}
      <polyline
        points={breakdown
          .map((y, i) => `${xScale(i)},${yScale(y.endingBalanceUSD)}`)
          .join(" ")}
        fill="none"
        className="stroke-positive"
        strokeWidth={1.5}
      />
      {/* Contribution line */}
      <polyline
        points={breakdown
          .map((y, i) => `${xScale(i)},${yScale(y.totalContributions)}`)
          .join(" ")}
        fill="none"
        className="stroke-accent"
        strokeWidth={1.5}
      />
      {/* X-axis labels */}
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
