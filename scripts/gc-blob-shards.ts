#!/usr/bin/env node
/**
 * Garbage-collect old versioned shard generations from Vercel Blob.
 *
 * `scripts/refresh-history.ts` publishes shards under
 * `quote-history/<generatedAt>/shard-NNN.json` paths (versioned for
 * atomic swap — see that file's stage-4 comment). Each refresh adds
 * 256 shards under a new prefix; old prefixes are never deleted
 * because Vercel Blob doesn't auto-GC unreferenced files.
 *
 * Result: storage grows unboundedly across refreshes. With 256
 * shards × ~2MB each, every refresh adds ~500MB. The 1GB free-tier
 * quota fills up after ~2-3 refreshes.
 *
 * This script deletes every `quote-history/<TIMESTAMP>/` prefix
 * EXCEPT the one currently pointed-at by the live manifest. Run it
 * AFTER each successful refresh OR on a separate weekly cleanup
 * cron.
 *
 * Free-tier safety: list-blobs costs 1 op + N ops per page (page
 * size 1000). Delete is 1 op per file. For 1000 stale shards across
 * a few prior generations: ~5 list pages + 1000 deletes = ~1005 ops
 * one-time per cleanup. Under the 2000/month write+list cap.
 *
 * Run: `npx tsx scripts/gc-blob-shards.ts` (sets
 * `BLOB_READ_WRITE_TOKEN` from env).
 */

import { list, del } from "@vercel/blob";

const MANIFEST_URL =
  "https://yr2lktc5f9ujt0cn.public.blob.vercel-storage.com/quote-history/manifest.json";

async function getCurrentGeneratedAt(): Promise<number | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const m = (await res.json()) as { generatedAt?: number };
    return typeof m.generatedAt === "number" ? m.generatedAt : null;
  } catch {
    return null;
  }
}

async function main() {
  const currentGen = await getCurrentGeneratedAt();
  if (!currentGen) {
    console.error(
      "Couldn't read live manifest.json — refusing to delete anything.",
    );
    process.exit(2);
  }
  console.log(`Current generation: ${currentGen}`);
  console.log(`Keeping: quote-history/${currentGen}/ + quote-history/manifest.json`);
  console.log("Listing all blobs under quote-history/…");

  const toDelete: string[] = [];
  let cursor: string | undefined;
  let totalListed = 0;
  do {
    const page = await list({
      prefix: "quote-history/",
      cursor,
      limit: 1000,
    });
    totalListed += page.blobs.length;
    for (const b of page.blobs) {
      // Keep the manifest (well-known path).
      if (b.pathname === "quote-history/manifest.json") continue;
      // Keep shards under the current generation's prefix.
      if (b.pathname.startsWith(`quote-history/${currentGen}/`)) continue;
      toDelete.push(b.url);
    }
    cursor = page.cursor;
  } while (cursor);

  console.log(
    `Listed ${totalListed} total blobs, ${toDelete.length} stale (to delete)`,
  );
  if (toDelete.length === 0) {
    console.log("Nothing to delete; storage is already clean.");
    return;
  }

  // Batch delete — @vercel/blob accepts an array URL list per call.
  // Use chunks of 100 to stay polite + bounded per-request payload.
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const chunk = toDelete.slice(i, i + BATCH);
    await del(chunk);
    deleted += chunk.length;
    if (i % 500 === 0) {
      console.log(`  deleted ${deleted}/${toDelete.length}`);
    }
  }
  console.log(`Deleted ${deleted} stale blobs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
