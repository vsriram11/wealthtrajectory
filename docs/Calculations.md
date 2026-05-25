# wealthtrajectory — CALCULATIONS REFERENCE

The math behind every projection, target, and reliability test in the app.
Every number rendered to the user is produced by one of the formulas
documented here. All computation runs on the client (PRD §1, ImplementationPlan
§2).

Convention used throughout: **all rates and balances are in real (today's-
dollar) terms unless explicitly tagged nominal.** This is the single most
important property of the app — the user should never have to mentally
subtract inflation to compare two numbers.

---

## 1. UNITS, SIGNS, AND THE REAL/NOMINAL BOUNDARY

### 1.1 Conversion identity
```
1 + nominal = (1 + real) × (1 + inflation)
real        = (1 + nominal) / (1 + inflation) − 1
nominal     = (1 + real) × (1 + inflation) − 1
```

### 1.2 Where nominal is allowed
Nominal numbers are allowed *only* on surfaces that:
1. Read directly from a brokerage-style timestamped snapshot
   (e.g. trailing growth velocity dollar deltas, historical NW chart).
2. Translate a real plan into sticker-price equivalents for intuition
   (e.g. "your $2M target is $X in future dollars").

Every nominal number must be labeled `nominal` in the UI. Every other
surface — projection, SWR, target, sensitivity, glide path, Monte Carlo —
operates on real numbers.

### 1.3 Inflation default
`assumptions.expectedInflationRate` is the single source of truth. If unset,
fall back to 3% (long-run US CPI baseline).

---

## 2. FINANCIAL INDEPENDENCE PROJECTION

### 2.1 Forward balance
For an account with starting balance `b`, monthly contribution `c`, and
real expected return `r`, the balance at year `t` is:
```
balance(t) = b × (1 + r)^t + 12c × ((1 + r)^t − 1) / r
```
(Annuity-due variants exist for end-of-month vs start-of-month; this app
uses end-of-month for consistency with how brokerages credit deposits.)

### 2.2 Financial-independence date
The earliest year `t*` such that `householdBalance(t*) ≥ targetNetWorthUSD`,
where the household balance is the sum over all accounts using each
account's expected real return.

When no `targetNetWorthUSD` is configured explicitly, derive it from the
spending plan (§4).

### 2.3 Doubling time
Rule of 72, real:
```
doubling_years = log(2) / log(1 + r_real)   ≈ 72 / (r_real × 100)
```
The exact log formula is used in the UI to avoid the rule-of-72 approximation
error at low rates.

---

## 3. TRAILING GROWTH VELOCITY

For a pair of household snapshots `(t₀, NW₀)` and `(t₁, NW₁)`:
```
delta_USD       = NW₁ − NW₀                            (nominal)
elapsed_years   = (t₁ − t₀) / 365.25
nominal_return  = (NW₁ / NW₀)^(1/elapsed_years) − 1
real_return     = (1 + nominal_return) / (1 + inflation) − 1
```

The card defaults to the **real** view: nominal returns mixed with real
plan assumptions is the most common source of "why does my plan feel
wrong?" confusion. The toggle exposes the nominal view one tap away for
users comparing to brokerage statements (which are always nominal).

Window definitions: 30-day, 90-day, 365-day, lifetime. Each window requires
two snapshots straddling its boundaries; missing windows render nothing.

---

## 4. SAFE WITHDRAWAL & TARGET CORPUS

### 4.1 Constant-spend target
Trinity-style baseline:
```
target_NW = annual_spend / SWR
```
With the default SWR = 4%, target NW = 25× annual spend. The app exposes
`assumptions.withdrawalRate` as a user-overridable knob (common overrides:
3% for 40-year horizons, 2% for legacy preservation).

### 4.2 Real-excess-inflation target (Gordon-growth, finite horizon)
Some expense categories grow faster than CPI in real terms (healthcare,
private education). Let `g` be a category's real-excess inflation rate
(growth above CPI, in real terms). For a planning horizon of `N` years
and a constant SWR `s`:
```
multiplier(g, N) = ((1 + g)^N − 1) / (g × N)        (g ≠ 0)
multiplier(0, N) = 1                                (limit)
target_for_category = annual_spend × multiplier / s
```
This finite-horizon form avoids the singularity in the naïve Gordon
perpetuity `annual / (s − g)`, which explodes when `g → s` — a real bug we
hit on healthcare with `g = 2%` and `s = 2%`.

