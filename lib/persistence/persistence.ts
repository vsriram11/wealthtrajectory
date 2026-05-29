import Dexie, { type Table } from "dexie";
import type { Assumptions, Household } from "@/lib/types";

export type PersistedRealState = {
  schemaVersion: number;
  household: Household;
  assumptions: Assumptions;
  /**
   * Per-member assumption overrides. Optional for back-compat with
   * pre-v? saved state. Defaults to {} on load when absent.
   */
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  /** Persistent default-view preference. Null = Household. */
  preferredMemberId?: string | null;
  /** User-defined target allocation (back-compat optional). */
  targetAllocation?: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
  /** Lifecycle glide-path (back-compat optional). */
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  /** Household annual gross income for savings-rate insight (back-compat optional). */
  householdAnnualIncomeUSD?: number | null;
  /** Non-Independence goals (back-compat optional). */
  goals?: import("@/lib/insights/goals").Goal[];
  /** Recurring monthly expense ledger (back-compat optional). */
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  /** Future income streams (back-compat optional). */
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  /**
   * What-if scenarios. Back-compat optional — older saves predate
   * this. Critically: scenarios used to live ONLY in Drive backups,
   * which meant signed-out users lost them on every refresh. Adding
   * them here makes scenarios survive a refresh regardless of
   * sign-in state.
   */
  scenarios?: import("@/lib/types").Scenario[];
  /** Health-insurance plans (back-compat optional). */
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  /** Per-member factor importance weights (back-compat optional). */
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
  /**
   * Whether the user has set up end-to-end encryption on their Drive
   * backup. The passphrase itself is in-memory only (security), but
   * we persist *that* encryption is enabled so the next session
   * (passphrase wiped on tab close) can surface a "enter your
   * passphrase to unlock" prompt instead of pretending no encryption
   * was ever set up.
   */
  driveEncryptionEnabled?: boolean;
  savedAt: number;
};

/**
 * A timestamped record of the user's wealth at a moment. The richer
 * form carries the full household composition for that date — so the
 * history chart can interpolate using actual past holdings rather
 * than just back-projecting today's shares. The legacy `{t, netWorth}`
 * form still loads cleanly (household is just absent), which keeps
 * pre-v3 snapshots usable.
 */
export type Snapshot = {
  t: number;
  netWorthUSD: number;
  /**
   * Optional full household composition as of `t`. When present, the
   * reconstruction engine uses these holdings (and historical prices
   * for their symbols) to render the past, rather than back-projecting
   * the current household. When absent (legacy snapshot), only the
   * `netWorthUSD` value is overlaid onto the reconstructed series.
   */
  household?: Household;
  /**
   * Free-text label the user can attach when manually saving a
   * snapshot ("Pre-promotion", "After RSU vest 2023-Q2", etc.). Falls
   * back to the date when absent.
   */
  label?: string;
};

const SCHEMA_VERSION = 2;
const REAL_KEY = "real-state";

type KvRow = { key: string; value: PersistedRealState };
type SnapshotRow = {
  t: number;
  netWorthUSD: number;
  household?: Household;
  label?: string;
};

class WealthTrajectoryDB extends Dexie {
  kv!: Table<KvRow, string>;
  snapshots!: Table<SnapshotRow, number>;

  constructor() {
    super("WealthTrajectory");
    // v1: kv only. v2: added snapshots. v3: snapshots gain optional
    // `household` + `label` — keeping the same primary key (t) so no
    // schema upgrade is needed; the new columns are just unused by
    // older rows and Dexie tolerates extra fields.
    this.version(1).stores({ kv: "key" });
    this.version(2).stores({ kv: "key", snapshots: "t" });
  }
}

let db: WealthTrajectoryDB | null = null;

function getDB(): WealthTrajectoryDB | null {
  if (typeof window === "undefined") return null;
  if (typeof indexedDB === "undefined") return null;
  if (!db) {
    try {
      db = new WealthTrajectoryDB();
    } catch (e) {
      console.warn("WealthTrajectory: IndexedDB unavailable", e);
      return null;
    }
  }
  return db;
}

export async function loadRealState(): Promise<PersistedRealState | null> {
  const handle = getDB();
  if (!handle) return null;
  try {
    const row = await handle.kv.get(REAL_KEY);
    if (!row) return null;
    if (row.value.schemaVersion !== SCHEMA_VERSION) return null;
    return row.value;
  } catch (e) {
    console.warn("WealthTrajectory: failed to load persisted state", e);
    return null;
  }
}

