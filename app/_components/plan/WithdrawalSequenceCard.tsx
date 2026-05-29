"use client";

import { useMemo, useState } from "react";
import { withdrawalSequence } from "@/lib/tax/withdrawalSequence";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { runWithdrawalSequence } from "@/lib/tax/withdrawalSequencer";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import { formatUSDCompact } from "@/lib/format";

/**
 * Tax-efficient withdrawal sequencer. Shows the user the
 * Bogleheads-consensus order to draw from accounts in retirement
 * (taxable → pre-tax → Roth → HSA) and how many months each
 * bucket independently covers at the household's planned annual
 * spend.
 *
 * Includes a year-by-year drawdown schedule powered by
 * `runWithdrawalSequence` (the engine that handles RMD math at
 * age 73+, tax gross-up, and per-bucket depletion tracking).
 *
 * The Independence projection itself doesn't model bucket
 * sequencing (it draws against aggregate NW), so this card adds a
 * layer of planning depth on top. The structural default is right
 * for ~80% of households; users with Roth-ladder /
 * RMD-bracket-smoothing strategies can ignore it.
 */
export function WithdrawalSequenceCard() {
  const { household, assumptions } = useActiveProjection();
  const annualSpend = useMemo(
    () => assumptions.targetNetWorthUSD * assumptions.withdrawalRate,
    [assumptions],
  );
  const seq = useMemo(
    () => withdrawalSequence(household, annualSpend),
    [household, annualSpend],
  );

  // Year-by-year simulation. Reads the bucket totals from the
  // existing aggregator and pushes them through the new engine.
  // Bucket name mapping: legacy uses pre_tax; engine uses pretax.
  const bucketTotals = useMemo(() => {
    const out = { taxable: 0, pretax: 0, roth: 0, hsa: 0 };
    for (const row of seq.rows) {
      if (row.bucket === "taxable") out.taxable = row.totalUSD;
      else if (row.bucket === "pre_tax") out.pretax = row.totalUSD;
      else if (row.bucket === "roth") out.roth = row.totalUSD;
      else if (row.bucket === "hsa") out.hsa = row.totalUSD;
    }
    return out;
  }, [seq.rows]);

  // Portfolio-weighted real CAGR as a single rate across all
  // buckets — the existing projection engine is per-account, but
  // this card aggregates so a single rate is the honest simple
  // model. Could be made per-bucket later (e.g. Roth runs equity-
  // heavy so might earn slightly more than the blended rate).
  const portfolio = useMemo(() => computePortfolio(household), [household]);
  const householdCAGR = portfolio.weightedRealCAGR ?? 0.05;

  // Start retirement at the YOUNGEST member's age, or 65 if no
  // ages configured. Round-5 audit fix: previously used the
  // OLDEST member's age, which made RMDs fire immediately for any
  // couple where one spouse was already 75+ — even if pre-tax
  // accounts belonged to the younger spouse, who legally
  // shouldn't have to take RMDs yet. Using the youngest age is
  // CONSERVATIVE (RMDs fire later → more tax-deferred growth).
  // True per-member RMD splitting is a future enhancement;
  // documenting the simplification is the right v1 trade-off.
  const startingAge = useMemo(() => {
    const ages = household.members
      .map((m) => m.age)
      .filter((a): a is number => a != null && a > 0);
    if (ages.length === 0) return 65;
    return Math.min(...ages);
  }, [household.members]);

  const sequencer = useMemo(
    () =>
      runWithdrawalSequence({
        startingBalances: bucketTotals,
        annualRealSpendUSD: annualSpend,
        realCAGRByBucket: {
          taxable: householdCAGR,
          pretax: householdCAGR,
          roth: householdCAGR,
          hsa: householdCAGR,
        },
        startingAge,
        retirementTaxRate: assumptions.retirementTaxRate ?? 0.2,
        // LTCG rate for taxable-bucket withdrawals (brokerage =
        // long-term capital gains, NOT ordinary income). Defaults
        // to ordinaryRate × 0.5 — rough proxy because the user's
        // single `retirementTaxRate` field captures ordinary
        // (typically 22-32% federal) while LTCG is 0/15/20%
        // federal. Round-5 audit fix.
        years: Math.max(1, assumptions.drawdownHorizonYears ?? 30),
      }),
    [
      bucketTotals,
      annualSpend,
      householdCAGR,
      startingAge,
      assumptions.retirementTaxRate,
      assumptions.drawdownHorizonYears,
    ],
  );

  const [showSchedule, setShowSchedule] = useState(false);

  const populated = seq.rows.filter((r) => r.totalUSD > 0);
  if (populated.length === 0) {
    // Don't silently vanish. Users adding their first accounts
    // need to know what this card will eventually show — and why
    // it's empty right now.
    return (
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="text-sm font-medium text-text">
            Drawdown sequence
          </div>
          <div className="mt-1 text-[11px] text-text-dim">
            Add retirement accounts with balances to see the Bogleheads-
            consensus drawdown order (taxable → pre-tax → Roth → HSA)
            and the year-by-year withdrawal schedule with RMD math.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div>
          <div className="text-sm font-medium text-text">
            Drawdown sequence
          </div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            The order to draw from your accounts in retirement. Default
            Bogleheads / tax-efficient sequence — adjust for your bracket
            and Roth-ladder plans.
          </div>
        </div>

        <ol className="mt-3 space-y-2">
          {populated.map((r, idx) => (
            <li
              key={r.bucket}
              className="rounded-md border border-border-strong bg-bg-elevated px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-text-dim">
                    Step {idx + 1}
                  </div>
                  <div className="text-[13px] font-semibold text-text">
                    {r.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-sm font-semibold text-text">
                    {formatUSDCompact(r.totalUSD)}
                  </div>
                  {r.monthsOfRunway != null && (
                    <div className="num text-[10px] text-text-dim">
                      {monthsLabel(r.monthsOfRunway)} of spend
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-1.5 text-[10px] leading-snug text-text-dim">
                {r.why}
              </div>
              {r.accounts.length > 1 && (
                <ul className="mt-2 space-y-0.5">
                  {r.accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between text-[10px]"
                    >
                      <span className="text-text-muted">{a.name}</span>
                      <span className="num text-text-dim">
                        {formatUSDCompact(a.valueUSD)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          Annual spend assumed:{" "}
          <span className="num text-text-muted">
            {formatUSDCompact(annualSpend)}
          </span>{" "}
          ({(assumptions.withdrawalRate * 100).toFixed(2)}% of Independence target).
        </div>

        {/* Year-by-year drawdown schedule (the engine) */}
        <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-muted">
                Year-by-year schedule
              </div>
              <div className="mt-0.5 text-[10px] text-text-dim">
                Real-$ projection over {assumptions.drawdownHorizonYears ?? 30} years
                {sequencer.depletedYear === -1 ? (
                  <>
                    {" "}— portfolio survives, ending at{" "}
                    <span className="num font-medium text-text">
                      {formatUSDCompact(sequencer.endingTotalUSD)}
                    </span>
                  </>
                ) : (
                  <>
                    {" "}—{" "}
                    <span className="font-medium text-negative">
                      depleted in year {sequencer.depletedYear + 1}
                    </span>
                  </>
                )}
                . Lifetime tax paid:{" "}
                <span className="num font-medium text-text">
                  {formatUSDCompact(sequencer.totalTaxesPaidUSD)}
                </span>
                .
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSchedule(!showSchedule)}
              className="rounded-md border border-border-strong bg-bg-surface px-2 py-0.5 text-[10px] font-medium text-text-muted active:opacity-70 hover:text-text"
            >
              {showSchedule ? "Hide" : "Show"}
            </button>
          </div>

          {showSchedule && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <Th>Yr</Th>
                    <Th>Age</Th>
                    <Th align="right">Taxable</Th>
                    <Th align="right">Pre-tax</Th>
                    <Th align="right">Roth</Th>
                    <Th align="right">HSA</Th>
                    <Th align="right">RMD</Th>
                    <Th align="right">Tax</Th>
                  </tr>
                </thead>
                <tbody>
                  {sequencer.rows.map((row) => (
                    <tr
                      key={row.year}
                      className={`border-b border-border/40 ${
                        row.depleted ? "text-negative/80" : "text-text-muted"
                      }`}
                    >
                      <Td>{row.year + 1}</Td>
                      <Td>{row.age}</Td>
                      <Td align="right" mono>
                        {formatUSDCompact(row.endingBalances.taxable)}
                      </Td>
                      <Td align="right" mono>
                        {formatUSDCompact(row.endingBalances.pretax)}
                      </Td>
                      <Td align="right" mono>
                        {formatUSDCompact(row.endingBalances.roth)}
                      </Td>
                      <Td align="right" mono>
                        {formatUSDCompact(row.endingBalances.hsa)}
                      </Td>
                      <Td align="right" mono>
                        {row.rmdAmountUSD > 0
                          ? formatUSDCompact(row.rmdAmountUSD)
                          : "—"}
                      </Td>
                      <Td align="right" mono>
                        {formatUSDCompact(row.taxesPaidUSD)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-[9px] leading-snug text-text-dim">
                Real $ (today&apos;s dollars). Balances shown are
                end-of-year. RMDs kick in at age 73 on the pre-tax
                bucket (SECURE 2.0 Uniform Lifetime Table). Tax
                column applies the configured retirement-era
                effective rate to taxable + pre-tax withdrawals;
                Roth/HSA are tax-free.
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
          <span className="font-semibold">Not financial advice.</span> Generic
          tax-efficient default — your situation may call for a different
          order (e.g. partial Roth conversions during the gap years, Social
          Security timing interactions, RMD bracket smoothing). Coordinate
          with a licensed CPA or fee-only fiduciary before executing.
        </div>
      </div>
    </section>
  );
}

function monthsLabel(months: number): string {
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={`px-1.5 py-1 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  mono,
}: {
  children: React.ReactNode;
  align?: "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-1.5 py-1 ${align === "right" ? "text-right" : ""} ${mono ? "num" : ""}`}
    >
      {children}
    </td>
  );
}
