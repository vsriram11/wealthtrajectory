"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  TAX_TREATMENT_LABELS,
  filterHousehold,
  taxBucketTotals,
  type Household,
  type TaxTreatment,
} from "@/lib/types";
import { formatPercent, formatUSD } from "@/lib/format";

const ORDER: TaxTreatment[] = [
  "PRE_TAX",
  "ROTH",
  "HSA",
  "TAXABLE",
  "EDUCATION",
];

const COLORS: Record<TaxTreatment, string> = {
  PRE_TAX: "#a78bfa",
  ROTH: "#4ade80",
  HSA: "#38bdf8",
  TAXABLE: "#64748b",
  EDUCATION: "#fbbf24",
};

const BLURBS: Record<TaxTreatment, string> = {
  PRE_TAX: "Tax-deferred — taxed on withdrawal",
  ROTH: "After-tax now, tax-free in retirement",
  HSA: "Triple-tax-advantaged for medical",
  TAXABLE: "Capital gains + dividends taxable",
  EDUCATION: "Tax-free for qualified expenses",
};

/**
 * Tax-bucket breakdown card.
 *
 * Two modes:
 *   - Display-only (no `onSelect` prop): renders bucket totals as
 *     a static read-out. Used historically as a standalone card.
 *   - Filter-controller (with `onSelect` + `selected`): each bucket
 *     row becomes a tap-toggle that scopes the rest of the
 *     Allocation page to just that bucket's holdings. Same UX
 *     pattern as the global member filter: select to focus,
 *     tap again to clear.
 *
 * Filter mode is what makes the page screenshot-worthy for the
 * "Can this couple retire with $X?" use case — instead of a wall
 * of "household total" numbers, the user picks a tax bucket and
 * sees that bucket's allocation, leverage breakdown, and metrics
 * in isolation.
 */
