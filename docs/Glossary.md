# wealthtrajectory — GLOSSARY

A reference of terms used across the PRD, ImplementationPlan, and product surfaces.
When code, copy, or charts use any of these terms they should mean exactly what is
defined here.

---

## 1. CORE Independence CONCEPTS

### Independence
Financial Independence, Retire Early. The user's investments can sustain their
spending without further wage income. Used here as a milestone, not necessarily
a commitment to stop working.

### Independence date
The earliest projected date at which a user's portfolio reaches the Independence target
under their current assumptions (CAGR, savings rate, inflation, withdrawal rate).

### Independence target
The portfolio size, in today's dollars, that supports the user's planned annual
spending at the chosen safe withdrawal rate. Default rule of thumb:
`target = annual_spend / SWR`.

### Net worth (NW)
Assets minus liabilities. Reported in today's dollars unless the surface is
explicitly nominal. Real-estate equity is `market_value − outstanding_mortgage`.

### Household vs member
A **household** is one or more **members**. Each account has an `ownerId`
pointing to a member; household totals are the sum across members. The
member-filter chip in the UI scopes every dollar figure to that member's
accounts.

### Rollup-include flag
A per-member boolean (`Member.includeInRollup`) controlling whether that
member's data feeds household-level totals. When set to `false`, the
member's income, accounts, liabilities, budget items, and income streams
all drop out of the household-aggregate view (NW, Independence projection,
Monte Carlo, savings rate, etc.). The member's data is PRESERVED — they're
just "set aside" — and explicitly picking them in the member chip still
shows their data. Common use: temporarily exclude a child from the
rollup to compare adults-only projections; model a non-earning partner
scenario; back-of-the-envelope what-ifs without losing data. The flag is
the SINGLE switch for "include this member in household-aggregate views";
implemented in `lib/types.ts:activeMembers` and routed through every
rollup helper.

### Income stream
A user-configured future-income source modeled as a recurring real-dollar
flow over a year range. Each stream has a `label`, `startYear`, `endYear`
(inclusive), `annualUSD` (real $), `realGrowthRate` (default 0 = perfectly
inflation-protected, like Social Security's COLA), and `ownerId`. Streams
flow as positive cash flow into both the Independence projection and
Monte Carlo simulator — adding income during accumulation pulls
Independence sooner; adding it during drawdown lifts survival rates and
softens lost-decade legacy outcomes. Demo data seeds Alex + Jordan's
Social Security via a built-in 2025-SSA-bend-point estimator
(`lib/budget/socialSecurity.ts`). See PRD §7.13 + `lib/budget/incomeStreams.ts`.

---

## 2. RATES & DOLLARS

### Real vs nominal
- **Nominal** dollars are face-value, inflation-included ("sticker price").
- **Real** dollars are inflation-adjusted, in today's purchasing power.

The rest of the app — projection engine, SWR, target NW, sensitivity, glide
path — runs in **real** terms. Surfaces that show nominal numbers (snapshot
deltas, brokerage-style trailing returns) must label them as nominal so the
user knows to subtract inflation before comparing.

Conversion identity:
```
1 + nominal = (1 + real) × (1 + inflation)
```

### CAGR
Compound Annual Growth Rate. The geometric average annual return that maps a
starting balance to an ending balance over N years.

Real CAGR: `(end / start)^(1/N) − 1`, computed on inflation-adjusted balances.

### Inflation rate
The user's assumed annual CPI rate, single source of truth for every
nominal↔real conversion in the app. Default 3% if unset.

### Retirement variable share
The fraction of retirement spending that's discretionary (lifestyle-
flex) and therefore subject to the variable haircut. The fixed
portion (housing, insurance, utilities, healthcare premiums) is
NEVER touched by the haircut; the variable portion (food,
transportation, entertainment, travel, gifts) can be cut.

Resolution chain (`lib/budget/budget.ts:effectiveVariableShare`):
1. Explicit user override on `assumptions.retirementVariableShare`
2. Budget-derived (variable monthly / total monthly) if the user
   has entered budget items
