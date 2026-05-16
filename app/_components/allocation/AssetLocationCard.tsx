"use client";

import { useMemo } from "react";
import {
  assetLocationFindings,
  type LocationFinding,
} from "@/lib/tax/assetLocation";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact } from "@/lib/format";

/**
 * Asset-location optimizer. Flags misplaced holdings using the
 * standard fee-only-fiduciary asset-location rules:
 *
 *   Bonds + cash + commodities → tax-deferred (ordinary income)
 *   Bonds in Roth → wasted shelter (Roth's value is growth)
 *
 * Renders nothing when everything is aligned.
 *
 * Free tier — the location structure is well-known public knowledge;
 * the value here is the audit, not the IP.
 */
export function AssetLocationCard() {
  const { household } = useActiveProjection();
  const findings = useMemo(
    () => assetLocationFindings(household),
    [household],
  );

  if (findings.length === 0) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div>
          <div className="text-sm font-medium text-text">
            Asset-location check
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Which holdings belong in which account types — same exposure,
            lower lifetime tax.
          </div>
        </div>
        <ul className="mt-3 space-y-2">
          {findings.map((f, i) => (
            <FindingRow key={`${f.kind}-${f.label}-${i}`} f={f} />
          ))}
        </ul>
        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          Tax-efficient location is a one-time portfolio change with permanent
          benefits. The optimal allocation by tax bucket: bonds &amp; cash in
          tax-deferred (401k / IRA), equities in taxable (LTCG + step-up basis)
          and Roth (highest-growth assets).
        </div>
        <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
          <span className="font-semibold">Not investment advice.</span> Selling
          to relocate can trigger taxable events; consider new contributions
          and 401(k) rebalances first. Confirm with a fee-only fiduciary if
          large unrealized gains are involved.
        </div>
      </div>
    </section>
  );
}

function FindingRow({ f }: { f: LocationFinding }) {
  const tone =
    f.kind === "tax-inefficient-in-taxable"
      ? "border-amber-300/40 bg-amber-300/5 text-amber-300"
      : "border-accent/40 bg-accent/5 text-accent";
  const heading =
    f.kind === "tax-inefficient-in-taxable"
      ? "Move to tax-deferred"
      : "Swap with equities";
  return (
    <li className={`rounded-md border px-3 py-2 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider opacity-80">
            {heading}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold">
            {f.label} in {f.accountName}
          </div>
        </div>
        <div className="num text-[12px] font-semibold">
          {formatUSDCompact(f.valueUSD)}
        </div>
      </div>
      <div className="mt-1 text-[10px] leading-snug opacity-80">
        {f.recommendation}
      </div>
    </li>
  );
}
