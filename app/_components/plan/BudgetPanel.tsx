"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  BILLING_CYCLE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_TONES,
  DEFAULT_RETIREMENT_TAX_RATE,
  budgetTotals,
  clampHaircut,
  clampTaxRate,
  filterBudgetForRollups,
  nextBillingDate,
  perCycleAmountUSD,
  retirementMonthlyAfterHaircut,
  subscriptionItems,
  suggestedIndependenceCorpus,
  realExcessCorpusDrag,
  weightedRealExcess,
  PLANNING_HORIZON_YEARS,
  type BudgetItem,
  type ExpenseCategory,
} from "@/lib/budget/budget";
import { activeMemberIds } from "@/lib/types";
import { formatUSD, formatUSDCompact } from "@/lib/format";
import { resolveAssumptionsForMember } from "@/lib/projection/useActiveProjection";
import { BudgetItemCreator } from "./BudgetItemCreator";
import { EmergencyFundCard } from "./EmergencyFundCard";
import { CategorySection } from "./budget/CategorySection";
import { SubscriptionsList } from "./budget/SubscriptionsList";

/**
 * Budget planner view. Top: summary card with monthly / annual /
 * retirement-relevant subtotal + the suggested independence corpus given
 * the current (effective per-member) withdrawal rate. "Apply"
 * button pushes the suggestion into the right level of assumptions
 * — per-member override when a specific member is filtered, else
 * the household default — so a member-scoped target ($20M for
 * Alice's view, say) isn't silently overwritten by a household-
 * default edit.
 *
 * Below: expense list grouped by category (Housing / Food / etc.).
 * Each category section shows its total, with collapsible
 * subcategory rows. Per-category "+ Add" button opens the
 * BudgetItemCreator pre-set to that category.
 *
 * The list deliberately mirrors the user's inspiration screens —
 * colored category dot, subcategory under the name, per-row monthly
 * amount, tap-to-edit.
 */
