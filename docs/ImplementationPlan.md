# wealthtrajectory — IMPLEMENTATION PLAN & TECHNICAL ARCHITECTURE

# 1. SYSTEM OVERVIEW

## Architecture Philosophy
- Local-first
- Zero marginal backend cost
- Client-side compute
- Minimal infrastructure
- User-owned data

## Infrastructure Cost Goal
- <$500/year at scale

---

# 2. HIGH-LEVEL ARCHITECTURE

## Core Principle
All business logic and financial computation run on the client device.

## Backend Responsibilities
Minimal:
- Google OAuth
- Optional backup sync
- Optional stock price proxy/cache

No server-side financial calculations.

---

# 3. TECH STACK

# Frontend
- Next.js
- React
- TypeScript

# Styling
- Tailwind CSS

# State Management
- Zustand or React Context

# Storage
- IndexedDB via Dexie.js

# Charts
- Recharts or Lightweight Charts

# Deployment
- Vercel Free Tier

---

# 4. DATA STORAGE ARCHITECTURE

# Primary Storage
IndexedDB

## Stored Locally
- Households / Members
- Accounts (with category + custom name)
- Holdings (positions inside accounts)
- Liabilities
- Snapshots
- Scenarios
- Settings
- Insights cache

## Data Model (sketch)
- `Household` → many `Member`
- `Member` → many `Account`
- `Account` { id, ownerId, category (enum), displayName, type: asset|liability }
- `Holding` { accountId, symbol, quantity, costBasis?, valueOverride? } or `{ accountId, kind: "cash", value }`

## Account Categories (enum)
`401K | ROTH_401K | TRAD_IRA | ROTH_IRA | HSA | BROKERAGE | SAVINGS | CHECKING | FIVE_29 | CRYPTO | OTHER`

## Why IndexedDB
- Persistent
- Offline-capable
- Large capacity
- Fast local reads/writes

---

# 5. BACKUP ARCHITECTURE

# Google Drive Integration

## Storage Location
Google Drive appDataFolder

## File Format
Preferred:
- SQLite backup file

Alternative:
- Compressed JSON

---

# Backup Strategy
- Manual backup
- Optional automatic backup on app open

---

# 6. SECURITY ARCHITECTURE

# Security Philosophy
- User data stays local by default
- Minimal trust assumptions
- Minimize attack surface

---

# 6.1 LOCAL DATA SECURITY

## IndexedDB Protection
- Browser sandbox isolation
- Optional local encryption layer

## Sensitive Data
No bank credentials stored.

---

# 6.2 BACKUP SECURITY

## Google Drive Backups
Optional:
- End-to-end encrypted before upload

## Encryption
Recommended:
- AES-256-GCM

## Key Strategy
- User passphrase-derived key
- Never stored server-side

---

# 6.3 AUTHENTICATION SECURITY

## Auth Provider
Google OAuth

## Tokens
- Stored locally only
- Short-lived where possible

## Backend
No user password storage.

---

# 6.4 API SECURITY

## Principles
- No sensitive financial data sent to backend
- No centralized portfolio database

---

# 7. COMPUTATION ENGINE

# All Computation Runs Client-Side

## Modules
- Independence projection engine
- CAGR calculations
- Scenario engine
- Legacy modeling
- Leverage analysis

---

# 7.1 Independence ENGINE

## Inputs
- Net worth
- Savings
- CAGR
- Withdrawal rate
- Legacy floor

## Outputs
- Independence date
- Sustainability curve
- Future balances

---

# 7.2 SCENARIO ENGINE

## Requirements
Parallel scenario calculation.

## Optimization
Memoized calculations where possible.

---

# 7.3 LEVERAGE ENGINE

## Inputs
- Asset leverage ratio

## Outputs
- Effective exposure
- Portfolio leverage

---

# 8. STOCK PRICE SYSTEM

# Strategy
Minimal-cost architecture.

## Data Source
- Yahoo Finance public endpoints
- Optional free APIs

## Refresh Policy
- Fetch on app open only
- No background polling

## Caching
- Local cache
- Timestamp-based invalidation

---

# 8.1 DEMO MODE (NON-PERSISTING)

## Purpose
Anonymous landing experience powered by a hard-coded mock fixture. Lets visitors evaluate the product instantly without signup or data entry.

## Behavior
- Loaded by default when no persisted profile exists in IndexedDB
- State held in an in-memory store (Zustand) — NOT written to IndexedDB
- All engines (Independence, scenarios, leverage) operate against the in-memory state, so charts and projections are fully interactive
- Refresh resets to the original fixture
- Explicit "Start with my own data" action: clears demo state, initializes a real (persisted) profile, switches the store backend to the IndexedDB-backed adapter

