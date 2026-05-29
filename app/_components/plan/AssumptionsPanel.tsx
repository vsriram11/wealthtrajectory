"use client";

import { Fragment, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { totalMonthlyContributions, type Assumptions } from "@/lib/types";
import {
  effectiveHouseholdAssumptions,
  resolveAssumptionsForMember,
} from "@/lib/projection/useActiveProjection";
import {
  clampHaircut,
  effectiveVariableShare,
  filterBudgetForRollups,
  weightedRealExcess,
} from "@/lib/budget/budget";
import { activeMemberIds } from "@/lib/types";
import { formatUSD } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

type Field = {
  key:
    | "targetNetWorthUSD"
    | "withdrawalRate"
    | "legacyFloorUSD"
    | "drawdownHorizonYears"
    | "expectedInflationRate"
    | "retirementVariableHaircut"
    | "retirementVariableShare"
    | "retirementFixedNominalYears"
    | "assumedCapGainsFraction";
  label: string;
  prefix?: string;
  suffix?: string;
  step: number;
  min: number;
  max: number;
  toDisplay: (n: number | undefined) => number;
  fromDisplay: (n: number) => number;
  helpFor?: (a: Assumptions) => string | null;
  pro?: boolean;
};

const fields: Field[] = [
  {
    key: "targetNetWorthUSD",
    label: "Target net worth",
    prefix: "$",
    step: 25_000,
    min: 0,
    max: 50_000_000,
    toDisplay: (n) => n ?? 0,
    fromDisplay: (n) => n,
    helpFor: (a) => {
      const annualSpend = a.targetNetWorthUSD * a.withdrawalRate;
      if (!Number.isFinite(annualSpend) || annualSpend <= 0) return null;
      const monthlySpend = annualSpend / 12;
      // Phrase as a CONDITIONAL — this preview computes
      // target × SWR, but the projection engine actually
      // withdraws (Independence-day-NW × SWR), and those
      // diverge when the user starts above target or when
      // phase transitions kick in. "If you stop at target"
      // names the assumption so the number isn't read as a
      // projection output.
      return `If you stop at target: ≈ $${formatGroupedInt(annualSpend)}/yr ($${formatGroupedInt(monthlySpend)}/mo)`;
    },
  },
  {
    key: "withdrawalRate",
    label: "Withdrawal rate",
    suffix: "%",
    // 0.05% steps so common Trinity-anchored values (3.00, 3.25,
    // 3.50, 4.00) are reachable without arithmetic surprise. The
    // prior 0.1 step worked at the 2-decimal display but felt
    // coarse near anchor values.
    step: 0.05,
    min: 0,
    max: 15,
    toDisplay: (n) => +(((n ?? 0) * 100)).toFixed(2),
    fromDisplay: (n) => n / 100,
    helpFor: (a) => {
      const preserveAll =
        a.legacyFloorUSD > 0 && a.legacyFloorUSD >= a.targetNetWorthUSD;
      const inflPct = (a.expectedInflationRate * 100).toFixed(1);
      if (preserveAll) {
        return `Use ~3% to preserve the full target as legacy — the 4% rule eventually depletes principal in real terms. Withdrawals stay flat in today's dollars (≡ 4% rule + ${inflPct}% annual CPI bumps).`;
      }
      return `Annual % of Independence-day net worth to draw, held flat in today's dollars (≡ 4% rule + ${inflPct}% annual CPI bumps).`;
    },
  },
  {
    key: "legacyFloorUSD",
    label: "Legacy floor",
    prefix: "$",
    step: 50_000,
    min: 0,
    max: 100_000_000,
    toDisplay: (n) => n ?? 0,
    fromDisplay: (n) => n,
    helpFor: () => "Minimum amount to leave behind at end of horizon.",
    pro: true,
  },
  {
    key: "drawdownHorizonYears",
    label: "Drawdown horizon",
    suffix: "yrs",
    step: 5,
    min: 5,
    max: 60,
    toDisplay: (n) => n ?? 0,
    fromDisplay: (n) => n,
    helpFor: () => "Years of retirement to project after Independence.",
  },
  {
    key: "expectedInflationRate",
    label: "Expected inflation",
    suffix: "%",
    step: 0.1,
    min: 0,
    max: 15,
    toDisplay: (n) => +(((n ?? 0) * 100)).toFixed(2),
    fromDisplay: (n) => n / 100,
    helpFor: () =>
      "All projection numbers are in today's dollars (real terms). Inflation only affects how the withdrawal-rate caption is phrased and how nominal-dollar references read.",
  },
  {
    key: "retirementVariableHaircut",
    label: "Variable haircut (retirement)",
    suffix: "%",
    // 1-point steps so users can target exact values (33%, 50%,
    // 67%) without being forced to 5-point snapping. The math is
    // continuous; the slider step shouldn't pretend otherwise.
    step: 1,
    min: 0,
    max: 100,
    toDisplay: (n) => Math.round((n ?? 0) * 100),
    fromDisplay: (n) => Math.max(0, Math.min(1, n / 100)),
    helpFor: () =>
      "Fraction of your variable (lifestyle-flex) budget you expect to cut in retirement. 0 = same lifestyle; 50 = half-cut; 100 = drop variable entirely. Fixed expenses are never touched. Lower haircut = larger independence corpus needed.",
  },
  {
    // Fixed-nominal years — SORR mitigation. Freezes the nominal
    // withdrawal amount for the first N retirement years; in the
    // engine's real-terms math this is a geometric decay of the
    // real withdrawal during the freeze window (the assumption's
    // own `expectedInflationRate` powers the decay so users don't
    // set inflation twice). 0 = disabled.
    key: "retirementFixedNominalYears",
    label: "Fixed-nominal years (SORR mitigation)",
    suffix: "yrs",
    step: 1,
    min: 0,
    max: 15,
    toDisplay: (n) => Math.round(n ?? 0),
    fromDisplay: (n) => Math.max(0, Math.min(15, Math.round(n))),
    helpFor: () =>
      "Freeze withdrawals at their year-0 nominal amount for the first N retirement years (instead of inflating with CPI). Cuts cumulative real spend during the early-retirement SORR danger zone — 10 years at 3% inflation trims ~14% of one year's real spend, which buys meaningful tail-risk relief. 0 = disabled (default). Applied in historical Monte Carlo only; the deterministic Independence projection assumes the post-freeze real-flat baseline.",
  },
  {
    // Variable-share input — companion to the haircut slider.
    // Determines what FRACTION of retirement spend the haircut
    // can cut. Defaults to budget-derived (when budget exists)
    // or 0.35 (BLS Consumer Expenditure Survey median). The
    // helper resolves overrides the same way: explicit user
    // value wins, else budget-derived, else default.
    //
    // This is a SHARE (a fraction), not a dollar amount, so the
    // haircut applies to a consistent slice of whatever spend
    // the MC card is testing — works correctly even when the
    // user's target NW and budget-implied corpus disagree on
    // total spending.
    key: "retirementVariableShare",
    label: "Variable share of retirement spend",
    suffix: "%",
    step: 1,
    min: 0,
    max: 100,
    toDisplay: (n) => Math.round((n ?? 0) * 100),
    fromDisplay: (n) => Math.max(0, Math.min(1, n / 100)),
    helpFor: () =>
      "How much of your retirement spend is variable (the slice the haircut may reduce). Defaults to your budget mix when set, else 35% (BLS median for 65+ households). Drag to override.",
  },
  {
    // Assumed cap-gains fraction — companion to the retirement
    // tax rate. Without per-holding cost-basis tracking, the
    // bucket-funding + deleveraging engines must assume SOME
    // gain-to-value ratio when modeling cap-gains tax on the
    // sale of equity to raise the requested cash bucket (or to
    // restructure leveraged ETFs at retirement). Default 100%
    // (treat all value as gain) is the conservative shipped
    // behavior; a long-held position that has doubled would
    // realistically be ~50%, and a just-purchased position
    // would be ~0%. User can dial to match their portfolio's
    // average cost-basis-to-value ratio.
    //
    // Threaded into both `planBucketFunding` and
    // `computeLeveragedEquityBuckets` so the two tax models
    // stay internally consistent.
    key: "assumedCapGainsFraction",
    label: "Assumed cap-gains fraction (sales)",
    suffix: "%",
    step: 5,
    min: 0,
    max: 100,
    toDisplay: (n) => Math.round((n ?? 1) * 100),
    fromDisplay: (n) => Math.max(0, Math.min(1, n / 100)),
    helpFor: () =>
      "Fraction of a sold holding's current value treated as taxable gain in the historical Monte Carlo's bucket-funding + deleveraging tax models. 100% (default) is conservative — treats all value as gain. A position that has doubled is ~50%. Just-purchased ≈ 0%. Lower values reduce the modeled tax bill on equity sales.",
  },
];

function formatGroupedInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function AssumptionsPanel() {
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const setAssumption = useAppStore((s) => s.setAssumption);
  const setMemberAssumption = useAppStore((s) => s.setMemberAssumption);
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const member = memberId
    ? household.members.find((m) => m.id === memberId)
    : null;

  const totalContrib = totalMonthlyContributions(household, memberId);
  const editingMember = memberId != null;

  // Blended real-excess inflation implied by the user's current
  // Budget mix, scoped to the same view (member-filtered when in
  // member view, full budget on household). Used to surface a
  // discoverability hint next to the SWR field: "your budget mix
  // implies +0.6% blended real-excess — Bake into SWR from Plan →
  // Budget to inflation-adjust your withdrawal rate."
  const allBudgetItems = useAppStore((s) => s.budgetItems);
  const haircutForBlend =
    (editingMember
      ? memberAssumptions[memberId]?.retirementVariableHaircut
      : assumptions.retirementVariableHaircut) ?? 0;
  const activeIds = useMemo(() => activeMemberIds(household), [household]);
  const budgetForBlend = filterBudgetForRollups(
    allBudgetItems,
    editingMember ? memberId : null,
    activeIds,
  );
  const blendedExcess = weightedRealExcess(budgetForBlend, haircutForBlend);

  // Household view: the displayed assumptions auto-aggregate over
  // members who have any explicit per-member override (matches the
  // "household = roll-up of per-member plans" model). When no
  // overrides exist, this falls back to state.assumptions, so
  // pristine users and no-override households are unchanged.
  //
  // Member view: the member's effective assumptions (their explicit
  // overrides merged onto household defaults).
  const effective = editingMember
    ? resolveAssumptionsForMember(assumptions, memberAssumptions, memberId)
    : effectiveHouseholdAssumptions(
        assumptions,
        memberAssumptions,
        household.members,
      );
  const memberOverride = memberId ? (memberAssumptions[memberId] ?? {}) : {};
  // Household view is READ-ONLY when any member overrides exist —
  // editing the household number directly would drift away from the
  // per-member reality. User filters to a member to edit. Household
  // view stays editable when no overrides exist (the "set a household
  // template" case for pristine users).
  const householdHasOverrides =
    !editingMember &&
    Object.values(memberAssumptions).some(
      (o) => o != null && Object.keys(o).length > 0,
    );
  const readOnlyHousehold = householdHasOverrides;

  return (
    <section className="px-5 pt-6">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Assumptions
        </h2>
        {editingMember && member && (
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
            {member.displayName}&apos;s plan
          </span>
        )}
      </div>
      {readOnlyHousehold && (
        <div className="mb-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] leading-snug text-accent">
          <span className="font-semibold">Household view (read-only).</span>{" "}
          Values below are auto-aggregated from each member&apos;s plan —
          target and legacy floor sum, withdrawal rate is target-weighted,
          the rest is averaged. Filter to a specific member (top of the
          app) to edit their assumptions.
        </div>
      )}
      {editingMember && (
        <div className="mb-3 rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px] text-text-dim">
          Editing assumptions for{" "}
          <span className="text-text-muted">{member?.displayName}</span>. Each
          field inherits the household default until you override it.
          Per-member overrides sync to Drive with the rest of your data.
        </div>
      )}
      <div className="rounded-2xl border border-border bg-bg-surface">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <div>
            <div className="text-sm text-text">Total monthly contributions</div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Edit per-account in the list below
            </div>
          </div>
          <div className="num text-sm font-semibold text-positive">
            +{formatUSD(totalContrib)}
          </div>
        </div>
        <div className="divide-y divide-border">
          {fields.map((f) => {
            // Source of truth for the displayed value: the member's
            // effective assumption (household default merged with their
            // override). Edits route to either the household default
            // (no member selected) or the per-member override map.
            //
            // Special case: `retirementVariableShare` resolves
            // through `effectiveVariableShare` when unset (budget-
            // derived → default 35%) so the slider always reflects
            // the value the simulator will actually consume.
            // Without this, an unset assumption would render as 0%,
            // which is wrong (it'd look like the haircut affects no
            // spend at all).
            const display =
              f.key === "retirementVariableShare"
                ? f.toDisplay(
                    effectiveVariableShare(
                      budgetForBlend,
                      effective.retirementVariableShare,
                    ),
                  )
                : f.toDisplay(effective[f.key]);
            const help = f.helpFor?.(effective);
            // The variable-share slider is only meaningful when the
            // user has SOME haircut configured AND has SOMETHING to
            // cut. With no haircut, this slider has zero effect on
            // any computation, so we hide it instead of cluttering
            // the assumption list with a dead control.
            const haircutRate = clampHaircut(
              effective.retirementVariableHaircut,
            );
            if (
              f.key === "retirementVariableShare" &&
              haircutRate <= 0
            ) {
              return null;
            }
            const isPreserveHint =
              f.key === "withdrawalRate" &&
              effective.legacyFloorUSD > 0 &&
              effective.legacyFloorUSD >= effective.targetNetWorthUSD;
            // Lock when in household view with overrides — values
            // are derived, so filter to a member to edit.
            const locked = readOnlyHousehold;
            const hasOverride =
              editingMember && f.key in memberOverride;
            return (
              <Fragment key={f.key}>
              <label
                className="flex items-start justify-between gap-3 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm text-text">
                    {f.label}
                    {hasOverride && (
                      <>
                        {/* Passive status pill: this field is overridden. */}
                        <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent">
                          Custom
                        </span>
                        {/* Active reset button — separate from the
                            status pill so the action is unambiguous.
                            Tooltip surfaces the household default
                            value that will be restored. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (!memberId) return;
                            setMemberAssumption(memberId, f.key, undefined);
                          }}
                          className="flex items-center gap-1 rounded border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-muted active:opacity-70 hover:text-text"
                          title={`Reset to household default (${f.toDisplay(assumptions[f.key])}${f.suffix === "%" ? "%" : ""})`}
                          aria-label={`Reset ${f.label} to household default`}
                        >
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                  {help && (
                    <div
                      className={`mt-0.5 text-[11px] ${
                        isPreserveHint ? "text-amber-300" : "text-text-dim"
                      }`}
                    >
                      {help}
                    </div>
                  )}
                  {f.key === "withdrawalRate" &&
                    Math.abs(blendedExcess) > 0.001 && (
                      <div className="mt-0.5 text-[10px] leading-snug text-text-dim">
                        Your budget mix implies{" "}
                        <span
                          className={
                            blendedExcess > 0
                              ? "text-amber-300"
                              : "text-positive"
                          }
                        >
                          {blendedExcess > 0 ? "+" : ""}
                          {(blendedExcess * 100).toFixed(2)}% blended real-
                          excess inflation
                        </span>
                        . Bake it into this SWR from Plan → Budget to
                        inflation-adjust the rate ({(effective.withdrawalRate * 100).toFixed(2)}% →{" "}
                        {(
                          Math.max(0.001, effective.withdrawalRate - blendedExcess) * 100
                        ).toFixed(2)}%).
                      </div>
                    )}
                  {editingMember && !hasOverride && (
                    <div className="mt-0.5 text-[10px] text-text-dim">
                      Inheriting household default
                    </div>
                  )}
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-lg border border-border-strong bg-bg-elevated px-2.5 py-1.5 ${
                    locked ? "opacity-50" : ""
                  } ${hasOverride ? "border-accent/40" : ""}`}
                >
                  {f.prefix && (
                    <span className="text-sm text-text-muted">{f.prefix}</span>
                  )}
                  <NumberField
                    value={display}
                    precision={f.suffix === "%" ? 2 : 0}
                    onChange={(v) => {
                      if (locked) return;
                      const next = f.fromDisplay(v);
                      if (editingMember && memberId) {
                        setMemberAssumption(memberId, f.key, next);
                      } else {
                        setAssumption(f.key, next);
                      }
                    }}
                    readOnly={locked}
                    className="num w-24 bg-transparent text-right text-sm font-medium text-text outline-none"
                  />
                  {f.suffix && (
                    <span className="text-sm text-text-muted">{f.suffix}</span>
                  )}
                </span>
              </label>
              {/* Dynamic-spending mode toggle. Sits directly under
                  the haircut slider so the relationship is visible
                  at a glance (the toggle is a MODIFIER on the
                  haircut, not a standalone control). Hidden when
                  the haircut is 0 — there's nothing to mode-switch
                  on. */}
              {f.key === "retirementVariableHaircut" &&
                haircutRate > 0 && (
                  <DynamicHaircutModeRow
                    on={
                      effective.retirementVariableHaircutOnDownYearOnly === true
                    }
                    locked={locked}
                    overridden={
                      editingMember &&
                      "retirementVariableHaircutOnDownYearOnly" in memberOverride
                    }
                    onChange={(v) => {
                      if (locked) return;
                      if (editingMember && memberId) {
                        setMemberAssumption(
                          memberId,
                          "retirementVariableHaircutOnDownYearOnly",
                          v,
                        );
                      } else {
                        setAssumption(
                          "retirementVariableHaircutOnDownYearOnly",
                          v,
                        );
                      }
                    }}
                    onReset={
                      editingMember && memberId
                        ? () =>
                            setMemberAssumption(
                              memberId,
                              "retirementVariableHaircutOnDownYearOnly",
                              undefined,
                            )
                        : null
                    }
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Dynamic-haircut mode toggle row.
 *
 * Sits inline beneath the Variable haircut slider so the
 * relationship is unambiguous — this row MODIFIES the slider's
 * behavior, it isn't a separate concept. The label + helper copy
 * + switch are wrapped in one button (role="switch") so the
 * entire row is the touch target (≥44pt), matching the pattern
 * used by the Members sheet's include-in-rollup toggle.
 *
 * When ON: the haircut applies only in retirement years
 * following a year of negative real stock returns. Models the
 * "spend less when scared" guardrail strategy. When OFF: the
 * haircut applies every retirement year (the historical
 * always-apply contract).
 */
function DynamicHaircutModeRow({
  on,
  locked,
  overridden,
  onChange,
  onReset,
}: {
  on: boolean;
  locked: boolean;
  overridden: boolean;
  onChange: (next: boolean) => void;
  onReset: (() => void) | null;
}) {
  const helperCopy = on
    ? "Variable spend is cut only in years following a down stock-market year (~31% of years historically). Lifestyle is preserved in good years. Higher expected spending → moderate survival improvement vs. no haircut, lower than always-apply for the same rate."
    : "Variable spend is cut every retirement year. Conservative — maximum survival improvement for the rate, but you commit to a permanent lifestyle reduction.";
  return (
    <div className="border-t border-border-strong/40 bg-bg-surface/30 px-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={locked}
        onClick={() => onChange(!on)}
        className="flex w-full items-start justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-text">
            Apply only after down market years
            {overridden && (
              <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent">
                Custom
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-text-dim">
            {helperCopy}
          </span>
        </span>
        <SwitchThumb on={on} />
      </button>
      {overridden && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mt-1.5 text-[10px] text-text-dim hover:text-text active:opacity-70"
        >
          Reset to household default
        </button>
      )}
    </div>
  );
}

/**
 * Pure-visual switch (semantics on the parent button via
 * role="switch" + aria-checked). Same sizing math as the
 * Members sheet's SwitchThumb — kept inline rather than
 * importing across UI files because cross-component visual
 * primitives benefit from being co-located with their usage
 * for now (extract to /ui if a third call site appears).
 *
 * Sizing (every number adds up exactly so the thumb can never
 * overflow the track):
 *   Track:   44px × 24px (w-11 h-6)
 *   Thumb:   20px diameter (w-5 h-5)
 *   Inset:   2px each side
 *   Travel:  44 − 20 − (2 × 2) = 20px (translate-x-5)
 */
function SwitchThumb({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border-strong"
      }`}
    >
      <span
        className={`ml-0.5 inline-block h-5 w-5 rounded-full bg-bg-surface shadow-sm transition-transform ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </span>
  );
}
