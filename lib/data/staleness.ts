import type { Household } from "@/lib/types";

const STALE_THRESHOLD_DAYS = 60;

/**
 * Identify manually-priced holdings that haven't had their price /
 * value touched in a while. The home-page banner uses this to
 * nudge the user to update — manual holdings drift silently
 * because there's no live quote pipeline keeping them honest.
 *
 * "Touched" = lastPricedAt is recent OR (for cash/RE/other) there's
 * no lastPricedAt concept and we never flag them as stale (the user
 * sets the face value directly).
 *
 * Returns up to N stalest holdings so the UI can pick the worst
 * offenders without overwhelming the user.
 */
export type StaleHolding = {
  id: string;
  symbol: string;
  daysSinceUpdate: number;
};

export function staleManualHoldings(
  household: Household,
  now = Date.now(),
  limit = 5,
): StaleHolding[] {
  const threshold = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const out: StaleHolding[] = [];
  for (const a of household.accounts) {
    for (const h of a.holdings) {
      // Only flag the kinds that have a lastPricedAt concept and
      // are currently in manual mode. Live-priceable holdings have
      // their own refresh pipeline; cash / RE / other are face-
      // value-by-design and never "stale" in this sense.
      if (
        h.kind !== "equity" &&
        h.kind !== "bond" &&
        h.kind !== "crypto" &&
        h.kind !== "commodity" &&
        h.kind !== "private_stock"
      )
        continue;
      if (!h.isManualPrice) continue;
      if (h.lastPricedAt == null) continue; // never priced — skip
      const elapsed = now - h.lastPricedAt;
      if (elapsed < threshold) continue;
      out.push({
        id: h.id,
        symbol: h.symbol,
        daysSinceUpdate: Math.floor(elapsed / (24 * 60 * 60 * 1000)),
      });
    }
  }
  out.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
  return out.slice(0, limit);
}