## Fixture Location
- Defined as a typed constant (e.g. `lib/demo/fixture.ts`)
- Single household, single member, the seven accounts below

## Fixture Contents

| Category | Display Name | Holdings | Value |
| --- | --- | --- | --- |
| 401K | Employer 401(k) | VOO 100% | $50,000 |
| ROTH_401K | Employer Roth 401(k) | VOO 100% | $50,000 |
| TRAD_IRA | Rollover IRA | TQQQ 100% | $50,000 |
| ROTH_IRA | Roth IRA | TQQQ 100% | $50,000 |
| BROKERAGE | Taxable Brokerage | VOO 50% / QQQM 50% | $100,000 |
| SAVINGS | High-Yield Savings | Cash | $10,000 |
| CHECKING | Checking | Cash | $10,000 |

Total mock net worth: **$320,000**

## Implementation Notes
- Holdings stored as `{symbol, valueUSD}` in the fixture (no share-count math required; price-refresh path is deferred)
- Demo banner component renders persistently while in demo mode
- Same selectors/components serve demo and real modes — only the store source differs

---

# 9. DAILY SNAPSHOT SYSTEM

# Trigger
Snapshot generated:
- On app open
- If last snapshot >24h ago

## Stored Data
- Timestamp
- Net worth
- Asset totals
- Exposure metrics

---

# 10. FAMILY MODELING

# Data Structure

## Household
Contains:
- Members
- Shared assets
- Shared scenarios

## Individual
Contains:
- Personal assets
- Individual projections

---

# 11. PERFORMANCE STRATEGY

# Goals
- <50ms UI updates
- Instant chart refresh
- Offline-first experience

---

# Optimization Techniques
- Web workers for heavy calculations
- Debounced recalculations
- Memoized selectors

---

# 12. OFFLINE SUPPORT

# Requirements
Full offline functionality except:
- Stock price refresh
- Backup sync

---

# 13. RESPONSIVE DESIGN

# Primary Targets
- Mobile
- Desktop

# Requirements
- Responsive charts
- Touch-friendly controls

---

# 14. INFRASTRUCTURE COST MODEL

# Vercel
- Free tier

# Cloudflare Workers
- Free tier or <$5/month

# Google APIs
- Free

# Domain
- ~$10–20/year

# Total Estimated Cost
Typical:
- <$100/year

Worst case:
- <$500/year

---

# 15. SCALING MODEL

# Why Scaling Cost Stays Near Zero

## Because:
- Storage is local
- Compute is local
- Backups use user Drive quota

## Backend Load
Minimal and mostly static.

---

# 16. DEVELOPMENT PHASES

# Phase 1 — MVP ✓
- Net worth tracking ✓
- Independence projection ✓
- Local storage (IndexedDB) ✓
- Graphs (history + projection) ✓

---

# Phase 2 ✓
- Scenario engine ✓ (with side-by-side overlay chart)
- Family modeling ✓ (per-member assumptions, reorder, preferred default view)
- Insights engine ✓ (monthly gain, YoY, growth-mix, leverage warning, concentration)

---

# Phase 3 ✓
- Leverage analysis ✓ (face/exposure views, structurally-aware education
  callouts for mortgage vs daily-reset LETF leverage, multi-asset
  composition for NTSX / GDE / RSST and custom wrappers)
- Legacy planning ✓ (drawdown phases, legacy floor, sustained check)
- Backup encryption ✓ (AES-256-GCM, PBKDF2 250K iters, in-memory passphrase)

---

# Phase 4 ✓
- Target allocation drift card (rebalancing companion)
- What-if savings calculator
- Coast-Independence detection
- Multi-tier commodity sub-classification (Metals + Energy/Ag)
- Live-priced crypto ETFs (IBIT / FBTC / BITX / etc.)

# Phase 5 ✓
- Doubling-time card (Rule-of-72 + contributions)
- Trailing growth-velocity card (30d / 90d / 1y / lifetime)
- Nominal-equivalent translator at Independence date
- Concentration-risk audit (ticker / account / member)
- Expense-ratio drag with cheaper-alternative recommendations
- Tax-efficient drawdown sequencer
- Roth conversion ladder estimator
- Asset-location optimizer (bonds in taxable, bonds in Roth)
- Net-worth percentile vs Fed SCF by age band
- Emergency-fund adequacy meter
- Multi-goal tracker (non-Independence goals)
- Income + savings-rate insight card (tiered framing)

