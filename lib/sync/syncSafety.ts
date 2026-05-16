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
  | "healthPlans";
/**
 * Sparse-map collections also need wipe-protection — same N→0 risk,
 * but the underlying shape is `Record<string, ...>` instead of an
 * array. Tracked separately so the original array-based check
 * stays simple.
 */
type MapCollection = "healthImportanceWeights";

export type ShrinkageReport = {
  shrinking: (Collection | MapCollection)[];
  /** Counts from Drive (what would be lost) vs current state. */
  driveCounts: Partial<Record<Collection | MapCollection, number>>;
  currentCounts: Partial<Record<Collection | MapCollection, number>>;
};

const TRACKED_COLLECTIONS: Collection[] = [
  "scenarios",
  "goals",
  "budgetItems",
  "incomeStreams",
  "healthPlans",
];

const TRACKED_MAP_COLLECTIONS: MapCollection[] = ["healthImportanceWeights"];

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
    healthImportanceWeights?: Record<string, unknown>;
  },
  currentState: {
    scenarios: unknown[];
    goals: unknown[];
    budgetItems: unknown[];
    incomeStreams: unknown[];
    healthPlans: unknown[];
    healthImportanceWeights: Record<string, unknown>;
  },
): ShrinkageReport | null {
  const driveCounts: ShrinkageReport["driveCounts"] = {};
  const currentCounts: ShrinkageReport["currentCounts"] = {};
  const shrinking: (Collection | MapCollection)[] = [];
  for (const c of TRACKED_COLLECTIONS) {
    const driveLen = Array.isArray(drivePayload[c]) ? drivePayload[c]!.length : 0;
    const curLen = currentState[c].length;
    driveCounts[c] = driveLen;
    currentCounts[c] = curLen;
    if (driveLen > 0 && curLen === 0) shrinking.push(c);
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
    if (driveCount > 0 && curCount === 0) shrinking.push(c);
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
    healthImportanceWeights: Record<string, unknown>;
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
