/**
 * Sync-safety: refuse to upload a payload to Drive that would
 * *shrink* a non-empty collection on Drive down to empty. Catches
 * the class of bug where a stale or under-hydrated state.scenarios
 * (= []) overwrites a real Drive backup that had scenarios.
 *
 * This was learned the hard way — a user's "mediumcagr" scenario
 * got wiped between sessions because some upload path fired with
 * empty state.scenarios before the import-from-Drive had finished.
 * The guard exists to make that class of regression impossible.
 *
 * Returns:
 *   - null when the upload is safe (no shrinkage)
 *   - { shrinking: [...] } listing which collections would shrink
 *     so the caller can refuse + report
 */

import { unwrapBackup } from "@/lib/sync/crypto";
import { parseImport } from "@/lib/persistence/dataIO";

type Collection =
  | "scenarios"
  | "goals"
  | "budgetItems"
  | "incomeStreams"
  | "healthPlans"
  /**
   * Snapshots live in IndexedDB rather than in the Zustand state
   * slice, but they participate in Drive sync exactly like the
   * store-backed collections (since the Round-1 audit fix), so they
   * need the same wipe-protection. Callers pass the local snapshot
   * COUNT into the guard (cheap), not the rows themselves.
   */
  | "snapshots"
  /**
   * Accounts live nested at `household.accounts`, not at the top
   * level. The guard accesses them via a special path below, but
   * they're listed here so the SHRINKAGE_GUARDED_ARRAY_COLLECTIONS
   * export covers the full set the banner / recovery flow needs to
   * know about.
   *
   * Added in the post-Frame-B "Layer 1" tightening: previously the
   * household tree was unprotected on Drive uploads, so an
   * auto-promoted demo-seed session whose findBackupFile call
   * returned a spurious null could PATCH a real Drive backup with
   * the demo's account list (10 demo accounts replacing the user's
   * 15 real ones — a count-match-but-content-differ wipe).
   */
  | "accounts";
/**
 * Sparse-map collections also need wipe-protection — same N→0 risk,
 * but the underlying shape is `Record<string, ...>` instead of an
 * array. Tracked separately so the original array-based check
 * stays simple.
 *
 * `memberAssumptions` holds per-member overrides on every assumption
 * field (target NW, withdrawal rate, fixed-nominal freeze, etc.).
 * Losing a populated overrides map silently re-anchors every
 * member to the household default — the user re-tunes everything
 * and on next sync re-loses it. Same N→0 failure mode as the
 * other guarded collections.
 */
type MapCollection = "healthImportanceWeights" | "memberAssumptions";

export type ShrinkageReport = {
  shrinking: (Collection | MapCollection)[];
  /** Counts from Drive (what would be lost) vs current state. */
  driveCounts: Partial<Record<Collection | MapCollection, number>>;
  currentCounts: Partial<Record<Collection | MapCollection, number>>;
};

/**
 * Single source of truth for which ARRAY collections are
 * shrinkage-guarded. Both the OUTBOUND guard (`checkShrinkage`,
 * preventing a local-empty payload from wiping Drive on upload)
 * and the INBOUND guard (`isInboundShrinkage` in cloudSync.ts,
 * preventing a Drive-empty payload from wiping local on download)
 * read from this list — so the two directions stay in lockstep
 * automatically.
 *
 * The recovery banner (`SyncShrinkageBanner.tsx`) also imports
 * this constant to drive its "Accept Drive (lose local)" clear
 * step. Previously the banner's clear list and the inbound
 * guard's check list had drifted (banner was missing
 * `incomeStreams`), which left users in a "Re-pull failed
 * (shrinkage-blocked)" loop. Driving everything from this one
 * constant prevents the bug class.
 *
 * If you add a new shrinkage-guarded collection: append it here,
 * ensure the store has the corresponding slice, and confirm the
 * regression test in `syncSafety.test.ts` still pins the
 * symmetric invariants.
 */