export function BudgetPanel() {
  const allBudgetItems = useAppStore((s) => s.budgetItems);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const members = useAppStore((s) => s.household.members);
  const householdAssumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const setAssumption = useAppStore((s) => s.setAssumption);
  const setMemberAssumption = useAppStore((s) => s.setMemberAssumption);

  // Effective assumptions for the current view. When the user has a
  // member filter active, this resolves the per-member override on
  // top of the household defaults (so the Independence target shown is the
  // one they see in AssumptionsPanel for the same view). Without
  // this, the card showed household-level numbers even when the
  // user was filtered to a member with a different target.
  const assumptions = useMemo(
    () =>
      resolveAssumptionsForMember(
        householdAssumptions,
        memberAssumptions,
        selectedMemberId,
      ),
    [householdAssumptions, memberAssumptions, selectedMemberId],
  );

  const [creatorOpen, setCreatorOpen] = useState<boolean>(false);
  const [creatorCategory, setCreatorCategory] = useState<
    ExpenseCategory | undefined
  >(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "subscriptions">("all");

  // Filter by the global member selection.
  //   - selectedMemberId set → that member's items only.
  //   - selectedMemberId null → drop items owned by members
  //     flagged out of household rollups (active-member set
  //     only). Mirrors how NW / projections compose elsewhere
  //     so all rollup surfaces stay consistent.
  const household = useAppStore((s) => s.household);
  const activeIds = useMemo(() => activeMemberIds(household), [household]);
  const budgetItems = useMemo(
    () => filterBudgetForRollups(allBudgetItems, selectedMemberId, activeIds),
    [allBudgetItems, selectedMemberId, activeIds],
  );

  const totals = useMemo(() => budgetTotals(budgetItems), [budgetItems]);
  // Variable-expense haircut from the (member-effective) assumptions.
  // Defaults to 0 when the field is unset, preserving back-compat.
  const variableHaircut = useMemo(
    () => clampHaircut(assumptions.retirementVariableHaircut),
    [assumptions.retirementVariableHaircut],
  );
  // Retirement tax rate from the (member-effective) assumptions.
  // Defaults to DEFAULT_RETIREMENT_TAX_RATE (20%) when unset.
  const taxRate = useMemo(
    () => clampTaxRate(assumptions.retirementTaxRate),
    [assumptions.retirementTaxRate],
  );
  const retirementMonthlyEffective = useMemo(
    () => retirementMonthlyAfterHaircut(budgetItems, variableHaircut),
    [budgetItems, variableHaircut],
  );
  const retirementAnnualEffective = retirementMonthlyEffective * 12;
  // Gross-up: withdrawals before tax must cover net spend.
  const grossWithdrawalAnnual = retirementAnnualEffective / (1 - taxRate);
  // The corpus is in REAL terms (today's dollars), matching the
  // rest of the app. Per-line excess inflation (e.g. healthcare's
  // ~2% real over CPI) feeds the Gordon-growth term directly:
  // contribution = annual / (swr - real_excess). When all lines
  // sit at 0% real excess (everyday expenses), this collapses to
  // the naive A/SWR formula.
  const suggestedCorpus = useMemo(
    () =>
      suggestedIndependenceCorpus(
        budgetItems,
        assumptions.withdrawalRate,
        variableHaircut,
        taxRate,
      ),
    [budgetItems, assumptions.withdrawalRate, variableHaircut, taxRate],
  );
  // How much of the corpus is real-excess drag (above what a pure
  // tracks-CPI assumption would suggest)? Positive when net-excess
  // categories like healthcare dominate; near zero when everything
  // tracks CPI; negative when deflators (lifestyle defaults to
  // -0.5%) dominate. Surfaced as a small explainer below the
  // corpus headline so the user understands what's driving it.
  const realExcessDrag = useMemo(
    () =>
      realExcessCorpusDrag(
        budgetItems,
        assumptions.withdrawalRate,
        variableHaircut,
        taxRate,
      ),
    [budgetItems, assumptions.withdrawalRate, variableHaircut, taxRate],
  );
  // Weighted-average real-excess across the budget mix, weighted by
  // post-haircut annual spend. Acts as the user-facing summary:
  // "your blended real-excess is X%". Also the input to the
  // 'Bake into SWR' action — apply that adjustment to the SWR
  // assumption so projection math everywhere uses the inflation-
  // adjusted rate going forward.
  const blendedExcess = useMemo(
    () => weightedRealExcess(budgetItems, variableHaircut),
    [budgetItems, variableHaircut],
  );
  const proposedSwr = Math.max(0.001, assumptions.withdrawalRate - blendedExcess);
  const proposedSwrMatchesCurrent =
    Math.abs(proposedSwr - assumptions.withdrawalRate) < 1e-5;
  const bakeBlendedIntoSwr = () => {
    if (proposedSwrMatchesCurrent) return;
    // Mirror the routing every other Budget→Plan action uses: when
    // the user is filtered to a member, write the per-member
    // override; otherwise update the household default. Without
    // this, baking in member view silently mutated the household
    // SWR while the member's own (overridden) SWR was unchanged.
    if (selectedMemberId) {
      setMemberAssumption(selectedMemberId, "withdrawalRate", proposedSwr);
    } else {
      setAssumption("withdrawalRate", proposedSwr);
    }
  };

  const grouped = useMemo(() => {
    const m: Record<ExpenseCategory, BudgetItem[]> = {
      food: [],
      housing: [],
      transportation: [],
      lifestyle: [],
      healthcare: [],
      savings: [],
    };
    for (const it of budgetItems) m[it.category].push(it);
    for (const c of CATEGORY_ORDER) {
      m[c].sort((a, b) => b.monthlyUSD - a.monthlyUSD);
    }
    return m;
  }, [budgetItems]);

  const subscriptions = useMemo(
    () => subscriptionItems(budgetItems),
    [budgetItems],
  );
  // Sort subscriptions by next billing date ASC so the soonest charge
  // is at top — the "what's coming next" framing matches the user's
  // inspiration screens. `nowAtMount` is captured once so the sort
  // ordering stays stable across re-renders.
  const [nowAtMount] = useState<number>(() => Date.now());
  const subscriptionsSorted = useMemo(() => {
    return [...subscriptions].sort((a, b) => {
      const an = nextBillingDate(a, nowAtMount)?.getTime() ?? Infinity;
      const bn = nextBillingDate(b, nowAtMount)?.getTime() ?? Infinity;
      return an - bn;
    });
  }, [subscriptions, nowAtMount]);
  const subscriptionMonthlyTotal = useMemo(
    () => subscriptions.reduce((s, it) => s + it.monthlyUSD, 0),
    [subscriptions],
  );

  const scopeLabel =
    selectedMemberId == null
      ? null
      : members.find((m) => m.id === selectedMemberId)?.displayName ?? null;

  const openCreator = (cat?: ExpenseCategory) => {
    setEditingId(null);
    setCreatorCategory(cat);
    setCreatorOpen(true);
  };

  const openEditor = (id: string) => {
    setCreatorCategory(undefined);
    setEditingId(id);
    setCreatorOpen(true);
  };

  const closeCreator = () => {
    setCreatorOpen(false);
    setEditingId(null);
    setCreatorCategory(undefined);
  };

  const applyToIndependenceTarget = () => {
    if (suggestedCorpus == null) return;
    const rounded = Math.round(suggestedCorpus);
    // Route to the right level: per-member override when a member
    // is filtered, household default otherwise. Matches the
    // setMemberAssumption / setAssumption split AssumptionsPanel
    // uses for the same field.
    if (selectedMemberId) {
      setMemberAssumption(selectedMemberId, "targetNetWorthUSD", rounded);
    } else {
      setAssumption("targetNetWorthUSD", rounded);
    }
  };

  // Same per-member-vs-household routing for the haircut slider.
  const setHaircut = (next: number) => {
    const clamped = clampHaircut(next);
    if (selectedMemberId) {
      setMemberAssumption(
        selectedMemberId,
        "retirementVariableHaircut",
        clamped,
      );
    } else {
      setAssumption("retirementVariableHaircut", clamped);
    }
  };

  const setTax = (next: number) => {
    const clamped = clampTaxRate(next);
    if (selectedMemberId) {
      setMemberAssumption(selectedMemberId, "retirementTaxRate", clamped);
    } else {
      setAssumption("retirementTaxRate", clamped);
    }
  };

  const targetMatchesSuggestion =
    suggestedCorpus != null &&
    Math.abs(assumptions.targetNetWorthUSD - suggestedCorpus) < 1;

  // Household view is read-only when any member has explicit
  // overrides — the target is auto-aggregated from members, so
  // "Apply to household Independence target" has no clean meaning (there's
  // no good way to split the suggestion back across members).
  // We disable the Apply button on that view with a hint.
  const householdAggregateMode =
    selectedMemberId == null &&
    Object.values(memberAssumptions).some(
      (o) => o != null && Object.keys(o).length > 0,
    );
  const applyDisabled = targetMatchesSuggestion || householdAggregateMode;

  return (
    <>
      {/* Summary card */}
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-text-dim">
              Monthly expenses
            </div>
            {scopeLabel && (
              <div className="text-[10px] uppercase tracking-wider text-accent">
                {scopeLabel} only
              </div>
            )}
          </div>
          <div className="num mt-1 text-3xl font-semibold text-text">
            {formatUSD(totals.monthlyUSD)}
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            <span className="num">{formatUSD(totals.annualUSD)}</span> / year
            across <span>{budgetItems.length}</span> line
            {budgetItems.length === 1 ? "" : "s"}
            {scopeLabel && (
              <> · switch member filter for the household total</>
            )}
          </div>

          {/* Fixed-vs-variable split. Fixed = essential to lifestyle
              (can't readily cut); variable = flex spending the user
              could trim in retirement or a downturn. Drives the
              emergency-fund dual-runway below and the Independence-corpus
              haircut slider. */}
          {totals.monthlyUSD > 0 && (
            <div className="mt-2 flex gap-2 text-[10px]">
              <div className="flex-1 rounded-md border border-amber-300/30 bg-amber-300/5 px-2 py-1.5">
                <div className="uppercase tracking-wider text-amber-300/90">
                  Fixed (essentials)
                </div>
                <div className="num mt-0.5 font-semibold text-amber-200">
                  {formatUSD(totals.fixedMonthlyUSD)}/mo
                </div>
              </div>
              <div className="flex-1 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2 py-1.5">
                <div className="uppercase tracking-wider text-emerald-400/90">
                  Variable (flex)
                </div>
                <div className="num mt-0.5 font-semibold text-emerald-300">
                  {formatUSD(totals.variableMonthlyUSD)}/mo
                </div>
              </div>
            </div>
          )}

          {/* Emergency fund — derived from monthly above. Dual runway:
              "current" uses total monthly burn; "essentials" uses
              fixed-only, modeling the user living lean. */}
          <EmergencyFundCard
            monthlyBurnUSD={totals.monthlyUSD}
            essentialsBurnUSD={totals.fixedMonthlyUSD}
          />

          {/* Retirement-spend haircut + tax rate: the two levers
              that shape the Independence-corpus suggestion beyond your
              monthly spend. Both live on `assumptions` and are
              per-member-overridable. Editing here writes to the
              same store field AssumptionsPanel uses — they stay
              in sync. */}
          {totals.variableMonthlyUSD > 0 && (
            <div className="mt-3 rounded-md border border-border-strong bg-bg-elevated px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-text-dim">
                  Retirement variable haircut
                </div>
                <div className="num text-[11px] font-semibold text-text">
                  {Math.round(variableHaircut * 100)}%
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(variableHaircut * 100)}
                onChange={(e) => setHaircut(Number(e.target.value) / 100)}
                className="mt-1.5 w-full accent-accent"
                aria-label="Variable expense haircut in retirement"
              />
              <div className="mt-1 text-[10px] leading-snug text-text-dim">
                How much of your <span className="text-emerald-300">variable</span>{" "}
                spending you expect to cut in retirement. Fixed expenses
                are untouched. Lower corpus needed → earlier Independence date.
              </div>
            </div>
          )}

          <div className="mt-3 rounded-md border border-border-strong bg-bg-elevated px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-text-dim">
                Retirement tax rate
              </div>
              <div className="num text-[11px] font-semibold text-text">
                {Math.round(taxRate * 100)}%
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(taxRate * 100)}
              onChange={(e) => setTax(Number(e.target.value) / 100)}
              className="mt-1.5 w-full accent-accent"
              aria-label="Retirement tax rate"
            />
            <div className="mt-1 text-[10px] leading-snug text-text-dim">
              Blended tax rate on withdrawals (Roth ≈ 0%, LTCG 0–20%,
              traditional 401k/IRA ordinary brackets). Withdrawals must
              be grossed up so your <em>net</em> spend equals your
              budget. Default {Math.round(DEFAULT_RETIREMENT_TAX_RATE * 100)}%.
            </div>
          </div>

          {suggestedCorpus != null && (
            <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-accent">
                Suggested independence corpus
                <span className="ml-1 text-text-dim">(today&apos;s dollars)</span>
              </div>
              <div className="num mt-0.5 text-xl font-semibold text-accent">
                {formatUSD(Math.round(suggestedCorpus))}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-accent/80">
                Net spend{" "}
                <span className="num">
                  {formatUSD(retirementAnnualEffective)}
                </span>
                /yr → grossed up at {Math.round(taxRate * 100)}% tax →{" "}
                <span className="num">
                  {formatUSD(Math.round(grossWithdrawalAnnual))}
                </span>
                /yr withdrawals ÷ SWR{" "}
                {(assumptions.withdrawalRate * 100).toFixed(1)}%
                {variableHaircut > 0 && (
                  <>
                    {" "}({Math.round(variableHaircut * 100)}% variable
                    haircut applied)
                  </>
                )}
              </div>
              {realExcessDrag != null && Math.abs(realExcessDrag) > 1_000 && (
                <div
                  className={`mt-1.5 text-[10px] leading-snug ${
                    realExcessDrag > 0 ? "text-amber-200" : "text-positive/90"
                  }`}
                >
                  {realExcessDrag > 0 ? "+" : "−"}
                  {formatUSD(Math.round(Math.abs(realExcessDrag)))} from
                  real-excess inflation
                  {realExcessDrag > 0
                    ? " — healthcare / housing growing above CPI in real terms drags the corpus larger. Adjust per-expense in Edit."
                    : " — net deflators (e.g. lifestyle) keep this slightly below the flat-CPI baseline."}
                </div>
              )}
              <button
                type="button"
                onClick={applyToIndependenceTarget}
                disabled={applyDisabled}
                className="mt-2 w-full rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-bg disabled:opacity-40 active:opacity-80"
              >
                {householdAggregateMode
                  ? "Filter to a member to apply"
                  : targetMatchesSuggestion
                    ? "Independence target already matches"
                    : `Apply to Independence target (${formatUSDCompact(assumptions.targetNetWorthUSD)} → ${formatUSDCompact(suggestedCorpus)})`}
              </button>
              <div className="mt-1.5 text-[10px] leading-snug text-text-dim">
                Excludes Savings category and any line marked &quot;ends at
                retirement&quot;. Each line uses its own real-excess
                inflation (0% = tracks CPI; healthcare ~2% real
                default). Edit your withdrawal rate on the Assumptions
                tab to recompute.
              </div>
            </div>
          )}

          {suggestedCorpus != null && Math.abs(blendedExcess) > 0.001 && (
            <div className="mt-2 rounded-md border border-border bg-bg-elevated px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">
                Blended real-excess inflation
              </div>
              <div className="num mt-0.5 text-base font-semibold text-text">
                {blendedExcess > 0 ? "+" : ""}
                {(blendedExcess * 100).toFixed(2)}% real / yr
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-text-dim">
                Spend-weighted average across retirement-relevant lines.
                Apply it to your SWR ({(assumptions.withdrawalRate * 100).toFixed(2)}%) and
                projection math everywhere will use the inflation-
                adjusted rate ({(proposedSwr * 100).toFixed(2)}%) going forward.
              </div>
              <button
                type="button"
                onClick={bakeBlendedIntoSwr}
                disabled={proposedSwrMatchesCurrent || householdAggregateMode}
                className="mt-2 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent disabled:opacity-40 active:opacity-70"
              >
                {householdAggregateMode
                  ? "Filter to a member to bake inflation"
                  : proposedSwrMatchesCurrent
                    ? "SWR already inflation-adjusted"
                    : `Bake into SWR (${(assumptions.withdrawalRate * 100).toFixed(2)}% → ${(proposedSwr * 100).toFixed(2)}%)`}
              </button>
              <div className="mt-1 text-[10px] leading-snug text-text-dim">
                Trinity SWR assumes a {PLANNING_HORIZON_YEARS}-year retirement.
                If your blended excess equals your SWR, the perpetuity
                limit kicks in — the floor at 0.1% prevents an
                infinite-corpus answer.
              </div>
            </div>
          )}

          {budgetItems.length === 0 && (
            <div className="mt-3 rounded-md border border-dashed border-border-strong bg-bg-elevated px-3 py-3 text-[11px] text-text-dim">
              Add your monthly expenses below — they roll up to a suggested
              independence corpus you can apply to your plan in one tap.
            </div>
          )}
        </div>
      </section>

      {/* View toggle: All expenses vs Subscriptions */}
      {(subscriptions.length > 0 || view === "subscriptions") && (
        <section className="px-5 pt-3">
          <div
            role="tablist"
            aria-label="Budget view"
            className="flex gap-1 rounded-full border border-border bg-bg-surface p-1"
          >
            <ViewTab
              label="All expenses"
              count={budgetItems.length}
              active={view === "all"}
              onClick={() => setView("all")}
            />
            <ViewTab
              label="Subscriptions"
              count={subscriptions.length}
              active={view === "subscriptions"}
              onClick={() => setView("subscriptions")}
            />
          </div>
        </section>
      )}

      {view === "all" &&
        CATEGORY_ORDER.map((c) => (
          <CategorySection
            key={c}
            category={c}
            items={grouped[c]}
            total={totals.byCategory[c]}
            members={members}
            showOwner={selectedMemberId == null && members.length > 1}
            onAdd={() => openCreator(c)}
            onEdit={openEditor}
          />
        ))}

      {view === "subscriptions" && (
        <SubscriptionsList
          items={subscriptionsSorted}
          monthlyTotal={subscriptionMonthlyTotal}
          members={members}
          showOwner={selectedMemberId == null && members.length > 1}
          now={nowAtMount}
          onAdd={() => openCreator()}
          onEdit={openEditor}
        />
      )}

      {creatorOpen && (
        <BudgetItemCreator
          onClose={closeCreator}
          initialCategory={creatorCategory}
          editingId={editingId}
        />
      )}
    </>
  );
}


function ViewTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition active:opacity-70 ${
        active
          ? "bg-accent text-bg"
          : "text-text-muted hover:text-text"
      }`}
    >
      {label}
      <span
        className={`num ml-1 text-[10px] ${active ? "opacity-80" : "opacity-60"}`}
      >
        {count}
      </span>
    </button>
  );
}

