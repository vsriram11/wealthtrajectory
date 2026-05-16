/**
 * Playwright config for *marketing* screenshot + video capture.
 *
 * Separate from playwright.config.ts (which runs the e2e suite) so
 * marketing captures don't pollute the smoke / visual-regression runs.
 *
 *   npm run screenshots         → captures to docs/screenshots/
 *   npm run screenshots:videos  → captures + records WebM to docs/videos/
 *
 * Mobile-first viewport (375 × 812) because the app is built mobile-first
 * (`max-w-md` ≈ 448px). At desktop widths the layout renders as a
 * centered narrow column with whitespace on either side — not a flattering
 * marketing shot. The mobile viewport reflects how the app is meant to be used.
 *
 * Output formats:
 *   PNG  — lossless, retina-friendly. Optimization done in the spec via
 *          sharp (no pngquant available in this env).
 *   WebM — Playwright's native video format. `<video controls>` in
 *          modern browsers supports pause/scrub the same as MP4, so we
 *          don't need ffmpeg-based MP4 conversion.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RECORD_VIDEO = process.env.RECORD_VIDEO === "1";

// Mobile viewport — the app is mobile-first (max-w-md ≈ 448px), so we
// shoot at a phone size. Use Chromium with a manual mobile viewport
// rather than the iPhone 13 preset (which forces WebKit and adds an
// install dependency we don't need for marketing screenshots).
const MOBILE_VIEWPORT = { width: 390, height: 844 };

export default defineConfig({
  testDir: "./e2e/screenshots",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  // The comprehensive tour covers a multi-section walkthrough with
  // slow pacing, multiple feature flows, title cards, and animated
  // cursor moves. Test wall-clock is ~3-4 minutes — give it generous
  // headroom so slow hydration or a chart paint doesn't tip it over.
  timeout: 720_000,

  projects: [
    {
      name: "chromium-mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: MOBILE_VIEWPORT,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  use: {
    baseURL: BASE_URL,
    video: RECORD_VIDEO ? { mode: "on", size: MOBILE_VIEWPORT } : "off",
  },

  webServer: {
    // Marketing captures use the production build for stability —
    // dev-mode HMR can introduce visual artifacts (devtools overlay,
    // hydration flashes) that we don't want frozen into a PNG.
    command: `PORT=${PORT} npm run start`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
  },
});
