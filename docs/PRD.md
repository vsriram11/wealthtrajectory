# wealthtrajectory — PRODUCT REQUIREMENTS DOCUMENT (PRD)

## 1. PRODUCT SUMMARY

### Product Name
wealthtrajectory

### Product Vision
A private, local-first wealth trajectory platform that helps Independence-minded individuals and families understand how financial decisions affect long-term financial independence and legacy outcomes.

### Mission
Replace spreadsheets for long-term wealth planning with a fast, interactive, privacy-first experience.

### Core Philosophy
- Local-first
- User-owned data
- No bank connections required
- Instant feedback loops
- Wealth trajectory over transaction minutiae

---

# 2. TARGET USERS

## Primary Users
- Independence-focused individuals
- Spreadsheet-heavy financial planners
- High-income savers/investors
- Long-term investors
- Analytical users

## Secondary Users
- Families planning joint Independence
- Leverage ETF investors
- Multi-generational wealth planners

## Non-target Users
- Budgeting-focused users
- Expense categorization users
- Day traders
- Users wanting full automation

---

# 3. CORE USER PROBLEMS

Users currently:
- Manage wealth in spreadsheets
- Struggle with long-term scenario planning
- Lack intuitive wealth trajectory tools
- Use fragmented financial systems
- Want privacy and control
- Want family-aware planning

---

# 4. PRODUCT DIFFERENTIATION

## Existing Tools
### Kubera
- Excellent aggregation
- Weak trajectory planning
- Cloud-centric
- Expensive

### PortfolioVisualizer
- Excellent simulation
- Weak persistent personal planning
- No emotional engagement
- No habit loop

### Excel
- Flexible but high friction
- Maintenance burden
- Poor UX

---

## Our Positioning
“Private long-term wealth planning for Independence-minded families.”

---

# 5. CORE PRODUCT PILLARS

## Pillar 1: Wealth Trajectory
Understand future outcomes, not just current balances.

## Pillar 2: Instant Interactivity
All assumptions update immediately.

## Pillar 3: Privacy
User data remains local unless explicitly backed up.

## Pillar 4: Family Planning
Model households and long-term legacy outcomes.

---

# 6. USER STORIES

## Individual Independence User
- As a user, I want to know when I can retire.
- As a user, I want to understand how savings changes affect Independence timing.
- As a user, I want to compare investment strategies.

## Family Planner
- As a user, I want to model spouse and family assets together.
- As a user, I want to preserve a legacy amount.
- As a user, I want to model future obligations.

## Advanced Investor
- As a user, I want leverage-aware portfolio insights.
- As a user, I want effective exposure calculations.

---

# 6.5 INFORMATION ARCHITECTURE

The app surfaces a six-page navigation routed via the hamburger
menu. Each page maps to a distinct user mental model and caps card
density (the prior single-page dashboard reached 21 cards — wall
of scroll). Long pages use `SectionHeader` for sub-grouping.

> All features are free in the OSS build (see §8). A handful are
> still wrapped in `<ProGate>` as an architectural escape hatch —
> the wrapper is a pass-through today and adds no user-facing
> gate. Wrapped features are flagged with `(ProGate wrapped)` so
> the architectural seam is visible to contributors; this is
> NOT a "must pay to use" marker.