# Phase 6 ✓
- Information-architecture refactor: 6 pages keyed off `currentPage`
  with per-page sub-section headers, replacing a 21-card single-
  page dashboard
- Home trimmed to 8 essential dashboard cards
- New "Projections" page consolidates 9 forward-looking cards across
  4 sub-sections (Quick analytics, Stress & sensitivity, Forward
  composition, Scenarios). Folds the old Scenarios page in.
- Renamed/extended "Plan" page consolidates 9 strategy + safety +
  tax cards across 4 sub-sections (Assumptions, Safety net, Tax
  optimization, Benchmarks)
- `SectionHeader` component for visual sub-grouping

# Phase 7 ✓
- Budget tracker on Plan page (sub-tab "Budget" alongside
  "Strategy") — recurring monthly expenses tagged with category +
  subcategory + type, rolled up to suggested independence corpus =
  retirement-annual / withdrawal rate, with one-tap "Apply to Independence
  target" that writes assumptions.targetNetWorthUSD
- 6 categories (Housing / Food & drinks / Transportation /
  Lifestyle / Healthcare / Savings) with curated subcategory presets
- Full sync wiring: store + dataIO + persistence + 5 sync sites
  (PersistenceHydrator, CloudSyncer, AuthHydrator, GoogleSyncCard,
  DataIO) with defensive parseImport coercion
- Fix: scenarios now persist to IDB (latent bug — they were
  previously Drive-only, so signed-out refresh lost them)

# Phase 8 (in flight)
- Snapshot annotation + diff view
- Mega-backdoor Roth eligibility detector
- Empty-state suppression on Projections / Plan when account-less

---

# Deferred (per PRD §11)
- Monte Carlo simulation
- Tax modeling (federal/state bracket-aware drawdown)
- Automated brokerage integrations
- Estate / legal tooling

---

# 17. TESTING PLAN

The math is the asset and the tests are the spec. Engine
changes follow a TDD loop (write the failing test first, then
implement). Full philosophy + per-suite invariant catalog in
[docs/Testing.md](./Testing.md).

## Current state

- **1100+ tests across the engine, slice, component, and property-based layers**, Vitest + jsdom.
- **Engine coverage ≥ 90% line / branch** under v8 coverage.
- **Property-based layer** — `lib/properties.test.ts`, 10
  invariants × 200 fast-check samples each. Pins universal laws
  (nominal/real involution, glide-path interpolation bounds,
  Monte Carlo percentile ordering) that example tests miss.
- **CI** — `.github/workflows/ci.yml` runs typecheck + lint +
  test + build on every PR, Node 20, ~90s total. Coverage
  uploaded to Codecov.
- **Husky pre-commit** — `eslint --fix` on staged files
  (`.husky/pre-commit` + `lint-staged` config in `package.json`).
- **Dependabot** — `.github/dependabot.yml` batches weekly npm
  + github-actions updates; majors land separately.

## Test categories

- **Engine tests** — `lib/<engine>.test.ts` next to the source.
  Pure-function, no DOM, no React. Trinity SWR cross-reference,
  CPI deflation, mid-year compounding convention, glide-path
  interpolation, leverage compounding, sequence-of-returns
  regressions.
- **Slice tests** — `lib/store/<name>Slice.test.ts`. Each uses
  `makeFakeStore` to exercise actions in isolation without
  instantiating the real Zustand store. Cross-slice cascades
  (delete a holding → strip its scenario overrides) have
  explicit tests.
- **Property-based tests** — `lib/properties.test.ts`.
- **Integration tests** — IndexedDB persistence + Drive sync are
  covered via `lib/persistence.test.ts` + `lib/cloudSync.test.ts`
  using fake IDB + mocked Drive client.
- **E2E** — out of scope for this build; the engines are pure
  and the manual smoke-test path is short enough that Playwright
  ROI is low until contributors arrive.

---

# 18. FAILURE RECOVERY

# Data Recovery
- Google Drive restore
- Local export/import

# Corruption Handling
- Snapshot versioning
- Backup validation

---

# 19. PRIVACY POLICY PRINCIPLES

- No selling user data
- No portfolio analytics collection
- No tracking of financial details
- User retains ownership of data

---

# 20. LONG-TERM ARCHITECTURE PRINCIPLE

Never introduce infrastructure that creates:
- meaningful per-user cost
- server-side dependency for core functionality
- centralized financial data risk

END OF IMPLEMENTATION PLAN
