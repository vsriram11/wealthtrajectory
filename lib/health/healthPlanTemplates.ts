import type {
  HealthPlan,
  HealthPlanCategory,
  HealthPlanFactor,
} from "@/lib/health/healthPlans";

/**
 * Curated plan-template library.
 *
 * Each entry is a *typical* plan in its category, drawn from public
 * benchmarks (Kaiser Family Foundation's employer-benefits annual
 * survey, healthcare.gov tier definitions, university student-plan
 * disclosures). It is NOT a live quote. The user instantiates a
 * template, overrides the dollar amounts for their actual plan, and
 * the curated factor scores serve as a sensible starting baseline.
 *
 * For premium / deductible / OOP-max, we record realistic mid-range
 * numbers and surface a `caveat` in the UI so the user knows to
 * replace them with their actual quote.
 *
 * Factor scores are 0-100, curated qualitatively:
 *   - 100 = best-in-class on this dimension
 *   - 50  = average / neutral
 *   - 0   = no coverage / very poor
 *
 * Adding new templates: keep `id` stable across schema migrations
 * (it persists on user-instantiated HealthPlans via `templateId`).
 */

export type HealthPlanTemplate = {
  id: string;
  name: string;
  category: HealthPlanCategory;
  /**
   * Two-line UI description. First line: who it's for. Second line:
   * the key economic shape (HDHP+HSA, low-premium high-deductible,
   * etc.).
   */
  description: string;
  /**
   * Caveat shown in the editor when the template is selected, so the
   * user knows these are approximations of typical plans, not their
   * specific plan's terms.
   */
  caveat: string;
  /** Realistic single-coverage monthly premium ($). */
  defaultMonthlyPremiumUSD: number;
  /** Realistic family-coverage monthly premium ($). */
  defaultFamilyMonthlyPremiumUSD: number;
  defaultAnnualDeductibleUSD: number;
  defaultAnnualOutOfPocketMaxUSD: number;
  factorScores: Partial<Record<HealthPlanFactor, number>>;
};

/**
 * Numbers anchored to public benchmarks (2024 KFF employer survey,
 * ACA marketplace tier definitions, common university student-plan
 * disclosures). Premiums shown are POST-subsidy for ACA and
 * POST-employer-contribution for employer plans — i.e. what the
 * user actually pays. Family-of-4 column assumes mid-range area
 * rates; the user MUST override with their actual quote.
 */