| Page | Mental model | Sub-sections / contents |
| --- | --- | --- |
| **Home** | *"How am I doing?"* | NetWorth + projection, HomeMetrics, HealthScore, Milestones, Income/Savings rate, Coast-Independence, Insights (ProGate wrapped), Goals (ProGate wrapped) |
| **Accounts** | *"What I own"* | Accounts + holdings, Liabilities |
| **Allocation** | *"How it's distributed"* | Allocation panel, Target-allocation drift, Tax buckets, Positions list |
| **Projections** | *"Where I'm going"* | Quick analytics (doubling / growth velocity / nominal-equivalent); Stress & sensitivity (Stress test, What-if savings, Sensitivity); Forward composition (future composition, contribution mix); Scenarios (ProGate wrapped) |
| **Plan** | *"What I should do"* | Six sub-tabs: **Assumptions** (Independence target + drawdown phases + variable haircut with conditional mode) · **Budget** (monthly-expense ledger → emergency-fund runway → suggested independence corpus → apply-to-target) · **Income** (future-income streams — consulting / pension / Social Security / rental, with year-based start/end + real-growth rates) · **Health** (insurance plans + importance weights) · **Tax** (fee drag, asset location, drawdown sequence ProGate wrapped, Roth ladder ProGate wrapped) · **Audit** (concentration-risk + NW percentile) |
| **Data** | *"Settings & admin"* | Local export / import (encrypted or plaintext, no sign-in needed) · End-to-end encryption setup · Cloud backup (ProGate wrapped; capped at 100 users by Google's OAuth verification — see [OAUTH_VERIFICATION.md](./OAUTH_VERIFICATION.md)) · Reminders · Members · Privacy + disclosures |

**Routing.** The six primary in-app pages (Home, Accounts,
Allocation, Projections, Plan, Data) are NOT URL routes —
they're driven by a `currentPage` field in the Zustand store, so
switching pages is instant and the back button never navigates
away. Two true URL routes do exist for surfaces that should be
deep-linkable + printable: `/review` (annual review printout) and
`/security` (privacy + cryptography disclosure). Page state for
the primary pages is ephemeral (`currentPage` resets to `home`
on refresh, as do per-page UI flags like the future-projection
slider); only user preferences flagged as persistent
(`preferredMemberId`, etc.) survive a reload.

---

# 7. FEATURE REQUIREMENTS

# 7.1 ONBOARDING

## Goal
User receives first meaningful insight in under 30 seconds.

## Inputs
- Current net worth
- Monthly savings
- Independence target

## Output
- Estimated Independence date
- Projection graph

---

# 7.2 NET WORTH TRACKING

## Requirements
- Manual asset entry
- Manual liability entry
- Historical snapshot tracking
- Daily snapshot generation on app open
- Accounts grouped under members/households
- Each account has a custom user-defined name and a category

## Asset / Holding Types
- Stocks
- ETFs
- Crypto
- Cash
- Real estate
- Custom assets

## Account Types (Categories)
Users choose from a preset list when creating an account, and assign a custom display name (e.g. "Fidelity 401(k)").

- 401(k)
- Roth 401(k)
- Traditional IRA
- Roth IRA
- HSA
- Brokerage (taxable)
- Savings (bank)
- Checking (bank)
- 529
- Trump Account (federally-seeded tax-deferred account for newborn US citizens; One Big Beautiful Bill Act, launching 2026-07-04)
- Crypto wallet / exchange
- Other / Custom

---

# 7.3 Independence PROJECTION ENGINE

## Inputs
- Current net worth
- Savings rate
- CAGR assumptions
- Inflation assumptions (optional)
- Withdrawal assumptions
- Legacy floor

## Outputs
- Independence date
- Retirement sustainability
- Projected net worth curve
- Legacy estimate

---

# 7.4 SCENARIO ENGINE

## Requirements
Users can create and compare:
- Different savings rates
- Different allocations
- Different retirement ages
- Different CAGR assumptions

## Outputs
- Side-by-side comparison
- Independence timeline comparison
- Net worth comparison

---

# 7.5 FAMILY MODELING

## Requirements
Support:
- Multiple individuals
- Shared households
- Shared or separate assets
- Per-member assumption overrides (target NW, withdrawal rate,
  inflation, horizon, retirement variable haircut, retirement
  tax rate) merged onto household defaults via
  resolveAssumptionsForMember()
- **Household-view auto-aggregation** — when any member has
  explicit overrides, the household view shows the rolled-up
  plan (SUM target & legacy; weighted-avg withdrawal rate;
  simple-avg inflation / horizon / haircut / tax). The household
  number is always consistent with the per-member reality —
  there's no separate "household-level" value that drifts away
  from the members it's supposed to summarize.
- Household AssumptionsPanel is **read-only** when overrides
  exist (filter to a member to edit); editable when no overrides
  exist (the "household template" use case for pristine users)
- Persistent default-view preference (open the app into a specific
  member's slice, not just the household rollup)
- Global member reorder with synced ordering

## Views
- Individual net worth
- Household net worth
- Family trajectory
- All cards filter-aware (NetWorthCard, AllocationPanel,
  MilestonesCard, StressTestCard, AllocationFutureCard, Insights,
  ContributionMix, TaxBuckets, ScenariosPanel)

---

# 7.6 LEGACY MODELING

## Requirements
Support:
- Target inheritance amount
- Minimum portfolio preservation
- Multi-phase drawdown

## Outputs
- Sustainable withdrawal guidance
- Legacy projections

---

# 7.7 LEVERAGE MODELING

## Requirements
Users can define:
- Asset leverage ratio
- Effective exposure

## Outputs
- Portfolio leverage
- Exposure-adjusted allocation
- Risk concentration
- Structurally-aware education callouts: mortgage leverage flagged
  as safer (no daily reset, no margin calls), daily-reset leveraged
  ETFs flagged with volatility-decay warnings.
- Multi-asset wrapper support: NTSX / GDE / RSST / etc. decompose
  into per-leg exposure across asset classes via the holding's
  `composition` field.

---

# 7.8 INSIGHTS ENGINE

## Requirements
Generate:
- Contribution vs growth analysis
- Asset contribution analysis
- Progress velocity (DoublingTimeCard — rule-of-72 + contributions)
- Trailing growth velocity (GrowthVelocityCard — 30d/90d/1y/lifetime)
- What-if savings (interactive)
- Coast-Independence detection (can the user stop contributing yet?)
- Nominal-vs-real translation at Independence date (NominalEquivalentCard)
- Concentration risk (single-ticker / single-account / single-member)
- Expense-ratio drag with cheaper-alternative callouts (FeeDragCard)
- Net-worth percentile vs Fed SCF 2022 by age band (NWPercentileCard)
- Asset-location audit (AssetLocationCard — bonds in taxable, bonds
  in Roth, etc.)
- Emergency-fund adequacy meter (EmergencyFundCard — cash vs N months
  of declared burn)
- Drawdown sequence (WithdrawalSequenceCard — Bogleheads-default
  taxable → pre-tax → Roth → HSA with per-bucket runway)
- Roth conversion ladder estimator (RothLadderCard — years-to-clear
  pre-tax balance + lifetime tax savings)
- Multi-goal tracker (GoalsCard — non-Independence goals with on-pace flags)

## Example Insights
- “You gained $5,200 this month.”
- “80% of growth came from equities.”
- “Increasing savings by $500/month advances Independence by 3 years.”
  *Implemented as the WhatIfSavingsCard with quick-pick chips.*
- “Stop contributing today and you’d still hit Independence in 18y 4m.”
  *Implemented as the CoastIndependenceCard.*
- "At 7% real, your net worth doubles every 10 years."
  *Implemented as DoublingTimeCard with 2x/4x/8x roadmap.*
- "SPY → VOO saves ~$X over 30 years."
  *Implemented as FeeDragCard with curated cheaper-alternative table.*
- "You're at the 78th percentile for ages 35-44."
  *Implemented as NWPercentileCard against 2022 Fed SCF.*

---

# 7.9 VISUALIZATIONS

## Charts
- Net worth over time (NetWorthCard / HistoryView)
- Asset allocation (AllocationPanel — face & exposure basis)
- Independence projection curve (NetWorthCard / ProjectionView)
- Scenario comparison (ScenarioComparisonChart — overlay curves with
  per-curve Independence-crossing markers)
- Contribution breakdown (ContributionMix — principal vs contribution
  vs growth)
- Future composition (AllocationFutureCard — stacked-area class mix
  + leverage curve, 10/20/30y horizon)
- Target-allocation drift (TargetAllocationCard — current vs target
  with dollars-to-move per class)
- 3×3 equity style box (StyleBoxGrid)
- 2-tier commodity sub-classification (Metals + Energy/Ag)

---

# 7.10 STORAGE & BACKUP

## Local Storage
- IndexedDB primary storage (Dexie)
- Per-symbol quote cache (24h TTL)
- Snapshot history (rich household payloads supported)

## Backup
- Google Drive appDataFolder (private to the app, hidden from Drive UI)
- End-to-end AES-256-GCM encryption (PBKDF2 key derivation, 250K
  iterations). Passphrase is in-memory only — never persisted to
  IDB, never written to Drive. UI surfaced via EncryptionCard on
  the Data page (sign-in-gated).
- Single-active-session enforcement: a Drive-side marker tracks
  which device "owns" the live session; other tabs auto-sign-out
  on poll mismatch.

## Sync lifecycle
- **Shared helper** `lib/cloudSync.pullFromDrive(store, opts)`:
  single code path for every "fetch & import" attempt — used by
  the initial-mount sync, the tab-resume sync, the unlock banner's
  post-passphrase retry, and the EncryptionCard's unlock action.
  Returns a structured result (`ok` / `no-backup` / `encrypted` /
  `error` / `throttled`) and writes the matching store state.
- **Initial sign-in / page-load** (`AuthHydrator.handleUser`):
  waits for PersistenceHydrator, finds Drive backup, downloads +
  decrypts + `importPayload`. Surfaces `lastSyncOutcome` for the
  welcome banner.
- **Outbound changes** (`CloudSyncer`): subscribes to state, 3s
  debounce, uploads on diff. Pre-upload **shrinkage guard**
  refuses to wipe a non-empty Drive collection (scenarios / goals
  / budgetItems) down to empty. Sets
  `state.googleUploadScheduled = true` the moment the timer is
  queued (not just when it executes) so the resume-sync pull
  can't race it.
- **Auto-resync on tab return** (`AuthHydrator` visibilitychange
  + focus listeners): when the tab becomes visible again, re-pull
  Drive silently (no welcome banner) so the user sees up-to-date
  state without having to "Sync now" manually. Throttled to once
  per 60s. Skipped if `googleSyncing` already in flight OR if
  `googleUploadScheduled` is true (a CloudSyncer upload is queued
  but hasn't fired yet — pulling now would race it and lose
  unsynced local edits).
- **Encryption unlock** (`EncryptionUnlockBanner` mounted on every
  page): when `googleSyncBlockedReason === "encrypted"` (force-
  closed tab + encrypted backup → lost passphrase), shows a
  persistent amber banner with an "Unlock" sheet. Sheet collects
  the passphrase, sets it in the store, and immediately re-pulls
  Drive. Wrong passphrase clears the in-memory copy and surfaces
  an inline error. Banner auto-hides on successful unlock. The
  same retry path runs when the user unlocks via the Data page's
  `EncryptionCard` — no orphan "now go hit Sync now" step.
- **Session-marker validation** (`SessionEnforcer`): polls every
  30s + on visibility change. Independent of data sync.

---

# 7.11 AUTHENTICATION

## Requirements
- No account required for local mode
- Optional Google login for backup/sync

---

# 7.12 REMINDERS

## Requirements
- Daily reminders
- Weekly reminders
- Client-side notifications only

---

# 7.13 BUDGET / EXPENSE LEDGER → Independence CORPUS

## Goal
Turn the user's actual monthly expenses into the independence corpus they
need to fund those expenses in retirement. Closes the loop between
"what I spend" and "what I need to save".

## Inputs
A list of `BudgetItem`:
- `name` (e.g. "Rent")
- `category` (Housing / Food & drinks / Transportation / Lifestyle /
  Healthcare / Savings)
- optional `subcategory` (free-form, with curated presets per
  category — Telephone, Coffee, Rent/Mortgage/Property tax, etc.)
- `monthlyUSD`
- `type` (fixed / variable)
- `endsAtRetirement` (savings always; user-toggleable for others)
- optional `endDate`

## Outputs
- Monthly + annual totals
- Per-category breakdown
- **Fixed / variable split** — fixed = essential to lifestyle,
  variable = lifestyle flex that can be cut in retirement or a
  downturn. Drives the dual-runway emergency fund and the
  retirement-variable-haircut slider.
- "Retirement-relevant" subtotal — excludes Savings category and
  items marked `endsAtRetirement: true`
- `suggestedIndependenceCorpus` = grossed-up annual / withdrawalRate, where
  grossed-up annual = (fixed + variable × (1 − haircut)) / (1 − tax).
  Two new levers on top of the naive formula:
    - `retirementVariableHaircut` (per-member, default 0): fraction
      of variable spending the user expects to cut in retirement
    - `retirementTaxRate` (per-member, default 20%): blended tax
      rate on withdrawals — withdrawals must gross up so net spend
      matches budget
- One-tap "Apply to Independence target" button — writes the suggestion into
  the right level of `assumptions.targetNetWorthUSD` (per-member
  override when filtered, household default otherwise)
- Dual-runway emergency fund: "X months at current burn" alongside
  "Y months on essentials only" (fixed-monthly only), so the user
  sees how long they could last living lean

## Requirements
- Lives on the Plan page under a `Budget` sub-tab (sister to
  `Strategy`)
- Visual category accents match user's inspiration palette
  (blue / orange / purple / rose / emerald / cyan)
- Editable per item (tap to open the same creator sheet with
  preloaded values)
- Synced through household payload like goals — IDB save + Drive
  backup with full round-trip

## UX notes
- Per-category "+ Add" pre-selects the category so users don't have
  to repick
- Subcategory presets double as tap-to-fill name suggestions
- Apply-to-target button is disabled when the current target already
  matches the suggestion (idempotent UX)
- Mirrors the user's inspiration screens but skips Income (we have
  per-member income on the Household members)

## Subscriptions sub-mode
Budget items tagged `isSubscription` surface in a dedicated view
toggle at the top of the panel ("All expenses" / "Subscriptions").
The subscriptions view sorts by next billing date ASC, shows the
per-cycle amount (not the monthly equivalent), and renders the
billing cycle (Monthly / Quarterly / Yearly).

Fields:
- `isSubscription: boolean` — opt-in flag on each BudgetItem
- `billingCycle: "monthly" | "quarterly" | "yearly"` — drives the
  per-cycle display amount and the next-billing-date walk
- `startDate: number` — first billing anchor; nextBillingDate steps
  from here in cycle increments

Storage model: `monthlyUSD` remains the canonical figure so all
budget rollups (totals, retirement subtotal, independence corpus suggestion)
stay cycle-agnostic. The creator UI accepts per-cycle entry and
normalizes (e.g. $99/yr → $8.25/mo internally) — the round-trip is
exact.

---

# 7.14 DEMO MODE (NON-PERSISTING VIEW)

## Goal
Anonymous visitors see a fully-populated, interactive product on first load — no account creation, no manual data entry — so they can evaluate the experience in seconds.

## Requirements
- Default landing experience for unauthenticated / first-time users
- All state held in memory only — never written to IndexedDB or backed up
- Clearly labeled as "Demo" in the UI
- One-click "Start fresh with my own data" exits demo mode and initializes a real (persisting) profile
- Edits in demo mode are reactive (charts/projections recompute) but discarded on refresh

## Mock Data Fixture
Pre-populated household (see `lib/demo.ts` for the canonical
shape — this section describes what's there, not what's
required). The fixture has grown alongside the product as
features were added; it now exercises every major surface so a
first-time visitor sees a realistic, opinionated plan rather
than a single-account stub.

**Household**: 3 members
- Alex (age 38, income $220k)
- Jordan (age 36, income $165k)
- Kiddo (age 5, no income) — a non-earner to demonstrate the
  rollup-include flag (kid is "included" by default; the
  Members sheet shows how to toggle them out for "adults-only"
  views)

**Net worth**: ~$608k across a multi-account portfolio that
spans tax-deferred / Roth / HSA / taxable / shared brokerage,
plus liabilities (mortgage + auto + student loan). Accounts
include composition-wrapped holdings (NTSX, AVGE) so the
multi-asset / leverage / per-leg-CAGR machinery is visible from
the first render.

**Future income streams** (`DEMO_INCOME_STREAMS` in `lib/demo.ts`):
- Alex Social Security: 2055-2083 @ ~$43k/yr (FRA = 67, COLA-
  indexed, sized via `lib/budget/socialSecurity.ts:estimateSocialSecurityAtFRA`)
- Jordan Social Security: 2057-2085 @ ~$40.5k/yr (same shape,
  scaled to Jordan's income)

**Drawdown phases** (assumptions.drawdownPhases): 4% baseline
→ 3.5% at year 10 → 3.0% at year 20 (go-go / slow-go / no-go
pattern from retirement research).

**Variable haircut**: 0 by default. The conditional ("only
after down market years") toggle is OFF.

Every demo seed is reasoned-from-data — Social Security values
come from the SSA 2025 bend-point formula given each member's
income + projected retirement age; drawdown-phase rates come
from Pfau/Blanchett/Drak research. Updating the demo to a new
reasonable plan is a single-file edit (`lib/demo.ts`); the
factory pattern + the `incomeStreams` slice's `freshSlate()`
re-seed semantics handle the wiring.

---

# 8. OPEN-SOURCE PHILOSOPHY (FREE TIER ONLY)

> **Status as of 2026**: This project is fully open-source with
> NO paid tier. Every feature listed below is available to every
> user without sign-in, payment, or subscription. The
> `ProGate` component in the codebase is a deliberate
> architectural escape hatch (pass-through today) — see
> "Why ProGate stays" below.
>
> The full rationale lives in the
> [README](../README.md#privacy-model) and
> [OAUTH_VERIFICATION.md](./OAUTH_VERIFICATION.md). The TL;DR:
> we deliberately avoid any recurring infrastructure cost (no
> owned domain, no paid Google verification, no payment
> processor). The 100-user Google Drive sync cap is an
> accepted constraint; the data-portability path is free,
> encrypted, and sign-in-free for everyone via Data →
> Export/Import.

## What's free (i.e. everything)

The full feature catalog ships as the OSS build. Categorized
to keep the doc structured, NOT to suggest tiering:

### Position tracking + analytics
- Net worth tracking (full asset taxonomy: equity, bond, cash,
  crypto, commodity, real estate, private stock, other)
- Per-holding `expectedRealCAGR` (each line carries its own
  expected return; class defaults seed sensible values, override
  per holding)
- Multi-asset wrapper-fund modeling — composition-aware
  decomposition of NTSX / GDE / RSST / AVGE / user-rolled custom
  composition legs, each leg with its own weight + CAGR
- Per-holding leverage editing
- Live prices + leverage-aware exposure math
- Allocation panel (class / style box / geography / bond
  duration / tax-bucket breakdowns; per-holding editing)
- Concentration-risk audit (single-ticker / single-account /
  single-member)
- Expense-ratio drag with cheaper-alternative callouts
- Asset-location audit (bonds in taxable, broad equity in Roth)
- Liquid vs total NW toggle
- 5y / All-history range on the Net-Worth chart
- Future composition chart (any age)
- Trailing growth velocity (30d / 90d / 1y / lifetime
  annualized)

### Projection + stress
- Independence timeline + projection chart
- Milestones (next round-number NW thresholds)
- Coast-Independence detection
- Doubling time helper (Rule-of-72 + contributions roadmap)
- Stress test ("what if the market drops X%?")
- Lost-decade stress overlay on the Independence projection
- Income + savings-rate insight (Extreme / Strong / Steady)
- Net-worth percentile vs Fed SCF by age band
- Health score (composite plan-robustness check)
- Nominal-equivalent translation at Independence date
- Emergency-fund adequacy meter
- Historical Monte Carlo + bootstrap simulator
  (1928–2025 Damodaran dataset)
- Scenario engine + side-by-side overlay chart
- What-if savings explorer (interactive slider)
- Assumption sensitivity card

### Multi-member + planning
- Multi-member households (per-member ages, incomes,
  contributions, drawdown phases, assumption overrides)
- Per-member `includeInRollup` toggle — set a member aside
  from household totals without losing their data
- Per-member member-filter view + preferred default view
- Multi-goal tracker (non-Independence goals — house,
  education, sabbatical)
- Future-income streams (consulting, pension, Social Security,
  rental) — owner-keyed, year-based start/end, real-growth-rate
  default 0 (inflation-protected)
- Conditional variable-haircut mode ("only after down market
  years") — Guyton-Klinger style guardrail
- Recurring monthly expense ledger + subscriptions panel

### Tax + drawdown
- Tax-efficient drawdown sequencer (Bogleheads default order)
- Roth conversion ladder estimator
- Multi-phase drawdown with custom rate transitions
- Legacy floor + sustained-check
- Insights engine (concentration, leverage warning, monthly
  gain, YoY return, tax-bucket concentration, manual-price
  staleness)

### Data ownership + privacy
- Manual asset entry + holdings management
- Liability tracking
- Local-only storage (IndexedDB) by default
- Local export/import (plaintext OR AES-256-GCM encrypted with
  user-set passphrase) — sign-in not required; the
  cross-device, encrypted-at-rest, free-forever portability
  path
- Optional Google Drive backup (sign-in required) — capped at
  100 users by Google's OAuth verification policy; failure mode
  past the cap is graceful (falls back to local export/import).
  See [OAUTH_VERIFICATION.md](./OAUTH_VERIFICATION.md).
- E2E encryption for Drive backups AND local exports — same
  passphrase, same `fp-enc-v1` envelope, byte-for-byte
  equivalent payloads

## Why ProGate stays

The `ProGate` component (`app/_components/ui/ProGate.tsx`) is a
no-op pass-through in the OSS build (`useIsPro()` returns
`true` unconditionally). It still wraps a small set of
features the architecture treats as "the Pro tier if there
ever were one":

- Cloud backup (GoogleSyncCard)
- A handful of advanced Projections / Plan cards (drawdown
  sequence, Roth conversion ladder, historical Monte Carlo,
  what-if savings, sensitivity, scenarios)

The wrapping is intentional. It costs nothing today and
provides flexibility:

- **If we ever need to pay for Google OAuth verification** so
  Drive sync works past 100 users, the cleanest cost-recovery
  path is introducing a Pro tier covering the registrar +
  verification + ongoing OAuth-related infra cost. Flipping
  `useIsPro()` from `() => true` to an entitlement check is
  the entire toggle.
- **If the project ever forks** under a different funding
  model, the architectural seam is already in place.
- **If a contributor builds a SaaS layer on top of this OSS
  core**, the gate is a natural attach point.

None of this is planned. The OSS-only stance is the current
contract. ProGate's continued existence is purely an
architectural option, not a business commitment.

---

# 9. PERFORMANCE REQUIREMENTS

## UX Requirements
- Instant updates (<50ms)
- Offline-capable
- Mobile-first
- Responsive

---

# 10. SUCCESS METRICS

## Primary
- Paying users
- Annual retention
- Weekly active users

## Secondary
- Time-to-first-value
- User return frequency
- Annual conversion rate

---

# 11. MVP SCOPE

## MVP Includes
- Manual net worth tracking
- Independence projection
- Basic scenario comparison
- Historical graph
- Local-first storage

## Deferred
- Monte Carlo
- Tax modeling
- Automated integrations
- Estate/legal tooling

---

# 12. LONG-TERM VISION

Become the default operating system for private long-term wealth planning for independence-oriented individuals and families.

END OF PRD
