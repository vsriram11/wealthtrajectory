/**
 * Shared helpers for the two marketing-capture specs:
 *   screenshots.spec.ts — produces per-page PNGs (video off)
 *   tour.spec.ts        — produces the comprehensive walkthrough WebM/WebP (video on)
 *
 * Kept here so the two files can't drift apart on hydration / pacing /
 * navigation logic — both must locate pages and wait for the same
 * settle signals.
 *
 * Three things this file makes possible that vanilla Playwright video
 * recording does NOT:
 *
 *   1. Fake-cursor rendering.  Playwright's recorded video does not
 *      show the OS cursor. injectCursor() adds a CSS dot to the page
 *      that follows mousemove events — when we drive the mouse via
 *      page.mouse.move(...), the dot moves with it and shows up in
 *      the video so the viewer can follow clicks.
 *
 *   2. Title cards.  titleCard() injects a black full-screen overlay
 *      with white text for a few seconds, then removes it. Gives the
 *      viewer mental separation between demo sections.
 *
 *   3. Animated moveAndClick().  page.locator().click() teleports the
 *      mouse to the target without an animated path. moveAndClick()
 *      animates page.mouse.move() in N steps before clicking, so the
 *      fake cursor traces a visible path between elements.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const PAGES: { file: string; nav: string | null }[] = [
  { file: "01-home-dashboard", nav: null },
  { file: "02-accounts", nav: "Accounts" },
  { file: "03-allocation", nav: "Allocation" },
  { file: "04-projections", nav: "Projections" },
  { file: "05-plan", nav: "Plan" },
  { file: "06-data", nav: "Data" },
];

/**
 * Inject a fake CSS cursor + a global mousemove listener that follows
 * Playwright's synthetic mouse events. Call once after page.goto().
 */
export async function injectCursor(page: Page) {
  await page.addInitScript(() => {
    function attach() {
      if (document.getElementById("pw-cursor")) return;
      const cursor = document.createElement("div");
      cursor.id = "pw-cursor";
      cursor.style.cssText = [
        "position:fixed",
        "left:0",
        "top:0",
        "width:18px",
        "height:18px",
        "background:rgba(255,80,80,0.85)",
        "border:2px solid rgba(255,255,255,0.95)",
        "border-radius:50%",
        "pointer-events:none",
        "z-index:2147483647",
        "transform:translate(-50%,-50%)",
        "box-shadow:0 0 8px rgba(0,0,0,0.55)",
        "transition:opacity 0.15s",
        "opacity:0",
      ].join(";");
      document.body.appendChild(cursor);
      document.addEventListener(
        "mousemove",
        (e) => {
          cursor.style.opacity = "1";
          cursor.style.left = e.clientX + "px";
          cursor.style.top = e.clientY + "px";
        },
        true,
      );
    }
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  });
}

/**
 * Animate the fake cursor to the target element, hold briefly so the
 * viewer registers WHICH element is about to be clicked, then click
 * via Playwright's native locator.click().
 *
 * Why hybrid (cursor animation via mouse.move + click via locator):
 *   - mouse.move(x, y, { steps }) drives the fake-cursor div so the
 *     viewer sees the click target being approached. This is the
 *     reason this helper exists in the first place.
 *   - mouse.click(x, y) at fixed coords is unreliable: if the page
 *     reflows between the move and the click (banner appears, sticky
 *     header resizes, modal animates in/out), the click misses. A
 *     prior version of this helper used mouse.click and produced
 *     hard-to-debug "the click did nothing" failures where modals
 *     stayed open or accordions didn't expand.
 *   - locator.click() re-resolves the element's position, auto-
 *     scrolls, retries on actionability failures, and respects
 *     overlay-interception checks. The fake cursor doesn't animate
 *     to a re-resolved position (the cursor stayed where mouse.move
 *     left it), but in practice the move-to-target lands close
 *     enough that the viewer can't tell a click hopped a pixel.
 */
export async function moveAndClick(
  page: Page,
  locator: Locator,
  options: { hoverMs?: number; steps?: number } = {},
) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: options.steps ?? 28 });
    await page.waitForTimeout(options.hoverMs ?? 450);
  }
  await locator.click();
}

