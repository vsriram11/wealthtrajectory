import { projectIndependence, type IndependenceProjection } from "@/lib/projection/independence";
import { computePortfolio } from "@/lib/portfolio/portfolio";
import type { Snapshot } from "@/lib/persistence/persistence";
import { staleManualHoldings } from "@/lib/data/staleness";
import { totalMonthlyContributions, type Assumptions, type Household } from "@/lib/types";
import { formatPercent2, formatUSD, formatYearsMonths } from "@/lib/format";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type Insight = {
  id: string;
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "warning";
};

const SENSITIVITY_BUMP = 500;

export function generateInsights(
  household: Household,
  assumptions: Assumptions,
  projection: IndependenceProjection,
  snapshots: Snapshot[] = [],
): Insight[] {
  const out: Insight[] = [];
  const portfolio = computePortfolio(household);
  const totalContrib = totalMonthlyContributions(household);

  // PRD §7.8 "You gained $5,200 this month." Plus a year-over-year
  // companion when there's a snapshot ~12 months back. The 1Y view
  // is the more honest investment-return read because contributions
  // average out over the longer window (we still subtract them
  // explicitly below).
  const annualGain = annualDelta(portfolio.netWorthUSD, snapshots);
  if (annualGain != null) {
    const delta = annualGain.delta;
    const yoyPct = annualGain.priorNW > 0 ? delta / annualGain.priorNW : 0;
    const contribAnnual = totalContrib * 12;
    const fromGrowth = delta - contribAnnual;
    const positive = delta >= 0;
    out.push({
      id: "yoy-return",
      title: positive
        ? `Up ${formatUSD(delta)} year-over-year (${(yoyPct * 100).toFixed(1)}%)`
        : `Down ${formatUSD(Math.abs(delta))} year-over-year (${(yoyPct * 100).toFixed(1)}%)`,
      detail:
        contribAnnual > 0
          ? `${formatUSD(contribAnnual)} from savings; market contribution ${formatUSD(fromGrowth)}.`
          : "Tracked across 12 months of snapshots.",
      tone: positive ? "positive" : "warning",
    });
  }

  const monthlyGain = monthlyDelta(portfolio.netWorthUSD, snapshots);
  if (monthlyGain != null) {
    const delta = monthlyGain.delta;
    const fromContrib = totalContrib; // approximate; assumes the prior
    // snapshot was ~30d ago, in which case the user contributed
    // roughly one month's worth between then and now.
    const fromGrowth = delta - fromContrib;
    const positive = delta >= 0;
    const headline = positive
      ? `You gained ${formatUSD(delta)} this month`
      : `You lost ${formatUSD(Math.abs(delta))} this month`;
    const detail =
      Math.abs(fromContrib) > 0
        ? positive && fromGrowth > 0
          ? `${formatUSD(fromContrib)} from savings + ${formatUSD(fromGrowth)} from market growth.`
          : positive
            ? `${formatUSD(fromContrib)} from savings; market gave back ${formatUSD(Math.abs(fromGrowth))}.`
            : `Savings added ${formatUSD(fromContrib)}; market drawdown was ${formatUSD(Math.abs(fromGrowth))}.`
        : positive
          ? "Tracked since the last monthly snapshot."
          : "Worth checking the cause — market drawdown vs cash outflow.";
    out.push({
      id: "monthly-gain",
      title: headline,
      detail,
      tone: positive ? "positive" : "warning",
    });
  }

  if (assumptions.targetNetWorthUSD > 0) {
    const pct = portfolio.netWorthUSD / assumptions.targetNetWorthUSD;
    out.push({
      id: "progress",
      title: `${(pct * 100).toFixed(0)}% of the way to target`,
      detail: projection.independenceDate
        ? `${formatYearsMonths(projection.monthsToIndependence!)} at ${formatUSD(totalContrib)}/mo`
        : "Out of reach at current pace.",
      tone: projection.independenceDate ? "positive" : "warning",
    });
  }

  if (portfolio.netWorthUSD > 0) {
    // Expected-growth contribution per class = value × class CAGR.
    // Compare across ALL non-trivial classes (not just stocks/bonds/
    // cash) so a private-stock-heavy or RE-heavy household sees
    // accurate attribution.
    const eqExp = portfolio.classes.equityUSD * weightedClassCAGR(household, "equity");
    const bondExp = portfolio.classes.bondUSD * weightedClassCAGR(household, "bond");
    const cashExp =
      portfolio.classes.cashUSD * weightedClassCAGR(household, "cash");
    const cryptoExp =
      portfolio.classes.cryptoUSD * weightedClassCAGR(household, "crypto");
    const commodityExp =
      portfolio.classes.commodityUSD *
      weightedClassCAGR(household, "commodity");
    const reExp =
      portfolio.classes.realEstateUSD *
      weightedClassCAGR(household, "real_estate");
    const psExp =
      portfolio.classes.privateStockUSD *
      weightedClassCAGR(household, "private_stock");
    const otherExp =
      portfolio.classes.otherUSD * weightedClassCAGR(household, "other");
    const totalExp = eqExp + bondExp + cashExp + cryptoExp + commodityExp + reExp + psExp + otherExp;
    if (totalExp > 0) {
      const equityShare = eqExp / totalExp;
      out.push({
        id: "growth-mix",
        title: `Equities drive ${(equityShare * 100).toFixed(0)}% of expected growth`,
        detail: `${formatUSD(portfolio.classes.equityUSD)} stocks · ${formatUSD(portfolio.classes.bondUSD)} bonds · ${formatUSD(portfolio.classes.cashUSD)} cash`,
        tone: "neutral",
      });
    }
  }

  if (projection.monthsToIndependence != null && projection.monthsToIndependence > 6) {
    const sensitivity = findHighestLeverageAccount(
      household,
      assumptions,
      projection.monthsToIndependence,
    );
    if (sensitivity && sensitivity.monthsSaved > 0.5) {
      out.push({
        id: "sensitivity",
        title: `+${formatUSD(SENSITIVITY_BUMP)}/mo to ${sensitivity.accountName} → Independence ${formatYearsMonths(sensitivity.monthsSaved)} sooner`,
        detail: "Highest-leverage account for incremental savings.",
        tone: "positive",
      });
    }
  }

  if (
    portfolio.classes.cashUSD > 0 &&
    portfolio.classes.cashShare > 0.05 &&
    portfolio.cash.weightedRealCAGR < 0.005
  ) {
    out.push({
      id: "cash-drag",
      title: `${formatUSD(portfolio.classes.cashUSD)} sitting in low-yield cash`,
      detail: `${(portfolio.classes.cashShare * 100).toFixed(0)}% of net worth earning under 0.5% real — moving some to a HYSA or T-bills cuts the drag.`,
      tone: "warning",
    });
  }

  if (highestRateLiability(household)) {
    const liab = highestRateLiability(household)!;
    if (liab.annualInterestRate >= 0.06) {
      out.push({
        id: "high-rate-liability",
        title: `${liab.name} accrues at ${formatPercent2(liab.annualInterestRate)}`,
        detail: `Paying it down beats the long-run real return on most equity portfolios. ${formatUSD(liab.balanceUSD)} outstanding.`,
        tone: "warning",
      });
    }
  }

  // Concentration risk: any single ticker > 25% of total net worth.
  // Roll up all holdings by symbol (so VOO in 401k + VOO in brokerage
  // count together) and warn on the biggest offender if it crosses
  // the threshold. Excludes cash because the cash "asset class"
  // doesn't carry idiosyncratic single-position risk.
  if (portfolio.netWorthUSD > 0) {
    const top = topConcentration(household);
    if (top && top.share > 0.25) {
      out.push({
        id: "concentration",
        title: `${top.label} is ${(top.share * 100).toFixed(0)}% of your net worth`,
        detail: `${formatUSD(top.valueUSD)} in a single position. Single-stock or single-property concentration adds idiosyncratic risk on top of market risk.`,
        tone: "warning",
      });
    }
  }

  // Effective leverage warning. Above 2× the portfolio is taking on
  // meaningful path-dependence — a 50% drawdown wipes out the equity
  // entirely. Below 1.25× we don't bother flagging.
  if (
    portfolio.netWorthUSD > 0 &&
    portfolio.effectiveLeverage >= 2
  ) {
    out.push({
      id: "leverage-warning",
      title: `Effective leverage ${portfolio.effectiveLeverage.toFixed(2)}×`,
      detail: `A ${Math.round((1 - 1 / portfolio.effectiveLeverage) * 100)}% drop in the underlying assets wipes out your equity. Worth knowing before the next correction.`,
      tone: portfolio.effectiveLeverage >= 3 ? "warning" : "neutral",
    });
  }

  // Tax-bucket balance: highlight single-bucket portfolios as a
  // drawdown flexibility concern. The classic "all in pre-tax 401k"
  // case means every dollar of retirement income is ordinary-income-
  // taxed. Multi-bucket portfolios get flexibility to optimize
  // brackets year-by-year. This insight is gentle (neutral tone) —
  // suggestion, not warning.
  const taxOut = taxBucketInsight(household, portfolio.netWorthUSD);
  if (taxOut) out.push(taxOut);

  // Manual-price staleness: surface manually-priced holdings whose
  // lastPricedAt is > 60 days old. Without this nudge, a private-
  // stock 409A or a manual crypto entry silently drifts as the
  // portfolio totals stay stuck at the old value.
  const stale = staleManualHoldings(household);
  if (stale.length > 0) {
    const top = stale[0];
    const more =
      stale.length > 1
        ? ` (and ${stale.length - 1} other${stale.length === 2 ? "" : "s"})`
        : "";
    out.push({
      id: "stale-manual",
      title: `Update ${top.symbol} — ${top.daysSinceUpdate} days since last priced${more}`,
      detail:
        "Manual-priced holdings drift silently. Tap into the holding to refresh the value when you have a recent statement or 409A.",
      tone: "neutral",
    });
  }

  return out;
}

