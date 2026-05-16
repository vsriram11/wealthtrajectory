/**
 * Budget tracker — recurring monthly expense ledger that drives the
 * independence corpus calculation.
 *
 * Each item is a single recurring line ("Rent: $3,100/mo", "Groceries
 * $800/mo", etc.) tagged with a category + subcategory + type. The
 * sum of retirement-relevant expenses × 12 / withdrawalRate gives
 * the suggested independence corpus — the inverse of "how big a portfolio
 * generates this much income forever?". The user can apply that
 * number to assumptions.targetNetWorthUSD in one tap.
 *
 * Category + subcategory taxonomy mirrors the user's chosen
 * inspiration. Subcategory names are presets but the user can also
 * type a custom one — flexibility without abandoning structure.
 *
 * Excluded from the retirement spend rollup:
 *   - Savings category (you don't keep saving when withdrawing)
 *   - Items the user marks endsAtRetirement = true (mortgage paid
 *     off, kids out of college, etc.)
 */

export type ExpenseCategory =
  | "food"
  | "housing"
  | "transportation"
  | "lifestyle"
  | "healthcare"
  | "savings";

export type ExpenseType = "fixed" | "variable";

/**
 * Billing cycle for subscription-tagged items. Subscriptions store
 * `monthlyUSD` as the canonical figure (so all budget rollups stay
 * cycle-agnostic), but billingCycle + startDate let us reconstruct
 * the actual per-cycle amount and next billing date for the
 * subscription view. Default "monthly" when unspecified.
 */
export type BillingCycle = "monthly" | "quarterly" | "yearly";

export type BudgetItem = {
  id: string;
  name: string;
  /**
   * Member this expense is attributed to. Mirrors Account.ownerId
   * so the global member filter scopes the Budget view the same way
   * it scopes Accounts — the user sees their own line items in
   * per-member view, the full household when no member is selected.
   *
   * Shared/joint expenses are modeled by picking one member as the
   * "owner of record"; the household view still rolls everything up.
   */
  ownerId: string;
  category: ExpenseCategory;
  /** Optional subcategory. Free-form — UI presents presets per category. */
  subcategory?: string;
  monthlyUSD: number;
  type: ExpenseType;
  /**
   * If true, exclude this item from the retirement-spend rollup.
   * Sensible defaults: items in the savings category default to
   * true; items with a future end date default to true too (they
   * roll off before / at retirement). User-toggleable.
   */
  endsAtRetirement: boolean;
  /**
   * Optional date when this expense stops. Used to override the
   * endsAtRetirement default — an expense that ends in 5 months
   * is excluded from retirement spend, but a mortgage that ends
   * in 20 years is also excluded.
   */
  endDate?: number | null;
  /**
   * Marks this expense as a recurring subscription (Netflix, AWS,
   * Adobe, etc.). Enables a dedicated subscription view with next
   * billing date + per-cycle amount, derived from billingCycle +
   * startDate. Budget math is unchanged — subscriptions still
   * roll up via `monthlyUSD`.
   */
  isSubscription?: boolean;
  /**
   * Billing cycle for subscription-tagged items. Determines how
   * `monthlyUSD` translates to a per-cycle amount and how startDate
   * walks forward to the next billing. Defaults to "monthly" when
   * unspecified.
   */
  billingCycle?: BillingCycle;
  /**
   * When the subscription started. Required for computing next
   * billing date; if absent, we fall back to "createdAt".
   */
  startDate?: number | null;
  /**
   * Optional per-expense REAL EXCESS inflation rate — how much
   * faster (or slower) this expense grows than general CPI, in
   * real terms. e.g. 0.02 = "this line grows 2%/yr above CPI in
   * real terms" (healthcare's historical pattern). 0 = "tracks
   * CPI exactly, flat in real terms" (most everyday expenses).
   * Negative values are permitted (electronics, streaming
   * subscriptions, etc. tend to deflate in real terms).
   *
   * Why real-excess, not nominal: this app runs in real-terms
   * everywhere — real CAGR on holdings, real SWR, today's dollars
   * on net worth. Surfacing a nominal field like "5% inflation"
   * forces the user to mentally reconcile against the implicit
   * CPI baseline and disagrees with the rest of the model. With
   * real-excess semantics, 0% means "the SWR/Trinity math handles
   * this line exactly as advertised", and any non-zero value is
   * the *additional* drag (or relief) the corpus needs to absorb.
   *
   * The Gordon-growth math then resolves to:
   *   contribution = annual / max(floor, swr - excess)
   * with no CPI baseline anywhere in the formula — exactly what
   * a real-terms model wants.
   *
   * When null/undefined, falls back to `CATEGORY_DEFAULT_EXCESS_INFLATION`.
   */
  excessInflationOverride?: number | null;
  createdAt: number;
};

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: "Food & drinks",
  housing: "Housing",
  transportation: "Transportation",
  lifestyle: "Lifestyle",
  healthcare: "Healthcare",
  savings: "Savings",
};

