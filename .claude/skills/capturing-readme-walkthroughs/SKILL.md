---
name: capturing-readme-walkthroughs
description: Use when the user asks to regenerate the README's comprehensive tour video, add a new feature flow to that tour, refresh it after a UI change, or otherwise work with the Playwright capture pipeline. Produces one animated WebP (~1-2 MB) that inline-renders on GitHub README + a WebM source file. Covers when to regenerate (which UI changes drift the capture), how to add a new feature flow section, and the pacing pattern that makes the video read well. Skip for general Playwright work (smoke tests, visual regression, e2e flows) — those live under e2e/ separately.
---

# Capturing README walkthroughs and feature demos

The full architecture + portable adaptation guide lives in [`docs/Screenshots.md`](../../docs/Screenshots.md). **Read that first** for the why and the reusable pattern. This skill covers the *agent workflow* — when to invoke the pipeline, how to add a demo, what can go wrong.

## When to use this skill

- "Regenerate the README walkthroughs / videos / screenshots"
- "The home dashboard demo is stale — re-record it"
- "Add a per-feature demo for the new <X> flow"
- "The tour video got a gray-space artifact after the layout change"
- "I shipped a UI change — refresh the marketing assets" (proactive — flag this when you ship a feature whose UI surface area appears in the README assets)

Skip for: smoke tests, visual regression, e2e flows. Those are the main `playwright.config.ts` suite under `e2e/` (everything outside `e2e/screenshots/`).

## The one-shot command

```bash
npm run build && npm run screenshots:videos
```

- `npm run build` ensures the production server has the latest UI (the spec uses `npm run start`, not `npm run dev`, for stable visual frames).
- `npm run screenshots:videos` runs both specs (per-page PNGs from `screenshots.spec.ts`, comprehensive tour from `tour.spec.ts`), then converts the tour's WebM into an animated WebP via ffmpeg.
- Output lands in `docs/screenshots/` (PNGs) and `docs/videos/comprehensive-tour.{webm,webp}`.

For PNGs only (faster — skip the video pass):
```bash
npm run build && npm run screenshots
```

## When to regenerate — which UI changes drift which captures

