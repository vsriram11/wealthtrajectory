/**
 * PWA installability suite — fills the gap left by Lighthouse
 * 12 dropping the PWA category + its individual audits.
 *
 * The app ships full PWA infrastructure (service worker, web
 * manifest, themed status bar, apple-touch-icon, maskable
 * icons) but as of Lighthouse 12 (2024) there's no first-class
 * tool that asserts on it. These Playwright tests pin the
 * regression boundary:
 *
 *   - manifest.webmanifest is reachable + has the install-
 *     critical fields (name, start_url, icons, display).
 *   - At least one maskable icon is declared (Android adaptive-
 *     icon support — bad without it).
 *   - theme-color + viewport meta tags are in the HTML head
 *     (Android themed omnibox + correct mobile rendering).
 *   - apple-touch-icon route returns a PNG (iOS home-screen
 *     install affordance).
 *
 * What we DON'T test here:
 *   - Service worker registration in production — the Service-
 *     WorkerRegistrar component is gated behind window.isSecureContext
 *     and a few other client-only checks; mocking that in a unit
 *     test is more brittle than testing the route itself, which
 *     the smoke suite already does.
 */

import { test, expect } from "@playwright/test";

test("manifest.webmanifest is served + has the install-critical fields", async ({
  request,
}) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const body = await res.json();
  // Each field below is required by the Web App Manifest spec
  // for the OS to offer the install UI. A regression dropping
  // any of these would silently remove the "Add to Home Screen"
  // prompt on iOS + Android without breaking any other test.
  expect(typeof body.name).toBe("string");
  expect(body.name.length).toBeGreaterThan(0);
  expect(typeof body.start_url).toBe("string");
  expect(body.start_url.length).toBeGreaterThan(0);
  expect(["standalone", "fullscreen", "minimal-ui"]).toContain(body.display);
  expect(Array.isArray(body.icons)).toBe(true);
  expect(body.icons.length).toBeGreaterThan(0);
});

test("manifest declares at least one maskable icon (Android adaptive)", async ({
  request,
}) => {
  const res = await request.get("/manifest.webmanifest");
  const body = await res.json();
  // Android Chrome uses `purpose: maskable` icons for the
  // adaptive-icon system (the OS clips them to the user's
  // chosen shape). A manifest with only `purpose: any` icons
  // renders as the default rounded-square — looks broken next
  // to native apps.
  const hasMaskable = body.icons.some(
    (icon: { purpose?: string }) =>
      typeof icon.purpose === "string" && icon.purpose.includes("maskable"),
  );
  expect(hasMaskable).toBe(true);
});

test("home page exposes theme-color + viewport meta tags", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  // theme-color: Android Chrome tints the omnibox / status bar.
  // Without it, the address bar stays its default light gray
  // and the chrome looks unfinished in a PWA install.
  const themeColor = await page
    .locator('meta[name="theme-color"]')
    .first()
    .getAttribute("content");
  expect(themeColor).toMatch(/^#[0-9a-fA-F]{3,8}$/);

  // viewport: required for mobile rendering. Missing this
  // makes mobile browsers render at desktop width and zoom out.
  const viewport = await page
    .locator('meta[name="viewport"]')
    .first()
    .getAttribute("content");
  expect(viewport).toContain("width=device-width");
});

test("apple-touch-icon route returns a PNG", async ({ request }) => {
  // iOS uses /apple-touch-icon for the home-screen install
  // icon. Next.js generates this from app/apple-icon. The
  // smoke test confirms the route is 200; here we confirm the
  // payload is actually a PNG (the canonical iOS icon format).
  const res = await request.get("/apple-icon");
  expect(res.status()).toBe(200);
  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType.toLowerCase()).toContain("image/png");
});

test("favicon route returns a PNG", async ({ request }) => {
  // Browser tab favicon. Next.js generates from app/icon.
  const res = await request.get("/icon");
  expect(res.status()).toBe(200);
  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType.toLowerCase()).toContain("image/png");
});

test("home page wires a status-bar style + app-capable meta for PWA installs", async ({
  page,
}) => {
  // Read the SSR HTML directly. <meta> elements aren't visible,
  // so the standard page.locator(...).getAttribute call hits a
  // visibility-wait timeout. Pulling raw HTML + regex-matching
  // is more reliable for head-only assertions.
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  const html = (await response?.text()) ?? "";

  // Next.js 16 emits the spec-name `mobile-web-app-capable`
  // (Chrome, Edge, Safari ≥ 16.4 all support it; replaces the
  // legacy `apple-mobile-web-app-capable`). Without this meta,
  // the install banner won't surface on Android and Safari's
  // chrome won't hide on iOS standalone launches.
  expect(html).toMatch(
    /<meta name="mobile-web-app-capable" content="yes"\s*\/?>/i,
  );

  // iOS-only status-bar style. "black-translucent" matches the
  // dark theme; "default" or "black" would also be valid choices.
  // Pin to the documented set to catch a regression that emptied
  // the tag.
  const statusMatch = html.match(
    /<meta name="apple-mobile-web-app-status-bar-style" content="([^"]+)"/i,
  );
  expect(statusMatch).not.toBeNull();
  expect(["default", "black", "black-translucent"]).toContain(
    statusMatch![1],
  );

  // The web-app-title controls the home-screen icon label. Empty
  // would fall back to the page <title>, which is fine, but
  // explicitly setting it produces a cleaner install affordance.
  expect(html).toMatch(
    /<meta name="apple-mobile-web-app-title" content="[^"]+"/i,
  );
});
