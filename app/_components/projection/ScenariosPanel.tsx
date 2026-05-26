"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { NumberField } from "@/app/_components/ui/NumberField";
import { runScenarios } from "@/lib/insights/scenarios";
import { projectIndependence } from "@/lib/projection/independence";
import { resolveAssumptionsForMember } from "@/lib/projection/useActiveProjection";
import {
  filterHousehold,
  type Account,
  type Assumptions,
  type Holding,
  type ScenarioOverrides,
} from "@/lib/types";
import {
  formatMonthYear,
  formatPercent,
  formatUSD,
  formatUSDCompact,
  formatYearsMonths,
} from "@/lib/format";

export function ScenariosPanel() {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const householdAssumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const scenarios = useAppStore((s) => s.scenarios);
  const removeScenario = useAppStore((s) => s.removeScenario);
  const activeScenarioId = useAppStore((s) => s.activeScenarioId);
  const setActiveScenario = useAppStore((s) => s.setActiveScenario);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterHousehold(household, memberId),
    [household, memberId],
  );

  // Effective per-member assumptions — scenarios get applied on top
  // of the user's actual (possibly member-overridden) plan, not a
  // ghost household-default plan they aren't actually viewing.
  const assumptions = useMemo(
    () =>
      resolveAssumptionsForMember(
        householdAssumptions,
        memberAssumptions,
        memberId,
      ),
    [householdAssumptions, memberAssumptions, memberId],
  );

  const baseline = useMemo(
    () => projectIndependence(filtered, assumptions),
    [filtered, assumptions],
  );

  const runs = useMemo(
    () => runScenarios(filtered, assumptions, scenarios),
    [filtered, assumptions, scenarios],
  );

  return (
    <section className="px-5 pt-6 pb-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Scenarios
        </h2>
        {!creating && !editingId && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent active:opacity-70"
          >
            + What-if
          </button>
        )}
      </div>

      <p className="mb-3 px-1 text-[11px] text-text-dim">
        Build alternate plans without changing your actual data. Each scenario
        can override individual account contributions, per-holding CAGR, your
        target NW, or your withdrawal rate. Pick one from the chip row on the
        Home page to see the projection through that lens — target NW + WR
        overrides also flow into the Stress test&apos;s starting NW and annual
        spend defaults.
      </p>

      <div className="rounded-2xl border border-border bg-bg-surface">
        <BaselineRow
          baseline={baseline}
          active={activeScenarioId == null}
          onSelect={() => setActiveScenario(null)}
        />

        {runs.length === 0 && !creating && (
          <div className="px-4 py-4 text-[11px] text-text-dim">
            No scenarios yet. Tap &quot;+ What-if&quot; to create one.
          </div>
        )}

        {runs.map((run) =>
          editingId === run.scenario.id ? (
            <ScenarioEditor
              key={run.scenario.id}
              filtered={filtered}
              assumptions={assumptions}
              scenarioId={run.scenario.id}
              initialOverrides={run.scenario.overrides}
              initialName={run.scenario.name}
              onClose={() => setEditingId(null)}
            />
          ) : (
            <ScenarioRow
              key={run.scenario.id}
              run={run}
              baselineMonthsToIndependence={baseline.monthsToIndependence}
              active={activeScenarioId === run.scenario.id}
              onSelect={() => setActiveScenario(run.scenario.id)}
              onEdit={() => setEditingId(run.scenario.id)}
              onRemove={() => removeScenario(run.scenario.id)}
            />
          ),
        )}

        {creating && (
          <ScenarioEditor
            filtered={filtered}
            assumptions={assumptions}
            scenarioId={null}
            initialOverrides={{}}
            initialName="What if I save more"
            onClose={() => setCreating(false)}
          />
        )}
      </div>
    </section>
  );
}

