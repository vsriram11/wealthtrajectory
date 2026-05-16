/**
 * Comprehensive walkthrough — ONE continuous video covering the
 * full page sweep + every key interactive flow.
 *
 * Narrative order:
 *   1. Welcome card + home dashboard scroll
 *   2. Member management:
 *      — Open Manage, scroll the sheet
 *      — Add a new member "Newborn Kiddo"
 *      — Exclude BOTH kids (Kiddo + Newborn Kiddo) from rollups
 *      — Close, scroll home to show cascade across NW + projection + cards
 *   3. Add a new account:
 *      — Accounts page → "+ New"
 *      — Name = "Newborn Kiddo Trump Account"
 *      — Category dropdown → select "Trump Account"
 *      — Pause so the explanatory hint ("Launched July 4, 2026…") reads
 *      — Owner = Newborn Kiddo
 *      — Save
 *   4. Per-holding CAGR + style-box decomposition + multi-asset composition:
 *      — Expand Alex 401(k), tap VTI
 *      — Edit Expected real CAGR
 *      — Style box: Blend → 0%, Value → 50%, Growth → 50%
 *      — Enable AND disable Multi-asset composition (both slow)
 *      — Save & close
 *   5. Allocation time-travel:
 *      — Slider → ~10 years out
 *      — "Apply above" — every rollup re-roots
 *   6. Stress-test against a century:
 *      — Projections page → "Stress" tab
 *      — Historical Monte Carlo card — toggle Historical / Bootstrap modes
 *   7. "Edit an assumption → projection cascades":
 *      — Plan → AssumptionsPanel → Withdrawal rate edit
 *      — Back to Projections / Stress tab → success rate has shifted
 *   8. Multi-phase drawdown — edit a phase rate
 *   9. Budget drives the projection — Apply to Independence target
 *  10. Closing card
 *
 * Every meaningful click goes through moveAndClick so the fake red
 * cursor traces a visible path. Every state change is followed by a
 * long hold so the AFTER state lands before the next action.
 */
import { test } from "@playwright/test";
import {
  injectCursor,
  moveAndClick,
  openDrawerAndClick,
  scrollToTop,
  titleCard,
  tourPage,
  waitForHydration,
} from "./helpers";