export const HEALTH_PLAN_TEMPLATES: HealthPlanTemplate[] = [
  // ---- ACA marketplace tiers ----
  {
    id: "aca-bronze",
    name: "ACA Bronze (marketplace)",
    category: "aca_marketplace",
    description:
      "Lowest-premium ACA marketplace tier. ~60% actuarial value: insurance covers ~60% of medical costs on average.",
    caveat:
      "Numbers reflect a typical Bronze plan post-subsidy. Your actual premium depends on age, ZIP, income, and tobacco use. Use healthcare.gov for a real quote.",
    defaultMonthlyPremiumUSD: 280,
    defaultFamilyMonthlyPremiumUSD: 900,
    defaultAnnualDeductibleUSD: 7000,
    defaultAnnualOutOfPocketMaxUSD: 9450,
    factorScores: {
      premiumAffordability: 85,
      deductible: 20,
      outOfPocketMax: 25,
      networkBreadth: 55,
      primaryCare: 35,
      specialistAccess: 50,
      prescriptionCoverage: 55,
      mentalHealth: 60,
      preventiveCare: 95,
      telehealth: 60,
      hsaEligible: 30,
      outOfNetworkCoverage: 25,
    },
  },
  {
    id: "aca-silver",
    name: "ACA Silver (marketplace)",
    category: "aca_marketplace",
    description:
      "Middle ACA tier. ~70% actuarial value. Qualifies for cost-sharing reductions if household income ≤ 250% FPL.",
    caveat:
      "Typical Silver plan. If your income is in the CSR range (under ~$36k single / $75k family in 2024), the deductible drops dramatically — use the real marketplace quote.",
    defaultMonthlyPremiumUSD: 450,
    defaultFamilyMonthlyPremiumUSD: 1400,
    defaultAnnualDeductibleUSD: 4500,
    defaultAnnualOutOfPocketMaxUSD: 9000,
    factorScores: {
      premiumAffordability: 65,
      deductible: 50,
      outOfPocketMax: 45,
      networkBreadth: 60,
      primaryCare: 60,
      specialistAccess: 55,
      prescriptionCoverage: 65,
      mentalHealth: 65,
      preventiveCare: 95,
      telehealth: 65,
      hsaEligible: 20,
      outOfNetworkCoverage: 30,
    },
  },
  {
    id: "aca-gold",
    name: "ACA Gold (marketplace)",
    category: "aca_marketplace",
    description:
      "~80% actuarial value. Higher premium, much lower deductible — good if you expect regular care.",
    caveat:
      "Typical Gold plan post-subsidy. Subsidies cap at 8.5% of income post-IRA; the cliff matters for higher incomes.",
    defaultMonthlyPremiumUSD: 600,
    defaultFamilyMonthlyPremiumUSD: 1800,
    defaultAnnualDeductibleUSD: 1500,
    defaultAnnualOutOfPocketMaxUSD: 7000,
    factorScores: {
      premiumAffordability: 45,
      deductible: 75,
      outOfPocketMax: 65,
      networkBreadth: 65,
      primaryCare: 80,
      specialistAccess: 65,
      prescriptionCoverage: 75,
      mentalHealth: 70,
      preventiveCare: 95,
      telehealth: 75,
      hsaEligible: 15,
      outOfNetworkCoverage: 35,
    },
  },
  {
    id: "aca-platinum",
    name: "ACA Platinum (marketplace)",
    category: "aca_marketplace",
    description:
      "~90% actuarial value. Highest premium, lowest cost-sharing. Often unavailable in many ZIPs.",
    caveat:
      "Platinum plans are rare on most state exchanges — check availability before pricing this in.",
    defaultMonthlyPremiumUSD: 800,
    defaultFamilyMonthlyPremiumUSD: 2400,
    defaultAnnualDeductibleUSD: 250,
    defaultAnnualOutOfPocketMaxUSD: 4000,
    factorScores: {
      premiumAffordability: 20,
      deductible: 95,
      outOfPocketMax: 85,
      networkBreadth: 70,
      primaryCare: 90,
      specialistAccess: 75,
      prescriptionCoverage: 85,
      mentalHealth: 75,
      preventiveCare: 100,
      telehealth: 80,
      hsaEligible: 10,
      outOfNetworkCoverage: 40,
    },
  },
  // ---- Employer plans (KFF 2024 averages) ----
  {
    id: "employer-hdhp-hsa",
    name: "Employer HDHP + HSA",
    category: "employer",
    description:
      "High-deductible plan with HSA eligibility. Premium is low; employer often contributes to the HSA.",
    caveat:
      "KFF 2024 single coverage averages ~$1.4k/yr employee share. Your contribution depends on the employer's split.",
    defaultMonthlyPremiumUSD: 115,
    defaultFamilyMonthlyPremiumUSD: 500,
    defaultAnnualDeductibleUSD: 3500,
    defaultAnnualOutOfPocketMaxUSD: 7000,
    factorScores: {
      premiumAffordability: 80,
      deductible: 40,
      outOfPocketMax: 45,
      networkBreadth: 70,
      primaryCare: 50,
      specialistAccess: 65,
      prescriptionCoverage: 60,
      mentalHealth: 65,
      preventiveCare: 90,
      telehealth: 75,
      hsaEligible: 100,
      outOfNetworkCoverage: 45,
    },
  },
  {
    id: "employer-ppo",
    name: "Employer PPO",
    category: "employer",
    description:
      "Traditional employer PPO — copay-driven, wide network, no PCP referral required.",
    caveat:
      "KFF 2024 single coverage averages ~$1.5k/yr employee share. Higher for richer plans (Fortune 500 / Big Tech).",
    defaultMonthlyPremiumUSD: 145,
    defaultFamilyMonthlyPremiumUSD: 550,
    defaultAnnualDeductibleUSD: 1500,
    defaultAnnualOutOfPocketMaxUSD: 5500,
    factorScores: {
      premiumAffordability: 70,
      deductible: 70,
      outOfPocketMax: 70,
      networkBreadth: 90,
      primaryCare: 85,
      specialistAccess: 90,
      prescriptionCoverage: 80,
      mentalHealth: 75,
      preventiveCare: 90,
      telehealth: 75,
      hsaEligible: 0,
      outOfNetworkCoverage: 75,
    },
  },
  {
    id: "employer-hmo",
    name: "Employer HMO / EPO",
    category: "employer",
    description:
      "Narrower network, lower premium. PCP referrals required for specialists in classic HMOs.",
    caveat:
      "HMO economics depend heavily on whether your preferred providers are in-network.",
    defaultMonthlyPremiumUSD: 100,
    defaultFamilyMonthlyPremiumUSD: 420,
    defaultAnnualDeductibleUSD: 1000,
    defaultAnnualOutOfPocketMaxUSD: 4500,
    factorScores: {
      premiumAffordability: 85,
      deductible: 75,
      outOfPocketMax: 78,
      networkBreadth: 45,
      primaryCare: 90,
      specialistAccess: 35,
      prescriptionCoverage: 80,
      mentalHealth: 65,
      preventiveCare: 95,
      telehealth: 80,
      hsaEligible: 0,
      outOfNetworkCoverage: 10,
    },
  },
  // ---- Self-employed / freelancer ----
  {
    id: "self-employed-peo",
    name: "Self-employed via PEO (e.g. Opolis, Stride, Justworks)",
    category: "self_employed",
    description:
      "Group-rate coverage through a professional employer organization. Often a better deal than marketplace for healthy solopreneurs.",
    caveat:
      "PEO rates depend on member pool, age, and state. Opolis specifically routes through Anthem / BCBS; the actual plan quality is closer to an employer PPO than an ACA Silver.",
    defaultMonthlyPremiumUSD: 380,
    defaultFamilyMonthlyPremiumUSD: 1250,
    defaultAnnualDeductibleUSD: 2500,
    defaultAnnualOutOfPocketMaxUSD: 7500,
    factorScores: {
      premiumAffordability: 60,
      deductible: 60,
      outOfPocketMax: 55,
      networkBreadth: 80,
      primaryCare: 70,
      specialistAccess: 80,
      prescriptionCoverage: 75,
      mentalHealth: 70,
      preventiveCare: 90,
      telehealth: 80,
      hsaEligible: 30,
      outOfNetworkCoverage: 60,
    },
  },
  {
    id: "self-employed-marketplace",
    name: "Self-employed via ACA marketplace",
    category: "self_employed",
    description:
      "Straight marketplace plan, no PEO. Subsidy eligibility based on AGI — many solo founders qualify in lean years.",
    caveat:
      "Premium tax credits scale to income; if your S-corp / sole-prop income spikes, you'll owe at filing time.",
    defaultMonthlyPremiumUSD: 450,
    defaultFamilyMonthlyPremiumUSD: 1400,
    defaultAnnualDeductibleUSD: 4500,
    defaultAnnualOutOfPocketMaxUSD: 9000,
    factorScores: {
      premiumAffordability: 65,
      deductible: 50,
      outOfPocketMax: 45,
      networkBreadth: 60,
      primaryCare: 60,
      specialistAccess: 55,
      prescriptionCoverage: 65,
      mentalHealth: 65,
      preventiveCare: 95,
      telehealth: 65,
      hsaEligible: 20,
      outOfNetworkCoverage: 30,
    },
  },
  // ---- Student plans ----
  {
    id: "student-university",
    name: "University student health plan",
    category: "student",
    description:
      "Typical SHIP (Student Health Insurance Plan) at a public 4-year. Often Anthem / UHC / Aetna underwritten.",
    caveat:
      "Premiums vary widely — Rutgers / Rowan SHIP run $1.5–3k/yr; private schools (Stanford, Columbia) push $7–8k.",
    defaultMonthlyPremiumUSD: 250,
    defaultFamilyMonthlyPremiumUSD: 600,
    defaultAnnualDeductibleUSD: 500,
    defaultAnnualOutOfPocketMaxUSD: 6500,
    factorScores: {
      premiumAffordability: 60,
      deductible: 85,
      outOfPocketMax: 50,
      networkBreadth: 70,
      primaryCare: 90,
      specialistAccess: 70,
      prescriptionCoverage: 75,
      mentalHealth: 90,
      preventiveCare: 95,
      telehealth: 85,
      hsaEligible: 0,
      outOfNetworkCoverage: 50,
    },
  },
  // ---- Medicare ----
  {
    id: "medicare-original",
    name: "Original Medicare (A + B)",
    category: "medicare",
    description:
      "Part A (hospital) free if you've worked 40 quarters. Part B (outpatient) is income-adjusted.",
    caveat:
      "2024 Part B base = $174.70/mo, higher with IRMAA at income > $103k single / $206k joint. Add Medigap (~$150) + Part D (~$45) for full coverage.",
    defaultMonthlyPremiumUSD: 175,
    defaultFamilyMonthlyPremiumUSD: 350,
    defaultAnnualDeductibleUSD: 240,
    defaultAnnualOutOfPocketMaxUSD: 0, // No OOP cap on Original Medicare without Medigap
    factorScores: {
      premiumAffordability: 75,
      deductible: 95,
      outOfPocketMax: 20, // No cap is a real liability
      networkBreadth: 95,
      primaryCare: 80,
      specialistAccess: 85,
      prescriptionCoverage: 0, // Need Part D separately
      mentalHealth: 70,
      preventiveCare: 90,
      telehealth: 70,
      hsaEligible: 0,
      outOfNetworkCoverage: 60,
    },
  },
  {
    id: "medicare-advantage",
    name: "Medicare Advantage (Part C)",
    category: "medicare",
    description:
      "Bundled Medicare alternative through a private insurer. Often $0 premium, but network restrictions.",
    caveat:
      "MA plans bundle Part D and often add dental/vision, but networks are narrower than Original Medicare and prior authorizations are common.",
    defaultMonthlyPremiumUSD: 25,
    defaultFamilyMonthlyPremiumUSD: 50,
    defaultAnnualDeductibleUSD: 200,
    defaultAnnualOutOfPocketMaxUSD: 8850,
    factorScores: {
      premiumAffordability: 95,
      deductible: 90,
      outOfPocketMax: 55,
      networkBreadth: 50,
      primaryCare: 80,
      specialistAccess: 50,
      prescriptionCoverage: 75,
      mentalHealth: 65,
      dental: 70,
      vision: 70,
      preventiveCare: 90,
      telehealth: 80,
      hsaEligible: 0,
      outOfNetworkCoverage: 25,
    },
  },
  // ---- Short-term ----
  {
    id: "short-term",
    name: "Short-term medical (gap coverage)",
    category: "short_term",
    description:
      "Catastrophic-style coverage for transitions (post-layoff, between schools). NOT ACA-compliant — pre-existing exclusions, no preventive care mandate.",
    caveat:
      "Avoid as a long-term solution. Max term is state-dependent (90 days–12 months), pre-existing conditions are excluded, and there's no OOP cap.",
    defaultMonthlyPremiumUSD: 120,
    defaultFamilyMonthlyPremiumUSD: 350,
    defaultAnnualDeductibleUSD: 5000,
    defaultAnnualOutOfPocketMaxUSD: 15000,
    factorScores: {
      premiumAffordability: 90,
      deductible: 30,
      outOfPocketMax: 15,
      networkBreadth: 55,
      primaryCare: 30,
      specialistAccess: 40,
      prescriptionCoverage: 30,
      mentalHealth: 20,
      preventiveCare: 10,
      telehealth: 30,
      hsaEligible: 0,
      outOfNetworkCoverage: 30,
    },
  },
];

/** Instantiate a HealthPlan from a template — caller supplies owner + covered members. */
export function instantiateTemplate(
  template: HealthPlanTemplate,
  ownerId: string,
  coveredMemberIds: string[],
  opts: { isFamily?: boolean } = {},
): Omit<HealthPlan, "id" | "createdAt"> {
  const isFamily =
    opts.isFamily ?? coveredMemberIds.filter((m) => m !== ownerId).length > 0;
  return {
    name: template.name,
    ownerId,
    coveredMemberIds: coveredMemberIds.includes(ownerId)
      ? coveredMemberIds
      : [ownerId, ...coveredMemberIds],
    source: "template",
    category: template.category,
    monthlyPremiumUSD: isFamily
      ? template.defaultFamilyMonthlyPremiumUSD
      : template.defaultMonthlyPremiumUSD,
    annualDeductibleUSD: template.defaultAnnualDeductibleUSD,
    annualOutOfPocketMaxUSD: template.defaultAnnualOutOfPocketMaxUSD,
    factorScores: { ...template.factorScores },
    templateId: template.id,
  };
}