/**
 * Tailwind-compatible accent classes per category — matches the
 * inspiration's blue / orange / purple / rose / emerald / cyan.
 * Used by BudgetCategorySection to render the colored dot + tint.
 */
export const CATEGORY_TONES: Record<
  ExpenseCategory,
  { dot: string; tint: string; text: string }
> = {
  food: {
    dot: "bg-sky-500",
    tint: "bg-sky-500/10",
    text: "text-sky-400",
  },
  housing: {
    dot: "bg-amber-500",
    tint: "bg-amber-500/10",
    text: "text-amber-400",
  },
  transportation: {
    dot: "bg-violet-500",
    tint: "bg-violet-500/10",
    text: "text-violet-400",
  },
  lifestyle: {
    dot: "bg-rose-500",
    tint: "bg-rose-500/10",
    text: "text-rose-400",
  },
  healthcare: {
    dot: "bg-emerald-500",
    tint: "bg-emerald-500/10",
    text: "text-emerald-400",
  },
  savings: {
    dot: "bg-cyan-500",
    tint: "bg-cyan-500/10",
    text: "text-cyan-400",
  },
};

export const SUBCATEGORY_PRESETS: Record<ExpenseCategory, string[]> = {
  food: [
    "Alcohol",
    "Candy",
    "Coffee",
    "Delivery",
    "Drinks",
    "Fast food",
    "Food",
    "Groceries",
    "Lunch",
    "Restaurant",
    "Snacks",
  ],
  housing: [
    "Bank",
    "Bills",
    "Cleaning",
    "Decor",
    "Electricity & Gas",
    "Exterminator",
    "Furniture",
    "Garbage, Sewer, & Security",
    "HOA",
    "Home supplies",
    "Housing",
    "Insurance",
    "Internet",
    "Landscaping",
    "Loan",
    "Maintenance",
    "Property tax",
    "Rent/Mortgage",
    "Repairs",
    "Security alarm",
    "Service",
    "Storage",
    "TV",
    "Taxes",
    "Telephone",
    "Water",
  ],
  transportation: [
    "ATM withdrawals",
    "Bike",
    "Car costs",
    "Car insurance",
    "Car loan",
    "Car wash",
    "EV charging",
    "Flight",
    "Fuel / Gas",
    "Parking",
    "Public transport",
    "Registration",
    "Repair",
    "Ride share",
    "Scooter",
    "Taxi",
    "Tolls",
    "Train",
    "Transportation",
  ],
  lifestyle: [
    "Beauty",
    "Books",
    "Charity",
    "Child care",
    "Clothing",
    "Community",
    "Concerts",
    "Education",
    "Entertainment",
    "Gift",
    "Gym",
    "Hobbies",
    "Hotel",
    "Jewelry",
    "Legal",
    "Lifestyle",
    "Memberships",
    "Movies",
    "Music streaming",
    "Office expenses",
    "Personal care",
    "Pet",
    "Salon",
    "Shoes",
    "Shopping",
    "Spa",
    "Sports",
    "Streaming services",
    "Subscriptions",
    "Tax prep",
    "Theater",
    "Travel",
    "Tuition",
    "Work",
  ],
  healthcare: [
    "Chiropractor",
    "Copays",
    "Dental",
    "Doctor visits",
    "Eye exam",
    "Glasses / Contacts",
    "Health insurance",
    "Hearing",
    "Hospital",
    "Lab tests",
    "Medical bills",
    "Mental health",
    "Physical therapy",
    "Prescriptions",
    "Specialist",
    "Surgery",
    "Therapy",
    "Vision",
    "Vitamins",
  ],
  savings: [
    "529 / Education fund",
    "Car fund",
    "Down payment",
    "Emergency savings",
    "HSA contribution",
    "Holiday fund",
    "House fund",
    "Investment account",
    "IRA contribution",
    "Retirement",
    "Savings",
    "Sinking fund",
    "Vacation savings",
    "Wedding fund",
  ],
};

