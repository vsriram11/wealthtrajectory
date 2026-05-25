"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { ageHousehold } from "@/lib/portfolio/futureAllocation";
import {
  computePortfolio,
  sliceMetrics,
  type GeoScope,
} from "@/lib/portfolio/portfolio";
import {
  formatLeverage,
  formatPercent,
  formatPercentTight,
  formatUSD,
  formatUSDCompact,
} from "@/lib/format";
import {
  filterHouseholdByTaxBucket,
  householdNetWorth,
  type AssetClass,
  type Household,
  type TaxTreatment,
} from "@/lib/types";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import {
  filterHouseholdByClass,
  leverageBuckets,
} from "@/lib/portfolio/leverageBuckets";
import { LiquidityChip } from "@/app/_components/ui/LiquidityChip";
import { LiquidOnlyCaption, useLiquidExclusions } from "@/app/_components/shell/LiquidOnlyCaption";
import { TaxBuckets } from "./TaxBuckets";
import {
  BasisToggle,
  Chevron,
  Metric,
  sliceLabel,
} from "@/app/_components/allocation/allocation-views/helpers";
import { EquityView } from "@/app/_components/allocation/allocation-views/EquityView";
import { BondView } from "@/app/_components/allocation/allocation-views/BondView";
import { CashView } from "@/app/_components/allocation/allocation-views/CashView";
import { CryptoView } from "@/app/_components/allocation/allocation-views/CryptoView";
import { CommodityView } from "@/app/_components/allocation/allocation-views/CommodityView";
import { RealEstateView } from "@/app/_components/allocation/allocation-views/RealEstateView";
import { PrivateStockView } from "@/app/_components/allocation/allocation-views/PrivateStockView";
import { OtherView } from "@/app/_components/allocation/allocation-views/OtherView";

type ClassTab = "ALL" | AssetClass;