| UI change | What you must regenerate |
|---|---|
| Anything visible in the tour video | The whole pipeline — `npm run build && npm run screenshots:videos` (since the tour is one big asset, partial regeneration isn't possible) |
| Demo data (`lib/demo.ts`: household, assumptions, income streams, **budget**) | Everything (changes what numbers + items appear in captures) |
| Nav drawer / hamburger layout | Everything (the tour uses the drawer to navigate between sections) |

The tour covers every key interactive flow: member management (add + exclude-from-rollup cascade), add-account (Trump Account category + hint copy), per-holding CAGR + style-box decomposition + multi-asset composition enable/disable, allocation time-travel (slider + Apply above), Projections / Stress / Historical Monte Carlo mode toggle, Plan withdrawal-rate edit → back to Projections to see MC shift, drawdown phase edit, scenarios (LeverageOutPerformance / TQQQ CAGR override → home chip selection), budget subscriptions tab + apply-to-target, Data page export/import slow-scroll. Any UI change touching one of those drifts the asset. **Heuristic**: if you're not sure whether a change drifts the capture, regenerate.

## File layout

```
e2e/screenshots/
  helpers.ts                # shared hydration / scroll / nav / cursor / title-card helpers
  screenshots.spec.ts       # per-page PNGs, video: 'off'
  tour.spec.ts              # comprehensive walkthrough, video: 'on'

playwright.screenshots.config.ts   # separate Playwright config
scripts/move-screenshot-videos.mjs # post-process: flatten test-results + WebM→WebP
```

Spec-to-output mapping (key fact when debugging):

| Spec file | Test name | Output file (after move script) |
|---|---|---|
| `tour.spec.ts` | `comprehensive tour` | `docs/videos/comprehensive-tour.{webm,webp}` |
| `screenshots.spec.ts` | `per-page screenshots` | `docs/screenshots/0N-<page>.png` (no video) |

The tour spec produces one ~90s walkthrough that combines the page overview + all four feature flows (per-asset CAGR + multi-asset composition, drawdown-phase edit, budget apply, rollup cascade), separated by black title cards with white text via `titleCard()` from helpers.

## Adding a new feature flow to the tour

Each section of the comprehensive tour lives between two `titleCard()` calls in `tour.spec.ts`. To add another:

1. **Discover the UI selectors first.** Find: (a) the trigger element the user clicks to start the flow, (b) the editable control, (c) what visible value changes when the edit succeeds. Use `getByRole("button", { name: "..." })` or `getByLabel("...")` — these survive UI refactors better than CSS selectors.
2. **Add a section to `e2e/screenshots/tour.spec.ts`** following the existing 5-step pattern: title card → navigate → hold for BEFORE state → interact → hold for AFTER state → (optionally) reset for clean transition to next section.
3. **Use `moveAndClick(page, locator)` for every click that should show cursor motion** in the video. `locator.click()` teleports the mouse and looks instant; `moveAndClick` animates a fake cursor (red dot) to the target so the viewer can follow.
4. **Pacing** (the part that makes or breaks the demo):
   - Title card: **2.5 s** hold (longer for opening / closing cards).
   - Brief hold before the interaction: **~1.5–2 s** (viewer needs context).
   - After opening a modal: **1.5–2.2 s** (slide-in + reading time).
   - For visually impactful clicks (e.g. enabling a feature), use `moveAndClick(page, locator, { steps: 50, hoverMs: 900 })` for a slower cursor approach.
   - After a value change: **1.5–2 s** (state propagation + chart paint).
   - After the section's final action: **at least 1.5 s** before the next title card.
5. **Watch the file-size budget.** The comprehensive tour aims for **≤ 1 MB total WebP**. Each additional section adds ~15-30 s of motion, which adds ~150-300 KB to the WebP at the current encoder settings (fps=6, scale=300, quality=28). Above ~10 MB GitHub may not inline-render reliably; tighten the encoder if you push past that.
6. **Run the spec**: `npm run build && npm run screenshots:videos`. Watch the output WebP 2-3 times to verify the auto-loop reads coherently.

## What to watch out for (gotchas in this codebase)

- **Holdings are nested inside expandable account cards** on the Accounts page. To click a holding (e.g. VTI), you must first click the account row (`Alex 401(k)`). The CAGR flow expands the account row before clicking VTI.
- **MembersSheet renders one switch per member**, all with the same accessible name `"Include in household rollups"`. Use `.nth(1)` to target the second member (keep the primary's data intact so household totals stay valid).
- **Hydration signal is `text=/\$[0-9,]+/`** (waiting for any $-formatted figure). For pages without dollar values, fall back to a known label.
- **Chart paint is slower than hydration.** `waitForHydration()` in `helpers.ts` already waits for a chart/canvas/svg to be visible after the $ figure — don't skip this or the first scroll-tour frames capture a half-rendered state.
- **`fullPage: true` screenshots inside a video-recording test cause a viewport resize-reset cycle** that appears in the video as a gray-space artifact. That's why screenshots live in their own spec with `video: 'off'` — never mix them with video-recording tests.
- **The comprehensive tour test takes ~90 s** and `playwright.screenshots.config.ts` sets `timeout: 180_000` to give it headroom. If you add another feature flow, monitor against the timeout.
- **The fake cursor is injected via `injectCursor()`** — call it once after `page.goto()`. Otherwise `moveAndClick` will animate the mouse but the video won't show the cursor.

## When a regeneration fails

| Symptom | Cause + fix |
|---|---|
| Test times out finding a button | UI selector drifted. Use `npx playwright test --config=playwright.screenshots.config.ts -g "<test name>" --debug` to step through and find the right selector. |
| WebP file is huge (>3 MB for a single short demo) | Encoder defaults are tuned in `scripts/move-screenshot-videos.mjs`. For longer/larger files, drop fps (`fps=6`) or scale (`scale=280`) or quality (`quality=30`) in that script. |
| Tour video has gray space / weird viewport jump | Almost always a fullPage screenshot called inside the tour spec. Move it out to `screenshots.spec.ts` (video off). |
| Move script doesn't process the videos | Playwright exited non-zero (a test failed), so the `&&` short-circuited. Fix the failing test, then either re-run the whole pipeline or run `node scripts/move-screenshot-videos.mjs` manually to process what's already in `test-results/`. |
| ffmpeg "not found" | Run `npm install` — `@ffmpeg-installer/ffmpeg` is a dev dep that ships the binary. |

## Anti-patterns

- **Running `screenshots:videos` from `npm run dev` server.** The spec spawns its own production server on port 3001. Dev mode introduces HMR overlays + hydration flashes that shouldn't be frozen into a marketing asset.
- **Eyeballing scroll smoothness without watching the WebP loop 2–3 times.** Auto-looping content reveals jitter that's invisible on a single play.
- **Adding a demo without resetting to baseline for the loop.** A WebP that ends in a different state than it started produces a confusing "reset jump" every loop.
- **Committing the WebM but not the WebP** (or vice versa). The README references the WebP; the WebM is the source-of-truth + future upload candidate. Both belong in the commit.
- **Forgetting to regenerate after demo-data changes.** `lib/demo.ts` drives every number the user sees in captures. A change there silently invalidates all captures.

## Related artifacts

- [`docs/Screenshots.md`](../../docs/Screenshots.md) — full architectural guide + how to adapt this pattern to a different repo
- [`playwright.screenshots.config.ts`](../../playwright.screenshots.config.ts) — the separate Playwright config
- [`e2e/screenshots/`](../../e2e/screenshots/) — the three spec files + shared helpers
- [`scripts/move-screenshot-videos.mjs`](../../scripts/move-screenshot-videos.mjs) — post-processor for flattening + WebP encoding