`N` defaults to `PLANNING_HORIZON_YEARS = 30` (Trinity baseline).

### 4.3 Suggested-corpus rollup
Sum the per-category targets across the budget:
```
suggested_corpus = Σ_category (annual_c × multiplier(g_c, N) / s)
```
The "suggested corpus" displayed to the user is the larger of this value
and the constant-spend baseline — so a budget with no real-excess items
falls back cleanly to the 25× rule of thumb.

**Variable-haircut inputs**: the per-line `annual_c` for variable items
is reduced by `(1 − h_eff)`, where `h_eff = effectiveHaircut(rate,
onlyAfterDownYear)` from `lib/budget/budget.ts`. When the conditional mode is
off, `h_eff = rate`. When on, `h_eff = rate × HISTORICAL_DOWN_YEAR_FREQUENCY`
(≈ 0.31 per the 1928–2025 Damodaran dataset) so the suggested corpus
sizes for the realized average withdrawal rather than the always-apply
best case. The variable/fixed split for budget items is the user's
`type` tag; for spend amounts derived from `target_NW × SWR`, the share
falls back to `DEFAULT_VARIABLE_SHARE = 0.35` (BLS Consumer Expenditure
Survey median for households 65+). See Glossary → "Retirement variable
share".

### 4.4 Real-excess corpus drag
```
drag = suggested_corpus − constant_spend_target
```
What it costs in extra portfolio size to absorb the user's real-excess-
inflation assumptions.

---

## 5. LEVERAGE & EFFECTIVE EXPOSURE

### 5.1 Per-holding leverage
- **Cash / other**: `leverage = 1`.
- **Composition holding** (a basket of legs with weights): `leverage = Σ wᵢ`
  — sum of weights, which exceeds 1 when any leg is over-allocated.
- **Equity / crypto / commodity**: explicit `leverage` field (default 1; 2 or
  3 for leveraged ETFs).
- **Bond**: derived from duration via a piecewise-linear mapping
  (short bonds ≈ 1, long bonds ≈ 1.4) unless explicitly overridden.
- **Real estate**: `1 / (1 − LTV)`, e.g. 80% LTV ≈ 5× leverage.
- **Private stock**: explicit `leverage` field (default 1).

### 5.2 Effective exposure
```
effective_exposure_USD = market_value × leverage
```
Allocation charts can toggle between effective exposure and face
value, so the user sees their *risk* allocation alongside their
*balance-sheet* allocation.

### 5.3 Leverage buckets
Holdings are classified into one of four risk buckets:
| Bucket | Predicate | Examples |
| --- | --- | --- |
| 0–1× | `leverage ≤ 1` AND NOT mortgaged RE | cash, VOO, BND |
| 1–2× | `1 < leverage < 2` AND NOT mortgaged RE | SSO, mild bond comp |
| 2×+ | `leverage ≥ 2` AND NOT mortgaged RE | TQQQ, UPRO, TMF |
| Mortgaged RE | category = real_estate AND `leverage > 1` | 20% down house |

Real estate is intentionally separate even at the same nominal leverage
because residential housing has materially lower realized volatility than
leveraged equity ETFs.

---

## 6. GLIDE PATH

### 6.1 Definition
A glide path is a list of `{age, allocation}` waypoints, where each
`allocation` is `{equity, bond, cash}` summing to 1.

### 6.2 Normalization
- Waypoints sorted by ascending age.
- Same-age duplicates resolved last-write-wins.
- Out-of-range ages held flat at the nearest waypoint (no extrapolation).

### 6.3 Interpolation
Between two consecutive waypoints `(aᵢ, αᵢ)` and `(aᵢ₊₁, αᵢ₊₁)`:
```
t = (age − aᵢ) / (aᵢ₊₁ − aᵢ)
α(age) = αᵢ × (1 − t) + αᵢ₊₁ × t
```
Linear in each component, then renormalized to remove float drift.

