/**
 * Health-plan modeling for the Plan → Health tab.
 *
 * Design intent
 * -------------
 * 1. ONE OWNER per plan. The `ownerId` is the member who actually
 *    holds the policy and pays the premium. Dependents (spouse, kids)
 *    are listed in `coveredMemberIds` for display and read-only
 *    rollup, but the premium dollars stay attributed to the owner.
 *    This is what avoids the "household total double-counts a family
 *    plan" failure mode the user called out.
 *
 * 2. NORMALIZED IMPORTANCE WEIGHTS. The user rates each factor on
 *    0–1; we renormalize so weights sum to exactly 1 inside the
 *    scoring function. That way a user can drag the premium-importance
 *    slider to 0.8 and out-of-pocket-max to 0.5 without having to
 *    do the math themselves.
 *
 * 3. EXAMPLE TEMPLATES, NOT QUOTES. The plan-template library carries
 *    plausible parameters drawn from public benchmarks (Kaiser Family
 *    Foundation employer-survey averages, ACA marketplace tier
 *    structure, etc.). It explicitly does NOT pretend to be a live
 *    healthcare.gov / Opolis quote — fabricating a "live API" with
 *    placeholder numbers would just deliver misleading data, which
 *    is the failure mode we've spent the rest of this session
 *    closing. The `source` discriminator on each template makes it
 *    obvious where a future real-API plug-in would slot in.
 *
 * Pure data + math; no React or store imports.
 */

/**
 * Ratable factors a user might care about when picking a plan.
 * Each plan template carries a 0–100 score per factor (curated, NOT
 * a quote). The user picks an importance 0–1 per factor; the score
 * is a weighted average over the user's normalized importance.
 *
 * Ordering here drives the default order in the editor UI.
 */
export const HEALTH_PLAN_FACTORS = [
  "premiumAffordability",
  "deductible",
  "outOfPocketMax",
  "networkBreadth",
  "primaryCare",
  "specialistAccess",
  "prescriptionCoverage",
  "mentalHealth",
  "dental",
  "vision",
  "telehealth",
  "hsaEligible",
  "preventiveCare",
  "outOfNetworkCoverage",
] as const;

export type HealthPlanFactor = (typeof HEALTH_PLAN_FACTORS)[number];

export const HEALTH_PLAN_FACTOR_META: Record<
  HealthPlanFactor,
  { label: string; hint: string }
> = {
  premiumAffordability: {
    label: "Low monthly premium",
    hint: "Cheaper monthly cost. High score = low premium.",
  },
  deductible: {
    label: "Low deductible",
    hint: "How much you pay before insurance kicks in. High score = low deductible.",
  },
  outOfPocketMax: {
    label: "Low out-of-pocket max",
    hint: "Annual cap on what you'll spend in a worst-case year.",
  },
  networkBreadth: {
    label: "Wide provider network",
    hint: "Big PPO networks vs narrow HMOs / EPOs.",
  },
  primaryCare: {
    label: "Affordable primary care",
    hint: "Routine doctor visits — copay vs coinsurance vs full deductible.",
  },
  specialistAccess: {
    label: "Specialist access (no referrals)",
    hint: "Can you see a specialist directly, or does PCP have to refer?",
  },
  prescriptionCoverage: {
    label: "Prescription coverage",
    hint: "Generic / brand / specialty tier copays and the formulary.",
  },
  mentalHealth: {
    label: "Mental health coverage",
    hint: "Therapy, psychiatry, in-network availability.",
  },
  dental: { label: "Dental included", hint: "Standalone dental adds cost." },
  vision: { label: "Vision included", hint: "Eye exam + frames coverage." },
  telehealth: {
    label: "Telehealth / virtual care",
    hint: "$0 virtual visits are common in newer plans.",
  },
  hsaEligible: {
    label: "HSA-eligible (HDHP)",
    hint: "Triple-tax-advantaged savings; requires a qualifying HDHP.",
  },
  preventiveCare: {
    label: "Preventive care covered 100%",
    hint: "ACA-compliant plans cover well visits / screenings at no cost — but not all employer plans match.",
  },
  outOfNetworkCoverage: {
    label: "Out-of-network coverage",
    hint: "Travel a lot, or live near a state line? OON matters.",
  },
};

/**
 * Where a plan came from. `template` = curated library entry.
 * `custom` = user-typed plan. `api` is reserved for a future
 * healthcare.gov / state-exchange / Opolis live-quote integration;
 * not implemented in this version, but the discriminator means a
 * future PR can drop in `source: "api"` without re-shaping the
 * type.
 */
export type HealthPlanSource = "template" | "custom" | "api";

export type HealthPlanCategory =
  | "aca_marketplace"
  | "employer"
  | "self_employed"
  | "student"
  | "medicare"
  | "short_term"
  | "other";

/**
 * A health-insurance plan attached to a household member.
 *
 * Cost attribution:
 *   - `monthlyPremiumUSD` belongs to `ownerId` for budget rollups.
 *   - `coveredMemberIds` (which always includes ownerId for
 *     well-formedness) is purely for display: "this plan covers
 *     yourself + spouse + 2 kids". The premium is NOT split across
 *     covered members — that would either over- or under-count
 *     depending on how the family chose to allocate.
 *
 * Scoring:
 *   - `factorScores[f]` is a 0–100 curated rating of how well the
 *     plan does on factor f.
 *   - The composite score is computed per-viewer from their
 *     `importanceWeights` (see `scorePlanForMember`).
 */
