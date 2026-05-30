"use client";

import { useId, useMemo, useState } from "react";

import { formatPercent, formatUSD, formatUSDCompact } from "@/lib/format";
import {
  EMPTY_INCOME,
  FILING_STATUS_LABELS,
  STANDARD_DEDUCTION_2025,
  computeUsTax,
  type FilingStatus,
  type IncomeBuckets,
  type UsTaxInputs,
} from "@/lib/calculators/usTax";
import {
  US_STATES_ORDERED,
  US_STATE_NAMES,
  type USState,
} from "@/lib/calculators/usStateTaxBrackets";

/**
 * US Tax calculator — wealth-analyze-style federal + state estimate
 * for the 2025 tax year.
 *
 * Static / portfolio-blind (same contract as the Investment Growth
 * calculator on this page): inputs are typed directly, math is a pure
 * function of those inputs. NOT connected to the user's household or
 * projections.
 *
 * Surface
 *   1. Inputs panel  — income buckets, filing status, state,
 *      pre-tax retirement, deduction choice.
 *   2. Headline      — total tax + take-home, big numbers, effective
 *      + marginal rates.
 *   3. Breakdown     — federal vs state vs FICA + NIIT pie/bars.
 *   4. Federal tables — ordinary brackets + LTCG brackets, with the
 *      marginal bracket highlighted.
 *   5. State table   — or "No state income tax" message.
 *   6. Disclosures   — list of unmodeled items.
 *
 * Validation follows the Investment Growth calculator's inline error
 * pattern (per-input red message + global notice).
 */

const INCOME_LIMITS = {
  per: { min: 0, max: 99_999_999 },
} as const;

type ValidationErrors = Partial<Record<keyof IncomeBuckets, string>> & {
  retirementContribUSD?: string;
  itemizedDeductionUSD?: string;
};

function validate(
  income: IncomeBuckets,
  retirement: number,
  itemized: number | null,
): ValidationErrors {
  const errs: ValidationErrors = {};
  (Object.keys(income) as (keyof IncomeBuckets)[]).forEach((k) => {
    const v = income[k];
    if (!Number.isFinite(v)) errs[k] = "Enter a number";
    else if (v < 0) errs[k] = "Must be 0 or more";
    else if (v > INCOME_LIMITS.per.max) errs[k] = "Too large";
  });
  if (!Number.isFinite(retirement)) {
    errs.retirementContribUSD = "Enter a number";
  } else if (retirement < 0) {
    errs.retirementContribUSD = "Must be 0 or more";
  } else if (retirement > income.wagesUSD) {
    errs.retirementContribUSD = "Cannot exceed wages";
  }
  if (itemized != null) {
    if (!Number.isFinite(itemized)) errs.itemizedDeductionUSD = "Enter a number";
    else if (itemized < 0) errs.itemizedDeductionUSD = "Must be 0 or more";
  }
  return errs;
}

