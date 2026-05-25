"use client";

import { Fragment, useEffect, useMemo } from "react";
import {
  HISTORICAL_REAL_RETURNS,
  HISTORICAL_RETURNS_FIRST_YEAR,
  HISTORICAL_RETURNS_LAST_YEAR,
  LEVERAGED_2X_PROJECTION,
  LEVERAGED_2X_REAL_DATA_START_YEAR,
} from "@/lib/data/historicalReturns";

/**
 * Reference-data viewer for the historical-MC engine's input series.
 *
 * UX intent: the MC card lists "Data source: Damodaran …" as a small
 * footnote. Power users (and skeptics) reasonably want to actually
 * SEE the year-by-year numbers — what 1929 looked like, why 1966
 * keeps showing up as a worst-start, what real-terms 2008 was vs the
 * headline nominal -37%. This modal surfaces all of that without
 * leaving the projection page.
 *
 * Engineering notes:
 *  - Bottom-sheet on mobile (≤ sm), centered modal on desktop, mirroring
 *    the IncomePanel add-stream dialog pattern.
 *  - Backdrop-click + Escape + explicit Close button all dismiss.
 *  - Sticky header row + sticky year column so scrolling 98 rows ×
 *    7 cols stays readable.
 *  - Negative real returns rendered in `text-negative` for instant
 *    visual scanning of the bad-decade clusters.
 *  - 2x Stocks column shows a small amber "P" chip on years that
 *    use the calibrated projection formula (pre-2001) vs direct
 *    RYTNX-derived real data (2001+). The footer documents the
 *    formula + RMSE so the projection isn't presented as ground
 *    truth.
 */
export function HistoricalReturnsTableModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Escape-to-close. Listener only attaches while the modal is open
  // so it doesn't compete with other Escape handlers (e.g. edit
  // sheets) when this one is dismissed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Pre-compute display rows — pure on the imported dataset, so this
  // memo isn't strictly necessary (data is static), but it keeps
  // intent explicit + ready for any future filtering (e.g. jump-to-
  // year).
  const rows = useMemo(() => HISTORICAL_REAL_RETURNS, []);

  if (!open) return null;

  return (
    <Fragment>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hist-returns-title"
        className="fixed inset-0 z-50"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden
        />
        <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-3xl border-t border-border-strong bg-bg-surface sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-h-[85dvh] sm:max-w-3xl sm:rounded-3xl sm:border">
          {/* Header — sticky relative to the modal so the close
              button stays reachable while the table scrolls. */}
          <div className="border-b border-border bg-bg-surface px-5 pb-3 pt-3">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-text-dim">
                  Historical Monte Carlo
                </div>
                <div
                  id="hist-returns-title"
                  className="text-lg font-semibold text-text"
                >
                  Real annual returns, {HISTORICAL_RETURNS_FIRST_YEAR}–
                  {HISTORICAL_RETURNS_LAST_YEAR}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-text-dim">
                  CPI-deflated to real terms. Source: Damodaran Jan 2026
                  refresh ({HISTORICAL_REAL_RETURNS.length} years), plus
                  RYTNX-derived 2x SPY (real for{" "}
                  {LEVERAGED_2X_REAL_DATA_START_YEAR}+, projected via
                  calibrated formula for{" "}
                  {HISTORICAL_RETURNS_FIRST_YEAR}–
                  {LEVERAGED_2X_REAL_DATA_START_YEAR - 1}).
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
              >
                Close
              </button>
            </div>
          </div>

          {/* Scrollable table. The container handles overflow; sticky
              header + sticky first column stay locked while scrolling
              in either direction. */}
          <div className="max-h-[60dvh] overflow-auto sm:max-h-[60dvh]">
            <table className="min-w-full border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="text-text-dim">
                  <Th sticky>Year</Th>
                  <Th>Stocks</Th>
                  <Th>Bonds</Th>
                  <Th>Cash</Th>
                  <Th>Corp Bonds</Th>
                  <Th>RE</Th>
                  <Th>Gold</Th>
                  <Th>
                    2x Stocks
                    <span className="ml-1 text-[9px] uppercase text-text-dim">
                      (RYTNX)
                    </span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.year}
                    className="border-t border-border-strong/30"
                  >
                    <Td sticky bold>
                      {r.year}
                    </Td>
                    <Td>{formatPct(r.stocks)}</Td>
                    <Td>{formatPct(r.bonds)}</Td>
                    <Td>{formatPct(r.cash)}</Td>
                    <Td>{formatPct(r.corpBonds)}</Td>
                    <Td>{formatPct(r.realEstate)}</Td>
                    <Td>{formatPct(r.gold)}</Td>
                    <Td>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {formatPct(r.stocks2x)}
                        {r.stocks2xSource === "projected" && (
                          <span
                            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-amber-300/50 bg-amber-300/10 text-[8px] font-bold leading-none text-amber-300"
                            title="Projected via calibrated formula — no direct LETF data exists pre-2001"
                            aria-label="projected"
                          >
                            P
                          </span>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer — methodology disclosure. Anyone scrutinizing the
              data deserves to see the projection formula + fit
              quality, not just a single asterisk. */}
          <div className="border-t border-border bg-bg-surface px-5 py-3 text-[10px] leading-snug text-text-dim">
            <div>
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-amber-300/50 bg-amber-300/10 text-[8px] font-bold leading-none text-amber-300">
                P
              </span>{" "}
              = projected. For{" "}
              {HISTORICAL_RETURNS_FIRST_YEAR}–
              {LEVERAGED_2X_REAL_DATA_START_YEAR - 1}, the 2x SPY column
              uses{" "}
              <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[10px]">
                r_2x ≈ {LEVERAGED_2X_PROJECTION.aCoefficient.toFixed(2)}·r +{" "}
                {LEVERAGED_2X_PROJECTION.bCoefficient.toFixed(2)}·r²{" "}
                {LEVERAGED_2X_PROJECTION.dragRealAnnual.toFixed(2)}
              </code>
              , calibrated via OLS against real RYTNX 2001–2025 (RMSE{" "}
              {LEVERAGED_2X_PROJECTION.calibrationRmsePct.toFixed(2)}%,
              MAE {LEVERAGED_2X_PROJECTION.calibrationMaePct.toFixed(2)}%).
              The 0.82 r² coefficient captures daily-reset compounding
              (bull-year geometric bonus and bear-year drag-mitigation);
              the −0.05 captures combined fee + financing-cost drag in
              real terms.
            </div>
            <div className="mt-2">
              Past returns don&apos;t predict future ones.
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  );
}

/* ─── Local presentation helpers ─────────────────────────────── */

function Th({
  children,
  sticky,
}: {
  children: React.ReactNode;
  sticky?: boolean;
}) {
  return (
    <th
      className={`sticky top-0 z-10 bg-bg-surface px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wider ${
        sticky
          ? "left-0 z-20 border-r border-border-strong/30 text-left"
          : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  sticky,
  bold,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  bold?: boolean;
}) {
  return (
    <td
      className={`px-2.5 py-1.5 text-right tabular-nums ${
        sticky
          ? "sticky left-0 bg-bg-surface border-r border-border-strong/30 text-left"
          : ""
      } ${bold ? "font-semibold text-text" : "text-text-muted"}`}
    >
      {children}
    </td>
  );
}

function formatPct(v: number): React.ReactNode {
  const pct = v * 100;
  // 1 decimal place is plenty for visual scanning; the underlying
  // data stores 4 dp but extra precision adds noise to the table.
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const isNegative = v < 0;
  return (
    <span className={isNegative ? "text-negative" : "text-text-muted"}>
      {text}
    </span>
  );
}