export const CATEGORY_ORDER: ExpenseCategory[] = [
  "housing",
  "food",
  "transportation",
  "lifestyle",
  "healthcare",
  "savings",
];

export type BudgetTotals = {
  monthlyUSD: number;
  annualUSD: number;
  byCategory: Record<ExpenseCategory, number>;
  /**
   * Monthly subtotal of items the user marked `type: "fixed"`
   * — i.e. essentials they can't readily cut. Drives:
   *   - the "essentials runway" half of the emergency-fund meter
   *   - the floor of retirement spend (variable haircut can't go
   *     below it, by definition)
   */
  fixedMonthlyUSD: number;
  /** Monthly subtotal of items the user marked `type: "variable"`. */
  variableMonthlyUSD: number;
  /**
   * Monthly subtotal of items relevant for retirement-spend math
   * with NO haircut applied (excludes savings + endsAtRetirement
   * only). Kept for back-compat; new code should prefer
   * `retirementMonthlyAfterHaircut`.
   */
  retirementMonthlyUSD: number;
  retirementAnnualUSD: number;
};

/**
 * Clamp a haircut percentage to [0, 1]. A haircut of 0 = no change
 * (current behavior); 1 = drop variable expenses entirely. Values
 * outside the range are coerced rather than thrown — the field
 * comes from user input and we'd rather behave sanely than crash.
 */
export function clampHaircut(haircut: number | null | undefined): number {
  if (!Number.isFinite(haircut ?? NaN)) return 0;
  return Math.max(0, Math.min(1, haircut ?? 0));
}

/**
 * Historical frequency of negative real stock-return years in the
 * 1928–2025 dataset (~31% of years). Used by `effectiveHaircut`
 * below to size the corpus correctly when the user has set the
 * conditional-haircut mode (apply only after down years) — the
 * realized average withdrawal then sits between always-apply and
 * never-apply, so the corpus must too.
 *
 * Source: lib/historicalReturns.ts. Update if the dataset is
 * extended past 2025.
 */
export const HISTORICAL_DOWN_YEAR_FREQUENCY = 0.31;

/**
 * Sizing-time effective haircut.
 *
 * When `onDownYearOnly === false` (the default), returns the raw
 * rate — corpus is sized as if the haircut applies every year
 * (the existing always-apply contract).
 *
 * When `onDownYearOnly === true`, returns `rate × historical
 * down-year frequency`. The MC simulator will only apply the
 * full haircut in down-following years (~31% of the time on
 * average); sizing the corpus on the realized average keeps
 * `suggestedIndependenceCorpus` honest. Without this
 * adjustment, conditional-mode users would either over-save
 * (if we naively applied the full rate) or under-save (if we
 * ignored the haircut entirely).
 *
 * Returns a value in [0, 1]. NaN-safe.
 */
export function effectiveHaircut(
  rate: number | null | undefined,
  onDownYearOnly: boolean,
): number {
  const r = clampHaircut(rate);
  if (!onDownYearOnly) return r;
  return r * HISTORICAL_DOWN_YEAR_FREQUENCY;
}