export async function saveRealState(args: {
  household: Household;
  assumptions: Assumptions;
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  preferredMemberId?: string | null;
  targetAllocation?: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  householdAnnualIncomeUSD?: number | null;
  goals?: import("@/lib/insights/goals").Goal[];
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  scenarios?: import("@/lib/types").Scenario[];
  driveEncryptionEnabled?: boolean;
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
}): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.kv.put({
      key: REAL_KEY,
      value: {
        schemaVersion: SCHEMA_VERSION,
        household: args.household,
        assumptions: args.assumptions,
        memberAssumptions: args.memberAssumptions,
        preferredMemberId: args.preferredMemberId,
        targetAllocation: args.targetAllocation,
        glidePath: args.glidePath,
        householdAnnualIncomeUSD: args.householdAnnualIncomeUSD,
        goals: args.goals,
        budgetItems: args.budgetItems,
        incomeStreams: args.incomeStreams,
        scenarios: args.scenarios,
        driveEncryptionEnabled: args.driveEncryptionEnabled,
        healthPlans: args.healthPlans,
        healthImportanceWeights: args.healthImportanceWeights,
        savedAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn("WealthTrajectory: failed to save state", e);
  }
}

export async function clearRealState(): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.kv.delete(REAL_KEY);
    await handle.snapshots.clear();
  } catch (e) {
    console.warn("WealthTrajectory: failed to clear state", e);
  }
}

export async function recordSnapshot(snapshot: Snapshot): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.snapshots.put(snapshot);
  } catch (e) {
    console.warn("WealthTrajectory: failed to record snapshot", e);
  }
}

export async function loadSnapshots(): Promise<Snapshot[]> {
  const handle = getDB();
  if (!handle) return [];
  try {
    const all = await handle.snapshots.orderBy("t").toArray();
    // Drop NaN/Infinity defensively (these can ONLY come from
    // genuine data corruption — never a legitimate user state).
    // Round-1 audit MED fix: previously this ALSO deleted any
    // NW <= 0 row from IndexedDB silently. That's wrong — a
    // legitimately-underwater user (high mortgage, low assets,
    // early-career) has a real negative NW and should not have
    // their snapshot deleted. We now KEEP negative NW rows
    // (return them to the UI which shows them with the negative
    // sign) and only purge NaN/Infinity at load.
    const corrupt = all.filter((s) => !Number.isFinite(s.netWorthUSD));
    if (corrupt.length > 0) {
      try {
        await Promise.all(
          corrupt.map((s) => handle.snapshots.delete(s.t)),
        );
      } catch {
        /* best-effort cleanup; the runtime overlay filter is the
           authoritative guard regardless */
      }
    }
    return all.filter((s) => Number.isFinite(s.netWorthUSD));
  } catch (e) {
    console.warn("WealthTrajectory: failed to load snapshots", e);
    return [];
  }
}

/**
 * Replace the entire snapshot collection with the supplied rows.
 * Used by Drive-sync inbound (pullFromDrive) and JSON-file import to
 * mirror the source-of-truth payload into local IDB. Round-1 audit
 * CRITICAL fix: snapshots were never participating in sync, so a
 * user wiping local data lost their entire snapshot history. This
 * helper closes that gap.
 *
 * Atomicity: clear-then-bulkPut runs inside a Dexie `rw` transaction
 * so a partial failure aborts the WHOLE thing — `clear()` is rolled
 * back. R1-D5 audit HIGH fix: previously the outer try/catch
 * swallowed any BulkError thrown by Dexie and `clear()` stayed in
 * effect, causing silent data loss when a single corrupt row halted
 * the bulkPut. Now we (a) re-throw on BulkError to abort the txn
 * and (b) let the error bubble to the caller (applyImportedPayload)
 * so pullFromDrive can surface it as `googleSyncError` instead of
 * claiming success.
 */
export async function replaceAllSnapshots(rows: Snapshot[]): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  await handle.transaction("rw", handle.snapshots, async () => {
    await handle.snapshots.clear();
    if (rows.length > 0) {
      try {
        await handle.snapshots.bulkPut(
          rows.map((r) => ({
            t: r.t,
            netWorthUSD: r.netWorthUSD,
            ...(r.household ? { household: r.household } : {}),
            ...(r.label ? { label: r.label } : {}),
          })),
        );
      } catch (e) {
        // Dexie's `bulkPut` resolves with a BulkError on partial
        // failures BY DEFAULT (the txn commits with whatever rows
        // succeeded). Throwing here forces Dexie to roll the entire
        // transaction back, leaving IDB in its pre-clear state —
        // the only behavior consistent with "atomic restore."
        throw e;
      }
    }
  });
}

export async function deleteSnapshot(t: number): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.snapshots.delete(t);
  } catch (e) {
    console.warn("WealthTrajectory: failed to delete snapshot", e);
  }
}

/**
 * Move a snapshot from one timestamp to another. Used by the
 * snapshot manager UI when the user backdates a recording. The
 * primary key changes, so we delete-then-put; conflicts (a different
 * snapshot already exists at newT) are resolved by overwriting.
 */
export async function moveSnapshot(
  oldT: number,
  newT: number,
): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    const row = await handle.snapshots.get(oldT);
    if (!row) return;
    await handle.snapshots.delete(oldT);
    await handle.snapshots.put({ ...row, t: newT });
  } catch (e) {
    console.warn("WealthTrajectory: failed to move snapshot", e);
  }
}