function taxBucketInsight(
  household: Household,
  netWorth: number,
): Insight | null {
  if (netWorth <= 0) return null;
  const buckets = totalsByTaxTreatment(household);
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  // Count active buckets and find the dominant one.
  let active = 0;
  let topKey = "";
  let topShare = 0;
  for (const [k, v] of Object.entries(buckets)) {
    if (v <= 0) continue;
    active++;
    const share = v / total;
    if (share > topShare) {
      topShare = share;
      topKey = k;
    }
  }
  // Threshold: >85% in a single bucket triggers the gentle nudge.
  if (active === 0 || topShare < 0.85) return null;

  const label =
    topKey === "PRE_TAX"
      ? "pre-tax (401(k) / traditional IRA)"
      : topKey === "ROTH"
        ? "Roth"
        : topKey === "HSA"
          ? "HSA"
          : topKey === "EDUCATION"
            ? "529 / education"
            : "taxable";
  const suggestion =
    topKey === "PRE_TAX"
      ? "Consider funding a Roth (tax-free growth) or HSA (triple-tax-advantaged) — gives you bracket-management flexibility in retirement."
      : topKey === "ROTH"
        ? "Consider a pre-tax 401(k) deduction if you're in a high-income year — defer the tax bill to lower-income retirement years."
        : topKey === "TAXABLE"
          ? "Consider a 401(k) or IRA — sheltering growth from annual taxes can compound meaningfully over decades."
          : "Most of your net worth sits in one tax bucket — diversifying across pre-tax / Roth / taxable gives more drawdown flexibility.";
  return {
    id: "tax-bucket-concentration",
    title: `${Math.round(topShare * 100)}% of net worth is in ${label}`,
    detail: suggestion,
    tone: "neutral",
  };
}

