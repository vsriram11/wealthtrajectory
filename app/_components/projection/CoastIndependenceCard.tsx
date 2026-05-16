"use client";

import { useMemo } from "react";
import { coastAnalysis } from "@/lib/projection/coast";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatYearsMonths } from "@/lib/format";

/**
 * Coast-Independence explainer card. Answers the financial-independence-community question:
 * "Can I stop contributing and still hit my target through
 * compounding alone?"
 *
 * Three states:
 *   1. alreadyCoasting (no contributions today) — nothing to show,
 *      coast === current.
 *   2. Coast reachable — "If you stopped contributing today,
 *      you'd still Independence in 18y 4m. That's 6y 2m later than your
 *      current pace."
 *   3. Coast unreachable — "At current NW, contributions are
 *      essential. Keep saving."
 *
 * Hidden when the user is already in drawdown (monthsToIndependence == 0)
 * or when both projections never reach Independence (no insight to deliver).
 */
export function CoastIndependenceCard() {
  const { household, assumptions } = useActiveProjection();
  const a = useMemo(
    () => coastAnalysis(household, assumptions),
    [household, assumptions],
  );

  if (household.accounts.length === 0) return null;
  if (a.alreadyCoasting) return null;
  if (a.monthsContributing === 0) return null; // already Independence'd
  if (a.monthsContributing == null && a.monthsCoast == null) return null;

  const coastReachable = a.monthsCoast != null;

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">
          Coast-Independence
        </div>
        {coastReachable ? (
          <>
            <div className="mt-1.5 text-2xl font-semibold text-text num">
              {formatYearsMonths(a.monthsCoast!)}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              If you stopped contributing today, compounding alone
              would get you to Independence in that long.
              {a.monthsCostOfCoasting != null && a.monthsCostOfCoasting > 0
                ? ` That's ${formatYearsMonths(a.monthsCostOfCoasting)} later than your current pace.`
                : ""}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-dim">
              <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider">
                  Coasting
                </div>
                <div className="num mt-0.5 text-text">
                  {formatYearsMonths(a.monthsCoast!)}
                </div>
              </div>
              <div className="rounded-md border border-border bg-bg-elevated px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider">
                  Current pace
                </div>
                <div className="num mt-0.5 text-text">
                  {a.monthsContributing != null
                    ? formatYearsMonths(a.monthsContributing)
                    : "—"}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-1.5 text-sm font-medium text-text">
              Not yet coastable
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              At your current net worth, compounding alone can&apos;t
              reach your target in 70 years. Ongoing contributions
              are doing real work — keep saving.
            </div>
          </>
        )}
        <div className="mt-3 text-[10px] text-text-dim">
          Same projection engine as the headline Independence date, just with
          contributions zeroed. Honors your active scenario and
          member filter.
        </div>
      </div>
    </section>
  );
}
