import {
  accountValue,
  TAX_TREATMENT_BY_CATEGORY,
  type Household,
} from "@/lib/types";

/**
 * Emergency-fund adequacy meter. Rule-of-thumb wealth-advisor
 * guidance:
 *
 *   - 3 months: minimum for a dual-income household with stable
 *     W-2 jobs
 *   - 6 months: standard recommendation for single-income or
 *     households with one breadwinner
 *   - 12 months: prudent for self-employed / commission-based /
 *     contract workers with variable income
 *
 * "Emergency fund" = cash + savings (no brokerage, no Roth — we
 * don't want users to draw down invested capital and miss the
 * recovery). HSA is excluded because it's earmarked for medical.
 *
 * The calculation:
 *
 *   emergencyFundUSD = sum of accountValue for accounts whose
 *                      category maps to SAVINGS / CHECKING
 *   monthsOfRunway = emergencyFundUSD / monthlyBurnUSD
 *
 * If the user hasn't entered monthlyBurn, we can't size the
 * recommendation — return null and the UI prompts.
 */

export type EmergencyFundStatus = "under" | "okay" | "ample";

export type EmergencyFundAdequacy = {
  emergencyFundUSD: number;
  monthlyBurnUSD: number;
  monthsOfRunway: number;
  recommendedMonths: number;
  status: EmergencyFundStatus;
  shortfallUSD: number;
  /** Breakdown of which accounts contribute to the emergency bucket. */
  contributors: { id: string; name: string; valueUSD: number }[];
};

const STATUS_THRESHOLDS = {
  under: 0.66, // < 66% of recommended → "under"
  okay: 1.5, // 66%-150% → "okay", >150% → "ample"
};

export function emergencyFundAdequacy(
  household: Household,
  monthlyBurnUSD: number,
  recommendedMonths = 6,
): EmergencyFundAdequacy | null {
  if (!Number.isFinite(monthlyBurnUSD) || monthlyBurnUSD <= 0) return null;
  const contributors: EmergencyFundAdequacy["contributors"] = [];
  let fund = 0;
  for (const a of household.accounts) {
    const t = TAX_TREATMENT_BY_CATEGORY[a.category];
    // SAVINGS / CHECKING are TAXABLE bucket — and we want only
    // those specific categories (not BROKERAGE / CRYPTO / RE).
    if (t !== "TAXABLE") continue;
    if (a.category !== "SAVINGS" && a.category !== "CHECKING") continue;
    const v = accountValue(a);
    if (v <= 0) continue;
    fund += v;
    contributors.push({ id: a.id, name: a.displayName, valueUSD: v });
  }
  contributors.sort((a, b) => b.valueUSD - a.valueUSD);

  const months = fund / monthlyBurnUSD;
  const ratio = months / recommendedMonths;
  let status: EmergencyFundStatus = "okay";
  if (ratio < STATUS_THRESHOLDS.under) status = "under";
  else if (ratio > STATUS_THRESHOLDS.okay) status = "ample";

  const shortfall = Math.max(
    0,
    recommendedMonths * monthlyBurnUSD - fund,
  );

  return {
    emergencyFundUSD: fund,
    monthlyBurnUSD,
    monthsOfRunway: months,
    recommendedMonths,
    status,
    shortfallUSD: shortfall,
    contributors,
  };
}