function totalsByTaxTreatment(
  household: Household,
): Record<string, number> {
  // Mirror of taxBucketTotals but inlined here to avoid the named
  // dependency that types.ts already exports — keeps the insight
  // pure-local.
  const out: Record<string, number> = {
    PRE_TAX: 0,
    ROTH: 0,
    HSA: 0,
    TAXABLE: 0,
    EDUCATION: 0,
  };
  const byCat: Record<string, string> = {
    "401K": "PRE_TAX",
    TRAD_IRA: "PRE_TAX",
    ROTH_401K: "ROTH",
    ROTH_IRA: "ROTH",
    HSA: "HSA",
    BROKERAGE: "TAXABLE",
    SAVINGS: "TAXABLE",
    CHECKING: "TAXABLE",
    CRYPTO: "TAXABLE",
    REAL_ESTATE: "TAXABLE",
    OTHER: "TAXABLE",
    FIVE_29: "EDUCATION",
    // See TAX_TREATMENT_BY_CATEGORY in lib/types.ts — Trump Accounts
    // route through the EDUCATION bucket alongside 529s.
    TRUMP_ACCOUNT: "EDUCATION",
  };
  for (const a of household.accounts) {
    const bucket = byCat[a.category] ?? "TAXABLE";
    const v = a.holdings.reduce((s, h) => s + h.valueUSD, 0);
    out[bucket] += v;
  }
  return out;
}

/**
 * Find the largest single-symbol concentration as a share of total
 * net worth. Sums across accounts (a user might hold VOO in three
 * different brokerages — it's still one position from a risk
 * perspective). Real-estate properties and private-stock companies
 * are each their own concentration too. Returns null if there's
 * nothing to report.
 */
function topConcentration(
  household: Household,
): { label: string; valueUSD: number; share: number } | null {
  const totals = new Map<string, { label: string; valueUSD: number }>();
  let grandTotal = 0;
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      let key: string | null = null;
      let label = "";
      if (
        h.kind === "equity" ||
        h.kind === "bond" ||
        h.kind === "crypto" ||
        h.kind === "commodity"
      ) {
        const sym = h.symbol.toUpperCase();
        key = `${h.kind}:${sym}`;
        label = sym;
      } else if (h.kind === "private_stock") {
        key = `private:${h.symbol}`;
        label = `${h.symbol} (private)`;
      } else if (h.kind === "real_estate" || h.kind === "other") {
        key = `${h.kind}:${h.name}`;
        label = h.name;
      }
      if (!key) continue;
      const prev = totals.get(key);
      totals.set(key, {
        label,
        valueUSD: (prev?.valueUSD ?? 0) + h.valueUSD,
      });
      grandTotal += h.valueUSD;
    }
  }
  if (grandTotal <= 0 || totals.size === 0) return null;
  let best: { label: string; valueUSD: number } | null = null;
  for (const v of totals.values()) {
    if (!best || v.valueUSD > best.valueUSD) best = v;
  }
  if (!best) return null;
  return { ...best, share: best.valueUSD / grandTotal };
}