test("comprehensive tour", async ({ page }) => {
  await injectCursor(page);
  await page.goto("/");
  await waitForHydration(page);

  // ═══════════════════════════════════════════════════════════════════
  // Opening
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "wealthtrajectory\n\nFinancial-independence planning\nin your browser",
    3000,
  );
  await page.waitForTimeout(1600);
  await tourPage(page, 6500);
  await scrollToTop(page);
  await page.waitForTimeout(700);

  // ═══════════════════════════════════════════════════════════════════
  // Section 1 — Member management
  //   Add a newborn, then exclude both kids from household rollups.
  //   Demonstrates: (a) members are first-class editable, (b) the
  //   include-in-rollup cascade across every household total.
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Member management:\nadd a newborn, then exclude\nboth kids from household totals",
    3200,
  );

  const manageBtn = page.getByRole("button", { name: "Manage" }).first();
  await moveAndClick(page, manageBtn, { hoverMs: 800 });
  await page.waitForTimeout(2200);

  // Briefly scroll through the existing members so the viewer sees
  // they're real entities (name + income + age fields per row).
  const sheetBody = page.locator("div.overflow-y-auto").first();
  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: 220, behavior: "instant" }),
  );
  await page.waitForTimeout(1600);
  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: 440, behavior: "instant" }),
  );
  await page.waitForTimeout(1600);

  // Scroll all the way down to find the "Add a member" input.
  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" }),
  );
  await page.waitForTimeout(1500);

  // Type "Newborn Kiddo" into the new-member input + click Add.
  const newNameInput = page.getByPlaceholder("Kid · Parent · Other");
  await moveAndClick(page, newNameInput, { hoverMs: 800 });
  await page.waitForTimeout(700);
  await page.keyboard.type("Newborn Kiddo", { delay: 90 });
  await page.waitForTimeout(1400);
  const addMemberBtn = page.getByRole("button", { name: /^Add$/ }).first();
  await moveAndClick(page, addMemberBtn, { hoverMs: 800 });
  await page.waitForTimeout(2000); // hold: new member row appears in the list

  // Scroll back to the top of the sheet so the viewer sees all the
  // members + their include-switches.
  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: 0, behavior: "instant" }),
  );
  await page.waitForTimeout(1200);

  // Exclude BOTH kids — Kiddo (index 2) and the newly-added Newborn
  // Kiddo (index 3). Demo data starts with members [Alex, Jordan,
  // Kiddo], so after the add the order is [Alex, Jordan, Kiddo,
  // Newborn Kiddo]. Scroll the sheet so each switch is visible.
  const switches = page.getByRole("switch", {
    name: "Include in household rollups",
  });

  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: 320, behavior: "instant" }),
  );
  await page.waitForTimeout(800);
  await moveAndClick(page, switches.nth(2), { hoverMs: 900 });
  await page.waitForTimeout(1400);

  await sheetBody.evaluate((el) =>
    el.scrollTo({ top: 480, behavior: "instant" }),
  );
  await page.waitForTimeout(800);
  await moveAndClick(page, switches.nth(3), { hoverMs: 900 });
  await page.waitForTimeout(1500);

  // Close the sheet. The visual click on Done is for the demo;
  // the Escape press right after is a hard guarantee — MembersSheet
  // listens for Escape (lib/_components/insights/MembersSheet.tsx:37)
  // and unmounts on next render. Without the Escape, prior runs had
  // the modal stay open and intercept every subsequent click on
  // the page.
  await moveAndClick(
    page,
    page.getByRole("button", { name: "Done" }).first(),
    { hoverMs: 700 },
  );
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(2200); // hold: NW headline updates

  // Scroll down home to show the cascade across all derived cards.
  const maxScrollHome = await page.evaluate(
    () =>
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ) - window.innerHeight,
  );
  if (maxScrollHome > 100) {
    const steps = 70;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const eased =
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await page.evaluate(
        (y) => window.scrollTo({ top: y, behavior: "instant" }),
        maxScrollHome * 0.6 * eased,
      );
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1800);
    await page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    await page.waitForTimeout(700);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 2 — Add a Trump Account for the newborn
  //   Synergy with the new TRUMP_ACCOUNT category — the hint copy
  //   ("Launched July 4, 2026 — every American newborn child…")
  //   surfaces on selection.
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Add an account.\nSee the new Trump Account category\n(launches July 4, 2026)",
    3000,
  );

  await openDrawerAndClick(page, "Accounts");
  await scrollToTop(page);
  await page.waitForTimeout(700);

  // Click "+ New" to open the AccountEditor.
  const newAccountBtn = page.getByRole("button", { name: /^\+ New$/ }).first();
  await moveAndClick(page, newAccountBtn, { hoverMs: 800 });
  await page.waitForTimeout(2000);

  // Fill the account name to show the user filling out the form.
  const nameInput = page.getByPlaceholder(/Fidelity 401\(k\)/i);
  await moveAndClick(page, nameInput, { hoverMs: 700 });
  await page.waitForTimeout(600);
  await page.keyboard.type("Newborn Kiddo Trump Account", { delay: 80 });
  await page.waitForTimeout(1400);

  // Open the Category dropdown and pick "Trump Account". Selecting
  // surfaces the hint copy beneath the dropdown. The AccountEditor's
  // <Field label="Category"> wrapping makes getByLabel finicky, so
  // address selects by their position in the editor — there are two
  // (Category nth 0, Owner nth 1).
  const editorSelects = page.locator("select");
  const categorySelect = editorSelects.nth(0);
  await moveAndClick(page, categorySelect, { hoverMs: 800 });
  await page.waitForTimeout(900);
  await categorySelect.selectOption("TRUMP_ACCOUNT");
  await page.waitForTimeout(3000); // hold: viewer reads the hint copy

  // Set owner to Newborn Kiddo so the new account is correctly
  // attributed to the newborn child (not the default "Alex").
  const ownerSelect = editorSelects.nth(1);
  await moveAndClick(page, ownerSelect, { hoverMs: 700 });
  await page.waitForTimeout(700);
  await ownerSelect.selectOption({ label: "Newborn Kiddo" });
  await page.waitForTimeout(2200); // hold: viewer sees owner now reads "Newborn Kiddo"

  // Save. AccountEditor's primary button reads "Create account" for
  // new accounts (and "Save changes" for edits) — there is no plain
  // "Save" button. Press Escape right after as a hard fallback: if
  // the click landed and the modal is gone, Escape is a no-op; if
  // the click silently missed, Escape unblocks the next section
  // (without it, the modal stays open and blocks every downstream
  // click).
  const createAccountBtn = page
    .getByRole("button", { name: /^Create account$/i })
    .first();
  if ((await createAccountBtn.count()) > 0) {
    await moveAndClick(page, createAccountBtn, { steps: 50, hoverMs: 1100 });
    await page.waitForTimeout(800);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1800);

  // ═══════════════════════════════════════════════════════════════════
  // Section 3 — Per-holding CAGR + Style Box + Multi-asset composition
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Per-holding expected return,\nstyle box, and multi-asset composition\n— every blended number recomputes",
    3200,
  );

  // Expand Alex 401(k). Use Playwright's native locator.click() —
  // moveAndClick's raw mouse.click sometimes fails to expand this
  // accordion (suspected overlap with sticky header at mobile
  // viewport). Native click auto-scrolls, auto-retries, and handles
  // overlay interception. The cursor won't animate to this click,
  // but it's a single in-page hop so the viewer barely notices.
  const accountRow = page
    .getByRole("button")
    .filter({ hasText: /Alex 401\(k\)/i })
    .first();
  await accountRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await accountRow.click();
  await page.waitForTimeout(2600); // hold: viewer reads positions inside

  // Tap VTI to open the holding editor. waitFor + native click for
  // the same robustness reasons.
  const vti = page.locator("button").filter({ hasText: "VTI" }).first();
  await vti.waitFor({ state: "visible", timeout: 10_000 });
  await vti.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await vti.click();
  await page.waitForTimeout(2800);

  // Edit Expected real CAGR.
  const cagrField = page.getByLabel(/expected real CAGR/i).first();
  await moveAndClick(page, cagrField, { hoverMs: 800 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("9", { delay: 170 });
  await page.waitForTimeout(2300);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1500);

  // Style box: shift weight from Blend cells (Large + Mid + Small)
  // into Large Value + Large Growth, summing to 100%. VTI's default
  // style box is Large Blend 82 / Mid Blend 12 / Small Blend 6
  // (total 100%), so we have to zero ALL THREE Blend cells before
  // adding 50/50 to the Large row — otherwise the box totals 130%
  // (the user's "doesn't sum to 100%" feedback).
  //
  // Cell index map (3×3 grid, row-major):
  //   0 Large Value   1 Large Blend   2 Large Growth
  //   3 Mid Value     4 Mid Blend     5 Mid Growth
  //   6 Small Value   7 Small Blend   8 Small Growth
  //
  // Use locator.fill() instead of Control+A + type() — fill() clears
  // and sets the value via a synthetic input event that NumberField's
  // controlled-string state reliably picks up, where Control+A + type
  // can race the React render and leave stale values.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /^Style box/.test((el.textContent ?? "").slice(0, 30)),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(2200);

  const styleBoxCells = page.locator(".num.h-12");
  if ((await styleBoxCells.count()) >= 9) {
    // 1. Zero out Large Blend (the biggest default chunk).
    await moveAndClick(page, styleBoxCells.nth(1), { hoverMs: 700 });
    await page.waitForTimeout(500);
    await styleBoxCells.nth(1).fill("0");
    await page.waitForTimeout(1100);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);

    // 2. Zero out Mid Blend (the 12% middle-row default).
    await moveAndClick(page, styleBoxCells.nth(4), { hoverMs: 700 });
    await page.waitForTimeout(500);
    await styleBoxCells.nth(4).fill("0");
    await page.waitForTimeout(1100);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);

    // 3. Zero out Small Blend (the 6% bottom-row default).
    await moveAndClick(page, styleBoxCells.nth(7), { hoverMs: 700 });
    await page.waitForTimeout(500);
    await styleBoxCells.nth(7).fill("0");
    await page.waitForTimeout(1100);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);

    // 4. Fill Large Value with 50.
    await moveAndClick(page, styleBoxCells.nth(0), { hoverMs: 800 });
    await page.waitForTimeout(500);
    await styleBoxCells.nth(0).fill("50");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);

    // 5. Fill Large Growth with 50. Box now sums to 50 + 50 = 100%.
    await moveAndClick(page, styleBoxCells.nth(2), { hoverMs: 800 });
    await page.waitForTimeout(500);
    await styleBoxCells.nth(2).fill("50");
    await page.waitForTimeout(2600); // long hold: viewer reads 100% V+G
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1500);
  }

  // Multi-asset composition: enable, hold, disable, hold.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      (el.textContent ?? "").startsWith("Multi-asset composition"),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(1900);

  const enableComposition = page
    .getByRole("button", { name: /Enable multi-asset composition/i })
    .first();
  if ((await enableComposition.count()) > 0) {
    await moveAndClick(page, enableComposition, { steps: 70, hoverMs: 1200 });
    await page.waitForTimeout(3200);
  }

  const disableComposition = page
    .getByRole("button", { name: /Disable composition/i })
    .first();
  if ((await disableComposition.count()) > 0) {
    await disableComposition.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await moveAndClick(page, disableComposition, { steps: 60, hoverMs: 1100 });
    await page.waitForTimeout(2800);
  }

  // Close the holding editor. HoldingEditor's close button reads
  // "Done" — changes auto-save as you edit, so this acts as the
  // save action even though there's no separate Save button.
  // With moveAndClick now using locator.click() under the hood
  // (reliable), no Escape fallback needed here — the visible Done
  // click is enough.
  const holdingDoneBtn = page
    .getByRole("button", { name: /^Done$/ })
    .first();
  await moveAndClick(page, holdingDoneBtn, { hoverMs: 700 });
  await page.waitForTimeout(1800);

  // ═══════════════════════════════════════════════════════════════════
  // Section 4 — Allocation time-travel
  //   Drag the year slider to ~10 years, then "Apply above" — every
  //   rollup re-roots to the aged-forward household.
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Time-travel:\nsee your allocation 10 years out,\nApply above to re-root every rollup",
    3000,
  );
  await openDrawerAndClick(page, "Allocation");
  await tourPage(page, 5500);
  await scrollToTop(page);
  await page.waitForTimeout(700);

  // Find the horizon slider, scroll it into view, drag to 10 years.
  const horizonSlider = page.getByRole("slider", {
    name: /projection horizon in years/i,
  });
  if ((await horizonSlider.count()) > 0) {
    await horizonSlider.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);
    // Set the value programmatically (input[type=range] doesn't have
    // a clean keyboard-typed value) — but route through fill() so
    // React's onChange fires.
    await horizonSlider.focus();
    await page.waitForTimeout(500);
    // Animate from current to 10 via repeated arrow-key presses so
    // the viewer sees the slider thumb move (the projection chart
    // beneath should also redraw with each step).
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(2000);

    // Click "Apply above". After clicking, the same button re-labels
    // to "Applied · reset" — same selector won't work twice.
    const applyAbove = page
      .getByRole("button", { name: /^Apply above$/i })
      .first();
    if ((await applyAbove.count()) > 0) {
      await moveAndClick(page, applyAbove, { steps: 50, hoverMs: 1000 });
      await page.waitForTimeout(2400); // hold: rollups above re-anchor
    }

    // Scroll back up so the viewer sees the aged-forward rollups.
    const cardTop = await horizonSlider.evaluate(
      (el) => el.getBoundingClientRect().top + window.scrollY,
    );
    if (cardTop > 200) {
      await page.evaluate(
        (y) => window.scrollTo({ top: Math.max(0, y - 1200), behavior: "instant" }),
        cardTop,
      );
      await page.waitForTimeout(3000); // viewer reads the aged-forward rollups
    }

    // Hit the Reset button so the demo returns to today's allocation
    // before moving on. The button now reads "Applied · reset".
    const resetBtn = page
      .getByRole("button", { name: /Applied.*reset/i })
      .first();
    if ((await resetBtn.count()) > 0) {
      await resetBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await moveAndClick(page, resetBtn, { steps: 40, hoverMs: 900 });
      await page.waitForTimeout(2200); // hold: rollups snap back to today
      // Scroll back up so the viewer sees the rollups restored to today.
      await page.evaluate(
        (y) => window.scrollTo({ top: Math.max(0, y - 1200), behavior: "instant" }),
        cardTop,
      );
      await page.waitForTimeout(2000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 5 — Projections: Historical Monte Carlo
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Stress-test against\na century of markets\n(1928–2025)",
    3000,
  );
  await openDrawerAndClick(page, "Projections");
  await page.waitForTimeout(1000);

  // Click the "Stress" tab. The Projections sub-nav uses role="tab",
  // not role="button" — getByRole("button") silently misses these,
  // which is why earlier runs stayed on the Outlook tab and the
  // viewer never saw the historical Monte Carlo content.
  const stressTab = page.getByRole("tab", { name: /^Stress$/ }).first();
  if ((await stressTab.count()) > 0) {
    await moveAndClick(page, stressTab, { hoverMs: 900 });
    await page.waitForTimeout(2200);
  }

  // Scroll to the Historical Monte Carlo card.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /historical success rate|historical monte carlo|success rate/i.test(
        (el.textContent ?? "").slice(0, 80),
      ),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(2400); // hold: viewer reads the success-rate headline

  // Toggle Bootstrap mode to show the alternative distribution.
  // ModeChip uses role="button" (Pill toggle), so the button role
  // matcher is correct here. After each mode toggle, scroll back to
  // the success-rate headline at the top of the card so the viewer
  // sees the percent change (the chip is below the headline so
  // clicking it leaves the headline off-screen).
  //
  // The scroll target is the "Success rate" label — narrower than
  // matching "success rate" anywhere in the page (a prior version
  // matched a giant container that scrolled to its center, far from
  // the actual headline).
  const scrollToSuccessRate = async () => {
    await page.evaluate(() => {
      // Find the small label "Success rate" — exact short text match
      const els = Array.from(document.querySelectorAll("div"));
      const label = els.find(
        (el) => (el.textContent ?? "").trim() === "Success rate",
      );
      label?.scrollIntoView({ behavior: "instant", block: "center" });
    });
  };

  const bootstrapChip = page
    .getByRole("button", { name: /^Bootstrap$/ })
    .first();
  if ((await bootstrapChip.count()) > 0) {
    await bootstrapChip.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await moveAndClick(page, bootstrapChip, { hoverMs: 1000 });
    await page.waitForTimeout(1400);
    // Scroll back up so the "Success rate" headline is visible.
    await scrollToSuccessRate();
    await page.waitForTimeout(3200); // long hold: viewer reads the bootstrap %

    // Back to Historical for the next beat.
    const historicalChip = page
      .getByRole("button", { name: /^Historical$/ })
      .first();
    if ((await historicalChip.count()) > 0) {
      await historicalChip.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await moveAndClick(page, historicalChip, { hoverMs: 900 });
      await page.waitForTimeout(1400);
      await scrollToSuccessRate();
      await page.waitForTimeout(2800);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 6 — Edit an assumption → projection cascades
  //   Plan → Withdrawal-rate edit → back to Projections / Stress to
  //   see the success rate shift.
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Edit a global assumption →\nwatch the projection cascade",
    3000,
  );
  await openDrawerAndClick(page, "Plan");
  await page.waitForTimeout(1000);

  // Scroll to + edit the AssumptionsPanel's withdrawal-rate field.
  // AssumptionsPanel wraps each field in a <label> whose text starts
  // with the field name, so getByLabel resolves cleanly to the
  // NumberField input inside. The first match is the global
  // withdrawal rate (AssumptionsPanel renders BEFORE
  // DrawdownPhasesCard on the Plan/Assumptions tab; the phase-level
  // "Withdrawal rate" UI uses a div-not-label structure so it doesn't
  // collide with getByLabel).
  const withdrawalInput = page
    .getByLabel(/Withdrawal rate/i)
    .first();
  if ((await withdrawalInput.count()) > 0) {
    await withdrawalInput.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);
    await moveAndClick(page, withdrawalInput, { hoverMs: 800 });
    await page.waitForTimeout(700);
    await page.keyboard.press("Control+A");
    // Bump the SWR from 4% to 5% — visibly higher rate, lower
    // success in the MC card after we navigate back.
    await page.keyboard.type("5", { delay: 170 });
    await page.waitForTimeout(2400);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(2400);
  }

  // Navigate back to Projections to see the new success rate.
  await openDrawerAndClick(page, "Projections");
  await page.waitForTimeout(900);
  // Re-resolve the Stress tab — using role="tab" so the click
  // actually switches view rather than silently missing.
  const stressTabAgain = page.getByRole("tab", { name: /^Stress$/ }).first();
  if ((await stressTabAgain.count()) > 0) {
    await moveAndClick(page, stressTabAgain, { hoverMs: 900 });
    await page.waitForTimeout(2000);
  }
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /historical success rate|success rate/i.test(
        (el.textContent ?? "").slice(0, 80),
      ),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(3000); // long hold: success rate has visibly shifted

  // ═══════════════════════════════════════════════════════════════════
  // Section 7 — Multi-phase drawdown — edit a phase rate
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Multi-phase drawdown:\nedit a phase rate, projection\nrecomputes downstream",
    2800,
  );
  await openDrawerAndClick(page, "Plan");
  await page.waitForTimeout(1000);

  // Scroll to the DrawdownPhasesCard by its unique title.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /^Multi-phase drawdown/.test((el.textContent ?? "").slice(0, 30)),
    );
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(1900);

  // DrawdownPhasesCard's phase inputs use class `num w-16` (vs the
  // AssumptionsPanel's `num w-24`); each phase row renders TWO w-16
  // inputs (start years, then withdrawal rate). nth(1) targets phase
  // 0's withdrawal rate — the first phase's "go-go" rate.
  const phaseRateInput = page.locator("input.num.w-16").nth(1);
  if ((await phaseRateInput.count()) > 0) {
    await moveAndClick(page, phaseRateInput, { hoverMs: 800 });
    await page.waitForTimeout(800);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("4.5", { delay: 170 });
    await page.waitForTimeout(2300);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(2200);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 7.5 — Scenarios: leverage-outperformance what-if
  //   On Projections / Scenarios → "+ What-if" → name
  //   "LeverageOutPerformance", bump TQQQ CAGR to 30% → save → home,
  //   tap the new chip, see the NW + projection card shift.
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Scenarios:\nsave a leveraged-outperformance what-if,\ntap to switch lenses",
    3000,
  );

  await openDrawerAndClick(page, "Projections");
  await page.waitForTimeout(1100);

  // Switch to the Scenarios sub-tab — role="tab", not "button".
  const scenariosTab = page.getByRole("tab", { name: /^Scenarios$/ }).first();
  if ((await scenariosTab.count()) > 0) {
    await moveAndClick(page, scenariosTab, { hoverMs: 900 });
    await page.waitForTimeout(2200);
  }

  // Click "+ What-if" to open the scenario editor.
  const whatIfBtn = page.getByRole("button", { name: /\+ What-if/i }).first();
  if ((await whatIfBtn.count()) > 0) {
    await moveAndClick(page, whatIfBtn, { hoverMs: 900 });
    await page.waitForTimeout(2000);

    // Type the scenario name. The editor's first text input is the
    // name field — locate by absence of placeholder vs the other
    // inputs that have placeholders.
    const scenarioNameInput = page
      .locator("input[type='text']")
      .nth(0); // editor renders this as the first text input
    if ((await scenarioNameInput.count()) > 0) {
      await moveAndClick(page, scenarioNameInput, { hoverMs: 700 });
      await page.waitForTimeout(600);
      await page.keyboard.press("Control+A");
      await page.keyboard.type("LeverageOutPerformance", { delay: 70 });
      await page.waitForTimeout(1600);
    }

    // Scroll to the Per-holding CAGR section, find the TQQQ row.
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("*"));
      const target = candidates.find((el) =>
        /^Per-holding CAGR/.test((el.textContent ?? "").slice(0, 30)),
      );
      target?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    await page.waitForTimeout(1800);

    // Scroll the TQQQ row into view + edit its CAGR. Drop word
    // boundaries — adjacent React divs concatenate textContent
    // without whitespace, so the row text is "TQQQAlex Taxable ·
    // base 12.00%" and `\bTQQQ\b` fails (no boundary between "Q"
    // and "A"). Substring match instead.
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("*"));
      const tqqq = rows.find((el) => (el.textContent ?? "").includes("TQQQ"));
      tqqq?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    await page.waitForTimeout(1400);

    // The HoldingCagrRow renders a <NumberField> wrapped in a div
    // with class `rounded-md.border`. Scope to that pattern so we
    // don't pick up `body` as the matching parent (which would then
    // return the first input anywhere on the page).
    const tqqqRow = page
      .locator("div.rounded-md.border")
      .filter({ hasText: "TQQQ" })
      .first();
    if ((await tqqqRow.count()) > 0) {
      const tqqqCagrInput = tqqqRow.locator("input").first();
      await tqqqCagrInput.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1400);

      // Painstakingly explicit keystroke sequence — prior runs used
      // fill() and triple-click + pressSequentially, both of which
      // failed to persist the value (the user saw "12" — TQQQ's
      // default CAGR — never become "30" in the scenario editor,
      // confirming the keystrokes never reached NumberField's
      // controlled state). This sequence focuses, selects all via
      // explicit Ctrl+A, deletes, then pressSequentially with a
      // generous 320ms per-key delay. Each step is verified by a
      // wait that gives React time to re-render between events.
      await tqqqCagrInput.focus();
      await page.waitForTimeout(500);
      await tqqqCagrInput.click(); // re-focus + give React a beat
      await page.waitForTimeout(500);
      await page.keyboard.press("ControlOrMeta+a");
      await page.waitForTimeout(500);
      await page.keyboard.press("Delete");
      await page.waitForTimeout(700);
      await tqqqCagrInput.pressSequentially("30", { delay: 320 });
      await page.waitForTimeout(4000); // long hold: viewer reads "30"
      await tqqqCagrInput.press("Tab");
      await page.waitForTimeout(1800);

      // Verify the input actually reads "30" — if it doesn't, the
      // scenario won't have the override and the chip click on home
      // will show no change. Log via the test name; visible to the
      // run output even if the WebP doesn't show it clearly.
      const finalValue = await tqqqCagrInput.inputValue();
       
      console.log(`[tour] TQQQ CAGR input final value: "${finalValue}"`);
    }

    // Save the scenario.
    const addScenarioBtn = page
      .getByRole("button", { name: /^Add scenario$/ })
      .first();
    if ((await addScenarioBtn.count()) > 0) {
      await addScenarioBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1100);
      await moveAndClick(page, addScenarioBtn, { steps: 50, hoverMs: 1000 });
      await page.waitForTimeout(2000);
    }
  }

  // Navigate home + click the new "LeverageOutPerformance" chip.
  await openDrawerAndClick(page, "Home");
  await scrollToTop(page);
  await page.waitForTimeout(1500);

  const newScenarioChip = page
    .getByRole("button", { name: /LeverageOutPerformance/i })
    .first();
  if ((await newScenarioChip.count()) > 0) {
    await moveAndClick(page, newScenarioChip, { hoverMs: 1100 });
    await page.waitForTimeout(2000); // brief pause: chip active
    // Scroll down to the projection chart so the viewer sees the
    // trajectory shift under the new scenario (the NW headline at
    // the top doesn't change — scenarios are forward-looking).
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas, svg.recharts-surface");
      canvas?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    await page.waitForTimeout(3500); // long hold: viewer reads chart shift

    // Scroll back to top so we land cleanly for the next section.
    await page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    await page.waitForTimeout(1200);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 8 — Budget drives the projection (with Subscriptions tab)
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Budget drives the projection.\nSubscriptions are a separate view\non the same ledger.",
    3000,
  );

  await openDrawerAndClick(page, "Plan");
  await page.waitForTimeout(1400);

  // Switch to the Plan / Budget sub-tab. Plan's sub-nav uses
  // role="tab" — same fix as Projections.
  const budgetTab = page.getByRole("tab", { name: /^Budget$/ }).first();
  if ((await budgetTab.count()) > 0) {
    await moveAndClick(page, budgetTab, { hoverMs: 900 });
    await page.waitForTimeout(2400); // hold: viewer lands on Budget content
  }

  // Scroll to the BudgetPanel's view-toggle (which contains the
  // "Subscriptions" tab) so we have it in view before clicking.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /^All expenses$/.test((el.textContent ?? "").trim()),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(1700);

  // Click the Subscriptions tab. BudgetPanel's view toggle uses
  // role="tab" — getByRole("button") silently misses these.
  const subscriptionsTab = page
    .getByRole("tab", { name: /^Subscriptions/i })
    .first();
  if ((await subscriptionsTab.count()) > 0) {
    await moveAndClick(page, subscriptionsTab, { hoverMs: 900 });
    await page.waitForTimeout(2200);
    // Scroll the list slowly so the viewer sees every subscription
    // (Netflix, Spotify, Adobe, AWS, gym, Costco).
    await page.evaluate(() => window.scrollBy({ top: 320, behavior: "instant" }));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollBy({ top: 320, behavior: "instant" }));
    await page.waitForTimeout(2000);
    // Back to "All expenses" before the Apply click.
    const allExpensesTab = page
      .getByRole("tab", { name: /^All expenses/i })
      .first();
    if ((await allExpensesTab.count()) > 0) {
      await moveAndClick(page, allExpensesTab, { hoverMs: 800 });
      await page.waitForTimeout(1800);
    }
  }

  // Scroll down to the Apply button context.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*"));
    const target = candidates.find((el) =>
      /apply to independence target/i.test(el.textContent ?? ""),
    );
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(1700);
  await page.evaluate(() => window.scrollBy({ top: -260, behavior: "instant" }));
  await page.waitForTimeout(2200); // viewer reads budget context

  const applyBtn = page
    .getByRole("button", { name: /apply to Independence target/i })
    .first();
  if ((await applyBtn.count()) > 0) {
    await applyBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await moveAndClick(page, applyBtn, { steps: 55, hoverMs: 1100 });
    await page.waitForTimeout(3000); // long hold: target NW updates visibly
  }

  // ═══════════════════════════════════════════════════════════════════
  // Section 9 — Data page: set passphrase + encrypted export
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Encrypted export / import.\nYour data, your laptop —\nno server required.",
    3000,
  );
  await openDrawerAndClick(page, "Data");
  await tourPage(page, 4500); // brief scroll-tour, leave time for interaction
  await scrollToTop(page);
  await page.waitForTimeout(900);

  // Scroll to the EncryptionCard's setup section. The "Enable
  // encryption" CTA is the unique anchor for the not-yet-set state.
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*"));
    const target = els.find((el) =>
      /Enable encryption/.test((el.textContent ?? "").slice(0, 20)),
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(1800);

  // Type the passphrase into the new-passphrase input.
  const newPassphraseInput = page.getByLabel(/new encryption passphrase/i);
  if ((await newPassphraseInput.count()) > 0) {
    await moveAndClick(page, newPassphraseInput, { hoverMs: 800 });
    await page.waitForTimeout(700);
    await newPassphraseInput.pressSequentially("DemoPassphrase-2026", {
      delay: 90,
    });
    await page.waitForTimeout(1400);

    // Confirm it in the second input.
    const confirmPassphraseInput = page.getByLabel(/^confirm passphrase$/i);
    if ((await confirmPassphraseInput.count()) > 0) {
      await moveAndClick(page, confirmPassphraseInput, { hoverMs: 800 });
      await page.waitForTimeout(700);
      await confirmPassphraseInput.pressSequentially("DemoPassphrase-2026", {
        delay: 90,
      });
      await page.waitForTimeout(1600);
    }

    // Click "Enable encryption" — locks in the passphrase, switches
    // future exports to AES-256-GCM mode.
    const enableEncBtn = page
      .getByRole("button", { name: /^Enable encryption$/ })
      .first();
    if ((await enableEncBtn.count()) > 0) {
      await moveAndClick(page, enableEncBtn, { steps: 50, hoverMs: 1100 });
      await page.waitForTimeout(2400); // hold: state flips to "unlocked"
    }
  }

  // Scroll down to the DataIO Export button — now exports will be
  // encrypted with the passphrase we just set.
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find(
      (b) => (b.textContent ?? "").trim() === "Export",
    );
    target?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await page.waitForTimeout(1800);

  const exportBtn = page
    .getByRole("button", { name: /export encrypted JSON/i })
    .first();
  if ((await exportBtn.count()) > 0) {
    await moveAndClick(page, exportBtn, { steps: 50, hoverMs: 1200 });
    await page.waitForTimeout(3000); // hold: download fires
  }

  // ═══════════════════════════════════════════════════════════════════
  // Interstitial card — import-in-fresh-session note
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "You can import this encrypted\nJSON file in a fresh local session.",
    3500,
  );

  // ═══════════════════════════════════════════════════════════════════
  // Closing
  // ═══════════════════════════════════════════════════════════════════
  await titleCard(
    page,
    "Try it →\nwealthtrajectory.vercel.app\n\nFree · Open-source · Local-first",
    3500,
  );
});