export function budgetTotals(items: BudgetItem[]): BudgetTotals {
  const byCategory: Record<ExpenseCategory, number> = {
    food: 0,
    housing: 0,
    transportation: 0,
    lifestyle: 0,
    healthcare: 0,
    savings: 0,
  };
  let monthly = 0;
  let retirementMonthly = 0;
  let fixedMonthly = 0;
  let variableMonthly = 0;
  for (const it of items) {
    if (!Number.isFinite(it.monthlyUSD) || it.monthlyUSD < 0) continue;
    byCategory[it.category] += it.monthlyUSD;
    monthly += it.monthlyUSD;
    if (it.type === "fixed") fixedMonthly += it.monthlyUSD;
    else variableMonthly += it.monthlyUSD;
    // Excluded from retirement: savings category (always) + items
    // explicitly marked endsAtRetirement. Items with an endDate
    // already in the past are treated as ended too — they shouldn't
    // count against today's spend either, but the UI should warn
    // the user to clean those up rather than silently dropping them.
    const inRetirement =
      it.category !== "savings" && !it.endsAtRetirement;
    if (inRetirement) retirementMonthly += it.monthlyUSD;
  }
  return {
    monthlyUSD: monthly,
    annualUSD: monthly * 12,
    byCategory,
    fixedMonthlyUSD: fixedMonthly,
    variableMonthlyUSD: variableMonthly,
    retirementMonthlyUSD: retirementMonthly,
    retirementAnnualUSD: retirementMonthly * 12,
  };
}

/**
 * Retirement-monthly with the variable-expense haircut applied.
 * Fixed items retain 100% weight; variable items are reduced by
 * the haircut (0 = no reduction, 0.5 = halved, 1 = dropped).
 *
 * Math:
 *   retirement_monthly = Σ (fixed items NOT in savings, NOT
 *                           ending-at-retirement)
 *                      + Σ (variable items NOT in savings, NOT
 *                           ending-at-retirement) × (1 - haircut)
 *
 * The Savings category and endsAtRetirement items are excluded
 * regardless of type — same rule as `retirementMonthlyUSD` above.
 * This is the function `suggestedIndependenceCorpus` consumes when a
 * haircut is configured.
 */
export function retirementMonthlyAfterHaircut(
  items: BudgetItem[],
  variableHaircut: number,
): number {
  const h = clampHaircut(variableHaircut);
  let total = 0;
  for (const it of items) {
    if (!Number.isFinite(it.monthlyUSD) || it.monthlyUSD < 0) continue;
    if (it.category === "savings") continue;
    if (it.endsAtRetirement) continue;
    if (it.type === "fixed") {
      total += it.monthlyUSD;
    } else {
      total += it.monthlyUSD * (1 - h);
    }
  }
  return total;
}

/**
 * Sum of variable, retirement-relevant monthly spend BEFORE any
 * haircut. This is the slice the dynamic-haircut feature can
 * reduce in-loop — fixed items pass through unchanged.
 *
 * Sister of `retirementMonthlyAfterHaircut`: the two compose to
 * the no-haircut retirement total via
 *   retirementMonthlyAfterHaircut(items, 0)
 *     === fixedRetirementMonthly + variableRetirementMonthly.
 *
 * Used by `effectiveVariableShare` (below).
 */
export function variableRetirementMonthly(items: BudgetItem[]): number {
  let total = 0;
  for (const it of items) {
    if (!Number.isFinite(it.monthlyUSD) || it.monthlyUSD < 0) continue;
    if (it.category === "savings") continue;
    if (it.endsAtRetirement) continue;
    if (it.type !== "fixed") total += it.monthlyUSD;
  }
  return total;
}

/**
 * Default variable-share when no budget data is available.
 *
 * Source: BLS Consumer Expenditure Survey (2022), households 65+.
 * Fixed ≈ housing + insurance + utilities + Medicare premiums
 *       ≈ ~65% of total spending.
 * Variable ≈ food + transportation + entertainment + apparel
 *          + personal care + cash gifts ≈ ~35%.
 *
 * Round number worth pinning as a constant rather than a magic
 * literal — if the survey methodology changes, this is the one
 * line to update + cite.
 */
export const DEFAULT_VARIABLE_SHARE = 0.35;