/**
 * Find the most recent snapshot that's at least ~30 days old and
 * return today's-NW vs that snapshot's NW delta. Returns null if
 * there's no usable comparison snapshot (e.g. brand-new user or
 * only same-day snapshots).
 */
/**
 * Find a snapshot roughly 1 year old (within ±30 days). Tolerant
 * range — we don't expect users to save snapshots on a perfect
 * cadence. Returns null if there's no suitable comparison point.
 */
function annualDelta(
  currentNW: number,
  snapshots: Snapshot[],
  now = Date.now(),
): { delta: number; priorT: number; priorNW: number } | null {
  if (snapshots.length === 0) return null;
  const target = now - ONE_YEAR_MS;
  const window = 30 * 24 * 60 * 60 * 1000;
  let best: Snapshot | null = null;
  let bestDist = Infinity;
  for (const s of snapshots) {
    const dist = Math.abs(s.t - target);
    if (dist > window) continue;
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  if (!best) return null;
  return {
    delta: currentNW - best.netWorthUSD,
    priorT: best.t,
    priorNW: best.netWorthUSD,
  };
}

function monthlyDelta(
  currentNW: number,
  snapshots: Snapshot[],
  now = Date.now(),
): { delta: number; priorT: number; priorNW: number } | null {
  if (snapshots.length === 0) return null;
  // Look for a snapshot in the 20-to-60-day-old window — wide enough
  // to accept variable user save cadences but tight enough that the
  // headline "this month" remains honest. Tighter than the prior
  // "any snapshot at least 30d old," which could pick a year-old
  // snapshot and mislabel it.
  const lowerBound = now - 20 * 24 * 60 * 60 * 1000;
  const upperBound = now - 60 * 24 * 60 * 60 * 1000;
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    if (s.t > lowerBound || s.t < upperBound) continue;
    if (!best || s.t > best.t) best = s;
  }
  if (!best) return null;
  return {
    delta: currentNW - best.netWorthUSD,
    priorT: best.t,
    priorNW: best.netWorthUSD,
  };
}

function highestRateLiability(h: Household) {
  return [...h.liabilities].sort(
    (a, b) => b.annualInterestRate - a.annualInterestRate,
  )[0];
}

function findHighestLeverageAccount(
  household: Household,
  assumptions: Assumptions,
  baselineMonths: number,
): { accountId: string; accountName: string; monthsSaved: number } | null {
  let best:
    | { accountId: string; accountName: string; monthsSaved: number }
    | null = null;
  for (const a of household.accounts) {
    // Skip accounts that only hold no-growth-target kinds (pure cash
    // or pure real-estate — both held at face value with no exposure
    // to market growth via leverage).
    if (
      a.holdings.every(
        (h) =>
          h.kind === "cash" ||
          h.kind === "real_estate" ||
          h.kind === "private_stock" ||
          h.kind === "other",
      )
    )
      continue;
    const altHousehold: Household = {
      ...household,
      accounts: household.accounts.map((x) =>
        x.id === a.id
          ? {
              ...x,
              monthlyContributionUSD:
                x.monthlyContributionUSD + SENSITIVITY_BUMP,
            }
          : x,
      ),
    };
    const alt = projectIndependence(altHousehold, assumptions);
    if (alt.monthsToIndependence == null) continue;
    const monthsSaved = baselineMonths - alt.monthsToIndependence;
    if (!best || monthsSaved > best.monthsSaved) {
      best = {
        accountId: a.id,
        accountName: a.displayName,
        monthsSaved,
      };
    }
  }
  return best;
}

function weightedClassCAGR(
  h: Household,
  cls:
    | "equity"
    | "bond"
    | "cash"
    | "crypto"
    | "commodity"
    | "real_estate"
    | "private_stock"
    | "other",
): number {
  let total = 0;
  let weighted = 0;
  for (const a of h.accounts) {
    for (const x of a.holdings) {
      if (x.kind !== cls) continue;
      total += x.valueUSD;
      weighted += x.valueUSD * x.expectedRealCAGR;
    }
  }
  return total > 0 ? weighted / total : 0;
}

