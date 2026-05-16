/**
 * Visual regression suite.
 *
 * Each test takes a deterministic screenshot of a built page +
 * compares against the committed baseline in
 * `e2e/__screenshots__/`. A pixel diff above the threshold
 * fails the test and the diff image is uploaded as a CI artifact.
 *
 * Strategy:
 *   - Run on a fixed viewport so screenshot dimensions match
 *     across machines.
 *   - Disable CSS animations + transitions so a captured frame
 *     is stable mid-animation. Playwright's
 *     `screenshot({ animations: "disabled" })` is the canonical
 *     knob; we set it via `expect(page).toHaveScreenshot(...)`.
 *   - Mask demonstrably volatile content (timestamps that depend
 *     on `now`, browser locale formatting that varies between
 *     Node + browser even after the recent hydration fix). The
 *     mask painter draws a solid color over the masked region
 *     so the diff ignores it.
 *
 * Maintenance: when a UI change is intentional, run
 * `npx playwright test --update-snapshots e2e/visual.spec.ts`
 * locally + commit the new baseline images. Cross-platform
 * font / rasterizer differences are tracked via the snapshot
 * path (chromium-linux for Linux CI; Playwright auto-derives
 * the name based on the runtime). We commit the linux baseline
 * since CI is ubuntu-latest.
 *
 * Why this layer matters: CSS regressions, layout shifts, and
 * accidentally-clipped content show up here when they would
 * pass every other check. The cost is small (~4s in CI for
 * the snapshot suite) and the catch rate on real visual bugs
 * is high.
 */

import { test, expect } from "@playwright/test";

// Stable viewport — most users hit the app on a desktop or a
// large phone. 390x844 is roughly iPhone 14 Pro; 1280x800 is a
// laptop. We snapshot the mobile viewport because the app is
// designed mobile-first (max-w-md on every page); desktop is
// effectively the same content padded.
test.use({ viewport: { width: 390, height: 844 } });

/**
 * Locators for volatile DOM that must not feed into the
 * snapshot diff. Each must be a real CSS selector — Playwright's
 * mask painter draws a solid pink (#FF00FF default) over each
 * matched bounding box before comparing pixels.
 *
 *   - The "Live · Nm ago" chip in NetWorthCard renders a
 *     relative timestamp after hydration. The minute granularity
 *     means a test that takes 60s to spin up could capture a
 *     different string than the baseline.
 *   - GoogleSyncCard's "Last sync Nm ago" — same pattern, gated
 *     behind sign-in so only fires after auth flow.
 */
const VOLATILE_SELECTORS = [
  "text=/Live · .+ ago/",
  "text=/Last sync .+ ago/",
];

/**
 * Take a stable screenshot of a page, suitable for committing
 * as a regression baseline. Wraps the common options into one
 * helper so each test stays focused on WHICH page + WHAT we're
 * pinning, not the screenshot mechanics.
 *
 * `fullPage` defaults to false (viewport-only). The home
 * dashboard scrolls for several screens; cumulative line-height
 * drift between rendering environments adds up to a multi-pixel
 * dimension mismatch on full-page captures, which Playwright
 * fails outright (dimension mismatch short-circuits before
 * pixel-ratio tolerance applies). Above-the-fold catches the
 * regressions that matter — the cards, chart, and primary nav
 * — and is stable across envs. Static content pages (/review,
 * /security) can safely use fullPage since their height is
 * short + deterministic.
 */
async function snapshotPage(
  page: import("@playwright/test").Page,
  name: string,
  opts: { fullPage?: boolean } = {},
) {
  await expect(page).toHaveScreenshot(name, {
    fullPage: opts.fullPage ?? false,
    animations: "disabled",
    caret: "hide",
    mask: VOLATILE_SELECTORS.map((s) => page.locator(s)),
    // Pixel-diff tolerance — set to absorb font-hinting +
    // antialiasing drift between developer sandboxes and the
    // ubuntu-latest CI runner. Structural regressions (layout
    // shifts, missing components, color changes) still diff
    // well above this floor, so the detection signal stays
    // useful. A precise visual-regression tool would docker-pin
    // the rendering env (Percy / Chromatic / a fixed Playwright
    // docker image) — 0.10 is the right pragmatic floor until
    // we adopt one.
    maxDiffPixelRatio: 0.1,
  });
}

test("home page — visual snapshot of the above-the-fold dashboard", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  // Wait for the demo NW figure to render so the snapshot
  // includes the populated dashboard, not the loading state.
  await expect(page.locator("text=/\\$[0-9,]+/").first()).toBeVisible({
    timeout: 15_000,
  });
  // Tiny extra settle for any post-hydration paint to finalize.
  await page.waitForTimeout(500);
  // Viewport-only on the home page (see snapshotPage doc).
  await snapshotPage(page, "home.png");
});

test("review page — visual snapshot of the printable annual review", async ({
  page,
}) => {
  await page.goto("/review", { waitUntil: "load" });
  // The review page is content-heavy and largely static — no
  // store hydration to wait for. The body length floor matches
  // the smoke test's content check.
  const body = await page.locator("body").innerText();
  expect(body.length).toBeGreaterThan(500);
  await page.waitForTimeout(500);
  // Viewport-only. Same rationale as home.png: full-page captures
  // on text-heavy pages drift cumulatively between rendering
  // environments — fonts wrap to different line counts on
  // ubuntu-latest vs developer sandboxes even at the same
  // Chromium build, leading to Playwright dimension-mismatch
  // failures that aren't reachable via the maxDiffPixelRatio
  // tolerance. Above-the-fold catches the regressions that
  // matter (printable header, summary cards) and is stable
  // across envs.
  await snapshotPage(page, "review.png");
});

test("security page — visual snapshot of the privacy + security disclosure", async ({
  page,
}) => {
  await page.goto("/security", { waitUntil: "load" });
  await page.waitForTimeout(500);
  // Viewport-only — same rationale as /review above. The
  // /security page is wall-to-wall text with code blocks
  // (PBKDF2-HMAC-SHA-256, AES-256-GCM, etc.); cumulative
  // line-height drift on full-page was ~120px between local
  // and CI rendering even when no content changed, plus 8px
  // jitter BETWEEN consecutive CI retries. Viewport-only
  // eliminates both failure modes and pins the page's visual
  // identity (the part the user sees first).
  await snapshotPage(page, "security.png");
});
