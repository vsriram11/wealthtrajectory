/**
 * Per-page PNG screenshots — VIDEO OFF.
 *
 * Playwright implements fullPage screenshots by temporarily resizing
 * the viewport, snapping, then resetting. If this ran inside the tour
 * test (with video on), that resize-reset cycle would appear in the
 * video as a brief "screen-size-change" artifact at the start of
 * every page. Splitting into two specs cleans up both deliverables.
 */
import { test } from "@playwright/test";
import path from "node:path";
import { PAGES, waitForHydration } from "./helpers";

// File-level: turn video OFF for all tests in this file.
test.use({ video: "off" });

const OUT_DIR = path.resolve(__dirname, "../../docs/screenshots");

test("per-page screenshots", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  for (const { file, nav } of PAGES) {
    if (nav) {
      // Cheap nav — no need for the slow pacing here since video is
      // off; we just need to land on the destination page.
      await page.getByRole("button", { name: /open menu/i }).click();
      await page.waitForTimeout(400);
      await page
        .locator(`button:has(> div > span:text-is("${nav}"))`)
        .first()
        .click();
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(OUT_DIR, `${file}.png`),
      fullPage: true,
      type: "png",
    });
  }
});
