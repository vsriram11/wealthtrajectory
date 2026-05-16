# Architecture

Notes for someone reading the codebase for the first time. Covers
the load-bearing patterns, the rationale behind them, and where to
add things without surprising the next maintainer.

## Layering

```
app/                                    ← Next.js App Router + React shell
  _components/                          ← UI grouped by subsystem
    ui/                                 ← shared primitives (NumberField,
                                          SectionHeader, ProGate, EmptyState,
                                          LiquidityChip)
    shell/                              ← page containers + cross-page chrome
                                          (PlanPage, AllocationPage,
                                          ProjectionsPage, NavDrawer,
                                          DemoHeader, LegalFooter,
                                          LiquidOnlyCaption, DataPageExtras)
    infra/                              ← invisible mount-effect runners
                                          (AuthHydrator, CloudSyncer,
                                          PersistenceHydrator, PriceRefresher,
                                          ServiceWorkerRegistrar,
                                          SessionEnforcer, QuoteCloudSync) —
                                          components that render null and
                                          subscribe to side effects on mount
    projection/                         ← NetWorth, projection chart,
                                          Independence date, Monte Carlo,
                                          stress, sensitivity, what-if,
                                          milestones, coast, scenario cards,
                                          drawdown phases
      historical-mc/                    ← MC card sub-charts (fan, …)
      net-worth/                        ← NW card sub-views (projection,
                                          history)
    allocation/                         ← class breakdown, target,
                                          glide-path, concentration, fee
                                          drag, asset location, tax buckets,
                                          positions, style box
      allocation-views/                 ← per-class allocation drill-downs
    holdings/                           ← accounts, holdings, liabilities
                                          editors + lists
      holding-creator/                  ← per-kind creation forms
      holding-editors/                  ← class-specific sub-editors
    plan/                               ← assumptions, budget, income,
                                          health, emergency fund,
                                          withdrawal sequence, Roth ladder,
                                          income/savings rate, goals
      budget/                           ← budget panel sub-components
      health/                           ← health-plan panel sub-components
    insights/                           ← Insights, HealthScore,
                                          NWPercentile, MemberFilter,
                                          MembersSheet
    data/                               ← DataIO, EncryptionCard, Google
                                          sync, sign-in banners, reminders,
                                          snapshots, quick-start
  review/                               ← printable annual review (URL route)
  security/                             ← privacy + crypto disclosure (URL route)
lib/                                    ← pure engines + store layer
  store/                                ← Zustand composition (16 slices +
                                          4 entity-action modules)
  projection/                           ← Independence, Monte Carlo, stress,
                                          sensitivity, what-if, coast,
                                          doubling, growth-velocity,
                                          useActiveProjection
  portfolio/                            ← portfolio aggregation, holding
                                          factory + kinds, leverage buckets,
                                          bond leverage, glide path,
                                          target allocation, future
                                          allocation, presets
  budget/                               ← budget rollup, income streams,
                                          social-security estimator,
                                          emergency fund
  health/                               ← health-plan modeling + score
  tax/                                  ← withdrawal sequence + sequencer,
                                          Roth ladder, asset location,
                                          fee drag
  sync/                                 ← Google auth + Drive, cloud sync,
                                          shrinkage safety, crypto envelope,
                                          session-local marker
  persistence/                          ← IndexedDB save/load, dataIO
                                          export/import, store migrations
                                          + helpers
  data/                                 ← historical returns, live quotes,
                                          history slicing, staleness logic
  insights/                             ← insights engine, concentration,
                                          NW percentile, reminders,
                                          scenarios, goals
  *.ts                                  ← cross-cutting core: types, format,
                                          nominal, entityIds, demo, store
                                          composition root,
                                          useLocalStorageState
```

