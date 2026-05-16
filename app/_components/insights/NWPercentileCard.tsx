"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AGE_BAND_LABELS,
  ageToBand,
  getBandTable,
  nwPercentile,
  yearsSinceSCFSnapshot,
} from "@/lib/insights/nwPercentile";
import { householdAverageAge, householdNetWorth } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";

/**
 * "Where do I sit?" — net-worth percentile reference using the
 * 2022 Fed Survey of Consumer Finances by age band.
 *
 * Two viewing modes driven by the global member filter:
 *   - HOUSEHOLD (selectedMemberId === null): show all members'
 *     age inputs, average them into a single band, look up the
 *     percentile against household NW.
 *   - PER-MEMBER (selectedMemberId set): show only that member's
 *     age input, use that age's band, look up against that
 *     member's filtered NW (already member-scoped via
 *     useActiveProjection).
 *
 * Breakpoints are inflated forward from the SCF 2022 snapshot
 * using the user's `expectedInflationRate`. Without that, today's
 * (nominal) NW would compare against 2022-dollar bars and over-
 * report the user's percentile.
 *
 * Legacy localStorage migration (one-shot): older builds stored a
 * single `fp.userAge` integer in localStorage. We read it once on
 * mount, write it into the first member's age (if no member has
 * one yet), then clear the LS key. Age is now part of Member, so
 * it syncs through the household payload to IDB + Drive.
 */
const LEGACY_LS_KEY = "fp.userAge";

