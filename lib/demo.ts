import { getPreset } from "@/lib/portfolio/presets";
import type { BudgetItem } from "@/lib/budget/budget";
import type { IncomeStream } from "@/lib/budget/incomeStreams";
import { estimateSocialSecurityAtFRA } from "@/lib/budget/socialSecurity";
import type {
  Account,
  Assumptions,
  CommodityHolding,
  CryptoHolding,
  EquityHolding,
  BondHolding,
  Holding,
  Household,
  Liability,
  Member,
  RealEstateHolding,
} from "@/lib/types";

let id = 0;
const nextId = () => `h${++id}`;

function equity(symbol: string, valueUSD: number): EquityHolding {
  const p = getPreset(symbol);
  if (!p || p.assetClass !== "equity") {
    throw new Error(`No equity preset for ${symbol}`);
  }
  const shares = valueUSD / p.referencePriceUSD;
  return {
    kind: "equity",
    id: nextId(),
    symbol: p.symbol,
    shares,
    lastPriceUSD: p.referencePriceUSD,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: p.expectedRealCAGR,
    leverage: p.leverage,
    styleBox: p.styleBox,
    geography: p.geography,
    ...(p.composition ? { composition: p.composition } : {}),
  };
}

function bond(symbol: string, valueUSD: number): BondHolding {
  const p = getPreset(symbol);
  if (!p || p.assetClass !== "bond") {
    throw new Error(`No bond preset for ${symbol}`);
  }
  const shares = valueUSD / p.referencePriceUSD;
  return {
    kind: "bond",
    id: nextId(),
    symbol: p.symbol,
    shares,
    lastPriceUSD: p.referencePriceUSD,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: p.expectedRealCAGR,
    leverage: p.leverage,
    bondType: p.bondType,
    geography: p.geography,
    averageDurationYears: p.averageDurationYears,
  };
}

function commodity(symbol: string, valueUSD: number): CommodityHolding {
  const p = getPreset(symbol);
  if (!p || p.assetClass !== "commodity") {
    throw new Error(`No commodity preset for ${symbol}`);
  }
  const shares = valueUSD / p.referencePriceUSD;
  return {
    kind: "commodity",
    id: nextId(),
    symbol: p.symbol,
    shares,
    lastPriceUSD: p.referencePriceUSD,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: p.expectedRealCAGR,
    ...(p.breakdown ? { breakdown: p.breakdown } : {}),
  };
}

function crypto(symbol: string, valueUSD: number): CryptoHolding {
  const p = getPreset(symbol);
  if (!p || p.assetClass !== "crypto") {
    throw new Error(`No crypto preset for ${symbol}`);
  }
  const shares = valueUSD / p.referencePriceUSD;
  return {
    kind: "crypto",
    id: nextId(),
    symbol: p.symbol,
    shares,
    lastPriceUSD: p.referencePriceUSD,
    lastPricedAt: null,
    isManualPrice: false,
    enteredAsShares: false,
    acquiredAt: null,
    valueUSD,
    expectedRealCAGR: p.expectedRealCAGR,
  };
}

function cash(valueUSD: number, expectedRealCAGR = 0): Holding {
  return {
    kind: "cash",
    id: nextId(),
    valueUSD,
    expectedRealCAGR,
    geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
  };
}

function realEstate(
  name: string,
  valueUSD: number,
  opts: {
    expectedRealCAGR?: number;
    leverage?: number;
    isPrimaryResidence?: boolean;
    isIlliquid?: boolean;
  } = {},
): RealEstateHolding {
  return {
    kind: "real_estate",
    id: nextId(),
    name,
    valueUSD,
    expectedRealCAGR: opts.expectedRealCAGR ?? 0.005,
    acquiredAt: null,
    leverage: opts.leverage ?? 1,
    isPrimaryResidence: opts.isPrimaryResidence,
    isIlliquid: opts.isIlliquid,
  };
}

