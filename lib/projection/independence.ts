import { accountValue, accountWeightedCAGR } from "@/lib/types";
import type { Assumptions, Household } from "@/lib/types";

export type ProjectionPoint = {
  monthOffset: number;
  netWorthUSD: number;
  phase: "accumulation" | "drawdown";
  cumulativeContributionsUSD: number;
  startingPrincipalUSD: number;
};

export type IndependenceProjection = {
  monthsToIndependence: number | null;
  independenceDate: Date | null;
  series: ProjectionPoint[];
  independenceSeriesIndex: number | null;
  legacyAtHorizonUSD: number | null;
  sustained: boolean;
  monthlyWithdrawalUSD: number;
  ruinMonthIndex: number | null;
};

type ProjAccount = {
  id: string;
  balanceUSD: number;
  monthlyRate: number;
  monthlyContributionUSD: number;
};

type ProjLiability = {
  id: string;
  balanceUSD: number;
  monthlyRate: number;
  monthlyPaymentUSD: number;
};

export type StressMode = "none" | "lost-decade";

export type IndependenceOptions = {
  stress?: StressMode;
  /**
   * Optional per-year income offset (real $). `index[i]` is the
   * total real-dollar income from future-income streams in year
   * `i` of the projection (i = 0 is "now", i = 1 is one year out,
   * etc.).
   *
   * Effect: this is added month-by-month at amount `array[year] /
   * 12` to:
   *   - account balances during the ACCUMULATION phase (so an
   *     active consulting stream effectively boosts your
   *     contributions and pulls Independence Day in sooner);
   *   - the cash flow during the DRAWDOWN phase (so a Social
   *     Security or pension stream offsets the portfolio's
   *     monthly withdrawal — corpus lasts longer in lost-decade
   *     stress).
   *
   * Pre-compute via `incomePerYearUSD(streams, baseYear,
   * numYears)` at the call site. Indexes past the array length
   * read as 0 (defensive). The projection iterates up to ~70
   * years, so the caller should size the array to cover that.
   */
  incomePerYearUSD?: number[];
};

const STRESS_LOST_DECADE_MONTHS = 10 * 12;

const MAX_ACCUMULATION_MONTHS = 70 * 12;