/**
 * Effective fraction of retirement spend that the haircut may
 * cut. Resolved via:
 *   1. user's explicit `assumptions.retirementVariableShare`
 *      override, when set — they know their plan best;
 *   2. budget-derived (`variable / total`) when budget items
 *      exist — uses their actual line-items;
 *   3. `DEFAULT_VARIABLE_SHARE` (0.35) — works without any
 *      configuration.
 *
 * Always returns a value in [0, 1]. NaN-safe. The result is the
 * single number the rest of the system multiplies the
 * spend-being-tested by, so the haircut applies to a consistent
 * fraction regardless of whether the user is testing a target-
 * derived or budget-derived spend.
 */
export function effectiveVariableShare(
  items: BudgetItem[],
  explicitOverride: number | null | undefined,
): number {
  if (
    explicitOverride != null &&
    Number.isFinite(explicitOverride) &&
    explicitOverride >= 0 &&
    explicitOverride <= 1
  ) {
    return explicitOverride;
  }
  // Budget-derived when we can compute it from non-zero totals.
  // The retirement-relevant total = fixed + variable monthly that
  // survives `endsAtRetirement` + non-savings filters.
  const noHaircutTotal = retirementMonthlyAfterHaircut(items, 0);
  const variable = variableRetirementMonthly(items);
  if (noHaircutTotal > 0) {
    const share = variable / noHaircutTotal;
    return Math.max(0, Math.min(1, share));
  }
  return DEFAULT_VARIABLE_SHARE;
}

/**
 * Default retirement tax rate when the user hasn't picked one.
 * 20% is a reasonable blended assumption across Roth (0%),
 * long-term cap gains (0-20%), and traditional 401k/IRA
 * (ordinary-income brackets). The user dials it from the
 * Assumptions panel.
 */
export const DEFAULT_RETIREMENT_TAX_RATE = 0.2;

/**
 * Per-category REAL-EXCESS inflation defaults, in real terms above
 * general CPI. 0 = "tracks CPI exactly, flat in real terms" — the
 * default for everyday expenses that the Trinity / SWR math
 * already handles correctly. Non-zero values are extra real drag
 * (or relief) the corpus needs to absorb.
 *
 * Anchored to long-run BLS / KFF data:
 *   - Healthcare (medical care services): ~2% real excess over CPI
 *     across the last 30 years (hospital + insurance components
 *     even higher). This is the headline reason this whole
 *     system exists.
 *   - Housing (shelter / rent): ~0.5% real over CPI on long-run
 *     averages, locally much higher in tight markets.
 *   - Food, transportation: track CPI on long-run averages → 0.
 *   - Lifestyle (entertainment / discretionary): historically
 *     trails CPI slightly thanks to consumer-electronics
 *     deflation in the basket → -0.5%.
 *
 * Per-item overrides always win.
 */
export const CATEGORY_DEFAULT_EXCESS_INFLATION: Record<
  ExpenseCategory,
  number
> = {
  food: 0,
  housing: 0.005,
  transportation: 0,
  lifestyle: -0.005,
  healthcare: 0.02,
  // Savings doesn't enter the retirement-spend rollup; value is
  // cosmetic.
  savings: 0,
};

/**
 * Resolve the effective REAL-EXCESS inflation rate for an expense:
 *   1. Use `excessInflationOverride` if set
 *   2. Else use `CATEGORY_DEFAULT_EXCESS_INFLATION[category]`
 *
 * Clamped to [-0.1, 0.5] defensively (10% real deflation per year
 * or 50% real inflation per year are both beyond any realistic
 * scenario; UI slider caps tighter).
 */
export function effectiveExcessInflation(item: BudgetItem): number {
  const raw =
    item.excessInflationOverride != null &&
    Number.isFinite(item.excessInflationOverride)
      ? item.excessInflationOverride
      : CATEGORY_DEFAULT_EXCESS_INFLATION[item.category];
  return Math.max(-0.1, Math.min(0.5, raw));
}

/** Clamp a tax rate to [0, 0.99] (avoids divide-by-zero at t=1). */
export function clampTaxRate(rate: number | null | undefined): number {
  if (!Number.isFinite(rate ?? NaN)) return DEFAULT_RETIREMENT_TAX_RATE;
  return Math.max(0, Math.min(0.99, rate ?? DEFAULT_RETIREMENT_TAX_RATE));
}

