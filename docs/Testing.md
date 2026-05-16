# Testing

This codebase is test-driven on the math. Every engine under
`lib/` has a sibling `*.test.ts` that pins its input → output
contract before any UI consumes it. That isn't decoration — the
tests *are* the spec. Anyone refactoring an engine should be
able to read its test file as a behavioral description of what
the engine guarantees.

This doc is the playbook for that discipline: what the suites
guard, how to write a new test, when to reach for property-based
checks, and the quality bar a test must clear to land.

## The numbers

| Stat | Value |
|---|---|
| Test files | 80+ |
| Unit + integration tests (Vitest) | 1100+ |
| Property-based suites | 1 (`lib/properties.test.ts`, 20+ invariants) |
| Cross-feature contract tests | 1 (`lib/rollupContract.test.ts`, the full cascade for the include-in-rollup flag) |
| Component tests (RTL + jsdom) | NumberField, NormalizedSliderGroup, useLocalStorageState, MembersSheet, IncomePanel, DataIO |
| E2E smoke tests (Playwright) | golden paths + hydration regression guard + visual regression baselines |
| Visual regression (Playwright) | 3 (full-page snapshots for /, /review, /security) |
| Accessibility scans (axe-core) | 4 (WCAG 2.x A/AA, critical + serious gate + informational pass) |
| PWA installability tests (Playwright) | 6 (manifest, maskable icon, meta tags, apple-touch-icon, favicon) |
| Performance budgets (Lighthouse CI) | 4 categories + 3 Web Vitals, 3 URLs × 3 runs each |
| Engine coverage (`lib/*.ts`) | ≥ 89% line / 94% function |
| Runners | [Vitest](https://vitest.dev/) (jsdom) + [Playwright](https://playwright.dev/) + [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) |
| Property checker | [fast-check](https://fast-check.dev/) |
| A11y scanner | [@axe-core/playwright](https://www.deque.com/axe/) |
| Mocking | `vi.mock`, [fake-indexeddb](https://www.npmjs.com/package/fake-indexeddb) |
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — three parallel jobs (verify · e2e · lighthouse) for per-axis PR check granularity |

Run them:

```bash
npm test               # one-shot Vitest run (unit + component)
npm run test:watch     # interactive Vitest
npm run test:coverage  # Vitest with v8 coverage report
npm run test:e2e       # Playwright E2E smoke tests
npm run test:e2e:ui    # Playwright with the UI mode (debugger)
```

`test:e2e` spins up the built production server on port 3001
and runs the smoke tests against it. The first run downloads
the chromium-headless-shell binary (~110 MB, cached after).

## The TDD loop

When you change an engine, you do this:

```
1. Open <engine>.test.ts.
2. Write the test that should pass after your change. Run it. Watch it fail.
3. Make the smallest change to <engine>.ts that turns the test green.
4. Run the full suite. Refactor if needed; keep it green.
5. Commit the test + the implementation together.
```

The test-first move is non-negotiable for engine work because
the engines are pure. There's no UI feedback loop that catches
arithmetic mistakes — only the test does. If you can't write
the test, you don't understand the change well enough to make
it.

The harness rewards this: `npm run test:watch` re-runs only the
affected files on save, sub-second feedback.

## What each suite guards

| Suite | The invariants it pins |
|---|---|
| `lib/independence.test.ts` | Months-to-Independence is monotonic in CAGR + contributions; phase transition (accumulation → drawdown) lines up with `independenceSeriesIndex`; `legacyAtHorizonUSD` agrees with the final series point; mid-year cash-flow convention. |
| `lib/monteCarlo.test.ts` + `.scenarios.test.ts` | Yearly + ending percentile arrays length = `horizon + 1`; percentile-ordering p1 ≤ p5 ≤ … ≤ p95; deterministic seeding (bootstrap with the same seed = same paths); broken-default-startNW regression (Round-1 fix) stays fixed. |
| `lib/portfolio.test.ts` | Class shares sum to 1.0; multi-asset wrappers (NTSX, GDE, RSST) compose into per-leg face exposure; effective leverage = Σ(face × leverage) / NW; commodity routing to gold series; tax-bucket aggregation. |
| `lib/scenarios.test.ts` | `applyScenario` composes correctly with `cagrDelta` on wrapped holdings; per-account contribution multipliers + per-holding CAGR overrides flow into `projectIndependence`; higher target → later-or-unreachable Independence. |
| `lib/glidePath.test.ts` | Waypoint interpolation is correct + class-share-conserving; clamping outside the bracket returns the endpoint allocation; collapsing same-age waypoints keeps last-written. |
| `lib/sensitivity.test.ts` | Zero-perturbation reproduces baseline exactly; monotonicity in delta; documented default sweeps stay stable. |
| `lib/nominal.test.ts` + `properties.test.ts` | `nominalToReal ∘ realToNominal = id`; monotonicity in years for non-negative inflation. |
| `lib/store/*Slice.test.ts` | Each Zustand slice's actions move the right state to the right place. Cross-slice cascades (deleting a holding strips its scenario overrides) have explicit tests. |
| `lib/crypto.test.ts` | AES-256-GCM round-trip with PBKDF2-HMAC-SHA-256 (250k iterations); wrong passphrase rejected; envelope schema is JSON `fp-enc-v1`; IV per envelope is random (different ciphertext each call); empty passphrase rejected. |
| `lib/dataIO.test.ts` | JSON export/import preserves household + assumptions + scenarios + budget items byte-for-byte; unknown schema versions are rejected; malformed budget shapes coerce to `[]`. |
| `lib/properties.test.ts` | Property-based laws across all of the above: 200 random samples per property, fast-check shrinks counterexamples to the minimal failing input. |

## Property-based tests

Example-based tests pin specific input → output pairs. Property
tests pin universal claims — laws that must hold for **every**
input in a given domain. We use them sparingly: only where the
property is structural and easy to state. Concretely:

```ts
// lib/properties.test.ts — abridged
it("nominalToReal ∘ realToNominal = id", () => {
  fc.assert(
    fc.property(usdArb, inflationArb, yearsArb, (x, i, y) => {
      const round = nominalToReal(realToNominal(x, i, y), i, y);
      expect(Math.abs(round - x)).toBeLessThan(Math.max(1e-6, |x|·1e-9));
    }),
    { numRuns: 200 },
  );
});
```

When fast-check finds a counterexample it **shrinks** it to the
minimal failing input. Past wins: it found that all-cash
portfolios with tiny spend produce near-identical Monte Carlo
paths where adjacent percentiles wobble by ~3 ULPs (`p1` and
`p5` swapped by 3e-12 due to interpolation), prompting an
explicit float-slack tolerance in the assertion. Example-based
tests would never have generated that input.

When NOT to reach for property tests:

- The property is "the example I just wrote also works for nearby
  values" — that's an example-based test in disguise. Skip it.
- The runtime per assertion is > 50ms (full Monte Carlo, IDB
  round-trip) — keep `numRuns` low (≤ 10) and pick the
  invariant that actually depends on input variation.
- The assertion needs more than a one-line predicate. Express
  it as an example test instead.

## The quality bar a test must clear

A staff-level reviewer would flag any of these. Don't write
them; rewrite them when you see them.

1. **Tautological assertion.** `expect(x).toBeDefined()`,
   `expect(x.length).toBeGreaterThan(0)`, `expect(x).toBeTruthy()`
   without checking what x contains. Replace with an assertion
   that would fail if the relevant field were wrong.

2. **Frozen magic number with no derivation.**
   `expect(result).toBe(42389.17)` where 42389.17 is "whatever
   the function happened to produce." Either (a) add a comment
   showing the formula (`// 4000 × 12 / 0.04 = 1.2M`), or (b)
   compute the expected value inside the test from the inputs.

3. **Vacuous if/else assertion.**
   ```ts
   if (x == null) expect(true).toBe(true);  // ← never fails
   else           expect(x).toBe(expected);
   ```
   Replace with an explicit "either A or B is valid" assertion
   or a guard that throws if neither path holds.

4. **No-assertion test.** A test that runs code and relies on
   absence-of-throw when the code itself can't throw is decoration.
   Either delete the test or assert the relevant output. The
   exception: `lib/entityIds.test.ts`'s compile-time tests, which
   *intentionally* have no runtime assertions because the assertion
   is compilation success — documented at the top of the file.

5. **Over-mocked.** If a test mocks the system under test or so
   many collaborators that the test can't fail meaningfully,
   delete it. Engine tests should never mock; slice tests use
   `makeFakeStore` which emulates only Zustand's `set`/`get`.

6. **Single happy-path test for a function with branches.**
   If the function has obvious edge cases (empty arrays, zero,
   negative, undefined, NaN), the test file must cover them.

7. **Implementation-testing, not behavior-testing.** Asserting
   that a spy was called with specific args, when you could
   instead assert on the resulting output. Rule of thumb: if
   you refactor the implementation without changing behavior,
   the test should still pass.

## Writing a new engine test

Look at any of the existing `lib/*.test.ts` files for the shape.
A canonical template:

```ts
import { describe, expect, it } from "vitest";
import { newEngine } from "./newEngine";

describe("newEngine", () => {
  it("produces the documented value for the baseline inputs", () => {
    const out = newEngine({ /* minimal valid inputs */ });
    expect(out.headline).toBe(EXPECTED_FROM_FORMULA);
  });

  it("scales linearly with input X", () => {
    const a = newEngine({ x: 100 });
    const b = newEngine({ x: 200 });
    expect(b.headline).toBeCloseTo(a.headline * 2, 6);
  });

  it("rejects negative X", () => {
    expect(() => newEngine({ x: -1 })).toThrow();
  });

  // Edge cases: zero, empty, max, NaN, the boundary just above
  // and just below any threshold the implementation uses.
});
```

## Writing a new slice test

```ts
// lib/store/newSlice.test.ts
import { describe, expect, it } from "vitest";
import { createNewSliceActions, NEW_SLICE_INITIAL } from "./newSlice";
import { makeFakeStore } from "./testStore";

describe("newSlice", () => {
  it("toggleX flips the flag", () => {
    const store = makeFakeStore(NEW_SLICE_INITIAL);
    const actions = createNewSliceActions(store.set, store.get);
    actions.toggleX();
    expect(store.state.x).toBe(true);
  });
});
```

`makeFakeStore` is in `lib/store/testStore.ts`. It exposes
`{ state, set, get }` matching the slice's structural context —
the slice's actions can be exercised in isolation without
instantiating the real Zustand store.

## Pre-commit hook

A Husky pre-commit hook runs `eslint --fix` on staged files. We
deliberately don't run the test suite in the hook — that would
be slow and would punish exploratory commits. The CI workflow
runs the suite on every PR push (~90s) and blocks merge on
failure.

If a commit must bypass the hook (rare — almost always a sign
you should fix the failure instead), `git commit --no-verify`.

## CI

`.github/workflows/ci.yml` splits the work into **three parallel
jobs**, each appearing as a separate check on the PR — so a
reviewer can immediately see whether the failure is a code-
quality issue, an end-to-end regression, or a perf budget
breach without scrolling through one mega-job's log.

### Job 1 — verify (fast path, ~3 min)

1. `npm ci` (install)
2. `npx tsc --noEmit` (typecheck)
3. `npm run lint` (eslint, 0 warnings tolerated)
4. `npm test -- --coverage` (Vitest with v8 coverage)
5. `npm run build` (Next.js production build)
6. Upload `.next/` as a workflow artifact for downstream jobs
7. Upload coverage to Codecov

### Job 2 — e2e (`smoke` · `visual` · `a11y` · `pwa`, ~5 min)

Depends on **verify** (downloads its build artifact). Runs the
full Playwright suite — four spec files, 20 tests total:

- `smoke.spec.ts` — golden-path HTTP + content rendering +
  hydration-mismatch regression.
- `visual.spec.ts` — full-page screenshot diffs against
  committed baselines (`e2e/__screenshots__/`). Linux baselines
  match `ubuntu-latest`'s rasterizer.
- `a11y.spec.ts` — axe-core scans + WCAG 2.x A/AA
  assertions on critical + serious impact. Minor / moderate
  violations attach as an artifact for tracking.
- `pwa.spec.ts` — installability surface: manifest fields,
  maskable icon presence, theme-color + viewport meta, iOS
  status-bar config. Fills the gap left by Lighthouse 12
  dropping the PWA category in 2024.

Failed runs upload the Playwright HTML report + traces as a
workflow artifact for off-line debugging.

### Job 3 — lighthouse (perf · a11y · best-practices · seo, ~3 min)

Depends on **verify**. Runs Lighthouse CI three times per URL
across `/`, `/review`, `/security` and asserts median scores:

- Category floors: performance ≥ 0.90, accessibility ≥ 0.95,
  best-practices ≥ 0.95, SEO ≥ 0.90.
- Web Vitals: LCP ≤ 2.5s, CLS ≤ 0.05, TBT ≤ 500ms.

The report uploads to Lighthouse's temporary public storage so
the workflow log contains a viewer link.

Total wall-clock across the three jobs: ~6 min (they run in
parallel after `verify` completes). Any job failure blocks
merge.
