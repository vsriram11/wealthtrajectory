#!/usr/bin/env node
/**
 * After `playwright test --config=playwright.screenshots.config.ts` runs
 * with RECORD_VIDEO=1, each test produces a WebM in
 * test-results/<test-name>/video.webm.
 *
 * This script:
 *   1. Flattens that layout into docs/videos/<test-name>.webm
 *   2. Converts each WebM into an animated WebP at 400px width
 *      (renders inline on GitHub README; WebM does not).
 *
 * The WebP files are what the README embeds via <img>. The WebMs
 * stay as click-through "full quality" links — they have audio
 * track support, sharper frames, and stream nicely in GitHub's
 * blob viewer.
 *
 * Output sizes (rule of thumb): WebPs land at ~100-300 KB each;
 * WebMs at ~100-200 KB. > 500 KB on either format usually means
 * the underlying capture was too long or the viewport too tall.
 */
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FFMPEG = require("@ffmpeg-installer/ffmpeg").path;

const RESULTS = path.resolve("test-results");
const OUT = path.resolve("docs/videos");

await fs.mkdir(OUT, { recursive: true });

const entries = await fs.readdir(RESULTS, { withFileTypes: true }).catch(() => []);
let moved = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(RESULTS, entry.name);
  const candidates = await fs.readdir(dir).catch(() => []);
  const video = candidates.find((f) => f.endsWith(".webm"));
  if (!video) continue;

  // Playwright names test-results dirs as <specfile>-<testname>-<project>.
  // Our video spec is e2e/screenshots/tour.spec.ts with test
  // "comprehensive tour", producing tour-comprehensive-tour-chromium-mobile.
  // Strip the project suffix and the redundant spec prefix to get a
  // clean output name (docs/videos/comprehensive-tour.{webm,webp}).
  const cleanName = entry.name
    .replace(/-chromium-mobile$/, "")
    .replace(/^tour-/, "")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();

  const src = path.join(dir, video);
  const webmDst = path.join(OUT, `${cleanName}.webm`);
  const webpDst = path.join(OUT, `${cleanName}.webp`);

  await fs.rename(src, webmDst);
  const webmSize = (await fs.stat(webmDst)).size;

  // Convert to animated WebP for inline rendering on GitHub. The
  // comprehensive tour is ~3 minutes long with title cards + four
  // feature flows; tighter encoder settings keep the inline asset
  // under GitHub's reliable inline-render budget (~10 MB).
  //
  //   fps=6         steady pan + slow click content; the eye averages
  //                 it out at this content type. Below 5 starts to
  //                 feel choppy on cursor motion.
  //   scale=300     READMEs render the asset at ~420 px wide. 300 px
  //                 source = ~1.4× HiDPI cushion at this content.
  //   quality 28    visually fine at this resolution. Below 22 banding
  //                 appears on dark UI gradients.
  //   method 6      slowest/best encoder pass (offline cost is fine).
  //   loop 0        infinite.
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i", webmDst,
      "-vf", "fps=6,scale=300:-2:flags=lanczos",
      "-loop", "0",
      "-lossless", "0",
      "-quality", "28",
      "-compression_level", "6",
      "-preset", "picture",
      webpDst,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const webpSize = (await fs.stat(webpDst)).size;
  console.log(
    `  ${cleanName.padEnd(30)} ` +
    `webm ${(webmSize / 1024).toFixed(0)}KB  ` +
    `webp ${(webpSize / 1024).toFixed(0)}KB`
  );
  moved++;
}

console.log(`\nProcessed ${moved} video(s) → ${OUT}`);