export const SHRINKAGE_GUARDED_ARRAY_COLLECTIONS = [
  "scenarios",
  "goals",
  "budgetItems",
  "incomeStreams",
  "healthPlans",
  "snapshots",
  "accounts",
] as const satisfies readonly Collection[];

/**
 * Catastrophic-shrinkage threshold: refuse the upload (outbound) or
 * download (inbound) if the destination would drop below this
 * fraction of the source's count.
 *
 * Pre-Layer-1: the trigger was N → 0 only (full wipe). That missed
 * the partial wipe class — e.g., a Drive backup with 15 accounts
 * being overwritten by a demo seed's 10 accounts isn't a "wipe"
 * (10 > 0) but is a significant data loss for the user, and the
 * "count match, content differ" case is the specific Frame-B
 * regression we want to catch.
 *
 * 0.5 is the lowest threshold that still permits a "delete one or
 * two items" workflow without nagging the user. Below 50% survival
 * we treat the transition as catastrophic and refuse pending
 * explicit recovery-banner consent.
 */
export const MAJOR_SHRINK_THRESHOLD = 0.5;

/**
 * Single source of truth for "is the destination's count
 * catastrophically smaller than the source's?". Used by both the
 * outbound (`checkShrinkage`) and inbound (`isInboundShrinkage`)
 * guards so they trip at the same threshold.
 *
 * - sourceCount === 0  → never shrinkage (there was nothing to lose)
 * - destCount === 0    → always shrinkage (full wipe)
 * - 0 < destCount      → shrinkage when destCount < source × ratio
 *                        (i.e., we lost more than (1 − ratio) of
 *                        the items). At ratio = 0.5 that's > 50%.
 */
export function isMajorShrink(
  sourceCount: number,
  destCount: number,
): boolean {
  if (sourceCount === 0) return false;
  if (destCount === 0) return true;
  return destCount < sourceCount * MAJOR_SHRINK_THRESHOLD;
}

export const SHRINKAGE_GUARDED_MAP_COLLECTIONS = [
  "healthImportanceWeights",
  "memberAssumptions",
] as const satisfies readonly MapCollection[];

const TRACKED_COLLECTIONS: readonly Collection[] =
  SHRINKAGE_GUARDED_ARRAY_COLLECTIONS;

const TRACKED_MAP_COLLECTIONS: readonly MapCollection[] =
  SHRINKAGE_GUARDED_MAP_COLLECTIONS;

/**
 * Compare a parsed Drive payload to the current state. Reports any
 * collection where Drive has > 0 items and current state has 0.
 *
 * Reasoning: a transition from N → 0 is almost always a bug (stale
 * state clobbering a populated backup). Legitimate "delete-all"
 * actions are rare enough that requiring an explicit confirmation
 * is acceptable — and the guard can be bypassed by the user
 * deleting items one-by-one (each individual delete is a 1→0 only
 * at the very end, by which point the Drive copy is already in
 * sync).
 *
 * Note: We compare item counts, not deep equality. The goal is to
 * catch wipes, not to enforce conservative-merge semantics.
 */
