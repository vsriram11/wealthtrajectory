import { accountValue, householdNetWorth, type Household } from "@/lib/types";

/**
 * Concentration-risk analyzer. Real-world wealth-management red
 * flags that the Independence engine alone can't see:
 *
 *   1. Single-ticker concentration (Enron / Lehman / Bear Stearns
 *      employer-stock blow-up): any one symbol > 20% of gross
 *      household assets warrants a callout. 10–20% = "watch",
 *      >20% = "high".
 *   2. Single-account concentration: any one account > 50% of
 *      household NW means one custodian outage / one tax bracket
 *      mistake can dominate. >75% = "high".
 *   3. Single-member concentration: in a household with multiple
 *      members, one member holding > 80% of NW signals an
 *      estate-planning / divorce-risk asymmetry worth flagging.
 *      (Won't fire for a 1-member household.)
 *
 * Returns null when there's nothing notable. Designed to be
 * additive — the Independence engine doesn't care about concentration,
 * but a household at the threshold is genuinely fragile in
 * ways the projection won't show.
 *
 * Symbol bucketing aggregates across accounts: 500 shares of AAPL
 * in a 401k + 200 in a brokerage = 700 shares to the concentration
 * calc. Uses holding.symbol when present (live ETFs / equities /
 * crypto) and holding.name for symbol-less manual entries.
 */

export type ConcentrationSeverity = "watch" | "high";

export type ConcentrationFinding = {
  kind: "ticker" | "account" | "member";
  /** Display label — symbol, account name, or member name. */
  label: string;
  /** Total dollars in this bucket. */
  bucketUSD: number;
  /** Bucket as % of denominator (gross for ticker, NW otherwise). */
  fraction: number;
  severity: ConcentrationSeverity;
};

const TICKER_WATCH = 0.1;
const TICKER_HIGH = 0.2;
const ACCOUNT_WATCH = 0.5;
const ACCOUNT_HIGH = 0.75;
const MEMBER_HIGH = 0.8;

function severityFor(
  fraction: number,
  watch: number,
  high: number,
): ConcentrationSeverity | null {
  if (fraction >= high) return "high";
  if (fraction >= watch) return "watch";
  return null;
}

/**
 * Stable label for a holding so two manual rows named "Apple stock"
 * still aggregate together when the user didn't fill in a ticker.
 * Lowercased so case differences don't fragment buckets.
 */
function tickerKeyForHolding(h: {
  symbol?: string;
  name?: string;
}): string | null {
  if (h.symbol && h.symbol.trim().length > 0) return h.symbol.toUpperCase();
  if (h.name && h.name.trim().length > 0) return h.name.trim().toLowerCase();
  return null;
}

export function concentrationFindings(
  household: Household,
): ConcentrationFinding[] {
  const findings: ConcentrationFinding[] = [];

  // 1. Per-ticker — denominator is gross assets (sum of holdings,
  //    ignoring liabilities) because concentration is about exposure,
  //    not net wealth.
  const gross = household.accounts.reduce(
    (s, a) => s + accountValue(a),
    0,
  );
  if (gross > 0) {
    const byTicker = new Map<
      string,
      { label: string; valueUSD: number }
    >();
    for (const a of household.accounts) {
      for (const h of a.holdings) {
        const key = tickerKeyForHolding(
          h as { symbol?: string; name?: string },
        );
        if (!key) continue;
        const display =
          (h as { symbol?: string }).symbol ||
          (h as { name?: string }).name ||
          key;
        const cur = byTicker.get(key);
        if (cur) {
          cur.valueUSD += h.valueUSD;
        } else {
          byTicker.set(key, { label: display, valueUSD: h.valueUSD });
        }
      }
    }
    for (const { label, valueUSD } of byTicker.values()) {
      const fraction = valueUSD / gross;
      const sev = severityFor(fraction, TICKER_WATCH, TICKER_HIGH);
      if (sev)
        findings.push({
          kind: "ticker",
          label,
          bucketUSD: valueUSD,
          fraction,
          severity: sev,
        });
    }
  }

  // 2. Per-account — denominator is household NW (signed). When NW
  //    is non-positive, skip (the ratio is meaningless).
  const nw = householdNetWorth(household);
  if (nw > 0) {
    for (const a of household.accounts) {
      const v = accountValue(a);
      if (v <= 0) continue;
      const fraction = v / nw;
      const sev = severityFor(fraction, ACCOUNT_WATCH, ACCOUNT_HIGH);
      if (sev)
        findings.push({
          kind: "account",
          label: a.displayName,
          bucketUSD: v,
          fraction,
          severity: sev,
        });
    }
  }

  // 3. Per-member — only fire for multi-member households.
  if (household.members.length > 1 && nw > 0) {
    const memberNw = new Map<string, number>();
    for (const a of household.accounts) {
      memberNw.set(
        a.ownerId,
        (memberNw.get(a.ownerId) ?? 0) + accountValue(a),
      );
    }
    for (const l of household.liabilities) {
      memberNw.set(
        l.ownerId,
        (memberNw.get(l.ownerId) ?? 0) - l.balanceUSD,
      );
    }
    for (const m of household.members) {
      const v = memberNw.get(m.id) ?? 0;
      if (v <= 0) continue;
      const fraction = v / nw;
      if (fraction >= MEMBER_HIGH) {
        findings.push({
          kind: "member",
          label: m.displayName,
          bucketUSD: v,
          fraction,
          severity: "high",
        });
      }
    }
  }

  findings.sort((a, b) => b.fraction - a.fraction);
  return findings;
}