The **app/** layer never owns business logic. Every chart, every
projection, every "is this number red or green" decision is a pure
function call into **lib/**. The shell is replaceable; the engines
are the asset.

The subsystem split exists for navigability + onboarding signal —
58 source files in a flat `lib/` and 80 in a flat `app/_components/`
became unscannable. The split groups files by *domain*, not by
component type, so contributors find related code by intuition.
Cross-subsystem references use absolute `@/lib/<subsystem>/X` or
`@/app/_components/<subsystem>/X` imports for stability through
future moves.

## The store: Zustand slices

`lib/store.ts` is 250 lines, almost all of which is composition.
The substance lives in **16 slice files** plus **4 entity-action
modules** under `lib/store/`. Slices own state + their own
setters; action modules cluster cross-slice mutations for one
entity type (e.g. all per-holding actions live in
`holdingsActions.ts`, not scattered across every slice that
references a holding):

| Slice file | Owns |
|---|---|
| `uiSlice.ts` | Current page, nav drawer, alloc tabs, view basis, liquidity toggle, future-projection slider |
| `editingSlice.ts` | Which entity is being edited / created (modal-presence flags) |
| `memberViewSlice.ts` | Member-filter scope (selected + persistent preference) |
| `authSlice.ts` | Signed-in Google profile, subscription tier, sign-out teardown |
| `googleSyncSlice.ts` | Sync flags + outcome telemetry |
| `encryptionSlice.ts` | E2E-encryption passphrase + persisted "encryption enabled" flag |
| `activitySlice.ts` | Last-activity timestamp, forced-signout reason |
| `assumptionsSlice.ts` | Household + per-member plan assumptions |
| `targetAllocationSlice.ts` | Static target + lifecycle glide path |
| `goalsSlice.ts` | Non-Independence goal list (house, college, …) |
| `budgetSlice.ts` | Recurring monthly expense ledger |
| `incomeStreamsSlice.ts` | Future-income streams (consulting, pension, SS, rental). Year-based start/end + real-growth rate. Flow into MC + projection as positive cash flow. |
| `healthSlice.ts` | Health plans + per-member importance weights |
| `scenariosSlice.ts` | Saved alternate plans + active selection |
| `householdSlice.ts` | The household tree + mode + legacy income |
| `holdingsActions.ts` | 19 per-holding mutation actions |
| `accountsActions.ts` | 5 per-account mutation actions |
| `liabilitiesActions.ts` | 3 per-liability mutation actions |
| `membersActions.ts` | 6 per-member mutation actions |
| `lifecycleSlice.ts` | hydrate / import / switchToReal / resetToDemo |

Every slice exports the same five things (`createUISliceActions`
in `uiSlice.ts` is a canonical example):

```ts
export type XSliceState = { /* fields this slice OWNS */ };
export type XSliceActions = { /* setters this slice PROVIDES */ };
export const X_SLICE_INITIAL: XSliceState = { /* defaults */ };
export type XSliceContext = XSliceState & { /* OTHER slices' fields this slice writes */ };
export function createXSliceActions(set, [get]): XSliceActions { /* … */ }
```

The composition root (`lib/store.ts`) intersects every slice's
state + actions into `AppState`, then spreads each slice's
initial state and action factory into the Zustand `create()`
body:

```ts
export const useAppStore = create<AppState>((set, get) => ({
  ...UI_SLICE_INITIAL,
  ...createUISliceActions(set),
  ...EDITING_SLICE_INITIAL,
  ...createEditingSliceActions(set),
  // … etc, one pair per slice
}));
```

**Cross-slice writes** are explicit: when `removeHolding`
cascades into the `scenarios` array (stripping overrides keyed
off the deleted holding), the slice declares a structurally-
typed `HoldingsActionsContext` that includes both `household`
and `scenarios`. The slice never imports `AppState` — it
declares exactly the fields it touches, and the composition
root happens to satisfy that contract automatically.

This is what makes adding a new slice mechanical:

1. Create `lib/store/<name>Slice.ts` with the five exports.
2. Write `lib/store/<name>Slice.test.ts` exercising each action.
3. Add the slice's `State & Actions` to the `AppState`
   intersection in `lib/store.ts`.
4. Spread `INITIAL` and `createXSliceActions(set)` into the
   `create()` body.

No consumers change. No selector hooks change. No tests for
other slices change. The slice is independently testable in
isolation — each `<name>Slice.test.ts` uses a `makeFakeStore`
that emulates only the slice's structural context.

## Entity ids: soft brands

Each household entity (holding, account, liability, member,
household, scenario) has its own branded id type defined in
`lib/entityIds.ts`:

```ts
type HoldingId  = string & { readonly __entityBrand?: "holding"  };
type AccountId  = string & { readonly __entityBrand?: "account"  };
type MemberId   = string & { readonly __entityBrand?: "member"   };
// … etc
```

At runtime these are just strings — `crypto.randomUUID()`
prefixed with a debug-readable token (`hld-…`, `acc-…`, etc.).
At compile time they're nominally distinct, so the compiler
catches `removeHolding(account.id)` before it ships.

**Soft (optional-property) brands rather than hard brands.**
With a *required* brand field, every JSON-parse / IDB-hydrate /
test-fixture site would need an explicit `castHoldingId(…)`
call. Soft brands let plain `string` flow into a branded slot
(the missing brand unifies with `"holding" | undefined`) while
still rejecting `HoldingId → AccountId` assignments because
the brand singletons conflict.

The bug class we want to catch is type confusion between entity
kinds, not "I forgot to validate an opaque UUID." The
deserialization shape is just `string`; there's nothing to
validate. Soft brands hit the cost/benefit sweet spot.

Pinned by `lib/entityIds.test.ts` — four `@ts-expect-error`
assertions that fail-the-build if anyone ever accidentally
makes two branded types mutually assignable.

## Per-kind dispatch: the holding registry

Asset class is a discriminated union — eight kinds (`equity`,
`bond`, `cash`, `crypto`, `commodity`, `real_estate`,
`private_stock`, `other`). Three places need per-kind logic:

1. **Display labels.** "Stocks" vs "Stock", per-class headings,
   ordering of the class-tab row.
2. **Default real CAGR.** When the user creates a holding
   without specifying CAGR, we seed from a benchmark.
3. **Builder logic.** Each kind has its own input shape and
   construction rules (preset matching, leg composition,
   commodity sub-breakdown, etc.).

`lib/portfolio/holdingKinds.ts` is the single source of truth for (1) and
(2). Every consumer that wants a label or a default CAGR reads
from `HOLDING_KIND_META` — no more scattered constants.

`lib/portfolio/holdingFactory.ts` covers (3): a pure `buildHolding(id,
input): Holding | null` function with one `buildXxxHolding`
helper per kind. The action handler in
`holdingsActions.ts:createHolding` is now ~10 lines —
generate id, build holding, set state — because the factory
absorbed the 386-line per-kind dispatch that used to live
inline.

Adding a 9th asset class is a four-file change:
`lib/types.ts` (extend `AssetClass`), `lib/portfolio/holdingKinds.ts`
(add a meta entry), `lib/portfolio/holdingFactory.ts` (add the builder),
and `app/_components/holding-creator/NewKindForm.tsx` (the
input form). The class-tab pickers, allocation views, and the
holding editor pick up the new kind automatically because they
all dispatch on the discriminant.

## Generic primitives that DRY domain shapes

A few small generics power the codebase out of proportion to
their size:

- `NormalizedSliderGroup<K>` — generic "n sliders that sum to
  100%" editor. Used by bond-type / geography / commodity
  breakdowns; each is a 5-line wrapper.
- `HoldingListView` — the five list-style allocation views
  (Crypto / Commodity / RealEstate / PrivateStock / Other) used
  to be 5 × ~80-line near-duplicates. Now they're 5 × ~25-line
  configurations over one ~80-line generic.
- `FilterChipGroup<T>` — typed chip strip used by the
  Historical Monte Carlo card. Adding a new filter is a
  one-line config change.

## Tests

Vitest, node environment. The convention:

- **`lib/**/*.test.ts`** — pure-function tests for engines and
  slices. No DOM, no React, no async beyond Promise.
- Math invariants (Trinity SWR, real-vs-nominal conversion,
  composition CAGR blend, Gordon-growth finite horizon) are
  pinned where they live, not in a central integration suite.
- Slices use a `makeFakeStore` helper that mirrors the slice's
  context type — emulates Zustand's `set`/`get` so the slice's
  actions can be exercised without instantiating the real store.
- **Property-based layer** — `lib/properties.test.ts` uses
  [fast-check](https://fast-check.dev/) to pin universal laws
  (nominal/real involution, glide-path interpolation bounds,
  Monte Carlo percentile ordering) across 200 generated inputs
  per property. Shrinking surfaces minimal failing examples
  that example-based tests miss.

The suite (1100+ tests across the engine, slice, component, and
property-based layers) pins every engine's invariants; engine
coverage sits at ≥ 90% line / branch. Adding a new slice or engine
should come with a test file that pins its contract. The full
testing playbook — TDD loop, quality bar a test must clear to
land, what each suite guards —
is in [`Testing.md`](./Testing.md).

CI (`.github/workflows/ci.yml`) runs typecheck + lint + test +
build on every PR push; total runtime ~90s. Husky pre-commit
runs `eslint --fix` on staged files. Dependabot batches weekly
npm + github-actions updates.

## Privacy + sync

Two design constraints shape the data layer:

1. **No backend.** All math runs in the browser. No
   account-data database, no analytics, no telemetry.
2. **Optional E2E encryption.** When a passphrase is set,
   Drive payloads round-trip through `AES-256-GCM` (envelope:
   `fp-enc-v1`, PBKDF2-HMAC-SHA-256 with 250k iterations).
   See `lib/sync/crypto.ts` + `docs/PrivacyAndSecurity.md`.

Persistence is IndexedDB by default. Drive sync is opt-in via
sign-in. The `CloudSyncer` component debounces uploads + bails
when an unlock is pending; `mergeFresherPrices` (in
`storeHelpers.ts`) preserves recent live-price timestamps so a
backup pull doesn't clobber them.

## Where I'd start

If you're adding a feature:

- **A new asset class** → start at `lib/portfolio/holdingKinds.ts`, then
  `holdingFactory.ts`, then a creator-form component.
- **A new piece of state** → pick the right slice (or create a
  new one) — never add fields to a top-level `AppState`.
- **A new chart** → derive from `computePortfolio()` or
  `projectIndependence()`. Charts are presentation; engines own
  the math.
- **A new modal/editor** → set its `editingXId` field on the
  Editing slice from a parent surface; the modal subscribes via
  `useAppStore((s) => s.editingXId)`.

If you're debugging:

- **Wrong number on screen** → trace it back to the engine in
  `lib/`. The corresponding test file should pin the input →
  output mapping; if it doesn't, that's a missing test.
- **State update that didn't fire** → the action lives in one
  of the `lib/store/*Slice.ts` files. The action handler is
  almost always 1-10 lines and reads its own intent clearly.
- **Cross-slice cascade missing** → look at the slice's
  `XSliceContext` type. It declares exactly which other-slice
  fields the action writes; if you need a new cascade, add the
  field to the context type.
