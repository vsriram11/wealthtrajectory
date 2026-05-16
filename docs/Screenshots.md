# Capturing screenshots and walkthrough videos with Playwright

How the README's animated walkthroughs and per-feature interaction demos are built. The pattern is designed to be **portable** — you can lift it into a different Next.js / React / SPA repo with minor adjustments. It's also what you'd hand to an AI coding agent (Claude Code, Cursor, etc.) when you want it to maintain the captures.

---

## What this gives you

Two deliverable types, both regenerated from one command:

1. **Per-page PNG screenshots** — full-page captures at a chosen viewport (mobile by default here). Useful for marketing screenshots, social cards, blog posts, anywhere a static image is enough.
2. **Animated walkthroughs** — short videos showing the app in motion. Stored in two formats:
   - **WebM** — the format Playwright records natively. Click-through source-of-truth.
   - **Animated WebP** — what the README embeds inline via `<img>`. Renders in modern browsers; auto-loops.

The README inline-embeds the WebPs because **GitHub README sanitizes `<video src="docs/...">` tags pointing at relative repo paths**. Animated WebP via `<img>` is the smallest workable format that GitHub renders. (Alternatives discussed below.)

---

## Architecture

Three files do the work, plus a small ffmpeg dependency:

```
playwright.screenshots.config.ts         # separate Playwright config
e2e/screenshots/helpers.ts               # shared hydration + scroll + nav + cursor + title-card helpers
e2e/screenshots/screenshots.spec.ts      # per-page PNG capture (video off)
e2e/screenshots/tour.spec.ts             # comprehensive walkthrough (video on)
scripts/move-screenshot-videos.mjs       # post-process: flatten test-results + WebM→WebP
```

Why the structure looks the way it does:

- **Separate Playwright config.** The main `playwright.config.ts` runs the smoke + visual-regression suite. Marketing captures need different settings (mobile viewport, video recording, longer timeouts, production build), so they live in `playwright.screenshots.config.ts`. The main config `testIgnore`s `**/screenshots/**` to keep CI's smoke run clean.
- **Two specs separated by video on/off.** Playwright's `fullPage: true` screenshot mechanic temporarily resizes the viewport, snaps, then resets. If video is on, that resize-reset cycle gets recorded as a brief "screen size change" artifact at the start of each captured page. Splitting the work — screenshots in one spec with `video: "off"`, the walkthrough in another with `video: "on"` — keeps both deliverables clean.
- **One comprehensive tour, not many short demos.** Earlier iterations had a per-page tour + four separate per-feature demos, each rendering as its own inline WebP. We collapsed to ONE walkthrough that combines the page overview and all feature flows, separated by black title cards. Lighter README load, no duplication, easier to maintain.
- **Shared helpers.** `tourPage()`, `scrollToTop()`, `waitForHydration()`, `openDrawerAndClick()`, `injectCursor()`, `moveAndClick()`, `titleCard()` — the building blocks live in one place so anything that touches pacing is editable centrally.
- **ffmpeg via npm dev dep.** `@ffmpeg-installer/ffmpeg` ships a static ffmpeg binary as a Node module. No system install needed. Used in the post-process step to convert WebM → animated WebP.

---

## The pacing pattern (the part that took the longest to get right)

The default `playwright` video record produces something that looks correct in isolation but reads as **jittery / jumpy / "stuck"** when watched as a marketing asset. Three lessons learned during iteration:

### 1. Scroll smoothly with many steps + ease-in-out, not few steps + linear

```ts
// Smooth top → bottom over the given duration. 120 eased steps over
// ~6 seconds = ~20 steps/sec — comfortably smoother than the WebP's
// 8 fps sampling rate. Ease-in-out cubic so the scroll rate looks like
// a steady pan rather than a constant-speed grind.
export async function tourPage(page: Page, durationMs = 6000) {
  const maxScroll = await page.evaluate(
    () => Math.max(
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
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      maxScroll * eased,
    );
    await page.waitForTimeout(durationMs / steps);
  }
  await page.waitForTimeout(700);
}
```

### 2. Scroll back to top BEFORE opening any header-anchored UI

In this repo the hamburger menu trigger is at the top of the page. If the tour finishes at the bottom and then tries to click the hamburger, the click triggers a viewport jump back to the trigger position — read as a "sudden screen-size change" in earlier iterations. The fix: an explicit `scrollToTop()` helper called between every page tour and the next nav action.

### 3. Hold long enough for the eye to register every change

- After opening a modal/drawer: **2–2.5 seconds** so the viewer reads what just appeared before the next action.
- After a route transition (click a nav item, land on new page): **1.4 seconds** so cards + charts finish their entrance paints.
- Before scrolling on a freshly landed page: **another 700–1000 ms** so any deferred banner / hydration / chart paint completes.
- After a state-changing interaction: **at least 2 seconds** so the AFTER state lands before the loop resets.