/**
 * Returns `true` iff a row was actually written. R1-D7 audit
 * CRITICAL fix: callers need this signal so they can bump the
 * sync-revision counter exactly when an IDB write happened, but not
 * on the (very common) min-interval no-op path. Without it, the
 * auto-snapshotter was either silent-to-CloudSyncer (current bug)
 * or would bump every 1.5s and amplify the debounced upload load.
 */
export async function maybeRecordSnapshot(
  netWorthUSD: number,
  household?: Household,
  now = Date.now(),
  minIntervalMs = 12 * 60 * 60 * 1000,
): Promise<boolean> {
  // Never persist a zero / negative net-worth auto-snapshot. The
  // most common cause: PersistenceHydrator's 3-second timer fires
  // before household state has finished loading from IDB or Drive,
  // so the "current" household is the empty boot default. Writing
  // {t: now, netWorthUSD: 0} would then poison overlaySnapshots —
  // every chart bucket at-or-after `now` snaps to $0 and the
  // history chart looks broken until the user manually deletes
  // the bad row.
  if (!Number.isFinite(netWorthUSD) || netWorthUSD <= 0) return false;
  if (household && household.accounts.length === 0) return false;

  const handle = getDB();
  if (!handle) return false;
  try {
    const last = await handle.snapshots.orderBy("t").reverse().first();
    if (last && now - last.t < minIntervalMs) return false;
    const row: SnapshotRow = household
      ? { t: now, netWorthUSD, household }
      : { t: now, netWorthUSD };
    await handle.snapshots.put(row);
    return true;
  } catch (e) {
    console.warn("WealthTrajectory: failed to maybe-record", e);
    return false;
  }
}

/**
 * Monthly auto-snapshot policy — sister of maybeRecordSnapshot, but
 * anchors the primary key (`t`) to the FIRST day of the calendar
 * month so successive same-month calls are a natural primary-key
 * no-op (idempotent re-runs within the month don't write multiple
 * rows). User-set quarterly check-in cadence pattern.
 *
 * Pruning: if the post-write total exceeds `maxAutoRows`, prune
 * OLDEST auto-snapshots (rows without a `label` — labeled rows are
 * user-saved and untouchable). Default cap of 240 = 20 years of
 * monthly snapshots, which keeps Drive payload size manageable
 * without losing meaningful long-term history.
 *
 * Returns `true` iff a write happened (so callers can bump the
 * sync-revision counter only when something changed).
 *
 * Engine purity: pure I/O — no Date.now() default would violate the
 * "no time as a hidden input" rule, so `now` is a required param at
 * use sites. We default it to Date.now() here because the function
 * IS I/O-bound (it's an auto-snapshotter), but tests always supply
 * a deterministic `now` for reproducibility.
 */
export async function maybeRecordMonthlySnapshot(
  netWorthUSD: number,
  household?: Household,
  now = Date.now(),
  maxAutoRows = 240,
): Promise<boolean> {
  if (!Number.isFinite(netWorthUSD) || netWorthUSD <= 0) return false;
  if (household && household.accounts.length === 0) return false;
  const handle = getDB();
  if (!handle) return false;
  // Anchor the primary key to (UTC year, month, day=1, noon). Noon
  // chosen so TZ-skew (up to 12h either way) can't push the row
  // into the neighbouring month.
  const nowDate = new Date(now);
  const monthAnchor = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    1,
    12,
    0,
    0,
    0,
  );
  try {
    // Same-month idempotency: if a row already exists at this
    // monthAnchor, refuse to overwrite (don't clobber a user's
    // mid-month manual snapshot OR another auto-snapshot from
    // earlier this month with potentially-different state). This
    // is the "first-call wins" semantic per the policy.
    const existing = await handle.snapshots.get(monthAnchor);
    if (existing) return false;
    const row: SnapshotRow = household
      ? { t: monthAnchor, netWorthUSD, household }
      : { t: monthAnchor, netWorthUSD };
    await handle.snapshots.put(row);
    // Prune oldest auto-snapshots (unlabeled) past the cap.
    if (maxAutoRows > 0) {
      const all = await handle.snapshots.orderBy("t").toArray();
      // Identify auto-snapshots: lack of `label` is the marker.
      const autoRows = all.filter((r) => r.label == null);
      if (autoRows.length > maxAutoRows) {
        const overflow = autoRows.length - maxAutoRows;
        // Oldest first — autoRows is already sorted by t ascending.
        const toDelete = autoRows.slice(0, overflow).map((r) => r.t);
        await Promise.all(
          toDelete.map((t) => handle.snapshots.delete(t)),
        );
      }
    }
    return true;
  } catch (e) {
    console.warn("WealthTrajectory: failed to maybe-record-monthly", e);
    return false;
  }
}