/**
 * Inverse of the SWR math: at the configured withdrawal rate, what
 * portfolio size sustains the retirement-monthly expenses forever?
 *
 * Two adjustments on top of the naive `annual / SWR` calc:
 *   - Variable haircut: a fraction of variable items is dropped,
 *     modeling lifestyle cuts in retirement.
 *   - Tax gross-up: the user has to *withdraw* more than they
 *     *spend* to net the spend after retirement-era taxes. With
 *     net monthly spend `S` and tax rate `t`, gross withdrawal
 *     needed is `S / (1 - t)`. Corpus sizes against the gross.
 *
 * Math:
 *   net_monthly = retirementMonthlyAfterHaircut(items, h)
 *   gross_monthly = net_monthly / (1 - t)
 *   corpus = gross_monthly * 12 / withdrawalRate
 *
 * Returns null when expenses are zero or withdrawalRate is
 * non-positive.
 */
/**
 * Trinity-style planning horizon, in years. The SWR field on
 * assumptions is empirically grounded in 30-year retirement
 * windows (Bengen / Trinity), so we use the same horizon here to
 * compute the "lifetime average real spend" lift from per-line
 * real-excess inflation. A future expansion could expose this
 * as a configurable assumption for users with very long (Independence
 * at 30, lives to 95) or very short (retires at 70) horizons.
 */
export const PLANNING_HORIZON_YEARS = 30;

/**
 * Time-weighted growth multiplier for a real-terms stream that
 * starts at 1 (year 1) and grows at real rate `g` per year for
 * `n` years. Returns the simple time-average of payments:
 *
 *   ((1 + g)^n - 1) / (g * n)
 *
 * Properties:
 *   g = 0   → 1 (flat in real terms; multiplier collapses to 1)
 *   g > 0   → > 1 (cost grows; average exceeds year-1 spend)
 *   g < 0   → < 1 (cost shrinks; average below year-1 spend)
 *
 * Bounded for any realistic g over a 30-year horizon — at the
 * UI slider's +8% real-excess cap, multiplier ≈ 3.78. No
 * singularities, no need for divide-by-zero floors. Replaces
 * the prior Gordon-perpetuity formula A/(swr-g), which assumed
 * infinite duration and broke when g approached swr.
 *
 * Defensive: clamps to [0, 50] in case absurd input slips
 * through.
 */
export function realExcessGrowthMultiplier(
  g: number,
  n: number = PLANNING_HORIZON_YEARS,
): number {
  if (!Number.isFinite(g) || !Number.isFinite(n) || n <= 0) return 1;
  // Numerical edge: near g = 0, use the limit (multiplier → 1)
  // to avoid 0/0. Closed-form `((1+g)^n - 1) / (g*n)` is well-
  // behaved at any other g.
  if (Math.abs(g) < 1e-9) return 1;
  const raw = (Math.pow(1 + g, n) - 1) / (g * n);
  return Math.max(0, Math.min(50, raw));
}

/**
 * Weighted-average real-excess inflation across retirement-relevant
 * lines, weighted by annual spend AFTER haircut and savings /
 * endsAtRetirement exclusions. Returns 0 when no relevant spend.
 *
 * This is the user-facing summary the Budget panel surfaces — a
 * single "your blended real-excess is X%" number that explains
 * how much of the corpus inflation drag comes from the budget mix.
 */
export function weightedRealExcess(
  items: BudgetItem[],
  variableHaircut: number = 0,
): number {
  const h = clampHaircut(variableHaircut);
  let weightedSum = 0;
  let totalWeight = 0;
  for (const it of items) {
    if (!Number.isFinite(it.monthlyUSD) || it.monthlyUSD < 0) continue;
    if (it.category === "savings") continue;
    if (it.endsAtRetirement) continue;
    const monthly =
      it.type === "fixed" ? it.monthlyUSD : it.monthlyUSD * (1 - h);
    if (monthly <= 0) continue;
    const excess = effectiveExcessInflation(it);
    weightedSum += monthly * excess;
    totalWeight += monthly;
  }
  if (totalWeight <= 0) return 0;
  return weightedSum / totalWeight;
}

