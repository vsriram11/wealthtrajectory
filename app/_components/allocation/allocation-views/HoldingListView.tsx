"use client";

/**
 * Generic "list of holdings in this class" view used by the
 * Crypto / Commodity / RealEstate / PrivateStock / Other class
 * tabs. Each tab differs only in:
 *
 *   - Which holding kind to filter on
 *   - The per-item caption (CAGR + optional leverage / shares × FMV)
 *   - The empty-state copy
 *   - A bucket-name string for the "X% of {bucket}" footer
 *
 * Hoisting the shared shape into this component keeps the per-class
 * view files at ~20 lines of pure configuration and removes ~300
 * lines of nearly-identical iteration + render code.
 */

import { formatPercent, formatUSD } from "@/lib/format";

export type HoldingListItem = {
  /** Stable React key. */
  key: string;
  /** Headline label (ticker, property name, or company name). */
  label: string;
  /** Dollar value of this holding. */
  valueUSD: number;
  /** Caption line shown under the label. */
  detail: React.ReactNode;
};

export function HoldingListView({
  items,
  totalUSD,
  bucketName,
  emptyState,
}: {
  /** Holdings already filtered + sorted by valueUSD desc. */
  items: HoldingListItem[];
  /** Class-bucket total — denominator for the "share of bucket" caption. */
  totalUSD: number;
  /** "crypto", "real estate", "private", etc. — appears in "X% of {bucketName}". */
  bucketName: string;
  /** Rendered when totalUSD <= 0. */
  emptyState: React.ReactNode;
}) {
  if (totalUSD <= 0) return <>{emptyState}</>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex items-center justify-between rounded-md border border-border bg-bg-elevated px-3 py-2"
        >
          <div>
            <div className="text-sm font-medium text-text">{item.label}</div>
            <div className="text-[11px] text-text-dim">{item.detail}</div>
          </div>
          <div className="num text-right">
            <div className="text-sm font-medium text-text">
              {formatUSD(item.valueUSD)}
            </div>
            <div className="text-[11px] text-text-dim">
              {formatPercent(item.valueUSD / totalUSD)} of {bucketName}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