/**
 * Drop a full-screen black overlay with white centered text in front
 * of the page for `holdMs`, then remove it. Used between demo sections
 * so the viewer gets a mental break.
 */
export async function titleCard(
  page: Page,
  text: string,
  holdMs = 2500,
) {
  await page.evaluate((t) => {
    const overlay = document.createElement("div");
    overlay.id = "demo-title-card";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:#000",
      "color:#fff",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "font-size:22px",
      "font-weight:500",
      "line-height:1.4",
      "text-align:center",
      "padding:40px",
      "z-index:2147483646",
      "white-space:pre-line",
      "letter-spacing:0.01em",
    ].join(";");
    overlay.textContent = t;
    document.body.appendChild(overlay);
  }, text);
  await page.waitForTimeout(holdMs);
  await page.evaluate(() => {
    document.getElementById("demo-title-card")?.remove();
  });
  // Brief settle after removing so the camera doesn't immediately catch
  // the page mid-mouse-move.
  await page.waitForTimeout(400);
}

export async function waitForHydration(page: Page) {
  // Demo household ships with non-zero NW; wait for at least one
  // $-formatted figure on screen. Same signal the smoke suite uses.
  await expect(page.locator("text=/\\$[0-9,]+/").first()).toBeVisible({
    timeout: 20_000,
  });
  // The dashboard's projection chart paints a canvas/svg that takes
  // longer than the first dollar-figure to settle. Wait for a chart
  // element to be visible before treating the page as ready, with a
  // generous fallback for pages that don't have one.
  const chart = page.locator("canvas, svg.recharts-surface, [role='img']").first();
  await chart.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {
    // No chart on this page — fine, just rely on the settle below.
  });
  // Extra settle so the page is fully laid out before any motion or
  // capture begins. Banners (EncryptionUnlock, GlobalSync, etc.) can
  // paint a beat after hydration and shift layout; without this the
  // first scroll-tour frames sometimes captured a transient state.
  await page.waitForTimeout(1600);
}

/**
 * Smoothly scroll top → bottom over the given duration. 120 eased
 * steps give ~20 steps/sec, comfortably smoother than the WebP's
 * sampling rate. Ease-in-out cubic so the scroll rate looks like a
 * steady pan rather than a constant-speed grind.
 */
export async function tourPage(page: Page, durationMs = 6000) {
  const maxScroll = await page.evaluate(
    () =>
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ) - window.innerHeight,
  );
  if (maxScroll <= 50) {
    await page.waitForTimeout(1500);
    return;
  }
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased =
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      maxScroll * eased,
    );
    await page.waitForTimeout(durationMs / steps);
  }
  await page.waitForTimeout(700);
}

/**
 * Smoothly scroll back to top so the hamburger trigger is reachable
 * for the next navigation.
 */
export async function scrollToTop(page: Page, durationMs = 1200) {
  const startY = await page.evaluate(() => window.scrollY);
  if (startY <= 50) return;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      startY * (1 - eased),
    );
    await page.waitForTimeout(durationMs / steps);
  }
  await page.waitForTimeout(300);
}

/**
 * Open the nav drawer and click the target page. Both clicks go through
 * moveAndClick so the fake cursor is visible — without that, the
 * hamburger-tap and page-select clicks were instantaneous teleports
 * that left the viewer guessing where the click landed.
 */
export async function openDrawerAndClick(page: Page, label: string) {
  const hamburger = page.getByRole("button", { name: /open menu/i });
  await moveAndClick(page, hamburger, { steps: 32, hoverMs: 500 });
  await page.waitForTimeout(2500); // drawer slide-in + reading time
  const pageButton = page
    .locator(`button:has(> div > span:text-is("${label}"))`)
    .first();
  await moveAndClick(page, pageButton, { steps: 28, hoverMs: 500 });
  // Page-transition settle + viewer-landing-pause. The 2.4s gives the
  // destination page time to (a) finish its route-change animation,
  // (b) hydrate any deferred banners / charts, and (c) let the viewer
  // register "ok, I'm on the <Page>" before any motion begins.
  await page.waitForTimeout(2400);
}
