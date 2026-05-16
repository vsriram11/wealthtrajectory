"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  ACCOUNT_CATEGORY_LABELS,
  accountValue,
  accountWeightedCAGR,
  filterHousehold,
  holdingLeverage,
  type Account,
  type Holding,
} from "@/lib/types";
import {
  formatLeverage,
  formatPercent,
  formatUSD,
} from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";
import { BulkHoldingImport } from "./BulkHoldingImport";

export function AccountList() {
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const beginEditingHolding = useAppStore((s) => s.beginEditingHolding);
  const beginEditingAccount = useAppStore((s) => s.beginEditingAccount);
  const beginCreatingAccount = useAppStore((s) => s.beginCreatingAccount);
  const beginCreatingHolding = useAppStore((s) => s.beginCreatingHolding);
  const setContribution = useAppStore((s) => s.setAccountContribution);
  const reorderAccounts = useAppStore((s) => s.reorderAccounts);

  const filtered = filterHousehold(household, memberId);

  /**
   * Move `id` one slot up or down within the *visible* subset. The
   * underlying household.accounts is the source of truth for order
   * (and what gets synced to Drive), so we resolve the visible
   * neighbor and swap their positions in the full array. Reordering
   * within a member-filtered view keeps adjacent visible cards
   * adjacent — we don't shuffle through hidden cards.
   */
  const moveBy = (id: string, direction: -1 | 1) => {
    const visibleIdx = filtered.accounts.findIndex((a) => a.id === id);
    const neighbor = filtered.accounts[visibleIdx + direction];
    if (!neighbor) return;
    const ids = household.accounts.map((a) => a.id);
    const i = ids.indexOf(id);
    const j = ids.indexOf(neighbor.id);
    if (i < 0 || j < 0) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderAccounts(ids);
  };

  return (
    <section className="px-5 pt-6 pb-6">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Accounts
        </h2>
        <div className="flex items-center gap-2">
          <BulkHoldingImport />
          <button
            type="button"
            onClick={beginCreatingAccount}
            className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent active:opacity-70"
          >
            + New
          </button>
        </div>
      </div>
      {filtered.accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-bg-surface px-4 py-8 text-center">
          <div className="text-sm font-medium text-text">No accounts yet</div>
          <div className="mt-1 text-[11px] text-text-muted">
            Tap &quot;+ New&quot; above to create one.
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.accounts.map((a, i) => (
            <AccountCard
              key={a.id}
              account={a}
              canMoveUp={i > 0}
              canMoveDown={i < filtered.accounts.length - 1}
              onMoveUp={() => moveBy(a.id, -1)}
              onMoveDown={() => moveBy(a.id, 1)}
              onTapHolding={beginEditingHolding}
              onContributionChange={(v) => setContribution(a.id, v)}
              onEditAccount={() => beginEditingAccount(a.id)}
              onAddHolding={() => beginCreatingHolding(a.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountCard({
  account,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onTapHolding,
  onContributionChange,
  onEditAccount,
  onAddHolding,
}: {
  account: Account;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onTapHolding: (id: string) => void;
  onContributionChange: (value: number) => void;
  onEditAccount: () => void;
  onAddHolding: () => void;
}) {
  const [open, setOpen] = useState(false);
  const total = accountValue(account);
  const cagr = accountWeightedCAGR(account);

  // The chevrons need their own click handlers that don't bubble up
  // to the card-level "tap to expand" button. We render them as a
  // separate sibling element (not nested inside the button) and use
  // stopPropagation as belt-and-suspenders.
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
      <div className="relative flex items-stretch">
        <div className="flex shrink-0 flex-col justify-center gap-0.5 pl-2 pr-1 py-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            disabled={!canMoveUp}
            aria-label="Move account up"
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-bg-elevated hover:text-text disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-dim active:opacity-70"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8l3-4 3 4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={!canMoveDown}
            aria-label="Move account down"
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-bg-elevated hover:text-text disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-dim active:opacity-70"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 4l3 4 3-4" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center justify-between gap-3 px-2 py-3.5 pr-4 text-left active:opacity-80"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-text">
              {account.displayName}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <span className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                {ACCOUNT_CATEGORY_LABELS[account.category]}
              </span>
              <span>{formatPercent(cagr)} real</span>
              {account.monthlyContributionUSD > 0 && (
                <span className="text-positive">
                  +{formatUSD(account.monthlyContributionUSD)}/mo
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="num shrink-0 text-sm font-semibold text-text">
              {formatUSD(total)}
            </div>
            <span
              className={`text-text-dim transition ${open ? "rotate-90" : ""}`}
            >
              ›
            </span>
          </div>
        </button>
      </div>
      {open && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              Account settings
            </div>
            <button
              type="button"
              onClick={onEditAccount}
              className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              Edit · Delete
            </button>
          </div>
          <ContributionRow
            value={account.monthlyContributionUSD}
            onChange={onContributionChange}
          />
          <AccountFutureRow account={account} />
          {account.holdings.length > 0 ? (
            <ul className="border-t border-border">
              {account.holdings.map((h) => (
                <HoldingRow
                  key={h.id}
                  holding={h}
                  accountTotal={total}
                  onTap={() => onTapHolding(h.id)}
                />
              ))}
            </ul>
          ) : (
            <div className="border-t border-border px-4 py-3 text-center text-[11px] text-text-dim">
              No holdings yet
            </div>
          )}
          <button
            type="button"
            onClick={onAddHolding}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-[11px] font-medium text-accent active:bg-bg-elevated"
          >
            + Add holding
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Tiny "what's this account going to be worth in N years" preview
 * shown inside each open AccountCard. Three timestamps: 5 / 10 / 20
 * years out. Reuses the same single-account ageing logic so the
 * numbers match the household-level AllocationFutureCard.
 */
function AccountFutureRow({ account }: { account: Account }) {
  const futures = [5, 10, 20].map((years) => {
    const aged = ageOneAccount(account, years);
    const value = aged.holdings.reduce((s, h) => s + h.valueUSD, 0);
    return { years, value };
  });
  // Hide for accounts with nothing to project (zero value, zero
  // contribution).
  const totalNow = account.holdings.reduce((s, h) => s + h.valueUSD, 0);
  if (totalNow === 0 && account.monthlyContributionUSD === 0) return null;
  return (
    <div className="border-t border-border px-4 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        Projected value
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[11px]">
        {futures.map((f) => (
          <div key={f.years} className="flex-1">
            <div className="num font-medium text-text">
              {formatUSD(f.value)}
            </div>
            <div className="text-[10px] text-text-dim">in {f.years}y</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ageOneAccount(account: Account, years: number): Account {
  // Mirror lib/futureAllocation.ts's per-holding ageing without
  // pulling in the rest of that module (avoids circular UI/engine
  // crossing here). Each holding grows by its CAGR; contributions
  // fan into existing holdings proportionally to their current
  // value.
  const months = Math.round(years * 12);
  let holdings = account.holdings.map((h) => {
    const factor = Math.pow(1 + h.expectedRealCAGR, years);
    if (h.kind === "cash" || h.kind === "real_estate" || h.kind === "other") {
      return { ...h, valueUSD: h.valueUSD * factor };
    }
    const newPrice = h.lastPriceUSD * factor;
    return { ...h, lastPriceUSD: newPrice, valueUSD: h.shares * newPrice };
  });
  if (account.monthlyContributionUSD > 0 && holdings.length > 0) {
    const totalContrib = account.monthlyContributionUSD * months;
    const totalNow =
      holdings.reduce((s, h) => s + h.valueUSD, 0) || 1;
    holdings = holdings.map((h) => {
      const share = h.valueUSD / totalNow;
      const inflow = totalContrib * share;
      if (h.kind === "cash" || h.kind === "real_estate" || h.kind === "other") {
        return { ...h, valueUSD: h.valueUSD + inflow };
      }
      const price = h.lastPriceUSD > 0 ? h.lastPriceUSD : 1;
      const extra = inflow / price;
      return {
        ...h,
        shares: h.shares + extra,
        valueUSD: (h.shares + extra) * price,
      };
    });
  }
  return { ...account, holdings };
}

function ContributionRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <div className="text-xs font-medium text-text-muted">
          Monthly contribution
        </div>
        <div className="mt-0.5 text-[11px] text-text-dim">
          Added at the end of each month during accumulation
        </div>
      </div>
      <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1">
        <span className="text-sm text-text-muted">$</span>
        <NumberField
          value={value}
          onChange={onChange}
          precision={0}
          allowNegative={false}
          className="num w-24 bg-transparent text-right text-sm font-medium text-text outline-none"
        />
      </span>
    </div>
  );
}

function HoldingRow({
  holding,
  accountTotal,
  onTap,
}: {
  holding: Holding;
  accountTotal: number;
  onTap: () => void;
}) {
  const weight = accountTotal > 0 ? holding.valueUSD / accountTotal : 0;
  const symbol =
    holding.kind === "cash"
      ? "Cash"
      : holding.kind === "real_estate" || holding.kind === "other"
        ? holding.name
        : holding.symbol;
  const classChip =
    holding.kind === "equity"
      ? "Stock"
      : holding.kind === "bond"
        ? "Bond"
        : holding.kind === "crypto"
          ? "Crypto"
          : holding.kind === "commodity"
            ? "Commodity"
            : holding.kind === "real_estate"
              ? "Real estate"
              : holding.kind === "private_stock"
                ? "Private"
                : holding.kind === "other"
                  ? "Other"
                  : null;
  // For composition-bearing equity wrappers (NTSX, GDE, …) the
  // effective leverage is the sum of leg weights, not the scalar
  // `leverage` field. holdingLeverage() picks the right value.
  const leverageNum =
    holding.kind === "equity" ||
    holding.kind === "bond" ||
    holding.kind === "real_estate" ||
    holding.kind === "private_stock"
      ? holdingLeverage(holding)
      : 0;
  const leverageWarn = leverageNum > 1.01;

  const composition =
    (holding.kind === "equity" ||
      holding.kind === "bond" ||
      holding.kind === "crypto" ||
      holding.kind === "commodity") &&
    holding.composition &&
    holding.composition.length > 0
      ? holding.composition
      : null;
  const compositionLabel = composition
    ? composition
        .map((l) => `${Math.round(l.weight * 100)}% ${legShortLabel(l.kind)}`)
        .join(" · ")
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-bg-elevated"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">{symbol}</span>
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
          <div className="mt-0.5 text-[11px] text-text-muted">
            {compositionLabel ? (
              <>
                <span className="text-accent">{compositionLabel}</span> ·{" "}
              </>
            ) : null}
            {formatPercent(holding.expectedRealCAGR)} real ·{" "}
            {Math.round(weight * 100)}% of account
          </div>
        </div>
        <div className="num shrink-0 text-sm text-text">
          {formatUSD(holding.valueUSD)}
        </div>
      </button>
    </li>
  );
}

function legShortLabel(kind: string): string {
  switch (kind) {
    case "equity":
      return "stocks";
    case "bond":
      return "bonds";
    case "cash":
      return "cash";
    case "crypto":
      return "crypto";
    case "commodity":
      return "gold/commodity";
    case "other":
      return "other";
    default:
      return kind;
  }
}
