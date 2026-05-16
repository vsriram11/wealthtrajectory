/**
 * Playwright config for end-to-end smoke tests.
 *
 * The suite is intentionally small (5-7 tests, ~60s total) and
 * focused on golden paths: load demo, render dashboards, exercise
 * the trickier integration boundaries (Monte Carlo, scenario
 * compare, budget → corpus math). Component-level UI logic is
 * covered by the RTL component tests under app/_components/*.test.tsx;
 * Playwright catches the integration + routing + build-time bugs
 * the in-process tests can't.
 *
 * Browser binaries are auto-downloaded by `playwright install`.
 * In CI we install chromium-headless-shell (smaller than full
 * chromium, fine for smoke tests).
 *
 * Docs: https://playwright.dev/docs/test-configuration
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Marketing screenshot/video specs live under e2e/screenshots/ and use
  // a separate config (playwright.screenshots.config.ts) — exclude them
  // from the main smoke / visual-regression run.
  testIgnore: ["**/screenshots/**"],
  // CI gets full parallelism; locally we serialize to keep the
  // single dev server happy.
  fullyParallel: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",

  use: {
    baseURL: BASE_URL,
    // Trace on first retry — keeps trace overhead off the happy
    // path but gives us a debuggable record when something flakes.
    trace: "on-first-retry",
    // Screenshot on failure so CI artifacts contain a visual
    // pin of what the user would have seen.
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the production preview server on demand. We use `next
  // build && next start` (via `npm run build && npm run start`)
  // rather than the dev server because:
  //   1. Smoke tests should validate the BUILT app, not a hot-
  //      reload variant that diverges in subtle ways.
  //   2. The dev server's first-render compile pauses cause
  //      flaky timeouts on the first test.
  //
  // reuseExistingServer keeps local iteration fast — if you've
  // already got the app running, Playwright skips the spin-up.
  webServer: {
    command: process.env.CI
      ? `npm run start -- --port ${PORT}`
      : `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