function BaselineRow({
  baseline,
  active,
  onSelect,
}: {
  baseline: ReturnType<typeof projectIndependence>;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left active:opacity-80 ${
        active ? "bg-accent/5" : ""
      }`}
    >
      <div>
        <div
          className={`text-sm font-medium ${
            active ? "text-accent" : "text-text"
          }`}
        >
          Baseline
        </div>
        <div className="mt-0.5 text-[11px] text-text-muted">
          Your actual accounts and assumptions
        </div>
      </div>
      <div className="text-right">
        <div className="num text-sm font-semibold text-accent">
          {baseline.independenceDate ? formatMonthYear(baseline.independenceDate) : "—"}
        </div>
        <div className="text-[11px] text-text-muted">
          {baseline.monthsToIndependence == null
            ? "Out of reach"
            : baseline.monthsToIndependence === 0
              ? "Already there"
              : formatYearsMonths(baseline.monthsToIndependence)}
        </div>
      </div>
    </button>
  );
}

function ScenarioRow({
  run,
  baselineMonthsToIndependence,
  active,
  onSelect,
  onEdit,
  onRemove,
}: {
  run: ReturnType<typeof runScenarios>[number];
  baselineMonthsToIndependence: number | null;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { scenario, projection } = run;
  const delta =
    baselineMonthsToIndependence != null && projection.monthsToIndependence != null
      ? baselineMonthsToIndependence - projection.monthsToIndependence
      : null;
  return (
    <div
      className={`border-b border-border last:border-b-0 ${
        active ? "bg-accent/5" : ""
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:opacity-80"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: scenario.color }}
            />
            <span
              className={`truncate text-sm font-medium ${
                active ? "text-accent" : "text-text"
              }`}
            >
              {scenario.name}
            </span>
          </div>
          <OverrideSummary overrides={scenario.overrides} />
        </div>
        <div className="text-right">
          <div className="num text-sm font-semibold text-accent">
            {projection.independenceDate
              ? formatMonthYear(projection.independenceDate)
              : "—"}
          </div>
          <div className="text-[11px] text-text-muted">
            {projection.monthsToIndependence == null
              ? "Out of reach"
              : projection.monthsToIndependence === 0
                ? "Already there"
                : formatYearsMonths(projection.monthsToIndependence)}
            {delta != null && delta !== 0 && (
              <span
                className={`ml-1 font-medium ${
                  delta > 0 ? "text-positive" : "text-negative"
                }`}
              >
                ({delta > 0 ? "−" : "+"}
                {formatYearsMonths(Math.abs(delta))})
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="flex items-center justify-end gap-3 px-4 pb-2 text-[11px]">
        <button
          type="button"
          onClick={onEdit}
          className="text-text-muted hover:text-text active:opacity-70"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-text-dim hover:text-negative active:opacity-70"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function OverrideSummary({ overrides }: { overrides: ScenarioOverrides }) {
  const parts: string[] = [];
  if (
    overrides.contributionMultiplier != null &&
    overrides.contributionMultiplier !== 1
  ) {
    const pct = (overrides.contributionMultiplier - 1) * 100;
    parts.push(`${pct > 0 ? "+" : ""}${pct.toFixed(0)}% contributions`);
  }
  if (overrides.cagrDelta != null && overrides.cagrDelta !== 0) {
    parts.push(
      `${overrides.cagrDelta > 0 ? "+" : ""}${(overrides.cagrDelta * 100).toFixed(1)}pt CAGR`,
    );
  }
  if (overrides.accountContributions) {
    const n = Object.keys(overrides.accountContributions).length;
    if (n > 0) parts.push(`${n} account${n === 1 ? "" : "s"} edited`);
  }
  if (overrides.holdingCAGRs) {
    const n = Object.keys(overrides.holdingCAGRs).length;
    if (n > 0) parts.push(`${n} CAGR override${n === 1 ? "" : "s"}`);
  }
  if (overrides.withdrawalRate != null) {
    parts.push(`${formatPercent(overrides.withdrawalRate)} draw`);
  }
  if (overrides.targetNetWorthUSD != null) {
    parts.push(`${formatUSDCompact(overrides.targetNetWorthUSD)} target`);
  }
  return (
    <div className="mt-0.5 text-[11px] text-text-muted">
      {parts.length === 0 ? "No overrides" : parts.join(" · ")}
    </div>
  );
}

function ScenarioEditor({
  filtered,
  assumptions,
  scenarioId,
  initialOverrides,
  initialName,
  onClose,
}: {
  filtered: { accounts: Account[] };
  assumptions: Assumptions;
  scenarioId: string | null;
  initialOverrides: ScenarioOverrides;
  initialName: string;
  onClose: () => void;
}) {
  const addScenario = useAppStore((s) => s.addScenario);
  const updateScenario = useAppStore((s) => s.updateScenario);

  const [name, setName] = useState(initialName);
  const [globalCagrDelta, setGlobalCagrDelta] = useState<number>(
    (initialOverrides.cagrDelta ?? 0) * 100,
  );
  const [globalContribMult, setGlobalContribMult] = useState<number>(
    ((initialOverrides.contributionMultiplier ?? 1) - 1) * 100,
  );
  const [accountContribs, setAccountContribs] = useState<
    Record<string, number>
  >(initialOverrides.accountContributions ?? {});
  const [holdingCAGRs, setHoldingCAGRs] = useState<Record<string, number>>(
    initialOverrides.holdingCAGRs ?? {},
  );
  // Plan-target overrides. `null` = inherit the user's base assumption;
  // a number = override. Stored as nullable so the editor distinguishes
  // "not overridden" from "overridden to the same value as base."
  // Without that distinction, opening an unedited scenario and saving
  // it would silently bake the current base value into the override,
  // freezing it against future plan changes.
  const [withdrawalRate, setWithdrawalRate] = useState<number | null>(
    initialOverrides.withdrawalRate ?? null,
  );
  const [targetNetWorthUSD, setTargetNetWorthUSD] = useState<number | null>(
    initialOverrides.targetNetWorthUSD ?? null,
  );

  const submit = () => {
    if (name.trim().length === 0) return;
    const overrides: ScenarioOverrides = {};
    if (globalContribMult !== 0) {
      overrides.contributionMultiplier = 1 + globalContribMult / 100;
    }
    if (globalCagrDelta !== 0) {
      overrides.cagrDelta = globalCagrDelta / 100;
    }
    if (Object.keys(accountContribs).length > 0) {
      overrides.accountContributions = accountContribs;
    }
    if (Object.keys(holdingCAGRs).length > 0) {
      overrides.holdingCAGRs = holdingCAGRs;
    }
    if (withdrawalRate !== null) {
      overrides.withdrawalRate = withdrawalRate;
    }
    if (targetNetWorthUSD !== null) {
      overrides.targetNetWorthUSD = targetNetWorthUSD;
    }
    if (scenarioId) {
      updateScenario(scenarioId, { name: name.trim(), overrides });
    } else {
      addScenario({ name: name.trim(), overrides });
    }
    onClose();
  };

  const onAccountContribChange = (id: string, val: number, base: number) => {
    setAccountContribs((cur) => {
      const next = { ...cur };
      if (val === base) delete next[id];
      else next[id] = val;
      return next;
    });
  };

  const onHoldingCagrChange = (id: string, val: number, base: number) => {
    setHoldingCAGRs((cur) => {
      const next = { ...cur };
      if (Math.abs(val - base) < 1e-6) delete next[id];
      else next[id] = val;
      return next;
    });
  };

  return (
    <div className="border-b border-border bg-bg-elevated px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {scenarioId ? "Edit scenario" : "New scenario"}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-text-muted active:opacity-70"
        >
          Cancel
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-3 w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
      />

      <div className="mt-4">
        <SectionHead title="Global" subtitle="Applies on top of every account / holding" />
        <Slider
          label="All contributions"
          value={globalContribMult}
          onChange={setGlobalContribMult}
          min={-100}
          max={200}
          step={5}
          format={(v) => `${v >= 0 ? "+" : ""}${v}%`}
        />
        <Slider
          label="All holdings CAGR"
          value={globalCagrDelta}
          onChange={setGlobalCagrDelta}
          min={-5}
          max={5}
          step={0.5}
          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pt`}
        />
      </div>

      {/* Plan-target overrides. These are the ONLY scenario fields
          that flow into the Stress test's Historical Monte Carlo (the
          sim draws returns from the historical dataset, so CAGR /
          contribution overrides have no effect there). Surfacing them
          here lets users build MC-affecting scenarios — without these
          controls, every scenario was silently a no-op for MC, which
          felt like a broken cascade. */}
      <div className="mt-5">
        <SectionHead
          title="Plan targets"
          subtitle="Withdrawal rate + target NW (also flows into Stress test defaults)"
        />
        <AssumptionOverrideRow
          label="Withdrawal rate"
          baseLabel={formatPercent(assumptions.withdrawalRate)}
          overridden={withdrawalRate !== null}
          onClear={() => setWithdrawalRate(null)}
          value={(withdrawalRate ?? assumptions.withdrawalRate) * 100}
          onChange={(v) => setWithdrawalRate(v / 100)}
          suffix="%"
          precision={2}
          numberFieldClassName="w-14"
        />
        <AssumptionOverrideRow
          label="Target NW"
          baseLabel={formatUSD(assumptions.targetNetWorthUSD)}
          overridden={targetNetWorthUSD !== null}
          onClear={() => setTargetNetWorthUSD(null)}
          value={targetNetWorthUSD ?? assumptions.targetNetWorthUSD}
          onChange={(v) => setTargetNetWorthUSD(v)}
          prefix="$"
          precision={0}
          numberFieldClassName="w-24"
        />
      </div>

      <div className="mt-5">
        <SectionHead
          title="Per-account contributions"
          subtitle="Override the monthly contribution amount"
        />
        <div className="space-y-2">
          {filtered.accounts.map((a) => {
            const overridden = a.id in accountContribs;
            const value = overridden ? accountContribs[a.id] : a.monthlyContributionUSD;
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-text">
                    {a.displayName}
                  </div>
                  <div className="mt-0.5 text-[10px] text-text-dim">
                    base {formatUSD(a.monthlyContributionUSD)}/mo
                  </div>
                </div>
                <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
                  <span className="text-xs text-text-muted">$</span>
                  <NumberField
                    value={value}
                    onChange={(v) =>
                      onAccountContribChange(
                        a.id,
                        v,
                        a.monthlyContributionUSD,
                      )
                    }
                    precision={0}
                    allowNegative={false}
                    className={`num w-20 bg-transparent text-right text-xs font-medium outline-none ${
                      overridden ? "text-accent" : "text-text"
                    }`}
                  />
                  <span className="text-xs text-text-muted">/mo</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <SectionHead
          title="Per-holding CAGR"
          subtitle="Override expected real CAGR for individual holdings"
        />
        <div className="space-y-2">
          {filtered.accounts.flatMap((a) =>
            a.holdings.map((h) => (
              <HoldingCagrRow
                key={h.id}
                account={a}
                holding={h}
                overridden={h.id in holdingCAGRs}
                value={
                  h.id in holdingCAGRs ? holdingCAGRs[h.id] : h.expectedRealCAGR
                }
                onChange={(v) =>
                  onHoldingCagrChange(h.id, v, h.expectedRealCAGR)
                }
              />
            )),
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg active:opacity-80"
      >
        {scenarioId ? "Save changes" : "Add scenario"}
      </button>
    </div>
  );
}

function HoldingCagrRow({
  account,
  holding,
  overridden,
  value,
  onChange,
}: {
  account: Account;
  holding: Holding;
  overridden: boolean;
  value: number;
  onChange: (v: number) => void;
}) {
  const symbol =
    holding.kind === "cash"
      ? "Cash"
      : holding.kind === "real_estate" || holding.kind === "other"
        ? holding.name
        : holding.symbol;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-surface px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-text">{symbol}</div>
        <div className="mt-0.5 text-[10px] text-text-dim">
          {account.displayName} · base {formatPercent(holding.expectedRealCAGR)}
        </div>
      </div>
      <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
        <NumberField
          value={value * 100}
          onChange={(pct) => onChange(pct / 100)}
          precision={2}
          className={`num w-16 bg-transparent text-right text-xs font-medium outline-none ${
            overridden ? "text-accent" : "text-text"
          }`}
        />
        <span className="text-xs text-text-muted">%</span>
      </span>
    </div>
  );
}

/**
 * Inline editor for a single plan-target override (withdrawal rate or
 * target NW). Shows the base value as a hint + a NumberField that
 * activates the override when edited. The "Use base" button clears
 * the override so the scenario inherits any future changes to the
 * user's base assumption (a stored numeric override would freeze the
 * value against future plan tweaks, which is rarely what the user
 * wants).
 */
function AssumptionOverrideRow({
  label,
  baseLabel,
  overridden,
  onClear,
  value,
  onChange,
  prefix,
  suffix,
  precision,
  numberFieldClassName,
}: {
  label: string;
  baseLabel: string;
  overridden: boolean;
  onClear: () => void;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  precision: number;
  numberFieldClassName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-surface px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-text">{label}</div>
        <div className="mt-0.5 text-[10px] text-text-dim">base {baseLabel}</div>
      </div>
      <div className="flex items-center gap-2">
        {overridden && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-text-muted hover:text-text active:opacity-70"
          >
            Use base
          </button>
        )}
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
          {prefix && <span className="text-xs text-text-muted">{prefix}</span>}
          <NumberField
            value={value}
            onChange={onChange}
            precision={precision}
            allowNegative={false}
            className={`num ${numberFieldClassName} bg-transparent text-right text-xs font-medium outline-none ${
              overridden ? "text-accent" : "text-text"
            }`}
          />
          {suffix && <span className="text-xs text-text-muted">{suffix}</span>}
        </span>
      </div>
    </div>
  );
}

function SectionHead({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-2">
      <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {title}
      </div>
      <div className="mt-0.5 text-[11px] text-text-dim">{subtitle}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>{label}</span>
        <span className="num font-medium text-text">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
    </div>
  );
}
