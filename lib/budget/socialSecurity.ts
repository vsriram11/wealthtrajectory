/**
 * Quick-estimate Social Security benefits for planning purposes.
 *
 * Real benefits are computed by the SSA from a user's full
 * earnings history; this module produces a reasonable estimate
 * from a few high-level inputs (income, current age, retirement
 * age, claim age) suitable for SEEDING a planning model. Users
 * who want precise numbers should use the SSA's official
 * Benefit Calculator and override the demo value.
 *
 * The estimate is intentionally CONSERVATIVE in two ways:
 *
 *   1. Zeros are averaged in for non-working years. The
 *      AIME (Average Indexed Monthly Earnings) formula divides
 *      by 35 regardless of how many years the worker actually
 *      contributed. Someone who retires at 48 with 26 working
 *      years has 9 zeros pulling down their AIME.
 *
 *   2. The Social Security taxable maximum caps the
 *      contribution. Income above ~$176k (2025) doesn't earn
 *      more SS. We use the cap, not the actual income.
 *
 * Cited values (2025 SSA bend points + taxable cap):
 *   https://www.ssa.gov/oact/cola/Benefits.html
 *
 * Caveats — what this does NOT model:
 *   - Spousal benefits (a non-earning spouse can collect 50%
 *     of the higher earner's PIA; we don't auto-derive this).
 *   - WEP / GPO offsets for non-covered pension recipients.
 *   - Survivor benefits.
 *   - Early-claim reduction past 62 (we don't model claim age
 *     below FRA; callers should manually reduce if claiming
 *     before FRA).
 *   - Delayed retirement credits past FRA (8%/year up to 70).
 *
 * Anything more sophisticated belongs in user-entered numbers,
 * not a heuristic estimator.
 */

/**
 * SSA wage-bend points for 2025. These are the dollar
 * thresholds that define the three tiers of PIA accrual:
 *
 *   - 90% of AIME up to BEND_1
 *   - 32% of AIME between BEND_1 and BEND_2
 *   - 15% of AIME above BEND_2
 *
 * Indexed annually — update when the SSA publishes new ones.
 */
export const SS_BEND_POINT_1_2025 = 1_226;
export const SS_BEND_POINT_2_2025 = 7_391;

/**
 * 2025 maximum taxable earnings ($176,100 / 12). Income above
 * this in any year doesn't earn additional SS credit.
 */
export const SS_TAXABLE_MAX_MONTHLY_2025 = 176_100 / 12;

/**
 * Full Retirement Age for anyone born 1960 or later (the cohort
 * that includes ~everyone currently in the workforce). The FRA
 * is 67 for them. Earlier cohorts have FRA 66-66.83; we don't
 * model that for the simple estimator.
 */
export const SS_FRA = 67;

/**
 * AIME assumes a 35-year contribution window. Workers with
 * fewer years average in zeros for the missing slots. Workers
 * with more years use their 35 HIGHEST years (we approximate
 * with the cap-adjusted income, which is the limiting factor
 * for high earners anyway).
 */
export const SS_AIME_WINDOW_YEARS = 35;

/**
 * Estimate a worker's Social Security benefit at Full Retirement
 * Age (FRA = 67).
 *
 * Inputs:
 *   - annualIncomeUSD: current/late-career annual earnings. The
 *     estimator caps this at the SS taxable max ($176,100/year
 *     for 2025) since income above that doesn't earn SS.
 *   - currentAge: how old the worker is today.
 *   - retirementAge: the age they stop working (and stop
 *     contributing to SS). Use the Independence Day age from
 *     your projection.
 *
 * Returns:
 *   - annualUSDAtFRA: estimated annual benefit at age 67,
 *     in TODAY'S DOLLARS (real terms — SS is CPI-indexed via
 *     the COLA, so a real-terms 0% growth rate matches the
 *     income-stream feature's default).
 *   - fraYear: the calendar year the worker reaches FRA. Used
 *     by callers to set `IncomeStream.startYear`.
 *
 * NaN-safety: returns 0 when inputs are invalid. The caller
 * should guard against displaying a $0 estimate to the user —
 * a non-earner or unreasonable input should be excluded from
 * the auto-seed flow.
 */
export function estimateSocialSecurityAtFRA(
  annualIncomeUSD: number,
  currentAge: number,
  retirementAge: number,
  currentYear: number = new Date().getFullYear(),
): { annualUSDAtFRA: number; fraYear: number } {
  if (
    !Number.isFinite(annualIncomeUSD) ||
    annualIncomeUSD <= 0 ||
    !Number.isFinite(currentAge) ||
    currentAge <= 0 ||
    !Number.isFinite(retirementAge) ||
    retirementAge <= currentAge
  ) {
    return { annualUSDAtFRA: 0, fraYear: currentYear + SS_FRA };
  }

  // Working years = full career assumed to start at age 22
  // (common college-grad assumption). Capped at the AIME window
  // — workers who contribute for more than 35 years just have
  // their lower-earning years dropped, but the cap-adjusted
  // formula approximates this well for stable high earners.
  const startAge = 22;
  const effectiveStartAge = Math.max(startAge, Math.min(currentAge, retirementAge));
  const workingYears = Math.min(
    SS_AIME_WINDOW_YEARS,
    Math.max(0, retirementAge - startAge),
  );
  void effectiveStartAge; // (currently unused — reserved for future "start work mid-career" refinement)

  // Monthly cap-adjusted contribution. High earners contribute
  // at the cap; low/mid earners contribute their actual income.
  const monthlyContribution = Math.min(
    annualIncomeUSD / 12,
    SS_TAXABLE_MAX_MONTHLY_2025,
  );

  // AIME = (monthly_contrib × working_years) / 35. Workers with
  // fewer than 35 years average in zeros — a 26-year career
  // contributor with $14k/month gets AIME of ~$10.4k, not $14k.
  const aime = (monthlyContribution * workingYears) / SS_AIME_WINDOW_YEARS;

  // PIA formula — three tiers of accrual at the bend points.
  let pia = 0;
  if (aime <= SS_BEND_POINT_1_2025) {
    pia = aime * 0.9;
  } else if (aime <= SS_BEND_POINT_2_2025) {
    pia =
      SS_BEND_POINT_1_2025 * 0.9 + (aime - SS_BEND_POINT_1_2025) * 0.32;
  } else {
    pia =
      SS_BEND_POINT_1_2025 * 0.9 +
      (SS_BEND_POINT_2_2025 - SS_BEND_POINT_1_2025) * 0.32 +
      (aime - SS_BEND_POINT_2_2025) * 0.15;
  }

  const annualUSDAtFRA = pia * 12;
  const fraYear = currentYear + (SS_FRA - currentAge);

  return { annualUSDAtFRA, fraYear };
}
