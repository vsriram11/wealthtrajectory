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
/**
 * A timestamped record of the user's wealth at a moment. The richer
 * form carries the full household composition for that date — so the
 * history chart can interpolate using actual past holdings rather
 * than just back-projecting today's shares. The legacy `{t, netWorth}`
 * form still loads cleanly (household is just absent), which keeps
 * pre-v3 snapshots usable.
 *
 * `appState` (added later) carries the rest of the financial-state
 * slices — target allocation, assumptions, goals, budget, etc. —
 * so historical views can reconstruct not just realized allocation
 * but ALSO the user's targets, withdrawal assumptions, goal
 * progress, etc. as-of `t`. Optional for back-compat: pre-`appState`
 * snapshots (including all JSON exports from earlier app versions)
 * still load and the history views fall back to "data unavailable
 * for this date" for the missing slice overlays.
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
   *
   * Per-member data lives INSIDE household: `household.members` is
   * the member roster (each member's per-member assumptions are on
   * `appState.memberAssumptions` keyed by member id), and
   * `household.accounts[].ownerId` + `household.liabilities[].ownerId`
   * carry the owner attribution that drives member-filtered views.
   */
  household?: Household;
  /**
   * Optional snapshot of the OTHER financial-state slices as of `t`
   * (everything that isn't household). Lets historical views answer
   * questions like "what was my target allocation last June?" or
   * "did my withdrawal-rate assumption drift after I switched jobs?"
   *
   * Mirrors `PersistedRealState` minus: auth/meta fields
   * (`schemaVersion`, `savedAt`, `driveEncryptionEnabled`) and UI
   * preferences (`preferredMemberId`) and the `household` slice
   * (already a sibling field on Snapshot).
   *
   * Critically: all fields are optional so a partial appState (from
   * a future schema, a hand-edited JSON, or a JSON import from an
   * older app version that included some-but-not-all slices) still
   * loads cleanly — consumers read with `appState?.field ?? null`.
   */
  appState?: SnapshotAppState;
  /**
   * Free-text label the user can attach when manually saving a
   * snapshot ("Pre-promotion", "After RSU vest 2023-Q2", etc.). Falls
   * back to the date when absent.
   */
  label?: string;
  /**
   * Provenance flag distinguishing auto-snapshots from user-
   * initiated ones. `maybeRecordSnapshot` and
   * `maybeRecordMonthlySnapshot` stamp `"auto"`; SnapshotsManager
   * + TimeTravelBanner stamp `"manual"`. The monthly-prune cap
   * ONLY prunes `source === "auto"` rows, protecting unlabeled
   * user-saved snapshots from being silently deleted on
   * long-horizon installs (audit round-2 BLOCK fix — the
   * previous `label == null` heuristic conflated "auto" with
   * "unlabeled user save," and the UI explicitly allows the
   * latter via SnapshotsManager.handleAdd).
   *
   * Back-compat: absent on pre-feature rows. The pruner treats
   * `source` not exactly equal to `"auto"` as untouchable — so
   * legacy IDB rows survive the cap unchanged.
   */
  source?: "auto" | "manual";
};

/**
 * The non-household financial-state slices captured alongside a
 * snapshot. Mirrors the optional fields on `PersistedRealState` so
 * a snapshot is conceptually "the persisted state as of `t`, minus
 * auth/meta". Every field is optional — a snapshot's appState may
 * carry only a subset, and consumers must tolerate absence.
 */
export type SnapshotAppState = {
  assumptions?: Assumptions;
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  targetAllocation?: import("@/lib/portfolio/targetAllocation").TargetAllocation | null;
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  householdAnnualIncomeUSD?: number | null;
  goals?: import("@/lib/insights/goals").Goal[];
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  scenarios?: import("@/lib/types").Scenario[];
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
};

const SCHEMA_VERSION = 2;
const REAL_KEY = "real-state";
// Time-travel session record. Lives in the same `kv` table under a
// dedicated key so the live state stays untouched while a session is
// active. Persisted across tab close so the user can resume editing
// historical values on reopen instead of losing them silently.
const TIME_TRAVEL_SESSION_KEY = "time-travel-session";

type KvRow = { key: string; value: PersistedRealState };
type SnapshotRow = {
  t: number;
  netWorthUSD: number;
  household?: Household;
  appState?: SnapshotAppState;
  label?: string;
  source?: "auto" | "manual";
};

/**
 * Single source of truth for the field set we persist on a
 * snapshot row. `replaceAllSnapshots` (and the JSON-import path)
 * uses this to spread-through every known field rather than a
 * hand-maintained whitelist — the previous whitelist silently
 * dropped `appState` until the audit caught it (cf. 8d5d5b6).
 *
 * Adding a new field to `Snapshot` MUST add the key here too,
 * and the compile-time exhaustiveness check below will fail until
 * it does.
 */
export const SNAPSHOT_PERSISTED_FIELDS = [
  "t",
  "netWorthUSD",
  "household",
  "appState",
  "label",
  "source",
] as const;