/**
 * Suggested independence corpus, in TODAY'S DOLLARS (real terms).
 *
 * Per-line FINITE-HORIZON time-weighted formulation. For each
 * retirement-relevant line with annual spend A and real-excess
 * inflation g:
 *
 *   lifetime_avg = A × realExcessGrowthMultiplier(g, 30)
 *   contribution = lifetime_avg / swr
 *
 *   Total corpus (pre-tax) = Σ contributions
 *   Final corpus            = total / (1 - retirement_tax_rate)
 *
 * Why this is the right shape:
 *
 *   - The whole app already runs in real-CAGR / real-SWR / today's-
 *     dollars terms.
 *
 *   - Trinity-style SWR (4% / 3.5% / etc.) is empirically grounded
 *     in a 30-year retirement window with CONSTANT real
 *     withdrawals. It encapsulates the survival of a portfolio
 *     funding constant real spend.
 *
 *   - When real-excess g > 0, the real spend isn't constant — it
 *     grows. The honest adjustment is to size the corpus to fund
 *     the AVERAGE real spend over the horizon (year-1 spend × the
 *     time-weighted multiplier), then apply the standard SWR.
 *
 *   - The multiplier collapses to 1 when g = 0 (Trinity unchanged).
 *     Healthcare at 2% real over 30 years → multiplier ≈ 1.35 →
 *     35% larger corpus contribution. Lifestyle at -0.5% real →
 *     multiplier ≈ 0.93 → 7% smaller. Bounded; no singularities.
 *
 * The earlier perpetuity formula A/(swr-g) was incorrect: it
 * combined Trinity's finite-horizon SWR with an infinite-duration
 * discount math, producing a singularity at g = swr that
 * a 0.001-floor papered over. At low SWRs (2%) with healthcare's
 * default 2% real excess, the singularity inflated corpus by 20×
 * per healthcare dollar — the user-visible $47M / $38M-drag bug.
 *
 * Variable items still take the haircut; savings + endsAtRetirement
 * items still drop out. Items with non-positive monthly are skipped.
 *
 * Returns null when there's no retirement-relevant spend or
 * withdrawal rate is non-positive.
 */
export function suggestedIndependenceCorpus(
  items: BudgetItem[],
  withdrawalRate: number,
  variableHaircut: number = 0,
  retirementTaxRate: number | null | undefined = DEFAULT_RETIREMENT_TAX_RATE,
): number | null {
  if (!Number.isFinite(withdrawalRate) || withdrawalRate <= 0) return null;
  const h = clampHaircut(variableHaircut);
  const t = clampTaxRate(retirementTaxRate);
  let corpus = 0;
  for (const it of items) {
    if (!Number.isFinite(it.monthlyUSD) || it.monthlyUSD < 0) continue;
    if (it.category === "savings") continue;
    if (it.endsAtRetirement) continue;
    const monthly =
      it.type === "fixed" ? it.monthlyUSD : it.monthlyUSD * (1 - h);
    if (monthly <= 0) continue;
    const excess = effectiveExcessInflation(it);
    const multiplier = realExcessGrowthMultiplier(excess);
    corpus += (monthly * 12 * multiplier) / withdrawalRate;
  }
  if (corpus <= 0) return null;
  return corpus / (1 - t);
}

/**
 * Diagnostic helper: how much of the suggested corpus is REAL-EXCESS
 * drag above the naive (everything-tracks-CPI) version? Returns the
 * absolute dollar premium (positive when net-excess items dominate,
 * negative when deflators dominate). Used by the Budget panel to
 * surface "Healthcare's 2% real excess adds $X to your target".
 *
 * Returns null when either underlying calc is null (no retirement
 * spend).
 */
