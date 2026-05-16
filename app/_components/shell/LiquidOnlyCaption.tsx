"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { holdingLabel, holdingValue, type Holding } from "@/lib/types";
import { formatUSD } from "@/lib/format";
import { Chevron } from "@/app/_components/allocation/allocation-views/helpers";

/**
 * Single source of truth for the "Liquid only — …" caption shown
 * under headline net-worth figures when the user has toggled the
 * liquidity filter on. Replaces a hand-written line that only
 * mentioned primary residence and missed two of the three reasons
 * a holding can be illiquid.
 *
 * The three exclusion reasons mirror `isLiquid` in `lib/types.ts`:
 *
 *   1. real-estate flagged `isPrimaryResidence`
 *   2. any `private_stock` holding
 *   3. any holding the user explicitly flagged `isIlliquid`
 *
 * Renders nothing when liquid mode is off or when the household
 * has no excluded holdings (the chip itself already hides in that
 * case; this is belt-and-suspenders).
 */
type ExclusionReason = "primary_residence" | "private_stock" | "flagged";

const REASON_LABEL: Record<ExclusionReason, string> = {
  primary_residence: "Primary residence",
  private_stock: "Private company stock",
  flagged: "Flagged illiquid",
};

const REASON_HINT: Record<ExclusionReason, string> = {
  primary_residence:
    "Real-estate holdings you marked as your primary residence. Selling means moving, so the equity can't fund retirement spending.",
  private_stock:
    "Pre-IPO equity, restricted shares, vested-but-locked options. Typically only realizes at an exit event, so it's excluded from liquid net worth.",
  flagged:
    "Holdings you marked illiquid in the holding editor — friend's-startup stakes, vested-but-restricted shares, collectibles, art, etc.",
};

function classify(h: Holding): ExclusionReason | null {
  if (h.kind === "private_stock") return "private_stock";
  if (h.kind === "real_estate" && h.isPrimaryResidence === true) {
    return "primary_residence";
  }
  if ("isIlliquid" in h && h.isIlliquid === true) return "flagged";
  return null;
}

type Excluded = { name: string; reason: ExclusionReason; usd: number };

/**
 * Computes the set of holdings the liquid filter would exclude for
 * the given member scope. Returns an empty array when not in liquid
 * mode — call sites can use `.length === 0` to coordinate sibling
 * captions (e.g. "Filtered to one member") that should hide when
 * the liquid caption is showing.
 */
export function useLiquidExclusions(memberId: string | null): Excluded[] {
  const liquidityView = useAppStore((s) => s.liquidityView);
  const rawHousehold = useAppStore((s) => s.household);
  return useMemo<Excluded[]>(() => {
    if (liquidityView !== "liquid") return [];
    const out: Excluded[] = [];
    for (const a of rawHousehold.accounts) {
      if (memberId && a.ownerId !== memberId) continue;
      for (const h of a.holdings) {
        const reason = classify(h);
        if (!reason) continue;
        out.push({ name: holdingLabel(h), reason, usd: holdingValue(h) });
      }
    }
    return out;
  }, [liquidityView, rawHousehold, memberId]);
}

export function LiquidOnlyCaption({ memberId }: { memberId: string | null }) {
  const excluded = useLiquidExclusions(memberId);
  const [open, setOpen] = useState(false);

  if (excluded.length === 0) return null;

  const totalExcluded = excluded.reduce((s, e) => s + e.usd, 0);
  const byReason = new Map<ExclusionReason, Excluded[]>();
  for (const ex of excluded) {
    const arr = byReason.get(ex.reason) ?? [];
    arr.push(ex);
    byReason.set(ex.reason, arr);
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-accent active:opacity-70"
        aria-expanded={open}
        aria-label={`Liquid only. ${formatUSD(totalExcluded)} excluded across ${excluded.length} holding${excluded.length === 1 ? "" : "s"}. Tap to ${open ? "hide" : "show"} details.`}
      >
        <span>
          Liquid only — <span className="num">{formatUSD(totalExcluded)}</span>{" "}
          excluded
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          {[...byReason.entries()].map(([reason, items], idx) => {
            const subtotal = items.reduce((s, i) => s + i.usd, 0);
            return (
              <div
                key={reason}
                className={idx > 0 ? "mt-2.5 border-t border-border pt-2" : ""}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-text">
                    {REASON_LABEL[reason]}
                  </span>
                  <span className="num text-text">{formatUSD(subtotal)}</span>
                </div>
                <ul className="mt-1 ml-3 list-disc space-y-0.5 text-text-dim">
                  {items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{it.name}</span>
                      <span className="num shrink-0">{formatUSD(it.usd)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 ml-3 text-[11px] text-text-dim">
                  {REASON_HINT[reason]}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
