"use client";

/**
 * Educational callouts displayed alongside leverage-bearing
 * holdings. Each note is purely informational — it shows up in
 * both the HoldingCreator and the HoldingEditor when the relevant
 * condition holds.
 *
 * The pair is intentionally symmetric so the user can compare:
 *   - {@link MortgageLeverageNote} reassures that a 5× mortgaged
 *     home is structurally safer than a 5× leveraged ETF.
 *   - {@link DailyResetLeverageNote} warns that daily-reset LETFs
 *     decay over time and don't deliver N× the underlying long-run
 *     return.
 *
 * They share the same "Heads up · …" header style so a user
 * scanning the page reads them as analogous risk notes.
 */

/**
 * Real-estate mortgage leverage note. Shown when a property's
 * leverage > 1× (i.e. there's an active mortgage). Explains
 * three reasons mortgage leverage is structurally safer than
 * synthetic / margin / LETF leverage at the same nominal ratio.
 */
export function MortgageLeverageNote() {
  return (
    <div className="mt-2 rounded-md border border-positive/30 bg-positive/5 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-positive">
        Heads up · mortgage leverage is structurally safer
      </div>
      <ul className="mt-1 space-y-1 text-[11px] text-text-muted">
        <li>
          <span className="text-text">Lower volatility</span> — housing
          moves ~3-5% / yr stdev vs ~15-20% / yr for stocks. A 5×
          mortgaged home feels nothing like a 5× leveraged ETF.
        </li>
        <li>
          <span className="text-text">Fixed debt, no daily reset</span> —
          your mortgage balance is set; daily-reset leveraged ETFs
          (TQQQ, UPRO) bleed value through volatility decay because
          they re-lever every trading day.
        </li>
        <li>
          <span className="text-text">No forced liquidation</span> —
          keep making the payment and the bank can&apos;t margin-call
          you. Leveraged stock positions can be force-sold at the
          worst possible moment.
        </li>
      </ul>
    </div>
  );
}

/**
 * Daily-reset leveraged ETF warning. Shown when an equity or bond
 * holding has leverage > 1× (e.g. TQQQ, UPRO, SPXL, TMF).
 * Symmetric to {@link MortgageLeverageNote}: same shape, opposite
 * conclusion — volatility decay + margin risk + conservative-CAGR
 * advice.
 */
export function DailyResetLeverageNote() {
  return (
    <div className="mt-2 rounded-md border border-amber-300/40 bg-amber-300/5 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-amber-300">
        Heads up · daily-reset leverage decays over time
      </div>
      <ul className="mt-1 space-y-1 text-[11px] text-text-muted">
        <li>
          <span className="text-text">Volatility decay</span> — leveraged
          ETFs (TQQQ, UPRO, SPXL, TMF) re-lever every trading day.
          Choppy markets erode value even when the underlying is flat;
          the 3× index doesn&apos;t deliver 3× the underlying&apos;s long-
          run return.
        </li>
        <li>
          <span className="text-text">Margin call risk</span> — if you
          built leverage from a portfolio margin loan rather than an
          LETF, a drawdown can force-sell at the worst moment. Real-
          estate leverage doesn&apos;t carry that risk.
        </li>
        <li>
          <span className="text-text">Conservative CAGR</span> — long-
          horizon real returns from daily-reset LETFs typically lag a
          pure leverage-multiplied buy-and-hold by 1-3 pts / yr.
          Consider trimming your expected real CAGR accordingly.
        </li>
      </ul>
    </div>
  );
}
