/**
 * End-to-end smoke tests — golden paths through the running app.
 *
 * These tests catch what the in-process tests can't:
 *   - Build-time errors that crash `next build`.
 *   - HTTP-level routing breakage (a page that 500s on the server).
 *   - Fully-rendered pages with content (the "white-screen on
 *     prod" class of regression).
 *
 * The set is intentionally small (~6 tests, ~30s wall-clock in
 * CI). Component-level UI logic is covered by RTL tests
 * (app/_components/*.test.tsx); these E2E tests catch the
 * integration + routing + build-time bugs the in-process tests
 * can't.
 *
 * The hydration-mismatch fix landed (NetWorthCard live-time
 * chip + QuickStart locale-pinning + Intl.NumberFormat compact
 * notation with explicit min/max fractional digits) — the
 * dedicated regression test at the bottom guards against
 * regression.
 */

import { test, expect, type Page } from "@playwright/test";

async function attachErrorListener(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test("home page loads + renders content", async ({ page }) => {
  const errors = await attachErrorListener(page);
  const response = await page.goto("/");
  // The server didn't crash — first-line defense against build
  // regressions that ship a page that 500s on first request.
  expect(response?.status()).toBe(200);
  // The page has user-visible content rather than a blank
  // white screen. 200 chars threshold catches both "empty
  // body" and "just the loading spinner".
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.length).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test("home page renders a dollar-formatted figure (store hydrated)", async ({
  page,
}) => {
  await page.goto("/");
  // Demo household ships with non-zero NW. After client hydration
  // the dashboard renders at least one $-formatted number.
  // Generous timeout — IndexedDB + Zustand hydration can take a
  // beat. If the user reloaded into a blank dashboard, this is
  // the test that catches it.
  await expect(page.locator("text=/\\$[0-9,]+/").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("review page returns 200 and renders substantial content", async ({
  page,
}) => {
  const response = await page.goto("/review");
  expect(response?.status()).toBe(200);
  const text = await page.locator("body").innerText();
  // Review page is the printable annual review — by design it
  // renders many sections of generated content. ≥ 500 chars is
  // a non-vacuous "the page worked" check.
  expect(text.length).toBeGreaterThan(500);
});

test("security page returns 200", async ({ page }) => {
  // /security holds the privacy + security disclosure. Mostly
  // static markdown-rendered content; we just confirm it builds
  // + serves without crashing.
  const response = await page.goto("/security");
  expect(response?.status()).toBe(200);
});

test("non-existent route returns 404 (not 500)", async ({ page }) => {
  // A 500 here would indicate the catch-all routing crashed.
  // 404 is the correct fail-soft behavior — Next.js renders
  // app/not-found or the framework default.
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
});

test("home page exposes interactive navigation after hydration", async ({
  page,
}) => {
  await page.goto("/");
  // Note: we deliberately don't `waitForLoadState("networkidle")`
  // here — the app's CloudSyncer + PriceRefresher + ServiceWorker
  // keep the network "active" past the 500ms idle threshold on
  // slower CI runners, and Playwright's own docs discourage
  // networkidle for this exact reason. Instead rely on the
  // web-first assertion below to auto-wait.
  //
  // The shell navigation is built from <button> elements (the
  // page tab strip), not <a href> links. Asserting on buttons
  // catches a no-nav regression while staying agnostic to the
  // label strings (which evolve).
  const buttons = page.getByRole("button");
  // At least three nav-like interactive elements visible — the
  // tab strip alone has more than that. The 4th-button locator
  // auto-waits up to the test timeout, so we don't need an
  // explicit waitForLoadState.
  await expect(buttons.nth(3)).toBeVisible({ timeout: 15_000 });
});

test("no hydration mismatch on initial load (React #418)", async ({ page }) => {
  // Hydration mismatch is a fail-loud bug in production: the
  // server-rendered HTML doesn't match the first client render,
  // forcing React to throw away the SSR work and re-render
  // client-side. Cost is correctness (UI flickers) AND
  // performance (lost FCP). Pin the regression at the test
  // boundary so this can't silently come back.
  const fatal: string[] = [];
  const hydration: string[] = [];
  page.on("pageerror", (err) => {
    if (err.message.includes("Hydration") || err.message.includes("#418"))
      hydration.push(err.message);
    else fatal.push(err.message);
  });
  await page.goto("/", { waitUntil: "load" });
  // Hydration errors fire during the first React render + commit,
  // which happens before window.load. A small explicit settle
  // gives the browser time to surface any error to pageerror
  // (some browsers batch microtasks differently). Avoiding
  // `networkidle` here — see the nav test for why.
  await page.waitForTimeout(2_000);
  expect(hydration).toEqual([]);
  expect(fatal).toEqual([]);
});