export function projectIndependence(
  household: Household,
  assumptions: Assumptions,
  now: Date = new Date(),
  options: IndependenceOptions = {},
): IndependenceProjection {
  const stress: StressMode = options.stress ?? "none";
  const accounts: ProjAccount[] = household.accounts.map((a) => ({
    id: a.id,
    balanceUSD: accountValue(a),
    monthlyRate: monthlyRateFromAnnual(accountWeightedCAGR(a)),
    monthlyContributionUSD: a.monthlyContributionUSD,
  }));
  const liabilities: ProjLiability[] = household.liabilities.map((l) => ({
    id: l.id,
    balanceUSD: l.balanceUSD,
    monthlyRate: monthlyRateFromAnnual(l.annualInterestRate),
    monthlyPaymentUSD: l.monthlyPaymentUSD,
  }));

  const sumAccounts = () => accounts.reduce((s, a) => s + a.balanceUSD, 0);
  const sumLiabilities = () => liabilities.reduce((s, l) => s + l.balanceUSD, 0);
  const netWorth = () => sumAccounts() - sumLiabilities();

  const startingPrincipalUSD = netWorth();
  let cumulativeContributionsUSD = 0;
  const series: ProjectionPoint[] = [
    {
      monthOffset: 0,
      netWorthUSD: startingPrincipalUSD,
      phase: "accumulation",
      cumulativeContributionsUSD: 0,
      startingPrincipalUSD,
    },
  ];

  const sortedPhases = (assumptions.drawdownPhases ?? [])
    .filter((p) => p.startMonthsAfterIndependence > 0)
    .slice()
    .sort((a, b) => a.startMonthsAfterIndependence - b.startMonthsAfterIndependence);
  let nextPhaseIndex = 0;

  let independenceMonth: number | null = null;
  let monthlyWithdrawalUSD = 0;
  let ruinMonthIndex: number | null = null;

  if (netWorth() >= assumptions.targetNetWorthUSD) {
    independenceMonth = 0;
    // Draw against ACTUAL Independence-day net worth, not the planned target.
    // The mid-projection Independence crossing (further down) uses `nw`; this
    // startup-already-Independence'd branch previously used the target, which
    // capped withdrawals lower than the assumption "% of Independence-day net
    // worth" promised. Aligning both branches removes the inconsistency.
    monthlyWithdrawalUSD = (netWorth() * assumptions.withdrawalRate) / 12;
    series[0] = { ...series[0], phase: "drawdown" };
  }

  const horizonMonths = assumptions.drawdownHorizonYears * 12;
  let month = 0;

  // Pre-compute the per-month income offset. The user-supplied
  // array is YEAR-indexed (matching the MC sim); divide by 12 to
  // amortize across each month in the year. Year-index for month
  // `month` is `floor((month - 1) / 12)` since month 0 is the
  // starting snapshot and month 1 is the FIRST month of cash
  // flow. Defensive ?? 0 keeps the no-streams case as a pure
  // no-op.
  const incomeYears = options.incomePerYearUSD ?? [];
  const incomeForMonth = (month: number): number => {
    if (incomeYears.length === 0) return 0;
    const yearIdx = Math.max(0, Math.floor((month - 1) / 12));
    return (incomeYears[yearIdx] ?? 0) / 12;
  };

  while (true) {
    month++;
    if (independenceMonth === null && month > MAX_ACCUMULATION_MONTHS) break;

    const inLostDecade =
      stress === "lost-decade" &&
      independenceMonth !== null &&
      month - independenceMonth <= STRESS_LOST_DECADE_MONTHS;

    const monthlyIncome = incomeForMonth(month);

    for (const a of accounts) {
      const rate = inLostDecade ? 0 : a.monthlyRate;
      a.balanceUSD *= 1 + rate;
      if (independenceMonth === null) {
        a.balanceUSD += a.monthlyContributionUSD;
        cumulativeContributionsUSD += a.monthlyContributionUSD;
      }
    }
    // Future-income / distribution streams during ACCUMULATION:
    //   - POSITIVE monthlyIncome (the typical case — part-time
    //     work, rental income, etc.) boosts the largest account
    //     so the cash flow lands somewhere identifiable (mirrors
    //     the contribution flow).
    //   - NEGATIVE monthlyIncome (partial-coast distribution —
    //     user pulls from the portfolio during a sabbatical or
    //     step-down period before formal retirement) drains all
    //     accounts proportionally, mirroring the drawdown-phase
    //     logic below. Single-account concentration is avoided
    //     so the distribution doesn't accidentally zero out one
    //     bucket while leaving others intact.
    // During drawdown, income offsets the withdrawal (handled
    // below; negative income simply makes the net withdrawal
    // larger).
    if (independenceMonth === null && monthlyIncome !== 0 && accounts.length > 0) {
      if (monthlyIncome > 0) {
        let biggest = accounts[0];
        for (const a of accounts) if (a.balanceUSD > biggest.balanceUSD) biggest = a;
        biggest.balanceUSD += monthlyIncome;
      } else {
        const draw = -monthlyIncome;
        const total = sumAccounts();
        if (total > 0) {
          for (const a of accounts) {
            const share = a.balanceUSD / total;
            a.balanceUSD = Math.max(0, a.balanceUSD - draw * share);
          }
        }
      }
      // Signed update: positive contributes, negative subtracts
      // from the cumulative net inflow figure. Net read is
      // "total real-dollar money flowing into the portfolio over
      // accumulation, after offsetting any pre-retirement
      // distributions" — which is what the ContributionMix
      // breakdown wants to show for partial-coast scenarios.
      cumulativeContributionsUSD += monthlyIncome;
    }
    for (const l of liabilities) {
      l.balanceUSD = Math.max(
        0,
        l.balanceUSD * (1 + l.monthlyRate) - l.monthlyPaymentUSD,
      );
    }

    if (independenceMonth !== null) {
      const monthsAfterIndependence = month - independenceMonth;
      while (
        nextPhaseIndex < sortedPhases.length &&
        monthsAfterIndependence >= sortedPhases[nextPhaseIndex].startMonthsAfterIndependence
      ) {
        const phase = sortedPhases[nextPhaseIndex];
        const remaining = sumAccounts();
        monthlyWithdrawalUSD = Math.max(0, (remaining * phase.withdrawalRate) / 12);
        nextPhaseIndex++;
      }
      // Income reduces the NET withdrawal during drawdown. Clamp
      // to >= 0 — if income exceeds the SWR-based withdrawal,
      // the simulator allows portfolios to GROW during income
      // years (matches reality: someone with $200k consulting +
      // $80k SWR-withdrawal actually saves $120k that year). We
      // surface the boost via the accumulation-style biggest-
      // account credit so it lands in a real bucket.
      const netWithdrawal = Math.max(0, monthlyWithdrawalUSD - monthlyIncome);
      const surplusIncome =
        monthlyIncome > monthlyWithdrawalUSD
          ? monthlyIncome - monthlyWithdrawalUSD
          : 0;
      const total = sumAccounts();
      if (total > 0) {
        for (const a of accounts) {
          const share = a.balanceUSD / total;
          a.balanceUSD = Math.max(0, a.balanceUSD - netWithdrawal * share);
        }
      }
      if (surplusIncome > 0 && accounts.length > 0) {
        let biggest = accounts[0];
        for (const a of accounts)
          if (a.balanceUSD > biggest.balanceUSD) biggest = a;
        biggest.balanceUSD += surplusIncome;
      }
    }

    const nw = netWorth();
    const phase: "accumulation" | "drawdown" =
      independenceMonth === null ? "accumulation" : "drawdown";
    series.push({
      monthOffset: month,
      netWorthUSD: nw,
      phase,
      cumulativeContributionsUSD,
      startingPrincipalUSD,
    });

    if (independenceMonth === null && nw >= assumptions.targetNetWorthUSD) {
      independenceMonth = month;
      monthlyWithdrawalUSD = (nw * assumptions.withdrawalRate) / 12;
    }

    if (
      independenceMonth !== null &&
      ruinMonthIndex === null &&
      sumAccounts() <= 0 &&
      month - independenceMonth > 0
    ) {
      ruinMonthIndex = series.length - 1;
    }

    if (independenceMonth !== null && month - independenceMonth >= horizonMonths) break;
  }

  const last = series[series.length - 1];
  const legacyAtHorizonUSD = independenceMonth === null ? null : last.netWorthUSD;
  const sustained =
    independenceMonth !== null && last.netWorthUSD >= assumptions.legacyFloorUSD;

  const independenceDate = independenceMonth === null ? null : addMonths(now, independenceMonth);

  return {
    monthsToIndependence: independenceMonth,
    independenceDate,
    series,
    independenceSeriesIndex: independenceMonth,
    legacyAtHorizonUSD,
    sustained,
    monthlyWithdrawalUSD,
    ruinMonthIndex,
  };
}

function monthlyRateFromAnnual(annual: number): number {
  if (annual === 0) return 0;
  if (annual <= -0.999) return -0.999;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}