export function NWPercentileCard() {
  const { household, assumptions } = useActiveProjection();
  const setMemberAge = useAppStore((s) => s.setMemberAge);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const fullHousehold = useAppStore((s) => s.household);
  const nw = useMemo(() => householdNetWorth(household), [household]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEGACY_LS_KEY);
      if (!raw) return;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        window.localStorage.removeItem(LEGACY_LS_KEY);
        return;
      }
      const anyMemberAge = fullHousehold.members.some(
        (m) => m.age != null && m.age > 0,
      );
      if (!anyMemberAge && fullHousehold.members[0]) {
        setMemberAge(fullHousehold.members[0].id, n);
      }
      window.localStorage.removeItem(LEGACY_LS_KEY);
    } catch {
      /* localStorage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The age inputs respect the global filter: one member when
  // filtered, all members in household view. The household member
  // list ALWAYS comes from the unfiltered store (filterHousehold
  // doesn't trim members; this is for clarity at the call site).
  const membersForView = useMemo(() => {
    if (selectedMemberId) {
      const single = fullHousehold.members.find(
        (m) => m.id === selectedMemberId,
      );
      return single ? [single] : fullHousehold.members;
    }
    return fullHousehold.members;
  }, [fullHousehold.members, selectedMemberId]);

  // Age used for the band lookup:
  //   - single-member view → that member's age
  //   - household view → average across all members with set age
  const effectiveAge = useMemo(() => {
    if (selectedMemberId) {
      const m = fullHousehold.members.find((x) => x.id === selectedMemberId);
      return m?.age && m.age > 0 ? m.age : null;
    }
    return householdAverageAge(fullHousehold);
  }, [fullHousehold, selectedMemberId]);

  const band = effectiveAge != null ? ageToBand(effectiveAge) : null;

  // Inflation-adjusted breakpoints. yearsSinceSCFSnapshot returns
  // 0 before mid-2022, so old test fixtures and demo runs aren't
  // perturbed; for real users today, the 2022 breakpoints get
  // inflated forward to current-year dollars.
  const yearsForward = useMemo(() => yearsSinceSCFSnapshot(), []);
  const inflationRate = assumptions.expectedInflationRate ?? 0;
  const row = band
    ? getBandTable(band, inflationRate, yearsForward)
    : null;
  const percentile =
    band != null
      ? Math.round(nwPercentile(nw, band, inflationRate, yearsForward))
      : null;

  const isPerMember = selectedMemberId != null;
  const scopeName = isPerMember
    ? (membersForView[0]?.displayName ?? "Member")
    : "Household";

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-text">
              Net-worth percentile
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {isPerMember
                ? `Where ${scopeName}'s net worth lands against US households`
                : "Where your household lands against US households"}{" "}
              in the same age band. 2022 Fed SCF, inflation-adjusted to today.
            </div>
          </div>
          {isPerMember && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
              {scopeName} only
            </span>
          )}
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
            {membersForView.length > 1 ? "Age per member" : "Age"}
          </div>
          <ul className="space-y-1.5">
            {membersForView.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5"
              >
                <span className="flex-1 truncate text-sm text-text">
                  {m.displayName}
                </span>
                <NumberField
                  value={m.age ?? 0}
                  onChange={(v) => setMemberAge(m.id, v > 0 ? v : null)}
                  precision={0}
                  allowNegative={false}
                  className="num w-16 rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-right text-sm font-medium text-text outline-none"
                />
              </li>
            ))}
          </ul>
          {!isPerMember && membersForView.length > 1 && effectiveAge != null && (
            <div className="mt-1.5 flex items-baseline justify-between px-1 text-[10px] text-text-dim">
              <span>Household average</span>
              <span className="num text-text-muted">
                {effectiveAge.toFixed(1)}
              </span>
            </div>
          )}
          <div className="mt-1 px-1 text-[10px] text-text-dim">
            Synced through the household record + Drive backup.
          </div>
        </div>

        {band && row && percentile != null && (
          <>
            <div className="mt-4 rounded-md border border-border-strong bg-bg-elevated px-3 py-3">
              <div className="text-[10px] uppercase tracking-wider text-text-dim">
                {AGE_BAND_LABELS[band]} band
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="num text-2xl font-semibold text-text">
                  {percentile}
                </span>
                <span className="text-[12px] text-text-muted">
                  th percentile
                </span>
              </div>
              <div className="num mt-0.5 text-[11px] text-text-dim">
                {formatUSDCompact(nw)} {isPerMember ? `${scopeName} ` : "household "}
                net worth
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <PercentileBar label="p10" value={row.p10} nw={nw} />
              <PercentileBar label="p25" value={row.p25} nw={nw} />
              <PercentileBar label="Median" value={row.p50} nw={nw} bold />
              <PercentileBar label="p75" value={row.p75} nw={nw} />
              <PercentileBar label="p90" value={row.p90} nw={nw} />
              <PercentileBar label="p95" value={row.p95} nw={nw} />
              <PercentileBar label="p99" value={row.p99} nw={nw} />
            </div>
          </>
        )}

        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          Source: Federal Reserve Survey of Consumer Finances 2022 (released
          Sept 2023). Breakpoints scaled forward{" "}
          <span className="num">{yearsForward.toFixed(1)}</span> years at your
          assumed inflation rate ({(inflationRate * 100).toFixed(1)}%) so
          today&apos;s nominal NW compares against today&apos;s-dollar bars.
        </div>
        <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
          <span className="font-semibold">Directional benchmark, not a score.</span>{" "}
          Inflation-only extrapolation under-corrects for real wealth growth
          (asset prices typically outpace CPI), so percentiles above the
          median may read a touch high. SCF reports survey data with sampling
          uncertainty either way.
        </div>
      </div>
    </section>
  );
}

function PercentileBar({
  label,
  value,
  nw,
  bold,
}: {
  label: string;
  value: number;
  nw: number;
  bold?: boolean;
}) {
  const reached = nw >= value;
  return (
    <div
      className={`flex items-center justify-between text-[11px] ${bold ? "font-medium" : ""}`}
    >
      <span className={reached ? "text-positive" : "text-text-muted"}>
        {reached ? "✓ " : "  "}
        {label}
      </span>
      <span
        className={`num ${reached ? "text-positive/80" : "text-text-dim"}`}
      >
        {formatUSDCompact(value)}
      </span>
    </div>
  );
}
