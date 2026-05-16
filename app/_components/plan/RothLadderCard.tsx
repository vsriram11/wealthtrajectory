"use client";

import { useMemo, useState } from "react";
import { rothLadder } from "@/lib/tax/rothLadder";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatPercent, formatUSDCompact } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * Roth conversion ladder estimator. Shows the classic Independence move:
 * in the gap between W-2 income and Social Security / RMD age, the
 * marginal bracket on conversion dollars can be 0% / 12% — far
 * below the typical 22% retiree marginal. Over a 5–10 year ladder,
 * that's six-figure lifetime tax savings for users with real
 * pre-tax balances.
 *
 * Surfaces structure, not advice — this is the kind of multi-year
 * strategic planning a fee-only CPA charges for, modeled here as
 * a reference. Run your specific numbers past a tax professional.
 *
 * Inputs are sliders: other ordinary income (default 0 — early
 * retiree case) and per-year conversion ceiling (default fills
 * std deduction + 12% bracket).
 *
 * Renders nothing when pre-tax balance is 0.
 */
export function RothLadderCard() {
  const { household } = useActiveProjection();

  const [otherIncome, setOtherIncome] = useState<number>(0);
  const [customConversion, setCustomConversion] = useState<number | null>(null);

  const result = useMemo(
    () =>
      rothLadder({
        household,
        otherIncomeUSD: otherIncome,
        annualConversionUSD: customConversion ?? undefined,
      }),
    [household, otherIncome, customConversion],
  );

  if (result.preTaxBalanceUSD <= 0) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div>
          <div className="text-sm font-medium text-text">
            Roth conversion ladder
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Convert tax-deferred dollars at the lowest possible bracket in
            your post-Independence / pre-RMD window. Each rung becomes penalty-free
            withdrawable after 5 years.
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            label="Pre-tax balance"
            value={formatUSDCompact(result.preTaxBalanceUSD)}
          />
          <Stat
            label="Years to ladder"
            value={
              result.yearsToConvert != null ? `${result.yearsToConvert} yr` : "—"
            }
          />
          <Stat
            label="Annual tax on conversion"
            value={formatUSDCompact(result.conversionTaxUSD)}
            sub={`${formatPercent(result.effectiveConversionRate)} effective`}
          />
          <Stat
            label="Lifetime savings vs 22% drawdown"
            value={formatUSDCompact(result.lifetimeSavingsUSD)}
            positive
          />
        </div>

        <div className="mt-3 space-y-2 rounded-md border border-border-strong bg-bg-elevated p-3">
          <Field label="Other ordinary income during conversion years">
            <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
              <span className="text-sm text-text-muted">$</span>
              <NumberField
                value={otherIncome}
                onChange={(v) => setOtherIncome(v)}
                precision={0}
                allowNegative={false}
                className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
              />
            </span>
          </Field>
          <Field label="Annual conversion (leave 0 for auto-fill 12% bracket)">
            <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2">
              <span className="text-sm text-text-muted">$</span>
              <NumberField
                value={customConversion ?? 0}
                onChange={(v) => setCustomConversion(v > 0 ? v : null)}
                precision={0}
                allowNegative={false}
                className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
              />
            </span>
          </Field>
          <div className="num text-[10px] text-text-dim">
            Using {formatUSDCompact(result.annualConversionUSD)} / year.
          </div>
        </div>

        {result.bracketFillNotes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {result.bracketFillNotes.map((n) => (
              <li key={n} className="text-[11px] text-text-muted">
                · {n}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
          <span className="font-semibold">Not tax advice.</span> Directional
          estimate using simplified married-filing-jointly federal brackets —
          doesn&apos;t model
          state tax, IRMAA, ACA cliffs, Social Security taxation, NIIT, or
          interaction with capital gains. Confirm with a licensed CPA or
          fee-only fiduciary before executing any conversion.
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div
        className={`num mt-0.5 text-base font-semibold ${positive ? "text-positive" : "text-text"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-text-dim">{sub}</div>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block px-0.5 text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      {children}
    </label>
  );
}
