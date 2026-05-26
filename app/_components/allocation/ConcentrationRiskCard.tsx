"use client";

import { useMemo } from "react";
import {
  concentrationFindings,
  type ConcentrationFinding,
} from "@/lib/insights/concentration";
import { useAllocationView } from "@/lib/portfolio/useAllocationView";
import { formatPercent, formatUSDCompact } from "@/lib/format";

/**
 * Concentration-risk card. Flags single-ticker / single-account /
 * single-member exposures that the Independence engine alone won't see.
 * Renders nothing when there's nothing notable.
 *
 * Why this matters: the projection engine assumes diversified
 * returns at the assumed CAGR. A 40%-of-NW position in one stock
 * has a *very* different return distribution than its expected
 * return suggests — a single bad year can wipe out a decade of
 * planning. We can't model the variance change here (would need
 * a per-ticker beta + vol), but flagging the structural
 * concentration is the first-order intervention.
 */
export function ConcentrationRiskCard() {
  // Use the shared allocation view so when the user toggles
  // "Apply +Ny" on the future-composition card, this card's
  // concentration findings reflect the aged-forward household —
  // not stale today's holdings. Without this, the future view
  // was inconsistent across cards on the same page.
  const { household } = useAllocationView();
  const findings = useMemo(
    () => concentrationFindings(household),
    [household],
  );

  if (findings.length === 0) return null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div>
          <div className="text-sm font-medium text-text">
            Concentration check
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Positions that drive risk independent of your assumed CAGR.
            Diversification is the only free lunch in investing.
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {findings.map((f, i) => (
            <FindingRow key={`${f.kind}-${f.label}-${i}`} f={f} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function FindingRow({ f }: { f: ConcentrationFinding }) {
  const tone =
    f.severity === "high"
      ? "border-negative/40 bg-negative/5 text-negative"
      : "border-amber-300/40 bg-amber-300/5 text-amber-300";
  const kindLabel =
    f.kind === "ticker"
      ? "Single ticker"
      : f.kind === "account"
        ? "Single account"
        : "Single member";
  const advice =
    f.kind === "ticker"
      ? "Consider diversifying — even great companies blow up."
      : f.kind === "account"
        ? "Custodian outage / tax-treatment risk concentrates here."
        : "Heavy NW asymmetry — review estate / titling.";
  return (
    <li className={`rounded-md border px-3 py-2 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider opacity-80">
            {kindLabel} · {f.severity}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold">{f.label}</div>
          <div className="num mt-0.5 text-[10px] opacity-80">
            {formatUSDCompact(f.bucketUSD)} · {formatPercent(f.fraction)} of{" "}
            {f.kind === "ticker" ? "gross assets" : "net worth"}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[10px] leading-snug opacity-80">{advice}</div>
    </li>
  );
}