export function TaxBuckets({
  selected = null,
  onSelect,
  household: householdProp,
}: {
  selected?: TaxTreatment | null;
  onSelect?: (bucket: TaxTreatment | null) => void;
  /**
   * Optional pre-filtered household. When the AllocationPanel uses
   * this card to drive the tax-bucket selector, it passes the
   * member + liquid-filtered household so the bucket totals match
   * the rest of the page. When omitted (legacy callers / standalone
   * use), we fall back to reading + member-filtering ourselves.
   * Never apply the tax-bucket filter to this input — that would
   * collapse the bucket list to just the selected one and prevent
   * the user from re-selecting.
   */
  household?: Household;
} = {}) {
  const storeHousehold = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const filtered = useMemo(
    () => householdProp ?? filterHousehold(storeHousehold, memberId),
    [householdProp, storeHousehold, memberId],
  );
  const buckets = useMemo(() => taxBucketTotals(filtered), [filtered]);
  const total = ORDER.reduce((s, t) => s + buckets[t], 0);

  // Per-row hint-expand state, mirroring the LeverageBreakdownView
  // pattern. Each row has TWO independent affordances:
  //   1. Tap the row body to toggle bucket selection (filter).
  //   2. Tap the chevron to expand/collapse the help text.
  // Separate so a tap doesn't accidentally trigger the wrong one.
  // Hook must be unconditional — declared above the empty-state
  // early return below so the call order is stable across renders.
  const [hintOpen, setHintOpen] = useState<Record<string, boolean>>({});

  if (total <= 0) return null;

  const segs = ORDER.filter((t) => buckets[t] > 0).map((t) => ({
    t,
    usd: buckets[t],
    share: buckets[t] / total,
  }));

  const isInteractive = !!onSelect;

  return (
    <section className="px-5 pt-3">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Tax buckets
        </h2>
        {isInteractive && selected && (
          <button
            type="button"
            onClick={() => onSelect?.(null)}
            className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent active:opacity-70"
          >
            Showing {TAX_TREATMENT_LABELS[selected]} · clear
          </button>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-bg-elevated">
          {segs.map((s) => {
            const dim = selected != null && selected !== s.t;
            return (
              <div
                key={s.t}
                style={{
                  width: `${s.share * 100}%`,
                  backgroundColor: COLORS[s.t],
                  opacity: dim ? 0.25 : 1,
                  transition: "opacity 0.15s",
                }}
              />
            );
          })}
        </div>
        <ul className="mt-3 space-y-1.5">
          {segs.map((s) => {
            const isSelected = selected === s.t;
            const otherSelected = selected != null && !isSelected;
            const isOpen = !!hintOpen[s.t];

            const rowBody = (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <Chevron open={isOpen} />
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COLORS[s.t] }}
                  />
                  <span
                    className={`truncate ${otherSelected ? "text-text-muted" : "text-text"}`}
                  >
                    {TAX_TREATMENT_LABELS[s.t]}
                  </span>
                </span>
                <span className="num flex shrink-0 items-baseline gap-2 text-text-muted">
                  <span
                    className={`font-medium ${otherSelected ? "text-text-muted" : "text-text"}`}
                  >
                    {formatPercent(s.share)}
                  </span>
                  <span className="text-[11px] text-text-dim">
                    {formatUSD(s.usd)}
                  </span>
                </span>
              </>
            );

            if (!isInteractive) {
              return (
                <li
                  key={s.t}
                  className="rounded-md hover:bg-bg-elevated/50"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setHintOpen((p) => ({ ...p, [s.t]: !p[s.t] }))
                    }
                    className="flex w-full items-center justify-between gap-2 py-1 text-sm active:opacity-70"
                    aria-expanded={isOpen}
                  >
                    {rowBody}
                  </button>
                  {isOpen && (
                    <div className="pb-2 pl-8 pr-2 text-[11px] leading-snug text-text-dim">
                      {BLURBS[s.t]}
                    </div>
                  )}
                </li>
              );
            }

            // Interactive mode: row body taps select/deselect the
            // bucket as a page-wide filter. The chevron at the
            // start of the row is its own button (event stopped)
            // and only toggles the help-text expansion.
            return (
              <li
                key={s.t}
                className={`rounded-md transition ${
                  isSelected
                    ? "bg-accent/10 ring-1 ring-accent/40"
                    : "hover:bg-bg-elevated/60"
                }`}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHintOpen((p) => ({ ...p, [s.t]: !p[s.t] }));
                    }}
                    className="rounded-md px-2 py-1 text-text-dim hover:text-text active:opacity-70"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Hide" : "Show"} help text for ${TAX_TREATMENT_LABELS[s.t]}`}
                  >
                    <Chevron open={isOpen} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect?.(isSelected ? null : s.t)}
                    className="flex flex-1 items-center justify-between gap-3 py-1 pr-2 text-left text-sm active:opacity-70"
                    aria-pressed={isSelected}
                    aria-label={`Filter Allocation page to ${TAX_TREATMENT_LABELS[s.t]} only. ${isSelected ? "Currently selected — tap to clear." : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: COLORS[s.t] }}
                      />
                      <span
                        className={`truncate ${otherSelected ? "text-text-muted" : "text-text"}`}
                      >
                        {TAX_TREATMENT_LABELS[s.t]}
                      </span>
                    </span>
                    <span className="num flex shrink-0 items-baseline gap-2 text-text-muted">
                      <span
                        className={`font-medium ${otherSelected ? "text-text-muted" : "text-text"}`}
                      >
                        {formatPercent(s.share)}
                      </span>
                      <span className="text-[11px] text-text-dim">
                        {formatUSD(s.usd)}
                      </span>
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="pb-2 pl-10 pr-2 text-[11px] leading-snug text-text-dim">
                    {BLURBS[s.t]}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {isInteractive && !selected && (
          <div className="mt-2 px-1 text-[10px] leading-snug text-text-dim">
            Tap a bucket to scope the rest of the page (NW, leverage,
            allocation, metrics) to just that tax treatment.
          </div>
        )}
      </div>
    </section>
  );
}

/** Right-pointing chevron that rotates 90° on expand — same shape
 *  + sizing as the leverage rows on the Allocation page, so the
 *  two cards read as a matched pair. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