export function checkShrinkage(
  drivePayload: {
    scenarios?: unknown[];
    goals?: unknown[];
    budgetItems?: unknown[];
    incomeStreams?: unknown[];
    healthPlans?: unknown[];
    snapshots?: unknown[];
    household?: { accounts?: unknown[] };
    healthImportanceWeights?: Record<string, unknown>;
    memberAssumptions?: Record<string, unknown>;
  },
  currentState: {
    scenarios: unknown[];
    goals: unknown[];
    budgetItems: unknown[];
    incomeStreams: unknown[];
    healthPlans: unknown[];
    snapshots: unknown[];
    household: { accounts: unknown[] };
    healthImportanceWeights: Record<string, unknown>;
    memberAssumptions: Record<string, unknown>;
  },
): ShrinkageReport | null {
  const driveCounts: ShrinkageReport["driveCounts"] = {};
  const currentCounts: ShrinkageReport["currentCounts"] = {};
  const shrinking: (Collection | MapCollection)[] = [];
  for (const c of TRACKED_COLLECTIONS) {
    let driveLen: number;
    let curLen: number;
    if (c === "accounts") {
      // Nested at household.accounts — not at the top level like
      // the other collections, so it gets a dedicated access path
      // here. The branch only exists for this one collection
      // because lifting accounts to the top level would require a
      // schema migration we don't need.
      driveLen = Array.isArray(drivePayload.household?.accounts)
        ? drivePayload.household.accounts.length
        : 0;
      curLen = currentState.household.accounts.length;
    } else {
      driveLen = Array.isArray(drivePayload[c]) ? drivePayload[c]!.length : 0;
      curLen = currentState[c].length;
    }
    driveCounts[c] = driveLen;
    currentCounts[c] = curLen;
    if (isMajorShrink(driveLen, curLen)) shrinking.push(c);
  }
  for (const c of TRACKED_MAP_COLLECTIONS) {
    const driveObj = drivePayload[c];
    const curObj = currentState[c];
    const driveCount =
      driveObj && typeof driveObj === "object" && !Array.isArray(driveObj)
        ? Object.keys(driveObj).length
        : 0;
    const curCount =
      curObj && typeof curObj === "object" && !Array.isArray(curObj)
        ? Object.keys(curObj).length
        : 0;
    driveCounts[c] = driveCount;
    currentCounts[c] = curCount;
    if (isMajorShrink(driveCount, curCount)) shrinking.push(c);
  }
  if (shrinking.length === 0) return null;
  return { shrinking, driveCounts, currentCounts };
}

/**
 * Convenience: pull the current Drive backup, decrypt if needed,
 * and run checkShrinkage against the supplied current state.
 *
 * Pass `currentDriveContent` if you've already fetched it (avoids
 * a second Drive round-trip). When null/undefined, returns null
 * (treat as safe — no existing backup to shrink).
 *
 * THROWS on encrypted-but-can't-decrypt instead of silently
 * returning null. The caller MUST refuse the upload in this case —
 * a silent allow here is the exact failure mode that overwrites
 * an encrypted Drive backup with plaintext stale state when the
 * user opens the app on a new device without their passphrase yet.
 */
export class DriveUnreadableError extends Error {
  constructor(
    message: string,
    public reason: "encrypted" | "parse",
  ) {
    super(message);
    this.name = "DriveUnreadableError";
  }
}

export async function checkShrinkageAgainstDrive(
  currentDriveContent: string | null | undefined,
  passphrase: string | null,
  currentState: {
    scenarios: unknown[];
    goals: unknown[];
    budgetItems: unknown[];
    incomeStreams: unknown[];
    healthPlans: unknown[];
    snapshots: unknown[];
    household: { accounts: unknown[] };
    healthImportanceWeights: Record<string, unknown>;
    memberAssumptions: Record<string, unknown>;
  },
): Promise<ShrinkageReport | null> {
  if (!currentDriveContent) return null;
  let plain: string;
  try {
    plain = await unwrapBackup(currentDriveContent, passphrase);
  } catch (err) {
    // Encrypted backup the caller can't decrypt OR malformed envelope.
    // Throw so the caller refuses the upload — silent allow here is
    // a data-loss footgun (uploads plaintext over the encrypted
    // backup the user actually has).
    const isEncrypted =
      err instanceof Error && err.name === "EncryptedRequiresPassphrase";
    throw new DriveUnreadableError(
      isEncrypted
        ? "Drive backup is encrypted and no passphrase is loaded"
        : err instanceof Error
          ? err.message
          : String(err),
      isEncrypted ? "encrypted" : "parse",
    );
  }
  let parsed: ReturnType<typeof parseImport>;
  try {
    parsed = parseImport(plain);
  } catch (err) {
    throw new DriveUnreadableError(
      err instanceof Error ? err.message : String(err),
      "parse",
    );
  }
  return checkShrinkage(parsed, currentState);
}