// Compile-time exhaustiveness check: this type alias compiles iff
// every key of `Snapshot` is listed in SNAPSHOT_PERSISTED_FIELDS.
// If you add a field to `Snapshot` and forget to add it above,
// _SnapshotFieldCoverage resolves to `never` and TypeScript
// fails. Defense against the "I added a field but forgot
// replaceAllSnapshots" footgun.
type _SnapshotFieldCoverage = Exclude<
  keyof Snapshot,
  (typeof SNAPSHOT_PERSISTED_FIELDS)[number]
> extends never
  ? true
  : never;
// Force the type to be evaluated so a divergence is a compile
// error, not a silent dead branch.
const _ensureSnapshotFieldCoverage: _SnapshotFieldCoverage = true;
void _ensureSnapshotFieldCoverage;

function snapshotToRow(s: Snapshot): SnapshotRow {
  // Build the row by picking known fields from `s`. Unknown
  // fields (e.g. a hand-edited JSON with `notes: "x"`) are
  // stripped here — Dexie tolerates extras but we don't want
  // foreign keys to leak into our IDB rows.
  const row: SnapshotRow = { t: s.t, netWorthUSD: s.netWorthUSD };
  if (s.household !== undefined) row.household = s.household;
  if (s.appState !== undefined) row.appState = s.appState;
  if (s.label !== undefined) row.label = s.label;
  if (s.source !== undefined) row.source = s.source;
  return row;
}

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
    await handle.kv.delete(TIME_TRAVEL_SESSION_KEY);
    await handle.snapshots.clear();
  } catch (e) {
    console.warn("WealthTrajectory: failed to clear state", e);
  }
}

/**
 * The persisted form of a time-travel session. Lives in a dedicated
 * `kv` row so the user's live state (REAL_KEY) stays untouched while
 * editing historical values. Resuming on app reopen is the load-
 * bearing UX: a user reported that closing the tab during a backdate
 * session silently discarded everything they typed; the resume path
 * makes the session feel like a real editor (work persists across
 * reloads).
 *
 * What's persisted:
 *   - `household` / `assumptions`: the LIVE edit state inside the
 *     session (every change the user has made so far).
 *   - `baselineHousehold` / `baselineAssumptions`: the pre-session
 *     state, needed by exit-discard to restore on Exit.
 *   - `timeTravelDate`: the backdate the user chose.
 *   - `editingSnapshotT`: non-null when the session was launched
 *     from an existing snapshot (Save overwrites that row directly
 *     without prompting).
 */
export type PersistedTimeTravelSession = {
  schemaVersion: number;
  timeTravelDate: string;
  editingSnapshotT: number | null;
  household: Household;
  assumptions: Assumptions;
  baselineHousehold: Household;
  baselineAssumptions: Assumptions;
  savedAt: number;
};

export async function loadTimeTravelSession(): Promise<PersistedTimeTravelSession | null> {
  const handle = getDB();
  if (!handle) return null;
  try {
    const row = await handle.kv.get(TIME_TRAVEL_SESSION_KEY);
    if (!row) return null;
    const v = row.value as PersistedTimeTravelSession | undefined;
    if (!v || v.schemaVersion !== SCHEMA_VERSION) return null;
    if (
      !v.timeTravelDate ||
      !v.household ||
      !v.assumptions ||
      !v.baselineHousehold ||
      !v.baselineAssumptions
    ) {
      return null;
    }
    return v;
  } catch (e) {
    console.warn("WealthTrajectory: failed to load time-travel session", e);
    return null;
  }
}

export async function saveTimeTravelSession(
  session: Omit<PersistedTimeTravelSession, "schemaVersion" | "savedAt">,
): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.kv.put({
      key: TIME_TRAVEL_SESSION_KEY,
      value: {
        ...session,
        schemaVersion: SCHEMA_VERSION,
        savedAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn("WealthTrajectory: failed to save time-travel session", e);
  }
}

export async function clearTimeTravelSession(): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    await handle.kv.delete(TIME_TRAVEL_SESSION_KEY);
  } catch (e) {
    console.warn("WealthTrajectory: failed to clear time-travel session", e);
  }
}

