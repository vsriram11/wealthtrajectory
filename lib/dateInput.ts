/**
 * Shared YYYY-MM-DD parsing for date `<input type="date">` values.
 *
 * Anchors to noon UTC so timezone wobble (up to 12h either way)
 * can't push the parsed timestamp into a neighbouring day. Round-
 * trip-validates the parse so JS's silent over-normalization
 * (e.g. "2024-02-31" → March 2, "2024-13-01" → January 1, 2025)
 * doesn't smuggle nonsensical dates through to consumers.
 *
 * Background: prior to extraction, three near-identical
 * `parseISO` / `isValidISO` functions existed in SnapshotsManager,
 * TimeTravelBanner, and EnterTimeTravelModal — only one had the
 * round-trip check, and the other two accepted "2024-02-31" with
 * Date silently normalizing it to March 2, then writing a snapshot
 * at March 2's primary key (overwriting any real March 2 row).
 * Round-4 audit findings #1 and #2 (BLOCKs) flagged the silent-
 * data-loss surface; this is the consolidated fix.
 *
 * Returns the parsed timestamp on success; null on any failure
 * (well-formed-shape miss, parse failure, over-normalized date,
 * NaN/Infinity guard).
 */

export function parseISODate(s: string): number | null {
  // 1. Shape — exactly YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // 2. Parse anchored to noon UTC.
  const t = Date.parse(`${s}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // 3. Round-trip — re-serialize and check the date didn't
  //    silently normalize. Catches "2024-02-31" → "2024-03-02".
  const roundtrip = new Date(t).toISOString().slice(0, 10);
  if (roundtrip !== s) return null;
  return t;
}

/** Today's date in YYYY-MM-DD (UTC). Used as the default for date pickers. */
export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Is this date today or earlier?" — lexicographic comparison
 * against today's UTC date. Independent of current wall-clock
 * hour (so a user clicking at 3am UTC sees today's date pass).
 *
 * Returns false on any malformed input.
 */
export function isPastOrToday(s: string): boolean {
  if (parseISODate(s) === null) return false;
  return s <= todayISODate();
}