// Two-member demo household — a hypothetical couple in their late
// 30s, mid-career, with a child's 529. Chosen to surface every
// engine the app supports: per-member ownership, real estate with
// mortgage leverage, multi-asset wrappers, a credit-card / mortgage
// liability mix, a gold sleeve for diversification, a crypto sliver,
// and shares across taxable / Roth / traditional / HSA / 529.
//
// Numbers chosen so the household lands roughly mid-trajectory: well
// past starting principal but still years away from target. That
// lets every surface (allocation drift, Monte Carlo, glide-path,
// sequence-of-returns risk) render meaningfully out of the box.
const ALEX_ID = "demo-member-alex";
const JORDAN_ID = "demo-member-jordan";
const KIDDO_ID = "demo-member-kiddo";

const members: Member[] = [
  { id: ALEX_ID, displayName: "Alex", age: 38, incomeUSD: 220_000 },
  { id: JORDAN_ID, displayName: "Jordan", age: 36, incomeUSD: 165_000 },
  { id: KIDDO_ID, displayName: "Kiddo", age: 5, incomeUSD: null },
];

function account(args: {
  category: Account["category"];
  displayName: string;
  ownerId: string;
  holdings: Holding[];
  monthlyContributionUSD?: number;
}): Account {
  return {
    id: `acc-${args.ownerId}-${args.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    category: args.category,
    displayName: args.displayName,
    ownerId: args.ownerId,
    holdings: args.holdings,
    monthlyContributionUSD: args.monthlyContributionUSD ?? 0,
  };
}

const alexAccounts: Account[] = [
  account({
    category: "401K",
    displayName: "Alex 401(k)",
    ownerId: ALEX_ID,
    holdings: [
      equity("VTI", 180_000),
      equity("VXUS", 45_000),
      bond("BND", 25_000),
    ],
    monthlyContributionUSD: 1_958, // $23.5k/yr employee max prorated
  }),
  account({
    category: "ROTH_IRA",
    displayName: "Alex Roth IRA",
    ownerId: ALEX_ID,
    holdings: [equity("VTI", 65_000), equity("AVUV", 20_000)],
    monthlyContributionUSD: 583, // $7k/yr
  }),
  account({
    category: "HSA",
    displayName: "Alex HSA",
    ownerId: ALEX_ID,
    holdings: [equity("VTI", 28_000)],
    monthlyContributionUSD: 350,
  }),
  // Levered ETF sleeve in a Roth — captures the "leveraged ETF in
  // a tax-advantaged account" scenario that the leverage + tax
  // surfaces are designed around.
  account({
    category: "BROKERAGE",
    displayName: "Alex Taxable",
    ownerId: ALEX_ID,
    holdings: [
      equity("VOO", 95_000),
      equity("QQQM", 40_000),
      equity("NTSX", 35_000), // 1.5× leveraged stocks+bonds composition
      equity("TQQQ", 18_000), // 3× leveraged Nasdaq
      commodity("GLD", 22_000),
      crypto("BTC", 12_000),
    ],
    monthlyContributionUSD: 2_400,
  }),
];

const jordanAccounts: Account[] = [
  account({
    category: "401K",
    displayName: "Jordan 403(b)",
    ownerId: JORDAN_ID,
    holdings: [
      equity("VOO", 140_000),
      equity("VEA", 30_000),
      bond("AGG", 35_000),
    ],
    monthlyContributionUSD: 1_500,
  }),
  account({
    category: "ROTH_IRA",
    displayName: "Jordan Roth IRA",
    ownerId: JORDAN_ID,
    holdings: [equity("VTI", 42_000)],
    monthlyContributionUSD: 583,
  }),
  account({
    category: "TRAD_IRA",
    displayName: "Jordan Rollover IRA",
    ownerId: JORDAN_ID,
    holdings: [equity("VTI", 88_000), bond("BNDX", 18_000)],
    monthlyContributionUSD: 0,
  }),
];

// Shared household accounts — joint brokerage, savings, checking,
// the family home (primary residence with a mortgage), a rental
// duplex, and a 529 for the kiddo.
const sharedAccounts: Account[] = [
  account({
    category: "BROKERAGE",
    displayName: "Joint Taxable",
    ownerId: ALEX_ID,
    holdings: [
      equity("VOO", 75_000),
      equity("AVUV", 25_000),
      bond("BND", 30_000),
      commodity("GLD", 18_000),
    ],
    monthlyContributionUSD: 1_500,
  }),
  account({
    category: "FIVE_29",
    displayName: "Kiddo 529",
    ownerId: KIDDO_ID,
    holdings: [equity("VTI", 32_000)],
    monthlyContributionUSD: 500,
  }),
  account({
    category: "SAVINGS",
    displayName: "Emergency Fund (HYSA)",
    ownerId: ALEX_ID,
    holdings: [cash(45_000, 0.005)], // ~50bp real on a 4-5% nominal HYSA
    monthlyContributionUSD: 0,
  }),
  account({
    category: "CHECKING",
    displayName: "Joint Checking",
    ownerId: ALEX_ID,
    holdings: [cash(15_000, 0)],
    monthlyContributionUSD: 0,
  }),
  // Direct real estate — equity-net values. Primary residence:
  // $850k market, $620k mortgage → $230k equity at ~3.7× leverage.
  // Rental duplex: $480k market, $310k mortgage → $170k equity
  // at ~2.8× leverage, used as a long-term hold for appreciation +
  // rental yield (yield handled outside the simulator's RE series).
  account({
    category: "REAL_ESTATE",
    displayName: "Primary Residence",
    ownerId: ALEX_ID,
    holdings: [
      realEstate("Family Home", 230_000, {
        leverage: 3.7,
        isPrimaryResidence: true,
        expectedRealCAGR: 0.01,
      }),
    ],
    monthlyContributionUSD: 0,
  }),
  account({
    category: "REAL_ESTATE",
    displayName: "Rental Duplex",
    ownerId: JORDAN_ID,
    holdings: [
      realEstate("Rental Duplex", 170_000, {
        leverage: 2.8,
        isPrimaryResidence: false,
        // Audit R4 MED: realistic showcase narrative — a rental
        // with tenants on a multi-year lease isn't liquid enough
        // to fund retirement spend on demand. Marks the holding
        // off the Liquid net-worth view and Independence
        // projection (matches the `isLiquid` cascade).
        isIlliquid: true,
        expectedRealCAGR: 0.015,
      }),
    ],
    monthlyContributionUSD: 0,
  }),
];

// IMPORTANT convention (see `RealEstateHolding` doc at
// lib/types.ts:481+): `real_estate.valueUSD` stores EQUITY (net of
// mortgage), and the `leverage` field captures the gross-vs-equity
// ratio for stress-test math. Mortgages are therefore NOT entered
// as separate liabilities for properties already tracked as equity
// holdings — doing so would double-count the debt against net
// worth. Demo previously had `liab-mortgage` ($620k) and
// `liab-rental-mortgage` ($310k) entries alongside their equity-
// valued real-estate holdings, which understated demo NW by
// $930k (R4 audit CRITICAL fix). Auto / student / credit card
// liabilities remain — those are NOT netted into any holding.
const liabilities: Liability[] = [
  {
    id: "liab-auto",
    name: "Auto loan",
    balanceUSD: 22_000,
    annualInterestRate: 0.058,
    monthlyPaymentUSD: 495,
    ownerId: ALEX_ID,
  },
  {
    id: "liab-student",
    name: "Student loan",
    balanceUSD: 14_500,
    annualInterestRate: 0.048,
    monthlyPaymentUSD: 240,
    ownerId: JORDAN_ID,
  },
  {
    id: "liab-cc",
    name: "Credit card",
    balanceUSD: 3_200,
    annualInterestRate: 0.218,
    monthlyPaymentUSD: 250,
    ownerId: ALEX_ID,
  },
];

export const DEMO_HOUSEHOLD: Household = {
  id: "demo-household",
  members,
  accounts: [...alexAccounts, ...jordanAccounts, ...sharedAccounts],
  liabilities,
};

/**
 * Demo retirement ages drawn from each earner's projected
 * Independence Day (~age 48 for Alex, ~46 for Jordan). The
 * Social Security estimator averages in zero-earning years for
 * the gap between retirement and the standard 35-year AIME
 * window — so early retirees see meaningfully lower SS than a
 * full-career worker at the same income. This realism is
 * critical: an over-stated SS estimate would make the demo
 * household look more secure than they actually are.
 */
const DEMO_ALEX_RETIREMENT_AGE = 48;
const DEMO_JORDAN_RETIREMENT_AGE = 46;

/**
 * Anchor year for the demo data. Using a literal makes the
 * snapshots stable across calendar years (otherwise the test
 * suite's expected SS start year would tick over every Jan 1).
 * Match this to the year the dataset is current as of.
 */
const DEMO_BASE_YEAR = 2026;

const ALEX_SS = estimateSocialSecurityAtFRA(
  220_000,
  38,
  DEMO_ALEX_RETIREMENT_AGE,
  DEMO_BASE_YEAR,
);
const JORDAN_SS = estimateSocialSecurityAtFRA(
  165_000,
  36,
  DEMO_JORDAN_RETIREMENT_AGE,
  DEMO_BASE_YEAR,
);

/**
 * Demo future-income streams. Both household earners get a
 * Social Security stream sized to their income + early-retire
 * pattern. We claim at Full Retirement Age (67) — the
 * conservative default. End year is set to age 95 to cover the
 * planning horizon without being absurd.
 *
 * Real growth = 0 because SS is CPI-indexed (the COLA), which
 * matches the income-stream feature's default for inflation-
 * protected streams.
 *
 * Owner-keyed so the rollup-include filter handles them
 * correctly: excluded members' SS drops out of the household-
 * aggregate view, but stays visible when the user filters to
 * that member.
 *
 * We deliberately round to the nearest $500 — the estimator
 * outputs $43,232.40 for Alex, but a sticker-precise number
 * in the demo would tell users "this exact dollar amount is
 * what you'll receive" which is misleading. $43,000 reads as
 * "estimate" to a financially-literate user.
 */
function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export const DEMO_INCOME_STREAMS: IncomeStream[] = [
  {
    id: "demo-stream-alex-ss",
    label: "Alex Social Security",
    startYear: ALEX_SS.fraYear,
    // Plan to age 95: Alex turns 95 in (DEMO_BASE_YEAR - 38 + 95).
    endYear: DEMO_BASE_YEAR - 38 + 95,
    annualUSD: roundToNearest(ALEX_SS.annualUSDAtFRA, 500),
    realGrowthRate: 0,
    ownerId: ALEX_ID,
  },
  {
    id: "demo-stream-jordan-ss",
    label: "Jordan Social Security",
    startYear: JORDAN_SS.fraYear,
    endYear: DEMO_BASE_YEAR - 36 + 95,
    annualUSD: roundToNearest(JORDAN_SS.annualUSDAtFRA, 500),
    realGrowthRate: 0,
    ownerId: JORDAN_ID,
  },
];

/**
 * Demo budget — sized to match `DEMO_ASSUMPTIONS` so the budget panel
 * and the plan tell a consistent story:
 *
 *   target NW $3.5M × SWR 4% = ~$140K/yr in retirement = ~$11,700/mo
 *
 * Items marked `endsAtRetirement: true` (mortgage, childcare) drop out
 * of the retirement-spend rollup. The continuing items below sum to
 * ~$11,700/mo, so the budget-implied corpus closely tracks the
 * assumptions' target NW — pressing "Apply to Independence target" on
 * the budget panel reconciles them rather than fighting them.
 *
 * Subscriptions are tagged with `isSubscription: true` so they show up
 * under the dedicated Subscriptions tab on the Budget panel. They also
 * roll up into the monthly totals like any other variable-lifestyle
 * item — the subscription tab is a view, not a separate ledger.
 *
 * Demo "today" total: ~$16,330/mo across both Alex and Jordan as
 * owners (high-income dual-earner household with one young child).
 */
const SUBSCRIPTION_START = Date.UTC(DEMO_BASE_YEAR - 2, 0, 15);

export const DEMO_BUDGET: BudgetItem[] = [
  // ── Housing ──────────────────────────────────────────────────────────
  {
    id: "demo-budget-mortgage",
    name: "Mortgage P&I",
    ownerId: ALEX_ID,
    category: "housing",
    subcategory: "Mortgage",
    monthlyUSD: 3500,
    type: "fixed",
    endsAtRetirement: true,
    createdAt: 0,
  },
  {
    id: "demo-budget-property-tax",
    name: "Property tax + insurance",
    ownerId: ALEX_ID,
    category: "housing",
    subcategory: "Tax + insurance",
    monthlyUSD: 1200,
    type: "fixed",
    endsAtRetirement: false,
    createdAt: 0,
  },
  {
    id: "demo-budget-utilities",
    name: "Utilities",
    ownerId: ALEX_ID,
    category: "housing",
    subcategory: "Utilities",
    monthlyUSD: 400,
    type: "fixed",
    endsAtRetirement: false,
    createdAt: 0,
  },
  {
    id: "demo-budget-maintenance",
    name: "Home maintenance",
    ownerId: ALEX_ID,
    category: "housing",
    subcategory: "Maintenance",
    monthlyUSD: 400,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  // ── Food ─────────────────────────────────────────────────────────────
  {
    id: "demo-budget-groceries",
    name: "Groceries",
    ownerId: JORDAN_ID,
    category: "food",
    subcategory: "Groceries",
    monthlyUSD: 1400,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  {
    id: "demo-budget-dining",
    name: "Dining out",
    ownerId: JORDAN_ID,
    category: "food",
    subcategory: "Restaurants",
    monthlyUSD: 600,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  // ── Transportation ──────────────────────────────────────────────────
  {
    id: "demo-budget-car-payment",
    name: "Car payment",
    ownerId: ALEX_ID,
    category: "transportation",
    subcategory: "Car loan",
    monthlyUSD: 500,
    type: "fixed",
    endsAtRetirement: false,
    createdAt: 0,
  },
  {
    id: "demo-budget-auto-insurance-gas",
    name: "Auto insurance + gas",
    ownerId: JORDAN_ID,
    category: "transportation",
    subcategory: "Insurance + fuel",
    monthlyUSD: 700,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  // ── Healthcare ──────────────────────────────────────────────────────
  {
    id: "demo-budget-health-insurance",
    name: "Health insurance premiums",
    ownerId: ALEX_ID,
    category: "healthcare",
    subcategory: "Premiums",
    monthlyUSD: 1800,
    type: "fixed",
    endsAtRetirement: false,
    // Healthcare runs hotter than CPI — Pfau / Kaiser benchmarks put
    // medical inflation ~2pt above general inflation. Set a +1.5pt
    // real-excess so the demo's Gordon-growth math reflects that
    // headwind rather than flat-real.
    excessInflationOverride: 0.015,
    createdAt: 0,
  },
  // ── Lifestyle (continuing) ──────────────────────────────────────────
  {
    id: "demo-budget-travel",
    name: "Travel",
    ownerId: JORDAN_ID,
    category: "lifestyle",
    subcategory: "Travel",
    monthlyUSD: 1500,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  {
    id: "demo-budget-entertainment",
    name: "Entertainment + hobbies",
    ownerId: ALEX_ID,
    category: "lifestyle",
    subcategory: "Hobbies",
    monthlyUSD: 800,
    type: "variable",
    endsAtRetirement: false,
    createdAt: 0,
  },
  // ── Lifestyle (ends at retirement: childcare) ───────────────────────
  {
    id: "demo-budget-childcare",
    name: "Childcare + school",
    ownerId: JORDAN_ID,
    category: "lifestyle",
    subcategory: "Childcare",
    monthlyUSD: 1800,
    type: "fixed",
    endsAtRetirement: true,
    createdAt: 0,
  },
  // ── Subscriptions ───────────────────────────────────────────────────
  {
    id: "demo-budget-sub-netflix",
    name: "Netflix",
    ownerId: ALEX_ID,
    category: "lifestyle",
    subcategory: "Streaming",
    monthlyUSD: 23,
    type: "fixed",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "monthly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
  {
    id: "demo-budget-sub-spotify",
    name: "Spotify Family",
    ownerId: JORDAN_ID,
    category: "lifestyle",
    subcategory: "Streaming",
    monthlyUSD: 19,
    type: "fixed",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "monthly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
  {
    id: "demo-budget-sub-adobe",
    name: "Adobe Creative Cloud",
    ownerId: ALEX_ID,
    category: "lifestyle",
    subcategory: "Software",
    monthlyUSD: 60,
    type: "fixed",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "monthly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
  {
    id: "demo-budget-sub-aws",
    name: "AWS (personal)",
    ownerId: ALEX_ID,
    category: "lifestyle",
    subcategory: "Software",
    monthlyUSD: 30,
    type: "variable",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "monthly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
  {
    id: "demo-budget-sub-gym",
    name: "Gym membership",
    ownerId: JORDAN_ID,
    category: "lifestyle",
    subcategory: "Fitness",
    monthlyUSD: 90,
    type: "fixed",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "monthly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
  {
    id: "demo-budget-sub-costco",
    name: "Costco membership",
    ownerId: ALEX_ID,
    category: "food",
    subcategory: "Wholesale",
    // $130/yr ≈ $10.83/mo. Store as monthly USD; the
    // subscription view derives the per-cycle amount from
    // billingCycle = "yearly" so the user sees "$130 next bill"
    // not "$10.83 next bill".
    monthlyUSD: 10.83,
    type: "fixed",
    endsAtRetirement: false,
    isSubscription: true,
    billingCycle: "yearly",
    startDate: SUBSCRIPTION_START,
    createdAt: 0,
  },
];

export const DEMO_ASSUMPTIONS: Assumptions = {
  targetNetWorthUSD: 3_500_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 35,
  expectedInflationRate: 0.03,
  /**
   * Phased withdrawal — captures the "go-go / slow-go / no-go"
   * pattern that retirement researchers (Wade Pfau, David Blanchett,
   * Mike Drak) consistently observe in real retiree spending:
   *
   *   - Years 0-9 (go-go):     4.0% — the baseline (no phase
   *     needed; the headline withdrawalRate above covers this).
   *   - Years 10-19 (slow-go): 3.5% — travel + active hobbies
   *     taper off as energy declines through 70s-early 80s.
   *   - Years 20+ (no-go):     3.0% — even lower as mobility
   *     and discretionary spending decline; medical / housing
   *     stays fixed but flex drops further.
   *
   * The exact percentages are conservative — Blanchett's
   * "spending smile" research suggests real retirees drop more
   * sharply than this. We use a modest taper so the demo
   * isn't projecting unrealistic longevity wins from
   * lifestyle decline.
   */
  drawdownPhases: [
    { startMonthsAfterIndependence: 120, withdrawalRate: 0.035 },
    { startMonthsAfterIndependence: 240, withdrawalRate: 0.03 },
  ],
  /**
   * Variable-expense haircut, conditional mode. The demo household
   * models the realistic "spend less when scared" guardrail: in
   * retirement, trim 30% of variable spending — but ONLY in years
   * that follow a down-year in stocks. Good market years keep the
   * full lifestyle; bad ones tighten the belt. This is the most
   * pedagogically useful default for the demo because it surfaces
   * the conditional-haircut toggle (which a static reader of the
   * Assumptions panel would otherwise miss).
   */
  retirementVariableHaircut: 0.3,
  retirementVariableHaircutOnDownYearOnly: true,
};

export const EMPTY_HOUSEHOLD: Household = {
  id: "real-household",
  members: [{ id: "real-member-1", displayName: "You" }],
  accounts: [],
  liabilities: [],
};

export const EMPTY_ASSUMPTIONS: Assumptions = {
  targetNetWorthUSD: 1_500_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};