### 6.4 Blended CAGR along the glide path
For each year of the projection, the expected real return is the weighted
mix of class returns at that age's allocation:
```
r(age) = α_eq(age) × r_eq + α_bd(age) × r_bd + α_cash(age) × r_cash
```
The projection engine integrates `r(age)` year by year, so equity-heavy
early years compound at a higher rate than the bond-heavy late years.

### 6.5 Presets
- **Vanguard-style target retirement** — ≈90/10 → 50/50 → 30/70 over age 25→95.
- **Conservative** — starts at 70/30, ends at 20/80.
- **Perpetual aggressive** — holds 90/10 indefinitely.

---

## 7. STRESS & MONTE CARLO

### 7.1 Single-shock stress test
For each shock scenario, multiply the current NW by the shock factor and
recompute the Independence date under the user's current plan:
```
post_shock_NW = current_NW × (1 + shock)
```
Default shocks: −30% market drop, lost decade (compound 0% real for 10
years), early retirement (advance retirement age by 5 years and re-run
SWR check).

### 7.2 Historical sequences
For each starting year `y` in `[1928, 2025 − horizon]`, replay that
window's real returns against the user's allocation. The simulator uses
**mid-year cash-flow convention** to match the deterministic
projection engine's monthly compounding (so the two surfaces agree):
```
r_blend(y+t) = wₛ·r_stocks + w_b·r_bonds + w_c·r_cash
             + w_g·r_gold  + w_re·r_realEstate
nw_after     = NW(t) × (1 + r_blend(y+t))
cf           = +contribution (pre-Independence)  OR  −spend (post-Independence)
NW(t+1)      = nw_after + cf × (1 + r_blend(y+t) / 2)
```
The `cf × (1 + r/2)` term is the closed-form approximation for a cash
flow that occurs at mid-year (the average across 12 monthly cash flows).
In a −10% year, a $40k mid-year withdrawal drops NW by $40k × 0.95 =
$38k (the withdrawn money avoided the second half of the drawdown); in
a +10% year, a $20k contribution adds $20k × 1.05 = $21k to year-end NW.

Weights `wₛ, w_b, w_c, w_g, w_re` come from the user's portfolio
decomposition (§7.5). A sequence **succeeds** if `NW(t) > 0` (or
`NW(t) > legacy_floor`) for every `t` in the horizon. Reported metrics:
- Success rate
- Worst starting year (the sequence with the lowest ending balance)
- Percentile bands (10th / 50th / 90th of ending balance)

### 7.3 Block bootstrap
For wider distributions, resample contiguous *blocks* of historical
returns (default block length 5 years) with replacement. Preserves serial
correlation while expanding the sample beyond raw 1928–2025.

