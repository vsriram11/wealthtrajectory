"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  ACCOUNT_CATEGORY_LABELS,
  GEOGRAPHIES,
  GEOGRAPHY_LABELS,
  TAX_TREATMENT_BY_CATEGORY,
  TAX_TREATMENT_LABELS,
  filterHousehold,
  holdingLeverage,
  type AccountCategory,
  type GeographyAllocation,
  type Holding,
  type TaxTreatment,
} from "@/lib/types";
import { formatLeverage, formatPercent, formatUSD } from "@/lib/format";

type PositionAccount = {
  accountId: string;
  accountName: string;
  category: AccountCategory;
  taxTreatment: TaxTreatment;
  valueUSD: number;
};

type Position = {
  key: string;
  symbol: string;
  kind: Holding["kind"];
  valueUSD: number;
  shares: number | null;
  leverage: number | null;
  expectedRealCAGR: number;
  share: number;
  geography: GeographyAllocation;
  byAccount: PositionAccount[];
};

const TAX_COLORS: Record<TaxTreatment, string> = {
  PRE_TAX: "#a78bfa",
  ROTH: "#4ade80",
  HSA: "#38bdf8",
  TAXABLE: "#64748b",
  EDUCATION: "#fbbf24",
};

export function PositionsList() {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const classTab = useAppStore((s) => s.allocClassTab);
  const geoScope = useAppStore((s) => s.allocGeoScope);

  const filtered = useMemo(
    () => filterHousehold(household, memberId),
    [household, memberId],
  );

  const positions = useMemo(() => buildPositions(filtered), [filtered]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (positions.length === 0) return null;

  const filterActive = classTab !== "ALL" || geoScope !== "ALL";

  return (
    <section className="px-5 pt-3 pb-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Positions
        </h2>
        {filterActive && (
          <span className="text-[11px] text-accent">
            Highlighting matches
          </span>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-bg-surface">
        <ul className="divide-y divide-border">
          {positions.map((p) => (
            <Row
              key={p.key}
              position={p}
              expanded={expandedKey === p.key}
              onToggle={() =>
                setExpandedKey((c) => (c === p.key ? null : p.key))
              }
              highlight={matchesFilter(p, classTab, geoScope)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function buildPositions(household: { accounts: Array<{
  id: string;
  category: AccountCategory;
  displayName: string;
  holdings: Holding[];
}> }): Position[] {
  const total = household.accounts.reduce(
    (s, a) => s + a.holdings.reduce((ss, h) => ss + h.valueUSD, 0),
    0,
  );
  if (total <= 0) return [];

  const groups = new Map<string, Position>();
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      const symLabel =
        h.kind === "cash"
          ? "Cash"
          : h.kind === "real_estate" || h.kind === "other"
            ? h.name
            : h.symbol.toUpperCase();
      const key =
        h.kind === "cash"
          ? "cash"
          : h.kind === "real_estate"
            ? `real_estate:${h.id}`
            : h.kind === "other"
              ? `other:${h.id}`
              : `${h.kind}:${(h.symbol ?? "").toUpperCase()}`;
      const symbol = symLabel;
      const taxTreatment = TAX_TREATMENT_BY_CATEGORY[a.category];
      const acctEntry: PositionAccount = {
        accountId: a.id,
        accountName: a.displayName,
        category: a.category,
        taxTreatment,
        valueUSD: h.valueUSD,
      };
      const holdingShares =
        h.kind === "equity" ||
        h.kind === "bond" ||
        h.kind === "crypto" ||
        h.kind === "commodity"
          ? h.shares
          : null;
      // For composition-bearing equity wrappers, the meaningful
      // leverage is the sum of leg weights (NTSX = 1.5), not the
      // scalar `leverage` field.
      const holdingLev =
        h.kind === "equity" ||
        h.kind === "bond" ||
        h.kind === "real_estate" ||
        h.kind === "private_stock"
          ? holdingLeverage(h)
          : null;
      const holdingGeo =
        h.kind === "equity" || h.kind === "bond" || h.kind === "cash"
          ? h.geography
          : { US: 0, DEVELOPED: 0, EMERGING: 0 };

      const existing = groups.get(key);
      if (existing) {
        const prev = existing.valueUSD;
        existing.valueUSD += h.valueUSD;
        existing.byAccount.push(acctEntry);
        if (holdingShares != null) {
          existing.shares = (existing.shares ?? 0) + holdingShares;
        }
        if (holdingLev != null) {
          existing.leverage =
            ((existing.leverage ?? 1) * prev + holdingLev * h.valueUSD) /
            existing.valueUSD;
        }
        existing.expectedRealCAGR =
          (existing.expectedRealCAGR * prev +
            h.expectedRealCAGR * h.valueUSD) /
          existing.valueUSD;
        for (const g of GEOGRAPHIES) {
          existing.geography[g] =
            (existing.geography[g] * prev +
              holdingGeo[g] * h.valueUSD) /
            existing.valueUSD;
        }
      } else {
        groups.set(key, {
          key,
          symbol,
          kind: h.kind,
          valueUSD: h.valueUSD,
          shares: holdingShares,
          leverage: holdingLev,
          expectedRealCAGR: h.expectedRealCAGR,
          share: 0,
          geography: { ...holdingGeo },
          byAccount: [acctEntry],
        });
      }
    }
  }

  const out = Array.from(groups.values());
  for (const p of out) p.share = p.valueUSD / total;
  out.sort((a, b) => b.valueUSD - a.valueUSD);
  return out;
}

function matchesFilter(
  p: Position,
  classTab:
    | "ALL"
    | "equity"
    | "bond"
    | "cash"
    | "crypto"
    | "commodity"
    | "real_estate"
    | "private_stock"
    | "other",
  geoScope: "ALL" | "US" | "DEVELOPED" | "EMERGING",
): boolean {
  const classMatch = classTab === "ALL" || p.kind === classTab;
  // Crypto, commodity, real estate, private-stock, and "other" have
  // no geography attribution — under a region scope they don't match
  // anything, but they always match ALL.
  const geoMatch =
    geoScope === "ALL"
      ? true
      : p.kind === "crypto" ||
          p.kind === "commodity" ||
          p.kind === "real_estate" ||
          p.kind === "private_stock" ||
          p.kind === "other"
        ? false
        : p.geography[geoScope] > 0.01;
  return classMatch && geoMatch;
}

function Row({
  position: p,
  expanded,
  onToggle,
  highlight,
}: {
  position: Position;
  expanded: boolean;
  onToggle: () => void;
  highlight: boolean;
}) {
  const classChip =
    p.kind === "equity"
      ? "Stock"
      : p.kind === "bond"
        ? "Bond"
        : p.kind === "crypto"
          ? "Crypto"
          : p.kind === "commodity"
            ? "Commodity"
            : p.kind === "real_estate"
              ? "Real estate"
              : p.kind === "private_stock"
                ? "Private"
                : p.kind === "other"
                  ? "Other"
                : null;
  const leverageNum = p.leverage != null ? p.leverage : 0;
  const leverageWarn = leverageNum > 1.01;

  const taxTotals: Record<TaxTreatment, number> = {
    PRE_TAX: 0,
    ROTH: 0,
    TAXABLE: 0,
    HSA: 0,
    EDUCATION: 0,
  };
  for (const a of p.byAccount) taxTotals[a.taxTreatment] += a.valueUSD;
  const taxSegs = (
    Object.entries(taxTotals) as [TaxTreatment, number][]
  ).filter(([, v]) => v > 0);

  return (
    <li className={highlight ? "bg-accent/5" : ""}>
      <button
        type="button"
        onClick={onToggle}
        className="block w-full px-4 py-3 text-left active:opacity-80"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`text-sm font-medium ${
                highlight ? "text-accent" : "text-text"
              }`}
            >
              {p.symbol}
            </span>
            {classChip && (
              <span className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                {classChip}
              </span>
            )}
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                leverageWarn
                  ? "border-amber-300/40 bg-amber-300/10 text-amber-300"
                  : "border-border bg-bg-elevated text-text-dim"
              }`}
            >
              {formatLeverage(leverageNum)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="num shrink-0 text-right">
              <div className="text-sm font-semibold text-text">
                {formatPercent(p.share)}
              </div>
              <div className="text-[11px] text-text-muted">
                {formatUSD(p.valueUSD)}
              </div>
            </div>
            <span
              className={`text-text-dim transition ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ›
            </span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-dim">
          <span>
            {p.shares != null
              ? `${p.shares.toFixed(p.shares < 10 ? 4 : 2)} shares`
              : `${p.byAccount.length} account${p.byAccount.length === 1 ? "" : "s"}`}
          </span>
          <span>{formatPercent(p.expectedRealCAGR)} real CAGR</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-elevated">
          <div
            className={`h-full ${highlight ? "bg-accent" : "bg-accent/60"}`}
            style={{ width: `${Math.min(100, p.share * 100)}%` }}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-bg-elevated px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-text-dim">
            Tax bucket allocation
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-bg-surface">
            {taxSegs.map(([t, v]) => (
              <div
                key={t}
                style={{
                  width: `${(v / p.valueUSD) * 100}%`,
                  backgroundColor: TAX_COLORS[t],
                }}
              />
            ))}
          </div>
          <ul className="mt-2 space-y-1">
            {taxSegs.map(([t, v]) => (
              <li
                key={t}
                className="flex items-center justify-between text-[11px]"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: TAX_COLORS[t] }}
                  />
                  <span className="text-text">{TAX_TREATMENT_LABELS[t]}</span>
                </span>
                <span className="num text-text-muted">
                  <span className="font-medium text-text">
                    {formatPercent(v / p.valueUSD)}
                  </span>{" "}
                  · {formatUSD(v)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 text-[11px] uppercase tracking-wider text-text-dim">
            Held in
          </div>
          <ul className="mt-2 space-y-1">
            {p.byAccount.map((a) => (
              <li
                key={a.accountId}
                className="flex items-center justify-between gap-3 text-[11px]"
              >
                <div className="min-w-0">
                  <span className="text-text">{a.accountName}</span>
                  <span className="ml-1 rounded border border-border bg-bg-surface px-1 py-0.5 text-[9px] uppercase tracking-wider text-text-muted">
                    {ACCOUNT_CATEGORY_LABELS[a.category]}
                  </span>
                </div>
                <span className="num text-text-muted">
                  <span className="font-medium text-text">
                    {formatUSD(a.valueUSD)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {p.kind !== "cash" && (
            <div className="mt-3 text-[11px] uppercase tracking-wider text-text-dim">
              Geography
            </div>
          )}
          {p.kind !== "cash" && (
            <ul className="mt-2 space-y-1">
              {GEOGRAPHIES.map((g) =>
                p.geography[g] > 0.005 ? (
                  <li
                    key={g}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="text-text-muted">
                      {GEOGRAPHY_LABELS[g]}
                    </span>
                    <span className="num text-text">
                      {formatPercent(p.geography[g])}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