3. `DEFAULT_VARIABLE_SHARE = 0.35` — BLS Consumer Expenditure
   Survey median for households 65+ (housing/insurance/utilities/
   Medicare ≈ 65% fixed)

Stored as a SHARE, not a dollar amount, so the haircut applies to a
consistent fraction of whatever spend the user is testing — works
correctly even when target NW and budget-implied corpus disagree on
total spending. See PRD §7.13 + Calculations §4.

### Expected return
The user's assumed forward-looking annual return. Quoted in **real** terms.
Sourced from `assumptions.expectedCAGR` (household) or member-level override.

---

## 3. WITHDRAWAL & DRAWDOWN

### Safe withdrawal rate (SWR)
The fraction of starting portfolio the user can withdraw annually, adjusted for
inflation, with high probability of surviving the planned horizon. 4% is the
Trinity-study baseline for a 30-year horizon; this app defaults to a real
withdrawal model and surfaces user-overridable SWRs (e.g. 2% for very long or
legacy-preserving plans).

### Drawdown horizon
Number of years the portfolio must sustain withdrawals after the Independence date.
30 years is the Trinity baseline; 45+ is common for early-retirement users in
their 30s.

### Sequence-of-returns risk
The risk that a poor sequence of returns early in retirement causes failure
even when long-run average returns are adequate. The reason Monte Carlo and
historical-replay tests matter more than simple "average return" projections.

### Drawdown phases
Distinct life stages with different withdrawal rates, modeling the
"go-go / slow-go / no-go" pattern that retirement researchers (Pfau,
Blanchett, Drak) consistently observe in real retiree spending. Each phase
specifies `startMonthsAfterIndependence` and `withdrawalRate`; the
projection engine recomputes monthly withdrawal at each boundary as
`remaining_NW × phase_rate / 12`. Income streams (Social Security,
pension) offset this withdrawal one-for-one during drawdown, so corpus
lasts longer in phased plans with substantial future income.

### Variable haircut (retirement)
A fraction (0-1) of variable retirement expenses the user expects to cut
in retirement. Applied in two modes:

- **Always-apply** (default): the haircut reduces every retirement year's
  variable spend. Conservative — maximum survival improvement, but commits
  to a permanent lifestyle reduction.