Watching the same WebP three times in a row and asking "does this feel calm?" was the cheapest quality gate.

---

## How a single test produces output

When you run `npm run screenshots:videos`:

1. Playwright launches Chromium at a mobile viewport (390×844, 2× DPI).
2. The web server (`npm run start` — production build) starts on port 3001.
3. **`screenshots.spec.ts`** runs first, with `video: "off"`. One test navigates each page in turn and writes `docs/screenshots/0N-<name>.png`.
4. **`tour.spec.ts`** runs next. Video on. One comprehensive test combines the page overview AND all feature flows (CAGR edit + style-box decomposition + multi-asset composition toggle, drawdown phase edit, budget apply, multi-member rollup cascade), separated by black title cards. Playwright writes the recording to `test-results/tour-comprehensive-tour-chromium-mobile/video.webm`.
5. **`scripts/move-screenshot-videos.mjs`** scans `test-results/`, flattens each `<spec>-<test>-<project>/video.webm` to `docs/videos/comprehensive-tour.webm`, then invokes ffmpeg to encode it as an animated WebP (`fps=6`, `scale=300`, `quality=28` — tuned for a 2–3 minute tour that stays inside GitHub's reliable inline-render budget of ~10 MB).

---

## ffmpeg encoder settings (and why)

```bash
ffmpeg -i input.webm \
  -vf "fps=8,scale=320:-2:flags=lanczos" \
  -loop 0 \
  -lossless 0 \
  -quality 35 \
  -compression_level 6 \
  -preset picture \
  output.webp
```

| Flag | Choice | Rationale |
|---|---|---|
| `fps=8` | 8 frames per second | Smooth enough for steady scroll panning (the eye averages it out). Halves the bitrate vs 15. Below 6 fps starts to feel choppy on fast cuts. |
| `scale=320` | 320 px wide | README embeds at 280 px display width. 1.3× HiDPI cushion is enough at this content type. `-2` preserves aspect ratio. |
| `quality 35` | quality 0–100, lower is smaller | Visually fine at this resolution. Below 30 starts to show banding on dark UI. |
| `compression_level 6` | 0–6, higher is slower/better | Slowest pass. Offline cost is fine since we run this rarely. |
| `loop 0` | infinite loop | Matches a GIF expectation. |
| `lossless 0` | lossy | At marketing-asset quality, lossless triples the file size without visible improvement. |

For a single longer file (the comprehensive tour at ~70 seconds), the same settings produce ~3 MB. For short demos (~10 seconds each), the same settings produce 50–200 KB.

---

## Why these format choices (and what the alternatives cost)

| Format | Renders inline on GitHub? | Pause / scrub control? | File size for 10s @ 320 px | Notes |
|---|---|---|---|---|
| **Animated WebP** (current) | ✅ via `<img>` | Right-click in modern browsers | ~50–200 KB | Best balance. Modern browsers handle it; falls back to first frame on old ones. |
| Animated GIF | ✅ via `<img>` | ❌ | ~1–3 MB | Universal but 10× bigger. 256 colors. |
| MP4 (relative path) | ❌ — GitHub sanitizes `<video src="docs/...">` | n/a | ~150–400 KB | Doesn't render. Click-through becomes a download. |
| MP4 (uploaded to GitHub assets via PR comment) | ✅ via `<video src="https://github.com/.../assets/...">` | ✅ native player | ~150–400 KB | Best UX. **Requires manual upload step** (drag into PR comment, copy CDN URL, paste into README) — not scriptable. |
| WebM (relative path) | ❌ | n/a | ~100–300 KB | Same sanitization issue as MP4. |
| APNG | ✅ via `<img>` | Some control | ~500 KB – 2 MB | Smaller than GIF, bigger than WebP. |

The current pattern picks WebP because it's the smallest format that **renders inline AND doesn't require manual upload**. If you want true `<video controls>` pause/scrub UX, the workflow is:

1. Keep the WebM files committed in repo (source-of-truth).
2. After committing, drag each WebM into a GitHub PR or issue comment to get a `https://github.com/<owner>/<repo>/assets/<id>` CDN URL.
3. Swap the README `<img src="docs/videos/foo.webp">` for `<video src="<the assets URL>" controls></video>`.

That's a one-time manual step per asset that gives users the best player UX.

---

## Adapting this to a new repo

Steps to drop this pattern into a different Next.js / SPA codebase:

### 1. Install ffmpeg as a dev dep
```bash
npm install --save-dev @ffmpeg-installer/ffmpeg
```

### 2. Add the separate Playwright config
Copy `playwright.screenshots.config.ts`. Key bits:
- `testDir: "./e2e/screenshots"`
- `timeout: 180_000` (the comprehensive tour spec needs headroom)
- Mobile viewport (override if your app isn't mobile-first)
- `webServer` pointing at your production-build serve command
- `video: RECORD_VIDEO ? "on" : "off"` gated by env var

### 3. Make the main Playwright config ignore the screenshots dir
In your existing `playwright.config.ts`:
```ts
export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/screenshots/**"],
  // ...
});
```

### 4. Copy the helpers + spec files
`helpers.ts`, `screenshots.spec.ts`, `tour.spec.ts`. Adjust:
- Hydration signal in `waitForHydration()` — pick a selector that's reliably present once your app is interactive (here it's `text=/\$[0-9,]+/`).
- Nav helper — adjust `openDrawerAndClick()` if your app's navigation isn't a hamburger drawer.
- The list of pages in `PAGES` — match your app's routes.
- The feature-flow sections inside `tour.spec.ts` — replace the CAGR / drawdown / budget / rollup flows with your app's equivalents, keeping the title-card / interact / hold cadence.

### 5. Copy the post-process script
`scripts/move-screenshot-videos.mjs`. Adjust the spec-name prefix stripping (`/^tour-/`) if you rename the spec file.

### 6. Add the npm scripts
```json
{
  "scripts": {
    "screenshots": "playwright test --config=playwright.screenshots.config.ts",
    "screenshots:videos": "RECORD_VIDEO=1 playwright test --config=playwright.screenshots.config.ts && node scripts/move-screenshot-videos.mjs"
  }
}
```

### 7. Build, then capture
```bash
npm run build
npm run screenshots:videos
```

---

## Adding a new feature flow to the tour

Each section of the comprehensive tour in `tour.spec.ts` lives between two `titleCard()` calls. To add another section:

```ts
// Inside the existing test("comprehensive tour", ...) body:

await titleCard(page, "My new feature\nsection title", 2500);

// Navigate to the right page
await openDrawerAndClick(page, "Plan");
await page.waitForTimeout(1200); // brief BEFORE-state hold

// Click an element with animated cursor (visible red dot in the video)
const trigger = page.getByRole("button", { name: /open editor/i }).first();
await moveAndClick(page, trigger);
await page.waitForTimeout(1600); // pause: viewer reads what just opened

// Edit a field
const field = page.getByLabel(/some setting/i).first();
await moveAndClick(page, field, { hoverMs: 600 });
await page.keyboard.press("Control+A");
await page.keyboard.type("42", { delay: 130 });
await page.waitForTimeout(1800); // hold: AFTER value lands
await page.keyboard.press("Tab");
await page.waitForTimeout(1500);

// (Optional) For visually impactful clicks — slower cursor approach
await moveAndClick(page, criticalToggle, { steps: 50, hoverMs: 900 });
```

Conventions:

- **Brief hold before the interaction.** ~1–1.5 seconds. Viewer needs context.
- **800 ms after opening a modal.** Slide-in animations finish.
- **600 ms after a value change.** State propagation + chart paint.
- **2 seconds after the final action.** The AFTER state must land before the loop resets.

Keep each demo under 15 seconds. Auto-loop with a 60-second WebP is overwhelming; 10 seconds is right.

---

## Troubleshooting

### "The demo doesn't show the change I expected"

Usually one of:
- The change happens on a DIFFERENT page than where you interacted (e.g. editing a phase rate on the Plan page updates the projection chart on Home). The demo needs to navigate or scroll to where the change is visible.
- The change is too subtle (text shifts by 1px). Pick a more visually impactful interaction.
- The `waitForTimeout` after the action is too short — bump from 2000 to 3000 ms.

### "The video has weird gray space at the top of a page"

`fullPage: true` screenshots inside a video-recording test cause the viewport to temporarily resize. Move all PNG screenshots out into a separate spec with `video: "off"`. (This is exactly why this pattern uses two specs.)

### "The scroll feels jerky"

Increase the step count in `tourPage()` from 120 to 200, or decrease the per-step `waitForTimeout` so steps fire more frequently than the recorded fps. Goal: scroll steps per second should be ≥ 2× the video fps.

### "The WebP is huge (multiple MB) and the README load is slow"

The encoder is dialed for short clips. For long clips (the comprehensive tour is 70s), drop fps further (`fps=6`) or scale (`scale=280`) or quality (`quality=30`). Test until size is under 4 MB for the largest single asset; below that GitHub READMEs feel responsive on cellular.

### "I can't view the WebP locally"

Modern browsers (Chrome, Firefox, Safari, Edge) and modern macOS/Linux file previews all render animated WebP. If yours doesn't, install a viewer like `webp` (`apt install webp` / `brew install webp`) and try `webpinfo file.webp` to confirm it's actually animated (look for `Frames: N`).

---

## Why bother

The README hero matters disproportionately. A static screenshot tells the visitor "this is a thing." A short animated walkthrough tells the visitor "this is a thing that *works*, and here's what it feels like."

Doing it right once + automating regeneration means UI changes don't immediately make the marketing assets stale. Every UI refactor on this repo runs `npm run screenshots:videos` as part of the PR and re-commits the assets in the same commit — same discipline as updating the test snapshot.