export function AllocationPanel() {
  // Use the canonical active-projection resolver so member +
  // liquidity + active-SCENARIO overrides all flow into this page.
  // Reading `state.household` directly here was the historical bug
  // (issue #11) — scenario contribution / CAGR overrides never
  // reached the allocation views because the scenario merge happens
  // inside `useActiveProjection`, not on the raw store slice.
  const { household: baseHousehold } = useActiveProjection();
  const basis = useAppStore((s) => s.viewBasis);
  const setBasis = useAppStore((s) => s.setViewBasis);
  // When the user has tapped "Apply above" on AllocationFutureCard,
  // re-root every downstream calculation to the household as it
  // would look `appliedFutureYears` years from now (every holding
  // aged forward at its expectedRealCAGR, contributions
  // accumulated, liabilities amortized). The future projection
  // composes cleanly with member + liquidity + tax-bucket filters
  // — we age the already-filtered subset, so a member-scoped
  // future view reflects what that member will look like.
  const appliedFutureYears = useAppStore((s) => s.appliedFutureYears);
  const setAppliedFutureYears = useAppStore(
    (s) => s.setAppliedFutureYears,
  );

  // Tax-bucket filter (selectedTaxBucket below) is local to this
  // page: the user taps a bucket in the TaxBuckets card to scope
  // every downstream number — NW, leverage breakdown, class
  // breakdown, metrics — to just that tax treatment. Composable
  // with member + liquid + scenario filters that
  // `useActiveProjection()` already applied upstream.
  const [selectedTaxBucket, setSelectedTaxBucket] =
    useState<TaxTreatment | null>(null);

  // Two-stage filtering: the "pre-tax-bucket" view feeds the
  // TaxBuckets card itself (it needs to show ALL buckets so the
  // user can pick from them — otherwise selecting one would
  // collapse the picker). The "fully filtered" view feeds every
  // other card on the page (NW, leverage, allocation, metrics).
  const householdMemberLiquid = useMemo(() => {
    let h = baseHousehold;
    // Age forward when the user has applied a future state. The
    // member + liquidity + scenario filters are already baked into
    // `baseHousehold` via the resolver.
    if (appliedFutureYears != null && appliedFutureYears > 0) {
      h = ageHousehold(h, appliedFutureYears);
    }
    return h;
  }, [baseHousehold, appliedFutureYears]);

  const filteredHousehold = useMemo(
    () =>
      filterHouseholdByTaxBucket(householdMemberLiquid, selectedTaxBucket),
    [householdMemberLiquid, selectedTaxBucket],
  );

  const m = useMemo(
    () => computePortfolio(filteredHousehold),
    [filteredHousehold],
  );

  const classTab = useAppStore((s) => s.allocClassTab);
  const geoScope = useAppStore((s) => s.allocGeoScope);
  const setClassTab = useAppStore((s) => s.setAllocClassTab);
  const setGeoScope = useAppStore((s) => s.setAllocGeoScope);

  const slice = useMemo(
    () => sliceMetrics(filteredHousehold, classTab, geoScope),
    [filteredHousehold, classTab, geoScope],
  );

  if (m.netWorthUSD === 0) return null;

  const showBasisToggle = classTab === "equity" || classTab === "bond";
  // Crypto and real estate carry no geographic attribution, so their
  // region tabs would be empty. Hide GeoTabs in those views.
  const showGeoTabs =
    classTab === "equity" || classTab === "bond" || classTab === "cash";

  return (
    <section className="px-5 pt-6">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Allocation{" "}
          {appliedFutureYears != null && appliedFutureYears > 0 && (
            <span className="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tracking-normal text-accent">
              future +{appliedFutureYears}y
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <LiquidityChip />
          {showBasisToggle && <BasisToggle basis={basis} onChange={setBasis} />}
        </div>
      </div>

      {/* Future-state banner — only renders when the user has
          applied a future horizon via AllocationFutureCard below.
          Surfaces the active state at the TOP of the page so users
          can't miss that the numbers below are projected, and
          gives a one-tap reset to today. */}
      {appliedFutureYears != null && appliedFutureYears > 0 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
          <div className="text-[11px] leading-snug text-accent">
            Showing projected state at{" "}
            <span className="font-semibold">+{appliedFutureYears} years</span>.
            Every holding aged at its real CAGR, contributions
            compounded, liabilities amortized.
          </div>
          <button
            type="button"
            onClick={() => setAppliedFutureYears(null)}
            className="shrink-0 rounded-full border border-accent/40 px-2.5 py-0.5 text-[10px] font-medium text-accent transition hover:bg-accent/10 active:opacity-70"
          >
            Today
          </button>
        </div>
      )}

      {/* NW summary at the top — same filters as everywhere else
          (member + liquid). Same headline shape as the home page
          but trimmed for the Allocation context. Designed to be
          the screenshot anchor for "Can this couple retire with
          $X" YouTube content — the chart below tells the story
          of how the NW is composed; this is the headline. */}
      {/* NW summary anchors on the member/household total (member +
          liquid filters applied, but NOT the tax-bucket filter).
          The user explicitly wanted this card to be a stable
          headline — when they tap a tax bucket below, the rest of
          the page rescopes but the NW headline stays put. The
          bucket selection is what's variable; the NW is the
          anchor. */}
      <NetWorthSummary household={householdMemberLiquid} />

      {/* TaxBuckets sits directly under the NW headline so a single
          screenshot captures NW + tax-shelter composition above
          the allocation pie. Each row is tappable: select a bucket
          to scope the rest of the page (NW summary, leverage
          breakdown, allocation chart, metrics) to that bucket only.
          Same UX as the global member filter — select to focus,
          tap again to clear. */}
      <div className="-mx-5">
        <TaxBuckets
          household={householdMemberLiquid}
          selected={selectedTaxBucket}
          onSelect={setSelectedTaxBucket}
        />
      </div>

      {/* mt-3 to match the vertical rhythm everywhere else on the
          page — each card sits at section-padding pt-3 from the
          one above it. Without this the rounded Allocation card
          butted right against TaxBuckets with zero breathing room. */}
      <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-4">
        <ClassTabs
          value={classTab}
          onChange={(v) => {
            setClassTab(v);
            if (v === "ALL") setGeoScope("ALL");
          }}
          breakdown={m.classes}
        />

        {showGeoTabs && (
          <div className="mt-3">
            <GeoTabs
              value={geoScope}
              onChange={setGeoScope}
              shares={
                classTab === "equity"
                  ? m.equity.geography
                  : classTab === "bond"
                    ? m.bond.geography
                    : m.cash.geography
              }
            />
          </div>
        )}

        {/* Leverage-bucket breakdown — first content under each
            tab. Scopes to the active tab's asset class (ALL =
            entire filtered household) so the bar reflects exactly
            what the user is looking at. Designed to share visual
            DNA with the class-breakdown bar a few lines below. */}
        <div className="mt-4">
          <LeverageBreakdownView
            household={filteredHousehold}
            classTab={classTab}
          />
        </div>

        <div className="mt-4">
          {classTab === "ALL" && <ClassBreakdownView portfolio={m} />}
          {classTab === "equity" && (
            <EquityView portfolio={m} basis={basis} scope={geoScope} />
          )}
          {classTab === "bond" && <BondView portfolio={m} scope={geoScope} />}
          {classTab === "cash" && <CashView portfolio={m} scope={geoScope} />}
          {classTab === "crypto" && (
            <CryptoView household={filteredHousehold} portfolio={m} />
          )}
          {classTab === "commodity" && (
            <CommodityView household={filteredHousehold} portfolio={m} />
          )}
          {classTab === "real_estate" && (
            <RealEstateView household={filteredHousehold} portfolio={m} />
          )}
          {classTab === "private_stock" && (
            <PrivateStockView household={filteredHousehold} portfolio={m} />
          )}
          {classTab === "other" && (
            <OtherView household={filteredHousehold} portfolio={m} />
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric
          label={
            classTab === "ALL" && geoScope === "ALL"
              ? "Effective leverage"
              : `Leverage · ${sliceLabel(classTab, geoScope)}`
          }
          value={formatLeverage(slice.effectiveLeverage)}
          sub={`${formatUSDCompact(slice.effectiveExposureUSD)} exposure on ${formatUSDCompact(slice.totalUSD)}`}
          valueClass={`num text-2xl font-semibold ${
            slice.effectiveLeverage <= 1.25
              ? "text-text"
              : slice.effectiveLeverage <= 2
                ? "text-amber-300"
                : "text-negative"
          }`}
        />
        <Metric
          label={
            classTab === "ALL" && geoScope === "ALL"
              ? "Real CAGR"
              : `Real CAGR · ${sliceLabel(classTab, geoScope)}`
          }
          value={formatPercent(slice.weightedRealCAGR)}
          sub={
            classTab === "ALL" && geoScope === "ALL"
              ? "Weighted across all holdings"
              : "Weighted across selection"
          }
          valueClass="num text-2xl font-semibold text-accent"
        />
      </div>
    </section>
  );
}

function ClassTabs({
  value,
  onChange,
  breakdown,
}: {
  value: ClassTab;
  onChange: (v: ClassTab) => void;
  breakdown: ReturnType<typeof computePortfolio>["classes"];
}) {
  const tabs: { id: ClassTab; label: string; share?: number }[] = [
    { id: "ALL", label: "All" },
    { id: "equity", label: "Stocks", share: breakdown.equityShare },
    { id: "bond", label: "Bonds", share: breakdown.bondShare },
    { id: "cash", label: "Cash", share: breakdown.cashShare },
    { id: "crypto", label: "Crypto", share: breakdown.cryptoShare },
    { id: "commodity", label: "Commodities", share: breakdown.commodityShare },
    { id: "real_estate", label: "Real estate", share: breakdown.realEstateShare },
    {
      id: "private_stock",
      label: "Private",
      share: breakdown.privateStockShare,
    },
    { id: "other", label: "Other", share: breakdown.otherShare },
  ];
  // The 8 class tabs don't fit on narrow phones at flex-1 widths, so
  // we let the row scroll horizontally with `hide-scrollbar` for a
  // clean look and `shrink-0` per-tab. Tabs keep a sensible minimum
  // width so labels never get clipped, and the active tab scrolls
  // into view via scroll-snap.
  return (
    <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-elevated p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`shrink-0 snap-start rounded-full px-3 py-1.5 text-[11px] font-medium leading-tight transition active:opacity-70 ${
            value === t.id
              ? "bg-accent/15 text-accent"
              : "text-text-muted hover:text-text"
          }`}
        >
          <div>{t.label}</div>
          {t.share != null && t.share > 0 && (
            <div className="num text-[9px] opacity-70">
              {formatPercentTight(t.share)}%
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function GeoTabs({
  value,
  onChange,
  shares,
}: {
  value: GeoScope;
  onChange: (v: GeoScope) => void;
  shares: Record<"US" | "DEVELOPED" | "EMERGING", number>;
}) {
  const tabs: { id: GeoScope; label: string; share?: number }[] = [
    { id: "ALL", label: "All" },
    { id: "US", label: "US", share: shares.US },
    { id: "DEVELOPED", label: "Developed", share: shares.DEVELOPED },
    { id: "EMERGING", label: "Emerging", share: shares.EMERGING },
  ];
  return (
    <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-elevated p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`shrink-0 snap-start rounded-full px-3 py-1.5 text-[11px] font-medium leading-tight transition active:opacity-70 ${
            value === t.id
              ? "bg-accent/15 text-accent"
              : "text-text-muted hover:text-text"
          }`}
        >
          <div>{t.label}</div>
          {t.share != null && t.share > 0 && t.id !== "ALL" && (
            <div className="num text-[9px] opacity-70">
              {formatPercentTight(t.share)}%
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function ClassBreakdownView({
  portfolio,
}: {
  portfolio: ReturnType<typeof computePortfolio>;
}) {
  const { classes } = portfolio;
  const segs = [
    { key: "equity", label: "Stocks", share: classes.equityShare, usd: classes.equityUSD, color: "#38bdf8" },
    { key: "bond", label: "Bonds", share: classes.bondShare, usd: classes.bondUSD, color: "#a78bfa" },
    { key: "cash", label: "Cash", share: classes.cashShare, usd: classes.cashUSD, color: "#64748b" },
    { key: "crypto", label: "Crypto", share: classes.cryptoShare, usd: classes.cryptoUSD, color: "#f59e0b" },
    { key: "commodity", label: "Commodities", share: classes.commodityShare, usd: classes.commodityUSD, color: "#fbbf24" },
    { key: "real_estate", label: "Real estate", share: classes.realEstateShare, usd: classes.realEstateUSD, color: "#10b981" },
    { key: "private_stock", label: "Private stock", share: classes.privateStockShare, usd: classes.privateStockUSD, color: "#ec4899" },
    { key: "other", label: "Other", share: classes.otherShare, usd: classes.otherUSD, color: "#94a3b8" },
  ];
  const visible = segs.filter((s) => s.share > 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-bg-elevated">
        {visible.map((s) => (
          <div
            key={s.key}
            style={{ width: `${s.share * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-2">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-text">{s.label}</span>
            </span>
            <span className="num flex items-baseline gap-2 text-text-muted">
              <span className="font-medium text-text">
                {formatPercent(s.share)}
              </span>
              <span className="text-[11px] text-text-dim">
                {formatUSD(s.usd)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* NetWorthSummary — top-of-page headline + caption.                */
/* --------------------------------------------------------------- */
function NetWorthSummary({ household }: { household: Household }) {
  const memberId = useAppStore((s) => s.selectedMemberId);
  const exclusions = useLiquidExclusions(memberId);

  const nw = householdNetWorth(household);

  if (nw === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-border bg-bg-surface px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        Net worth
      </div>
      <div className="num mt-1 text-3xl font-semibold text-text">
        {formatUSD(nw)}
      </div>
      <LiquidOnlyCaption memberId={memberId} />
      {/* The two captions are mutually exclusive — when there's nothing
          illiquid to show, the member-filter line fills the same slot. */}
      {exclusions.length === 0 && memberId && (
        <div className="mt-1 text-[11px] text-text-dim">
          Filtered to one member
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- */
/* LeverageBreakdownView — face-value buckets matching the          */
/* ClassBreakdownView visual.                                       */
/* --------------------------------------------------------------- */
function LeverageBreakdownView({
  household,
  classTab,
}: {
  household: Household;
  classTab: ClassTab;
}) {
  const breakdown = useMemo(
    () => leverageBuckets(filterHouseholdByClass(household, classTab)),
    [household, classTab],
  );
  // Per-row expand state, keyed by bucket. Collapsed by default so
  // the row stays single-line and screenshot-clean; users tap the
  // chevron when they want the explanation.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (breakdown.totalFaceUSD === 0) return null;

  // Color palette: green (safe / capital = exposure), amber
  // (mild leverage), red (true leveraged play), blue (mortgage-
  // leveraged real estate — different-risk-class blue, NOT red,
  // because the underlying volatility + fixed-rate + no-margin-
  // call dynamics put it in its own category).
  //
  // Example holdings audited against the bucketing math:
  //   - 0–1× INCLUSIVE → cash, 1× ETFs, paid-off real estate
  //     (real estate at leverage = 1 lands here, not in
  //     re_levered).
  //   - 1–2× EXCLUSIVE → NTSX (~1.5×), GDE (~1.8×), RSSB. QLD is
  //     exactly 2× so it does NOT land here.
  //   - 2×+ INCLUSIVE → QLD (2×), TQQQ / TMF / EDV / SOXL (3×),
  //     margin-funded equity, daily-reset leveraged funds.
  //   - Mortgaged real estate → any real-estate holding with
  //     leverage > 1, regardless of the multiplier.
  const segs = [
    {
      key: "low",
      label: "0–1× leverage",
      hint: "Cash, 1× unleveraged stocks/bonds/commodities/crypto, paid-off real estate, private stock owned outright. Capital equals exposure (no amplification).",
      entry: breakdown.buckets[0],
      color: "#22c55e",
    },
    {
      key: "mid",
      label: "1–2× leverage",
      hint: "Capital-efficient wrappers: NTSX (~1.5×), GDE (~1.8×), RSSB. Strictly between 1× and 2× — neither end included.",
      entry: breakdown.buckets[1],
      color: "#fbbf24",
    },
    {
      key: "high",
      label: "2×+ leverage",
      hint: "Daily-reset leveraged ETFs: QLD (2×), TQQQ (3×), TMF (3×), EDV, SOXL. Margin-funded equity also lands here.",
      entry: breakdown.buckets[2],
      color: "#ef4444",
    },
    {
      key: "re_levered",
      label: "Mortgaged real estate",
      hint: "Real estate with any mortgage, regardless of multiplier. Broken out from financial leverage because housing volatility is far lower, the mortgage is fixed-rate over 30 years (no margin call), and payments come from income — fundamentally different risk dynamics than a leveraged ETF.",
      entry: breakdown.buckets[3],
      color: "#3b82f6",
    },
  ];
  const visible = segs.filter((s) => s.entry.share > 0);

  const scopeLabel =
    classTab === "ALL"
      ? "all holdings"
      : classTab === "equity"
        ? "stocks"
        : classTab === "bond"
          ? "bonds"
          : classTab === "cash"
            ? "cash"
            : classTab === "crypto"
              ? "crypto"
              : classTab === "commodity"
                ? "commodities"
                : classTab === "real_estate"
                  ? "real estate"
                  : classTab === "private_stock"
                    ? "private stock"
                    : "other";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">
          Leverage breakdown · {scopeLabel}
        </div>
        <div className="num text-[10px] text-text-dim">
          {formatUSD(breakdown.totalFaceUSD)} total
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-bg-elevated">
        {visible.map((s) => (
          <div
            key={s.key}
            style={{
              width: `${s.entry.share * 100}%`,
              backgroundColor: s.color,
            }}
            title={`${s.label}: ${formatPercent(s.entry.share)} (${formatUSD(s.entry.faceUSD)})`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segs.map((s) => {
          const isOpen = !!expanded[s.key];
          return (
            <li
              key={s.key}
              className="rounded-md hover:bg-bg-elevated/50"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((p) => ({ ...p, [s.key]: !p[s.key] }))
                }
                className="flex w-full items-center justify-between gap-2 py-1 text-sm active:opacity-70"
                aria-expanded={isOpen}
                aria-label={`${s.label}: ${formatPercent(s.entry.share)}, ${formatUSD(s.entry.faceUSD)}. Tap to ${isOpen ? "hide" : "show"} examples.`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Chevron open={isOpen} />
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate text-text">{s.label}</span>
                </span>
                <span className="num flex shrink-0 items-baseline gap-2 text-text-muted">
                  <span className="font-medium text-text">
                    {formatPercent(s.entry.share)}
                  </span>
                  <span className="text-[11px] text-text-dim">
                    {formatUSDCompact(s.entry.faceUSD)}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="pb-2 pl-8 pr-2 text-[11px] leading-snug text-text-dim">
                  {s.hint}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