- **Down-year guardrail** (`retirementVariableHaircutOnDownYearOnly`):
  the haircut applies ONLY in retirement years following a year of
  negative real stock returns. Models the realistic "spend less when
  scared" pattern documented in academic retirement research
  (Guyton-Klinger style). Higher expected lifestyle than always-apply
  (you don't cut in good years), lower survival % than always-apply for
  the same rate. Corpus sizing in this mode uses an effective haircut of
  `rate × historical-down-year-frequency` (≈ 31% per the 1928-2025 dataset)
  so the suggested corpus reflects realized average withdrawal, not the
  always-apply best case.

### RMD
Required Minimum Distribution. The IRS-mandated minimum withdrawal from
tax-deferred accounts starting at the SECURE-2.0 age threshold. Reduces user
discretion over which buckets to drain first.

---

## 4. ALLOCATION & EXPOSURE

### Asset class
Top-level bucket: equity, bond, cash, crypto, commodity, real estate,
private stock, other.

### Allocation
The percent of net worth held in each asset class. Computed on **effective
exposure**, not face-value, when leverage is present.

### Glide path
A planned shift in allocation with age — typically more equity early, more
bonds/cash later. Modeled as a list of `{age, allocation}` waypoints with
linear interpolation between them.

### Leverage ratio
Effective exposure ÷ equity. A 2× leveraged ETF has leverage = 2; an
80%-LTV mortgaged property has leverage ≈ 5×; cash and unlevered equity have
leverage = 1.

### Leverage buckets
The app groups holdings into four buckets for risk visualization:
- **0–1×** (inclusive): no leverage.
- **1–2×** (exclusive of 2×): mildly leveraged.
- **2× and up** (inclusive): true leveraged plays (TQQQ, UPRO, TMF, etc.).
- **Mortgaged real estate**: separate bucket because housing has a different
  volatility profile from leveraged ETFs even at similar effective leverage.

### Concentration risk
Single-position or single-class concentration above a configurable threshold.
Flagged because idiosyncratic drawdown of one large holding can dominate
portfolio outcome.

---

## 5. TAX TREATMENT

### Tax buckets
Each account maps to one of:
- **Pre-tax** — traditional 401(k), traditional IRA. Tax-deferred; taxed as
  ordinary income on withdrawal.
- **Roth** — Roth 401(k), Roth IRA. After-tax contributions; tax-free growth
  and qualified withdrawal.
- **HSA** — Health Savings Account. Triple-tax-advantaged for qualified
  medical use.
- **Taxable** — brokerage, savings, checking. Capital gains + dividends taxed.
- **Education** — 529 plans + Trump Accounts. 529s are tax-free for
  qualified education expenses; Trump Accounts (One Big Beautiful Bill
  Act, launching 2026-07-04) are federally-seeded tax-deferred accounts
  for newborn US citizens. Both are dedicated to a child's future use
  and locked until majority — the planner buckets them together so the
  tax-bucket math and asset-location audit treat them as a single
  "education / minor child" pool.

### Asset location
The discipline of placing tax-inefficient assets (bonds, REITs) in tax-deferred
or Roth accounts and tax-efficient assets (broad equity index) in taxable
brokerage. Different from asset allocation, which is *what* you own.

### Roth conversion ladder
Annual conversions of pre-tax dollars to Roth during low-income years to fund
pre-59½ withdrawals five years later. Surfaced as a planning tool, not
automated.

---

## 6. SCENARIOS & SENSITIVITY

### Scenario
A named alternate plan with overrides on per-account contributions or per-
holding CAGR. Compared side-by-side to the baseline.

### Sensitivity
A strip showing how the Independence date moves under ±2 points of CAGR or
0.5×–2× savings rate. Quick test of how brittle the plan is to its inputs.

### What-if savings
An interactive slider: how much sooner (or later) does Independence arrive if the user
saves an additional $X per month from today.

---

## 7. RELIABILITY TESTS

### Monte Carlo
Simulation across many possible return sequences to estimate the probability
that the portfolio survives the drawdown horizon. This app runs **historical**
Monte Carlo by default — replaying actual 1928–2023 sequences — with a block-
bootstrap mode for wider distributions.

### Success rate
Fraction of simulated sequences in which the portfolio ends the drawdown
horizon with a positive balance (or above the user's legacy floor).

### Stress test
Single-shock test: how much does the Independence date or success rate move under one
adverse event (–30% market shock, lost decade, early retirement)?

---

## 8. STORAGE & SYNC

### Local-first
All data lives on the user's device by default. Cloud sync is opt-in.

### appDataFolder
Google Drive's per-app private sandbox. Each app sees only files it created;
the user can revoke access to wipe it. Used here as the cloud backup target.

### Snapshot
A point-in-time record of household state used for trailing growth velocity
and historical net-worth charts. Stored nominal (the prices at the time);
the app converts to real when needed.

### Shrinkage guard
Pre-write check that refuses to overwrite cloud state with a smaller set of
records than is present locally — unless the user has explicitly initiated
the deletion. Prevents silent data loss across device sync.

---

## 9. UI VOCABULARY

### Page
A top-level tab in the bottom nav: Home, Accounts, Allocation, Projections,
Plan, Data.

### Card
A bordered, padded surface that owns one mental model (e.g. CoastIndependenceCard,
GrowthVelocityCard). Cards compose into pages.

### ProGate
A wrapper component (`app/_components/ui/ProGate.tsx`) that historically gated
features behind a paid tier. As of 2026, the project is fully open-source
with NO paid tier — `useIsPro()` returns `true` unconditionally, so the
gate is a pass-through that renders its children unchanged. The wrapper is
RETAINED as an architectural escape hatch: if the project ever needs to
fund Google OAuth verification (registrar + verification costs) by
introducing a Pro tier, flipping `useIsPro()` from `() => true` to an
entitlement check is the entire toggle. See PRD §8 for the rationale.

### Insight
A short, opinionated piece of guidance derived from the user's data
("80% of growth came from equities") shown on the home page.

---

END OF GLOSSARY
