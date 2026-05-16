import { projectIndependence } from "@/lib/projection/independence";
import type { Assumptions, Household } from "@/lib/types";

/**
 * Coast-Independence analysis (PRD §7.4-ish, popular financial-independence-community concept).
 *
 * "Can I stop contributing today and still hit my Independence target through
 * compounding alone?" If yes, you're past your Coast number — the
 * critical NW threshold below which contributions are essential.
 *
 * Implementation: re-run projectIndependence on a household with every account's
 * monthlyContributionUSD zeroed out. monthsToIndependence becomes the coast
 * timeline; null means you can't reach target through compounding alone
 * within the 70-year accumulation window.
 *
 * Returns the FULL coast projection too so the card can offer
 * deltas vs the baseline (e.g. "stopping saves you nothing — but
 * also costs you 12 years").
 */
export type CoastAnalysis = {
  /** Months to Independence if contributions stop today. null = never reaches target. */
  monthsCoast: number | null;
  /** Months to Independence at current contribution rate. null = never. */
  monthsContributing: number | null;
  /**
   * How many additional months Independence slides out by if you stop
   * contributing. null if either path doesn't reach target. Positive
   * = coasting delays Independence; 0 = you're already coast-Independence'd; negative
   * is mathematically impossible (no extra contributions = same or
   * worse).
   */
  monthsCostOfCoasting: number | null;
  /** True when monthsCoast == monthsContributing (effectively zero contributions today). */
  alreadyCoasting: boolean;
};

export function coastAnalysis(
  household: Household,
  assumptions: Assumptions,
): CoastAnalysis {
  const baseline = projectIndependence(household, assumptions);

  const totalContrib = household.accounts.reduce(
    (s, a) => s + a.monthlyContributionUSD,
    0,
  );
  const alreadyCoasting = totalContrib <= 0;

  const coastingHousehold: Household = {
    ...household,
    accounts: household.accounts.map((a) => ({
      ...a,
      monthlyContributionUSD: 0,
    })),
  };
  const coast = projectIndependence(coastingHousehold, assumptions);

  const monthsCostOfCoasting =
    baseline.monthsToIndependence != null && coast.monthsToIndependence != null
      ? coast.monthsToIndependence - baseline.monthsToIndependence
      : null;

  return {
    monthsCoast: coast.monthsToIndependence,
    monthsContributing: baseline.monthsToIndependence,
    monthsCostOfCoasting,
    alreadyCoasting,
  };
}