### 7.4 Starting NW for drawdown tests
The drawdown question is: *given that I reach my target, does my plan
survive?* So the simulator should start at `max(current_NW, target_NW)`,
not `current_NW`. Using `current_NW` when the user is below target
silently answers a different and less useful question ("can I retire
*today* at target-level spending?") and produces near-zero success rates
that mislead the user.

### 7.5 Asset-class routing — which return series each bucket gets
The simulator carries **six** real-return series per year (1928–2025):
**stocks** (S&P 500), **bonds** (10Y US Treasury total return), **cash**
(3-mo T-Bill), **gold** (year-end physical gold price deflated by
CPI), **real estate** (Case-Shiller-style price-return), and **stocks2x**
(2x daily-reset SPY LETF — RYTNX-derived for 2001+, formula-projected
for 1928–2000). The user's portfolio is decomposed into these buckets:

| Portfolio class | Routes to | Notes |
| --- | --- | --- |
| Equity (1x and unrecognized-leverage like TQQQ / UPRO / SOXL) | `stocks` | Face value, not exposure-weighted. Non-recognized leveraged ETFs are flattened to 1x for projection purposes — projecting 3x daily-reset behavior backwards across 1929-32 / 1937 / 1973-74 isn't feasible; the UI surfaces a warning. |
| Equity in SSO / SPUU / QLD | `stocks2x` | Routed to the RYTNX-derived 2x return series. Real data 2001-2025, formula-projected 1928-2000 (RMSE 3.93% on the calibration window). See `LEVERAGED_2X_PROJECTION` for constants. |
| Bond | `bonds` | All durations / credit grades collapse to 10Y Treasury |
| Cash | `cash` | T-bills, money-market, checking, savings |
| Commodity | `gold` | Silver / copper / industrial metals collapse into gold as a stand-in (known approximation) |
| Direct real estate | `realEstate` | Case-Shiller price-return (no rental yield, no leverage adjustment) |
| Crypto + private stock + other | `otherFraction`, routed via UI toggle | Default `stocks`; user can pick `cash` for a conservative floor |

The `stocks2x` bucket is a SUBSET of total equity allocation, not an
addition to it — for a user with 60% equity (of which 20% is SSO), the
simulator sees `stocksFraction=0.40` + `stocks2xFraction=0.20`, summing
to the same 0.60 equity exposure but with different return-series
routing per portion. This preserves face-value invariants while
modeling the leveraged-portion's catastrophic-year behavior honestly
(e.g. 2x portfolio in 1931 loses ~69% real in that one year).

#### At-retirement deleveraging of non-recognized leveraged ETFs

3x daily-reset products (UPRO, SPXL, TQQQ, SOXL, FAS, NAIL, TMF, etc.)
have catastrophic multi-decade survival rates and no defensible
projection backwards. Rather than just modeling them as 1x equity for
the stress test (the previous behavior, which silently understated
their tax cost), the historical-MC engine now models a realistic
**at-retirement portfolio restructure** for each non-recognized
leveraged holding:

- `UPRO`, `SPXL` (3x S&P 500) → 2x S&P (SSO/SPUU equivalent) → routes
  to `stocks2x` bucket post-tax
- `TQQQ` (3x Nasdaq-100) → 2x Nasdaq-100 (QLD equivalent) → routes to
  `stocks2x` bucket post-tax (RYTNX is the closest long-history proxy;
  Nasdaq-100 has been more volatile than S&P 500 so the modeled result
  slightly understates true Nasdaq sequence risk)
- Everything else leveraged (`SOXL`, `FAS`, `NAIL`, `TNA`, `TECL`,
  `TMF`, etc.) → 1x broad equity → routes to `stocks` (1x) bucket
  post-tax

The deleveraging is modeled as a sell + rebuy at retirement. For
holdings in **taxable** accounts (per `TAX_TREATMENT_BY_CATEGORY`,
i.e. `BROKERAGE` / `SAVINGS` / `CHECKING` / `CRYPTO`/ `REAL_ESTATE` /
`OTHER`), this incurs capital-gains tax at the user's configured
retirement tax rate (`assumptions.retirementTaxRate`, default 20%).
For holdings in **tax-advantaged** accounts (`401K`/`ROTH_401K`/
`TRAD_IRA`/`ROTH_IRA`/`HSA`/`FIVE_29`/`TRUMP_ACCOUNT`), the tax is
zero — the trade happens inside the wrapper.

Cost-basis caveat: the app doesn't track cost basis per holding, so
the gain fraction defaults to 1.0 (treat all current value as gain).
This is the conservative stress-test assumption — long-held
leveraged positions through an accumulation phase typically have very
high gain-to-basis ratios anyway, and the resulting tax hit is the
worst case the user actually faces. The MC card surfaces this
assumption inline when the tax hit is non-zero.

Mathematical effect on the simulator inputs:

- `effectiveStartingNW = startingNW × (1 − taxHitFraction)` where
  `taxHitFraction = totalTaxHit / portfolio.netWorthUSD`. Scales
  with what-if startingNW overrides.
- `stocks2xFraction` includes both recognized 2x (full face) AND
  post-tax deleveraged 3x SPY/Nasdaq; `stocksFraction` includes
  regular 1x equity (full face) AND post-tax diversified-to-1x.
  Bonds, cash, commodity, real-estate fractions unchanged.

Recognized 2x positions (SSO/SPUU/QLD) are NOT touched by the
deleveraging — they're already at the target leverage, no tax cost,
no restructure.

Crypto is mapped via the toggle because its return history (2009-on) is
too short to fit into a 1928-anchored simulator. Direct real estate (vs
REITs, which already act equity-like) and private stock are idiosyncratic
enough that approximating them as stocks vs cash is honest about the
modeling gap.

The gold real-return series itself is stylized — regime patterns (1934
USD revaluation, 1934-1970 pegged-and-real-eroding era, 1971-1980 boom,
1981-1999 bear, 2001-2011 boom, 2019-2024 ATH rally) are accurate but
individual year values are best-effort pending a sourced refresh against
Damodaran's annual spreadsheet column or LBMA's year-end fix series.

### 7.6 Rebalancing and glide-path handling
The simulator assumes **annual rebalancing** back to the target
allocation — at the start of each year the portfolio is snapped back to
the year's weights before that year's returns are applied.

When the user has configured a **glide path** (§6), the simulator
resolves the allocation **per year** via `allocationAtAge(glidePath,
startAge + y)` rather than using a single static mix. The glide path's
waypoints (`{age, allocation}` pairs) define the user's target
allocation by member age; the resolver linearly interpolates between
waypoints and applies constant-tail behavior outside the bracket. So a
"100% equity at 25 → 50% by 65 → 30% by 85" glide path is honored
properly across the full horizon, with the appropriate allocation
applied to each year's returns.

When no glide path is configured (or its waypoints array is empty), the
static `allocation` field is used for every year, matching legacy
behavior. The card UI shows whether the glide path is active and which
member's age drives it.

For multi-member households, the relevant age is taken from the
member scope selected in the UI; "All members" defaults to the oldest
member's age (they hit retirement-related milestones first).

### 7.7 Cash-flow timing convention
Cash flows (contributions in accumulation, spending in retirement) are
modeled at **mid-year**, matching the deterministic `projectIndependence`
engine's monthly compounding and the standard actuarial convention:
```
nw_after = NW(t) × (1 + r_blend(y+t))
cf       = +contribution  (pre-Independence)  OR  −spend  (post-Independence)
NW(t+1)  = nw_after + cf × (1 + r_blend(y+t) / 2)
```
The `× (1 + r/2)` adjustment captures the half-year of returns that a
mid-year cash flow earns (positive when contributing, "saved
drawdown" when spending). In a −10% real year, a $40k mid-year
withdrawal drops NW by $40k × 0.95 = $38k; in a +10% year, a $20k
contribution adds $20k × 1.05 = $21k.

This is the same convention used by every monthly-compounding engine
in the app, so the deterministic Independence date and the Monte Carlo
success rate stay consistent for the same inputs.

---

## 8. SENSITIVITY & WHAT-IF

### 8.1 CAGR sensitivity
```
δIndependence / δCAGR  ≈ Independence_date(r + 0.02) − Independence_date(r − 0.02)
```
Reported as months saved / months cost at ±2 percentage points.

### 8.2 Savings sensitivity
```
δIndependence / δsavings ≈ Independence_date(0.5 × s) − Independence_date(2 × s)
```
Reported as months saved at 2× savings, months cost at 0.5× savings.

### 8.3 What-if savings slider
Reactive: every time the slider moves, re-run the full projection with
`monthly_contribution := monthly_contribution + Δ` and re-report the
Independence date. Per-account splits use proportional allocation (each account's
share of total contributions is preserved).

---

## 9. COAST Independence

The earliest age at which the user could stop contributing entirely and
still reach the Independence target by their retirement age:
```
coast_NW = target_NW / (1 + r_real)^(retirement_age − coast_age)
```
Solve for the smallest `coast_age` such that `current_NW × (1 + r)^Δ ≥
coast_NW(coast_age)`.

---

## 10. NW PERCENTILE

Lookup of the user's household NW against an age-banded distribution
table (US household NW by age decile). Used to contextualize, not to
plan — "you're at the 78th percentile for your age" is for emotional
calibration only.

---

## 11. FUTURE-INCOME STREAMS

A stream pays `annualUSD` in `startYear` and grows at
`realGrowthRate` per year (real terms) until `endYear`. For a
stream with parameters `(S, E, A, g)` and a query year
`Y ∈ [S, E]`:

```
payout(Y) = A × (1 + g)^(Y − S)
```

Outside `[startYear, endYear]` the payout is 0. Growth compounds
from `startYear`, not from "now" — a stream of $40k/yr at +2%
real growth starting in 2055 pays $40k in 2055 and grows from
there; what year you happen to be planning in doesn't shift the
compound base.

**Per-year summation across all streams** (the shape the
simulator + Independence projection consume):

```
incomePerYear[y] = Σ_stream payout(baseYear + y)
```

where `baseYear` is "now" and `y` indexes simulation years from
0. Streams with `realGrowthRate = 0` model inflation-protected
income (Social Security's COLA, indexed annuities); negative
rates model legacy pensions that aren't COLA-adjusted (and
therefore shrink in real terms).

**How the simulator consumes it**: during a retirement year `y`,
the per-year withdrawal becomes
`annualSpend − incomePerYear[y]` (clamped at 0; surplus income
beyond the SWR-derived withdrawal credits to the corpus).

**Lifetime total in real $** (the "$X lifetime total" shown in
the UI): closed-form sum of the geometric series:

```
lifetimeReal = A × ((1 + g)^N − 1) / g     when g ≠ 0
            = A × N                         when g = 0
```

where `N = endYear − startYear + 1`. Code path: `lib/budget/incomeStreams.ts:lifetimeTotalReal`.

---

## 12. SOCIAL SECURITY ESTIMATOR

For seeding the demo + as an optional heuristic for users to
prefill a Social Security income stream. Real benefits are
computed by the SSA from full earnings history; this is a
back-of-envelope estimate from three inputs.

**Inputs**: `(annualIncomeUSD, currentAge, retirementAge)`.

**Step 1 — Average Indexed Monthly Earnings (AIME)**:

```
contribMonthly = min(annualIncome / 12, $14,675)     // 2025 SS taxable max ÷ 12
workYears      = min(35, retirementAge − 22)         // SSA assumes start-age 22
AIME           = (contribMonthly × workYears) / 35
```

The 35-year AIME window matters for early retirees: someone who
stops working at 48 has 9 zeros averaged in, materially
reducing AIME vs a full-career worker at the same income.

**Step 2 — Primary Insurance Amount (PIA)** at Full Retirement
Age (FRA = 67 for anyone born 1960+), via the 2025 SSA
bend-point formula:

```
            0.9 × AIME                                 if AIME ≤ $1,226
PIA(mo)  =  0.9 × $1,226 + 0.32 × (AIME − $1,226)      if $1,226 < AIME ≤ $7,391
            0.9 × $1,226 + 0.32 × ($7,391 − $1,226)
                                + 0.15 × (AIME − $7,391) otherwise

annualUSDAtFRA = PIA(mo) × 12
fraYear        = currentYear + (67 − currentAge)
```

**Constants** (2025 SSA values; update when SSA publishes new
ones — see `lib/budget/socialSecurity.ts`):

- `SS_BEND_POINT_1_2025 = $1,226`
- `SS_BEND_POINT_2_2025 = $7,391`
- `SS_TAXABLE_MAX_MONTHLY_2025 = $14,675` (from $176,100 / 12)
- `SS_FRA = 67`
- `SS_AIME_WINDOW_YEARS = 35`

**What this does NOT model** (documented in
`lib/budget/socialSecurity.ts` header): spousal benefits, WEP / GPO
offsets, survivor benefits, early-claim reduction past 62,
delayed retirement credits past FRA. Anything more
sophisticated belongs in user-entered numbers, not the
heuristic.

---

## 13. EDGE CASES & GOTCHAS

- **Negative-NW projections**: clamp at 0 on display, but keep signed in
  the underlying model so a path that crosses through 0 is still
  detectable in stress tests.
- **Identical-age waypoints in a glide path**: last write wins.
- **Inflation = 0** in real conversion: short-circuit `real = nominal`.
- **`g = s` in Gordon growth**: use the finite-horizon multiplier (§4.2),
  never the perpetuity form.
- **Snapshot in nominal, plan in real**: never mix without an explicit
  conversion at the boundary. Trailing growth velocity is the canonical
  example — the dollar delta is nominal (it's an actual price-pair
  observation) but the annualized rate is converted to real before being
  compared against the plan's expected CAGR.
- **Leverage = 0** (e.g. a user accidentally sets it): treated as 1 in
  the bucket classifier to avoid divide-by-zero in exposure math.

---

END OF CALCULATIONS REFERENCE
