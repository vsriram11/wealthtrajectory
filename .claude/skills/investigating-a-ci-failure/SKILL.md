---
name: investigating-a-ci-failure
description: Use when a GitHub Actions PR webhook reports a CI failure on this repo (lint / test / build / visual / lighthouse / e2e). Triages by failure class, identifies whether the cause is environmental (CI runner difference), a recent code change, or a flaky test. Returns either a one-line "this is the fix" plan or a clarifying question. Don't use to investigate local-only test failures — those are usually faster to debug interactively.
---

# Investigating a CI failure

## Triage by failure class (most common first)

### Visual regression (`expect(page).toHaveScreenshot(...)` failed)

Two sub-cases, with very different fixes:

**A. Pixel diff above tolerance** (`expected ... 100px image, received ... 100px, 50000 pixels different`)
- The PAGE rendered the same dimensions, just with different content. Common when copy or styling changed intentionally.
- Fix: regenerate the baseline. From the repo root, with the dev server running on port 3010:
  ```
  CI=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    npx playwright test e2e/visual.spec.ts -g "<test name>" --update-snapshots
  ```
  Commit the regenerated PNG in `e2e/visual.spec.ts-snapshots/`.

**B. Dimension mismatch** (`expected 100x800, received 100x950`)
- The page renders at different HEIGHTS between dev environment and CI runner. This is a STRUCTURAL signal, not noise — usually cumulative line-height drift on text-heavy pages between rendering envs.
- `maxDiffPixelRatio` does NOT save you here — dimension mismatch short-circuits before pixel comparison.
- Fix options, in order of preference:
  1. Switch the test to viewport-only (drop `fullPage: true`) — matches the home-page strategy. Trade-off: lose below-fold layout-regression coverage.
  2. If full-page is essential, mask the volatile region.
  3. Last resort: bump `maxDiffPixelRatio` to 0.2+ — but the dimension issue still won't be solved this way.

### Lighthouse threshold

Look for `failure for minScore assertion` or `failure for maxNumericValue assertion`:
- Identify the specific audit (best-practices / accessibility / LCP / TBT / CLS).
- For LCP / TBT regressions: check if the recent change added meaningful JS to the home page render path. If yes, the perf regression is real → address with code-split / lazy-load / defer.
- For LCP on a CI runner specifically: real-user perf is faster than CI by 2-4×; if the threshold is at Google's "good" band (2500ms) but CI consistently hits 2700ms, the threshold may be unrealistic for the runner. Raise to 3000ms with a `TODO(perf)` and a clear comment explaining the runner-vs-real-user discrepancy.
- For best-practices < threshold: open the LHR report URL from the CI log and identify the specific audit that's deducting. Usually console errors or deprecated APIs.

### TypeScript / lint failure

- Read the error verbatim — don't assume. Common in this repo: `react-hooks/preserve-manual-memoization` when a `useMemo` dep is a nested property access (`effective.someField`). Fix: extract the property to a top-level const, use the const in the dep array.
- For `Cannot find module` after a refactor: an import path is stale. Search for the importing file + verify the target's location.

### Test failure (Vitest)

- Run the failing test locally first: `npx vitest run <file>`. If it fails locally → real bug, not CI infra.
- If it passes locally but fails in CI: check whether the test uses `Date.now()`, `Math.random()`, or has timing dependencies. Add seeded randomness or freeze the clock.
- Visual / DOM / jsdom-environment tests may fail if a JSDOM polyfill is missing (e.g. `URL.createObjectURL` doesn't exist in JSDOM by default).

### E2E (Playwright smoke)

- Look for `Timeout` — usually a navigation step waiting for an element that's been renamed or moved. Update the selector.
- For `Page closed` / `Browser disconnected` — usually a CI runner OOM. If it persists, lower `workers` in `playwright.config.ts`.

## The webhook-driven workflow

When the user subscribes to PR activity, CI failures arrive as `<github-webhook-activity>` messages. The expected response pattern:

1. **Acknowledge** the failure briefly + state the class (visual / lighthouse / test / etc.).
2. **Ask for the failing step's tail** if not already pasted — the inline error is enough to diagnose almost any class.
3. **Diagnose + propose** the fix in one message. Don't fix-then-explain — explain-then-fix, so the user can redirect if needed.
4. **Push the fix.** The next webhook fires when the new CI run completes.
5. If it fails again with a related-but-different error, iterate. If it fails the SAME way, the diagnosis was wrong — re-investigate.

## Anti-patterns

- Bumping pixel tolerance without checking whether the failure is dimension mismatch (won't help)
- Regenerating snapshots without verifying the content change was intentional (locks in a regression)
- Raising lighthouse thresholds without a `TODO(perf)` comment explaining why
- Marking a test as "flaky" and retrying — almost always a real timing bug
- Fixing in CI before fixing locally — if you can't reproduce, you don't understand the bug