export function UsTaxCalculator() {
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState<USState>("NONE");
  const [income, setIncome] = useState<IncomeBuckets>({
    ...EMPTY_INCOME,
    wagesUSD: 100_000,
  });
  const [retirementContribUSD, setRetirementContribUSD] = useState<number>(0);
  // null = use standard. The UI exposes a toggle + number field.
  const [useItemized, setUseItemized] = useState(false);
  const [itemizedDeductionUSD, setItemizedDeductionUSD] = useState<number>(0);
  // AMT preference inputs — default 0 (rare; most users leave alone).
  const [isoBargainElementUSD, setIsoBargainElementUSD] = useState<number>(0);
  const [privateActivityBondInterestUSD, setPrivateActivityBondInterestUSD] =
    useState<number>(0);

  const itemizedOrNull = useItemized ? itemizedDeductionUSD : null;

  const errors = validate(income, retirementContribUSD, itemizedOrNull);
  const hasErrors = Object.keys(errors).length > 0;

  const inputs: UsTaxInputs = useMemo(
    () => ({
      taxYear: 2025,
      filingStatus,
      state,
      income,
      retirementContribUSD,
      itemizedDeductionUSD: itemizedOrNull,
      isoBargainElementUSD,
      privateActivityBondInterestUSD,
    }),
    [
      filingStatus,
      state,
      income,
      retirementContribUSD,
      itemizedOrNull,
      isoBargainElementUSD,
      privateActivityBondInterestUSD,
    ],
  );

  const result = useMemo(() => computeUsTax(inputs), [inputs]);

  const setIncomeField = (k: keyof IncomeBuckets) => (v: number) =>
    setIncome((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="px-5 pt-4">
      {/* ------------------------------ Inputs ------------------------------ */}
      <div className="rounded-xl border border-border bg-bg-elevated">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Inputs
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Tax year 2025 · all amounts annual · USD
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2">
          <Select
            label="Filing status"
            value={filingStatus}
            onChange={(v) => setFilingStatus(v as FilingStatus)}
            options={(
              Object.entries(FILING_STATUS_LABELS) as [FilingStatus, string][]
            ).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="State"
            value={state}
            onChange={(v) => setState(v as USState)}
            options={US_STATES_ORDERED.map((s) => ({
              value: s,
              label: US_STATE_NAMES[s],
            }))}
          />
          <NumField
            label="W-2 wages"
            prefix="$"
            value={income.wagesUSD}
            onChange={setIncomeField("wagesUSD")}
            error={errors.wagesUSD}
          />
          <NumField
            label="Self-employment net income"
            prefix="$"
            value={income.selfEmploymentUSD}
            onChange={setIncomeField("selfEmploymentUSD")}
            error={errors.selfEmploymentUSD}
            hint="Schedule C net profit"
          />
          <NumField
            label="Taxable interest"
            prefix="$"
            value={income.interestIncomeUSD}
            onChange={setIncomeField("interestIncomeUSD")}
            error={errors.interestIncomeUSD}
          />
          <NumField
            label="Ordinary dividends"
            prefix="$"
            value={income.ordinaryDividendsUSD}
            onChange={setIncomeField("ordinaryDividendsUSD")}
            error={errors.ordinaryDividendsUSD}
            hint="1099-DIV box 1a (incl. the qualified portion)"
          />
          <NumField
            label="Qualified dividends"
            prefix="$"
            value={income.qualifiedDividendsUSD}
            onChange={setIncomeField("qualifiedDividendsUSD")}
            error={errors.qualifiedDividendsUSD}
            hint="Subset of ordinary divs — taxed at LTCG rates"
          />
          <NumField
            label="Short-term capital gains"
            prefix="$"
            value={income.shortTermCapGainsUSD}
            onChange={setIncomeField("shortTermCapGainsUSD")}
            error={errors.shortTermCapGainsUSD}
            hint="Held ≤ 1 year — taxed as ordinary"
          />
          <NumField
            label="Long-term capital gains"
            prefix="$"
            value={income.longTermCapGainsUSD}
            onChange={setIncomeField("longTermCapGainsUSD")}
            error={errors.longTermCapGainsUSD}
            hint="Held > 1 year — preferential rates"
          />
          <NumField
            label="Other ordinary income"
            prefix="$"
            value={income.otherOrdinaryUSD}
            onChange={setIncomeField("otherOrdinaryUSD")}
            error={errors.otherOrdinaryUSD}
            hint="Rental net, royalties, etc."
          />
          <NumField
            label="Pre-tax retirement contributions"
            prefix="$"
            value={retirementContribUSD}
            onChange={setRetirementContribUSD}
            error={errors.retirementContribUSD}
            hint="Traditional 401(k) / IRA / HSA — reduces wages"
          />
          <NumField
            label="ISO bargain element"
            prefix="$"
            value={isoBargainElementUSD}
            onChange={setIsoBargainElementUSD}
            hint="ISOs exercised but not sold this year (FMV − strike). The #1 AMT trigger."
          />
          <NumField
            label="Private activity bond interest"
            prefix="$"
            value={privateActivityBondInterestUSD}
            onChange={setPrivateActivityBondInterestUSD}
            hint="Tax-exempt for regular tax, but adds back for AMT."
          />
          <div className="rounded-md border border-border bg-bg-surface px-3 py-2">
            <span className="block text-[10px] uppercase tracking-wider text-text-muted">
              Deduction
            </span>
            <div className="mt-1 flex gap-2 text-[11px]">
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  checked={!useItemized}
                  onChange={() => setUseItemized(false)}
                  className="h-3 w-3"
                />
                Standard ({formatUSDCompact(STANDARD_DEDUCTION_2025[filingStatus])})
              </label>
              <label className="flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  checked={useItemized}
                  onChange={() => setUseItemized(true)}
                  className="h-3 w-3"
                />
                Itemized
              </label>
            </div>
            {useItemized && (
              <input
                type="number"
                inputMode="decimal"
                value={itemizedDeductionUSD}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setItemizedDeductionUSD(v);
                }}
                min={0}
                className="num mt-1 w-full bg-transparent text-right text-sm font-medium text-text outline-none"
              />
            )}
            {errors.itemizedDeductionUSD && (
              <div className="mt-1 text-[10px] text-red-300" role="alert">
                {errors.itemizedDeductionUSD}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasErrors && (
        <div
          className="mt-3 rounded-md border border-red-400/40 bg-red-400/5 px-3 py-2 text-[11px] leading-snug text-red-300"
          role="alert"
        >
          One or more inputs are out of range — fix the highlighted
          fields above. Results below reflect the current input state.
        </div>
      )}

      {/* ----------------------------- Headline ---------------------------- */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <HeadlineCard
          label="Total tax"
          value={result.totalTaxUSD}
          rate={result.overallEffectiveRate}
          rateLabel="Overall effective rate"
          color="text-text"
        />
        <HeadlineCard
          label="Take-home"
          value={result.takeHomeUSD}
          rate={
            result.federal.totalGrossIncomeUSD > 0
              ? result.takeHomeUSD / result.federal.totalGrossIncomeUSD
              : 0
          }
          rateLabel="of gross income"
          color="text-positive"
        />
      </div>

      {/* --------------------------- Breakdown table ----------------------- */}
      <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Tax breakdown by component
          </div>
          <div className="text-[10px] text-text-dim">
            % of total tax · % of gross income
          </div>
        </div>
        {/* Stacked horizontal bar: each component's share of total tax */}
        <ComponentStackedBar
          totalTax={result.totalTaxUSD}
          rows={taxComponents(result)}
        />
        {/* Per-component rows: $ amount + % of total tax + % of gross
            income + descriptive note. Every U.S. tax type the engine
            models has its own row so the user sees both the dollar
            cost AND the share of the total + gross. */}
        <div className="mt-3 divide-y divide-border/50">
          {taxComponents(result).map((c) => (
            <TaxComponentRow
              key={c.key}
              label={c.label}
              amount={c.amount}
              totalTax={result.totalTaxUSD}
              grossIncome={result.federal.totalGrossIncomeUSD}
              note={c.note}
              color={c.color}
            />
          ))}
          {/* Total row */}
          <TaxComponentRow
            label="Total tax (all U.S. federal + state)"
            amount={result.totalTaxUSD}
            totalTax={result.totalTaxUSD}
            grossIncome={result.federal.totalGrossIncomeUSD}
            note="Sum of every component above"
            color="bg-text"
            isTotal
          />
        </div>
        {/* Adjusted-gross-income context row (not a tax — informational) */}
        <div className="mt-3 flex items-baseline justify-between rounded-md border border-border bg-bg-surface px-3 py-2 text-[11px]">
          <div className="text-text-muted">
            AGI{" "}
            <span className="text-text-dim">
              · deduction{" "}
              {formatUSDCompact(result.federal.deductionUSD)} (
              {result.federal.deductionSource})
            </span>
          </div>
          <div className="num font-medium text-text">
            {formatUSD(result.federal.agiUSD)}
          </div>
        </div>
      </div>

      {/* ------------------------ Federal ordinary table ------------------- */}
      <BracketTable
        title="Federal ordinary income brackets"
        rows={result.federal.ordinaryBracketBreakdown}
        marginalRate={result.federal.marginalRateOrdinary}
        emptyMessage="No taxable ordinary income."
      />

      {/* ------------------------ Federal LTCG table ----------------------- */}
      <BracketTable
        title="Federal long-term capital gains & qualified dividend brackets"
        subtitle="LTCG fills brackets STARTING above your ordinary taxable income (stacking)."
        rows={result.federal.ltcgBracketBreakdown}
        marginalRate={result.federal.marginalRateLTCG}
        emptyMessage="No long-term capital gains or qualified dividends."
      />

      {/* ------------------------ State table ------------------------------ */}
      {result.state.hasIncomeTax ? (
        <BracketTable
          title={`${result.state.stateName} state income tax brackets`}
          subtitle={result.state.note}
          rows={result.state.bracketBreakdown}
          marginalRate={result.state.marginalRate}
          emptyMessage="No state taxable income."
        />
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            {result.state.stateName} state income tax
          </div>
          <div className="mt-1 text-sm text-text">No state income tax.</div>
          {result.state.note && (
            <div className="mt-1 text-[11px] text-text-dim">
              {result.state.note}
            </div>
          )}
        </div>
      )}

      {/* ----------------------- Disclosures ------------------------------- */}
      <details className="mt-4 rounded-xl border border-border bg-bg-elevated">
        <summary className="cursor-pointer px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">
          What this calculator does NOT model
        </summary>
        <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-text-dim">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong className="text-text">AMT</strong> — modeled with
              2025 exemption + phase-out + 26/28% brackets and Form
              6251 Part III LTCG stacking. Does not model: NOL
              adjustments, depreciation/depletion preferences, or
              foreign-tax-credit AMT interactions.
            </li>
            <li>
              <strong className="text-text">QBI deduction</strong>{" "}
              (Section 199A) — up to 20% deduction on pass-through
              business income, subject to multiple phase-outs.
            </li>
            <li>
              <strong className="text-text">Credits</strong>: Child Tax
              Credit, EITC, dependent care, education credits, retirement
              savings (saver&apos;s) credit, residential energy credits.
            </li>
            <li>
              <strong className="text-text">Dependent exemptions</strong>
              {" "}and the additional standard deduction for age 65+ or blind.
            </li>
            <li>
              <strong className="text-text">IRMAA</strong> — income-related
              monthly Medicare premium surcharges.
            </li>
            <li>
              <strong className="text-text">State-specific quirks</strong>:
              local income tax (NYC, Yonkers, Philadelphia, SF, Detroit,
              IN/OH/KY/PA municipalities), state-level PTE elections
              (SALT cap workarounds), retirement-income exemptions, WA&apos;s
              7% LTCG tax with the $270k threshold + primary-residence
              exclusion, MA&apos;s 4% surtax above $1M.
            </li>
            <li>
              <strong className="text-text">Phase-outs</strong> of
              itemized deductions, education credits, Roth IRA
              eligibility, and SALT cap interactions.
            </li>
            <li>
              <strong className="text-text">Employer match</strong> — not
              part of your taxable income for the year contributed.
            </li>
          </ul>
          <p className="mt-2">
            For complex situations consult a tax professional. This
            calculator targets back-of-envelope estimates for typical
            wage + investment + self-employment scenarios.
          </p>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UI atoms                                                             */
/* ------------------------------------------------------------------ */

function NumField({
  label,
  prefix,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  prefix?: string;
  value: number;
  onChange: (v: number) => void;
  error?: string;
  hint?: string;
}) {
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
          {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(v);
            }}
            min={0}
            step={100}
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

function Select({
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

function HeadlineCard({
  label,
  value,
  rate,
  rateLabel,
  color,
}: {
  label: string;
  value: number;
  rate: number;
  rateLabel: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={`num mt-1 text-3xl font-semibold ${color}`}>
        {formatUSD(value)}
      </div>
      <div className="mt-1 text-[11px] text-text-dim">
        {formatPercent(rate)} · {rateLabel}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="num mt-0.5 text-sm font-semibold text-text">
        {formatUSD(value)}
      </div>
      {sub && <div className="text-[10px] text-text-dim">{sub}</div>}
    </div>
  );
}

/**
 * Per-component tax row. Shows label, $ amount, % of total tax,
 * % of gross income, and a one-line note. Designed to read like a
 * line item in a tax return rather than a metric tile — explicit
 * dual-percentage display per user request.
 */
function TaxComponentRow({
  label,
  amount,
  totalTax,
  grossIncome,
  note,
  color,
  isTotal,
}: {
  label: string;
  amount: number;
  totalTax: number;
  grossIncome: number;
  note?: string;
  color: string;
  isTotal?: boolean;
}) {
  const pctOfTotal = totalTax > 0 ? amount / totalTax : 0;
  const pctOfGross = grossIncome > 0 ? amount / grossIncome : 0;
  return (
    <div className="grid grid-cols-12 items-baseline gap-2 py-2">
      <div className="col-span-5 flex items-center gap-2 sm:col-span-4">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
          aria-hidden
        />
        <span
          className={`text-[11px] ${
            isTotal ? "font-semibold text-text" : "text-text"
          }`}
        >
          {label}
        </span>
      </div>
      <div
        className={`num col-span-3 text-right text-[12px] sm:col-span-3 ${
          isTotal ? "font-semibold text-text" : "text-text"
        }`}
      >
        {formatUSD(amount)}
      </div>
      <div className="num col-span-2 text-right text-[11px] text-text-dim sm:col-span-2">
        {(pctOfTotal * 100).toFixed(1)}%
      </div>
      <div className="num col-span-2 text-right text-[11px] text-text-dim sm:col-span-2">
        {(pctOfGross * 100).toFixed(2)}%
      </div>
      {note && (
        <div className="col-span-12 -mt-1 pl-4 text-[10px] text-text-dim sm:col-span-1 sm:mt-0 sm:pl-0 sm:text-right">
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * Tax-component palette + ordering. Stable keys keyed off the engine
 * fields so adding a new component is a one-line change here.
 */
function taxComponents(result: ReturnType<typeof computeUsTax>): Array<{
  key: string;
  label: string;
  amount: number;
  note?: string;
  color: string;
}> {
  return [
    {
      key: "fedOrdinary",
      label: "Federal ordinary income tax",
      amount: result.federal.ordinaryTaxUSD,
      note: `Marginal ${formatPercent(result.federal.marginalRateOrdinary)}`,
      color: "bg-accent",
    },
    {
      key: "fedLtcg",
      label: "Federal LTCG + qualified-dividend tax",
      amount: result.federal.ltcgTaxUSD,
      note: `Marginal ${formatPercent(result.federal.marginalRateLTCG)}`,
      color: "bg-positive",
    },
    {
      key: "ss",
      label: "Social Security (6.2%)",
      amount: result.federal.ficaSsUSD,
      note: "Capped at $176,100 wage base",
      color: "bg-blue-400",
    },
    {
      key: "medicare",
      label: "Medicare (1.45%)",
      amount: result.federal.ficaMedicareUSD,
      note: "No wage cap",
      color: "bg-cyan-400",
    },
    {
      key: "addlMedicare",
      label: "Additional Medicare (0.9%)",
      amount: result.federal.additionalMedicareUSD,
      note: "Above the AGI threshold",
      color: "bg-teal-400",
    },
    {
      key: "se",
      label: "Self-employment tax (15.3%)",
      amount: result.federal.seTaxUSD,
      note: "Both halves of FICA; half deductible",
      color: "bg-purple-400",
    },
    {
      key: "niit",
      label: "Net Investment Income Tax (NIIT 3.8%)",
      amount: result.federal.niitUSD,
      note: "On investment income above MAGI threshold",
      color: "bg-amber-400",
    },
    {
      key: "amt",
      label: "Alternative Minimum Tax (AMT)",
      amount: result.federal.amtUSD,
      // The note surfaces AMTI + exemption so a curious user
      // can see WHY AMT is or isn't due. Shown even when
      // amount=0 so the line stays visible (consistent with
      // other zero-when-not-applicable lines like SE tax).
      note:
        result.federal.amtUSD > 0
          ? `TMT $${Math.round(
              result.federal.tmtUSD,
            ).toLocaleString()} exceeds regular tax`
          : `AMTI $${Math.round(
              result.federal.amtiUSD,
            ).toLocaleString()}, exemption $${Math.round(
              result.federal.amtExemptionUSD,
            ).toLocaleString()} — no AMT due`,
      color: "bg-orange-400",
    },
    {
      key: "state",
      label: `State income tax — ${result.state.stateName}`,
      amount: result.state.stateTaxUSD,
      note: result.state.hasIncomeTax
        ? `Marginal ${formatPercent(result.state.marginalRate)}`
        : "No state income tax",
      color: "bg-rose-400",
    },
  ];
}

/**
 * Stacked horizontal bar visualizing each component's share of the
 * total tax bill. Zero-amount components render with zero width
 * (and stay invisible) so the bar stays a clean visual summary
 * even on simple income mixes.
 */
function ComponentStackedBar({
  totalTax,
  rows,
}: {
  totalTax: number;
  rows: Array<{ key: string; amount: number; color: string; label: string }>;
}) {
  if (totalTax <= 0) {
    return (
      <div className="mt-2 h-2 rounded-full bg-bg-surface" aria-hidden />
    );
  }
  return (
    <div
      className="mt-2 flex h-2 overflow-hidden rounded-full bg-bg-surface"
      role="img"
      aria-label="Stacked tax-component composition bar"
    >
      {rows.map((r) =>
        r.amount > 0 ? (
          <div
            key={r.key}
            className={r.color}
            style={{ width: `${(r.amount / totalTax) * 100}%` }}
            title={`${r.label}: ${(r.amount / totalTax * 100).toFixed(1)}%`}
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * Single bracket table — shared between federal ordinary, federal
 * LTCG, and state. Highlights the row whose rate matches the
 * `marginalRate` AND whose `incomeInBracketUSD > 0` (i.e., the row
 * actually being taxed at the margin). Ceilings of +Infinity render
 * as "∞" / "—".
 */
function BracketTable({
  title,
  subtitle,
  rows,
  marginalRate,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  rows: { rate: number; floor: number; ceiling: number; incomeInBracketUSD: number; taxUSD: number }[];
  marginalRate: number;
  emptyMessage: string;
}) {
  const anyIncome = rows.some((r) => r.incomeInBracketUSD > 0);
  return (
    <div className="mt-4 rounded-xl border border-border bg-bg-elevated">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 text-[11px] leading-snug text-text-dim">
            {subtitle}
          </div>
        )}
      </div>
      {anyIncome ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Rate
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Bracket range
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Income in bracket
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Tax
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isMarginal =
                  row.rate === marginalRate && row.incomeInBracketUSD > 0;
                return (
                  <tr
                    key={`${row.rate}-${row.floor}-${i}`}
                    className={`border-t border-border/50 ${
                      isMarginal ? "bg-accent/10" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 text-text">
                      {formatPercent(row.rate)}
                      {isMarginal && (
                        <span className="ml-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] text-accent">
                          marginal
                        </span>
                      )}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-text-dim">
                      {formatUSDCompact(row.floor)} –{" "}
                      {row.ceiling === Number.POSITIVE_INFINITY
                        ? "∞"
                        : formatUSDCompact(row.ceiling)}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-text">
                      {row.incomeInBracketUSD > 0
                        ? formatUSDCompact(row.incomeInBracketUSD)
                        : "—"}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-text">
                      {row.taxUSD > 0 ? formatUSD(row.taxUSD) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-3 text-[11px] text-text-dim">{emptyMessage}</div>
      )}
    </div>
  );
}