export async function recordSnapshot(snapshot: Snapshot): Promise<void> {
  const handle = getDB();
  if (!handle) return;
  try {
    // Route through snapshotToRow so a hand-built Snapshot with
    // extras (or one missing the new `source` field that we
    // want pruned-safe) goes through the same projection as
    // bulk imports.
    await handle.snapshots.put(snapshotToRow(snapshot));
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
        // Use the shared snapshotToRow helper so adding a new
        // field to Snapshot lights up persistence + sync + import
        // automatically. The compile-time _SnapshotFieldCoverage
        // check (above) enforces that the helper stays in lock-
        // step with the type. Round-2 audit fix: replaced the
        // hand-maintained whitelist (which silently dropped
        // `appState` until 8d5d5b6 caught it via test).
        await handle.snapshots.bulkPut(rows.map(snapshotToRow));
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
  appState?: SnapshotAppState,
): Promise<boolean> {
  // Never persist a NaN / Infinity net-worth (defense against
  // pathological inputs).
  if (!Number.isFinite(netWorthUSD)) return false;
  // When household IS provided, trust accounts.length as the
  // boot signal (zero accounts = data not yet loaded). When
  // household is NOT provided, keep the strict <=0 guard —
  // we have no way to distinguish a legitimately-underwater
  // user from the boot-default case. Round-2 audit fix
  // (underwater-user lockout): the prior unconditional <=0
  // guard locked out users with real accounts but negative
  // NW (high mortgage, early career) from any auto-history.
  // loadSnapshots documents that legitimately-negative NW
  // rows are kept on READ; skipping them on WRITE was
  // inconsistent.
  if (household == null && netWorthUSD <= 0) return false;
  if (household && household.accounts.length === 0) return false;

  const handle = getDB();
  if (!handle) return false;
  try {
    // Wrap the read-check-write in a Dexie transaction so two
    // concurrent invocations (e.g. PersistenceHydrator's
    // baseline-effect AND its subscribe-debounce firing within
    // 1.5s of each other) can't BOTH pass the min-interval
    // check, BOTH put rows, and end up with two near-duplicate
    // snapshots ~1.5s apart. Round-2 audit fix #7.
    let wrote = false;
    await handle.transaction("rw", handle.snapshots, async () => {
      const last = await handle.snapshots.orderBy("t").reverse().first();
      if (last && now - last.t < minIntervalMs) return;
      const row: SnapshotRow = {
        t: now,
        netWorthUSD,
        // Auto-snapshotter stamp — the prune logic uses this to
        // distinguish auto rows (safely deletable past the cap)
        // from manual user saves (untouchable). The previous
        // `label == null` heuristic mis-classified unlabeled
        // manual saves; this is explicit.
        source: "auto",
      };
      if (household) row.household = household;
      if (appState) row.appState = appState;
      await handle.snapshots.put(row);
      wrote = true;
    });
    return wrote;
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
  appState?: SnapshotAppState,
): Promise<boolean> {
  // Same underwater-user-friendly gate as maybeRecordSnapshot.
  if (!Number.isFinite(netWorthUSD)) return false;
  if (household == null && netWorthUSD <= 0) return false;
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
  // Bound the "current month" window — any t in this range
  // counts as "already auto-captured this month" so we don't
  // backfill phantom data when the user edits / moves the
  // existing monthAnchor row mid-month. Round-2 audit fix #4:
  // the prior `get(monthAnchor)` check only saw the EXACT
  // anchor; if a user moved their manual row to e.g. May 10,
  // the May-1 slot was empty and the next auto fire wrote
  // today's holdings tagged as May 1.
  const monthStart = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  );
  const monthEnd = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  );
  try {
    // Wrap read-check-write in a transaction (same rationale as
    // maybeRecordSnapshot — concurrent mounts must not
    // double-write at this anchor). Round-2 audit fix #7.
    let wrote = false;
    await handle.transaction("rw", handle.snapshots, async () => {
      // Same-month idempotency: refuse to write if ANY snapshot
      // (auto, manual, or legacy-no-source) already exists
      // within the current calendar month. This generalizes the
      // prior "exact-anchor exists" check so a user-moved
      // monthAnchor row (now sitting elsewhere in the same
      // month) still prevents a phantom auto-write at the
      // vacated slot.
      const existingInMonth = await handle.snapshots
        .where("t")
        .between(monthStart, monthEnd, true, false)
        .first();
      if (existingInMonth) return;
      const row: SnapshotRow = {
        t: monthAnchor,
        netWorthUSD,
        source: "auto",
      };
      if (household) row.household = household;
      if (appState) row.appState = appState;
      await handle.snapshots.put(row);
      // Prune oldest AUTO snapshots past the cap. Uses the
      // explicit `source === "auto"` marker (round-2 audit fix
      // — the previous `label == null` heuristic mis-classified
      // unlabeled manual saves as auto-prunable). Legacy rows
      // (lacking `source` entirely, from pre-feature IDB) are
      // treated as untouchable for safety. EXCLUDE the row we
      // just inserted from the prune pool — see existing
      // comment for the over-cap-old-anchor edge case.
      if (maxAutoRows > 0) {
        const all = await handle.snapshots.orderBy("t").toArray();
        const autoRows = all.filter(
          (r) => r.source === "auto" && r.t !== monthAnchor,
        );
        if (autoRows.length > maxAutoRows - 1) {
          const overflow = autoRows.length - (maxAutoRows - 1);
          const toDelete = autoRows.slice(0, overflow).map((r) => r.t);
          await Promise.all(
            toDelete.map((t) => handle.snapshots.delete(t)),
          );
        }
      }
      wrote = true;
    });
    return wrote;
  } catch (e) {
    console.warn("WealthTrajectory: failed to maybe-record-monthly", e);
    return false;
  }
}