export type HealthPlan = {
  id: string;
  /** Display name — "Aetna Silver", "Rutgers Graduate Plan", etc. */
  name: string;
  /** Primary subscriber. Premium is attributed here. */
  ownerId: string;
  /** Members covered by this plan (always includes ownerId). */
  coveredMemberIds: string[];
  source: HealthPlanSource;
  category: HealthPlanCategory;
  /** What the user pays per month (post-subsidy / post-employer-contribution). */
  monthlyPremiumUSD: number;
  /** Plan-year deductible (in-network). */
  annualDeductibleUSD: number;
  /** Plan-year out-of-pocket max (in-network). */
  annualOutOfPocketMaxUSD: number;
  /** Curated 0–100 score per factor. Missing factors default to 50 (neutral). */
  factorScores: Partial<Record<HealthPlanFactor, number>>;
  /** Free-form notes — broker contact, renewal date, etc. */
  notes?: string;
  /** Template id this plan was instantiated from, if any. */
  templateId?: string;
  /** Timestamp the user added this plan. */
  createdAt: number;
};

/**
 * Per-member importance weights for the scoring engine. Stored in
 * the AppState keyed by memberId so each household member can rate
 * factors differently (a kid's plan is likely judged on different
 * priorities than the breadwinner's).
 *
 * Values are 0–1; missing factors default to 0 (don't care). We
 * renormalize at scoring time, so the user doesn't have to manage
 * the sum.
 */
export type HealthImportanceWeights = Partial<
  Record<HealthPlanFactor, number>
>;

/**
 * Compute a 0–100 composite score for a plan given a member's
 * importance weights. Logic:
 *
 *   1. Collect every factor with positive importance.
 *   2. If none have positive importance, return null (the UI can
 *      show a "no factors weighted" hint).
 *   3. Renormalize importance so the chosen factors sum to 1.
 *   4. For each, multiply weight × factorScore (defaulting to 50
 *      / neutral if the plan didn't rate that factor).
 *   5. Sum.
 *
 * Result is clamped to [0, 100] defensively.
 */
export function scorePlan(
  plan: HealthPlan,
  weights: HealthImportanceWeights,
): number | null {
  const active = HEALTH_PLAN_FACTORS.filter((f) => {
    const w = weights[f];
    return w != null && Number.isFinite(w) && w > 0;
  });
  if (active.length === 0) return null;
  const total = active.reduce((s, f) => s + (weights[f] ?? 0), 0);
  if (total <= 0) return null;
  let score = 0;
  for (const f of active) {
    const w = (weights[f] ?? 0) / total;
    const fs = plan.factorScores[f] ?? 50;
    score += w * fs;
  }
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, score));
}

/**
 * Household-level rollup that respects the no-double-count rule.
 *
 * If a member subscribes to one plan covering themselves + spouse
 * + 2 kids, the rollup counts the premium ONCE (under the
 * subscriber) and reports 4 covered members. The naive "iterate
 * every member, sum their covered-plans' premiums" approach would
 * count the same family plan four times.
 *
 * Returns:
 *   - totalMonthlyUSD: sum of each unique plan's premium, exactly once
 *   - planCount: count of distinct plans
 *   - coveredMemberIds: union of every coveredMemberIds across plans
 *   - uncoveredMemberIds: members in the household not listed on any plan
 */
export function rollupHealthPlans(
  plans: HealthPlan[],
  householdMemberIds: string[],
): {
  totalMonthlyUSD: number;
  planCount: number;
  coveredMemberIds: string[];
  uncoveredMemberIds: string[];
} {
  const seen = new Set<string>();
  let totalMonthlyUSD = 0;
  const covered = new Set<string>();
  for (const p of plans) {
    if (seen.has(p.id)) continue;
    // Skip phantom plans with no covered members — these would
    // otherwise contribute their premium to the household total
    // while leaving everyone "uncovered." Data-corruption-shape
    // (or a half-completed UI flow) shouldn't poison the rollup.
    // Real plans always carry at least the subscriber via the
    // ownerId-in-coverage invariant enforced in the store.
    if (p.coveredMemberIds.length === 0) continue;
    seen.add(p.id);
    totalMonthlyUSD += Math.max(0, p.monthlyPremiumUSD);
    for (const m of p.coveredMemberIds) covered.add(m);
  }
  const uncovered = householdMemberIds.filter((m) => !covered.has(m));
  return {
    totalMonthlyUSD,
    planCount: seen.size,
    coveredMemberIds: [...covered],
    uncoveredMemberIds: uncovered,
  };
}

/**
 * Returns the plans relevant to a single member view:
 *   - "subscribed": plans this member OWNS (premium attributed here)
 *   - "coveredAsDependent": plans where this member is in
 *     coveredMemberIds but isn't the owner — these display read-only
 *     in the member's view so they can see "I'm on Alice's family
 *     plan", but editing happens on Alice's row.
 */
export function plansForMember(
  plans: HealthPlan[],
  memberId: string,
): {
  subscribed: HealthPlan[];
  coveredAsDependent: HealthPlan[];
} {
  const subscribed = plans.filter((p) => p.ownerId === memberId);
  const coveredAsDependent = plans.filter(
    (p) => p.ownerId !== memberId && p.coveredMemberIds.includes(memberId),
  );
  return { subscribed, coveredAsDependent };
}

/**
 * Default neutral importance weights for a brand-new member —
 * roughly the priorities of someone shopping ACA marketplace plans
 * with no specific health concerns. The user adjusts from here.
 */
export const DEFAULT_IMPORTANCE_WEIGHTS: HealthImportanceWeights = {
  premiumAffordability: 0.8,
  deductible: 0.6,
  outOfPocketMax: 0.6,
  networkBreadth: 0.5,
  primaryCare: 0.5,
  prescriptionCoverage: 0.5,
  mentalHealth: 0.3,
  preventiveCare: 0.5,
  telehealth: 0.3,
  hsaEligible: 0.3,
};