export function realExcessCorpusDrag(
  items: BudgetItem[],
  withdrawalRate: number,
  variableHaircut: number = 0,
  retirementTaxRate: number | null | undefined = DEFAULT_RETIREMENT_TAX_RATE,
): number | null {
  const actual = suggestedIndependenceCorpus(
    items,
    withdrawalRate,
    variableHaircut,
    retirementTaxRate,
  );
  if (actual == null) return null;
  // Naive = everything tracks CPI. Reuse the same function with a
  // synthetic copy where excess is forced to 0 on every line.
  const flattened = items.map((it) => ({
    ...it,
    excessInflationOverride: 0,
  }));
  const naive = suggestedIndependenceCorpus(
    flattened,
    withdrawalRate,
    variableHaircut,
    retirementTaxRate,
  );
  if (naive == null) return null;
  return actual - naive;
}

/**
 * Default endsAtRetirement value for a new item. Savings always
 * ends at retirement (you stop saving). Other categories default
 * to false; user can toggle per item for cases like mortgage payoff
 * or college tuition that have a known end.
 */
export function defaultEndsAtRetirement(category: ExpenseCategory): boolean {
  return category === "savings";
}

/**
 * Filter budget items to a single member, or pass through unchanged
 * for the household-roll-up view. Mirrors `filterHousehold` —
 * single source of truth for member-scoping the budget list, used
 * by BudgetPanel and any future consumer that needs a per-member
 * view (e.g. per-member independence corpus suggestion).
 */
export function filterBudgetByMember(
  items: BudgetItem[],
  memberId: string | null,
): BudgetItem[] {
  if (!memberId) return items;
  return items.filter((it) => it.ownerId === memberId);
}

/**
 * Scope budget items for rollup display.
 *
 * Mirrors the household-scoping rules used everywhere else:
 *   - When a specific member is picked, return that member's
 *     items only (the explicit pick wins regardless of their
 *     rollup-include flag).
 *   - When no member is picked (household-aggregate view), drop
 *     items whose owner is flagged out of rollups.
 *
 * Pass the active-member-id set rather than the full Household
 * to keep this module dependency-free w.r.t. the higher-level
 * `Household` type — the caller composes the set via
 * `activeMemberIds(household)` from lib/types.
 */
export function filterBudgetForRollups(
  items: BudgetItem[],
  memberId: string | null,
  activeOwnerIds: Set<string>,
): BudgetItem[] {
  if (memberId) return items.filter((it) => it.ownerId === memberId);
  return items.filter((it) => activeOwnerIds.has(it.ownerId));
}

/** Months in one billing cycle. */
export const MONTHS_PER_CYCLE: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Per-cycle dollar amount for display. `monthlyUSD * monthsInCycle`.
 * Falls back to monthlyUSD when no cycle is specified.
 */
export function perCycleAmountUSD(item: BudgetItem): number {
  const cycle = item.billingCycle ?? "monthly";
  return item.monthlyUSD * MONTHS_PER_CYCLE[cycle];
}

/**
 * Compute the next billing date for a subscription. Walks
 * `startDate` (or createdAt fallback) forward by the billing cycle
 * until it lands on or after `now`.
 *
 * Returns null when the item isn't a subscription or has no start
 * anchor. Math is calendar-based (advanceByCycle steps by month
 * arithmetic) so leap years / month-length edge cases handle
 * themselves.
 */
export function nextBillingDate(
  item: BudgetItem,
  now: number = Date.now(),
): Date | null {
  if (!item.isSubscription) return null;
  const anchorMs = item.startDate ?? item.createdAt;
  if (!Number.isFinite(anchorMs)) return null;
  const cycle = item.billingCycle ?? "monthly";
  const monthsPer = MONTHS_PER_CYCLE[cycle];

  // Walk forward in cycle increments until next billing is in the
  // future. Caps the loop at 1200 iterations (100 years of monthly
  // cycles) as a defense against pathological input.
  let next = new Date(anchorMs);
  let safety = 0;
  while (next.getTime() <= now && safety < 1200) {
    next = new Date(next);
    next.setMonth(next.getMonth() + monthsPer);
    safety += 1;
  }
  return next;
}

/** Pick out subscription-tagged items. */
export function subscriptionItems(items: BudgetItem[]): BudgetItem[] {
  return items.filter((it) => it.isSubscription);
}

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
