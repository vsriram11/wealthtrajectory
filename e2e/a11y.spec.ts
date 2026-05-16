/**
 * Accessibility audit suite — runs axe-core against each public
 * page in the running app + asserts zero violations at a
 * configured impact level.
 *
 * axe-core checks ~80 rules across WCAG 2.1 levels A + AA. The
 * suite scopes the check to "serious" + "critical" impact by
 * default — the lower-impact warnings (minor / moderate) are
 * tracked-but-not-failing so we don't end up with a CI gate
 * that's red on every text-spacing nit.
 *
 * What this catches that other tests don't:
 *   - Missing `aria-label` on icon-only buttons (the home page
 *     has several — menu toggle, sign-in button).
 *   - Insufficient color contrast.
 *   - Forms with inputs that lack labels.
 *   - Landmark / heading structure that screen readers depend on.
 *   - Image alt-text gaps.
 *
 * Maintenance: when a violation lands, the test fails with the
 * axe rule id + a documentation link. Either fix the issue or
 * add a targeted exclusion (and a comment explaining why) in
 * the .exclude() chain below. Don't blanket-disable rules —
 * that defeats the purpose.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Standard axe configuration. WCAG 2.0 A + AA + 2.1 A + AA
 * pulled in via the matching tags. Rule disables go here when
 * they apply repo-wide; per-test disables stay local.
 */
function makeScan(page: Page) {
  return new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  // No repo-wide rule disables. If/when a rule needs to be
  // ignored (e.g. a false positive on the framework's chrome),
  // add it here with a comment explaining why.
}

/**
 * Filter to the impact bands worth gating CI on. Minor / moderate
 * violations are logged but don't fail — they accumulate into
 * "should fix" tech debt rather than block merge.
 */
function gatingViolations(
  results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
) {
  return results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

test("home page — no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });
  // Wait for the dashboard to render before scanning — axe
  // checks the live DOM at scan time, and a loading spinner
  // would skip the real interactive surfaces.
  await expect(page.locator("text=/\\$[0-9,]+/").first()).toBeVisible({
    timeout: 15_000,
  });
  const results = await makeScan(page).analyze();
  const gating = gatingViolations(results);
  if (gating.length > 0) {
    // Helpful failure message: list each violation with its
    // rule id, impact, and the documentation URL. axe reports
    // include the affected nodes; we surface the first few.
    const summary = gating
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.help}\n  fix: ${v.helpUrl}\n  nodes (${v.nodes.length}):\n${v.nodes
            .slice(0, 3)
            .map((n) => `    - ${n.target.join(" > ")}`)
            .join("\n")}`,
      )
      .join("\n\n");
    throw new Error(
      `axe found ${gating.length} gating violations on /:\n\n${summary}`,
    );
  }
});

test("review page — no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/review", { waitUntil: "load" });
  const results = await makeScan(page).analyze();
  const gating = gatingViolations(results);
  if (gating.length > 0) {
    const summary = gating
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.help} — ${v.helpUrl} (${v.nodes.length} nodes)`,
      )
      .join("\n");
    throw new Error(
      `axe found ${gating.length} gating violations on /review:\n${summary}`,
    );
  }
});

test("security page — no critical or serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/security", { waitUntil: "load" });
  const results = await makeScan(page).analyze();
  const gating = gatingViolations(results);
  if (gating.length > 0) {
    const summary = gating
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.help} — ${v.helpUrl} (${v.nodes.length} nodes)`,
      )
      .join("\n");
    throw new Error(
      `axe found ${gating.length} gating violations on /security:\n${summary}`,
    );
  }
});

test("home page — minor + moderate violations are logged for tracking", async ({
  page,
}, testInfo) => {
  // Non-gating: this test passes regardless of minor / moderate
  // findings. It attaches an axe report as a CI artifact when
  // those lower-impact issues exist, giving contributors a punch
  // list of "should fix" items without blocking the build on
  // stylistic nits.
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("text=/\\$[0-9,]+/").first()).toBeVisible({
    timeout: 15_000,
  });
  const results = await makeScan(page).analyze();
  const minor = results.violations.filter(
    (v) => v.impact === "minor" || v.impact === "moderate",
  );
  if (minor.length > 0) {
    await testInfo.attach("axe-minor-violations.json", {
      body: JSON.stringify(minor, null, 2),
      contentType: "application/json",
    });
  }
  // Real assertion: the scan actually ran + checked a non-zero
  // number of rules. If axe loaded but found zero rules to
  // evaluate (e.g. wrong tags), `passes` would be empty and
  // the informational signal would be a lie.
  expect(results.passes.length).toBeGreaterThan(0);
});
