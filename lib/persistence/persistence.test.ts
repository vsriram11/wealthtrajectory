// @vitest-environment jsdom
/**
 * persistence.ts exercises Dexie + IndexedDB. We point it at
 * fake-indexeddb so the real Dexie code paths run against an
 * in-memory IDB store — no module-level mocking of dexie itself,
 * so the test catches Dexie schema / transaction bugs that a
 * shallow mock would miss.
 *
 * Each test uses a fresh fake IDB instance + re-imports the
 * module so the module-level `db` singleton starts clean.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assumptions, Household } from "@/lib/types";

const EMPTY_HH: Household = {
  id: "test",
  members: [{ id: "m1", displayName: "Tester" }],
  accounts: [],
  liabilities: [],
};

const ASSUMP: Assumptions = {
  targetNetWorthUSD: 2_000_000,
  withdrawalRate: 0.04,
  legacyFloorUSD: 0,
  drawdownHorizonYears: 30,
  expectedInflationRate: 0.03,
};

async function freshModule() {
  // Reset the module so `db` (a singleton) is recreated for each
  // test. Each test will then open a NEW database name to avoid
  // accumulating state across tests (fake-indexeddb doesn't reset
  // between modules unless we delete the DB explicitly).
  vi.resetModules();
  const { indexedDB: idb } = await import("fake-indexeddb");
  // Drop the default WealthTrajectory DB so each test starts clean.
  try {
    idb.deleteDatabase("WealthTrajectory");
  } catch {
    /* nothing to drop on first run */
  }
  return import("@/lib/persistence/persistence");
}

beforeEach(async () => {
  // Belt-and-suspenders cleanup: explicitly drop the DB before
  // each test. Otherwise residual state from earlier tests can
  // bleed in through Dexie's connection cache.
  const { indexedDB: idb } = await import("fake-indexeddb");
  await new Promise<void>((resolve) => {
    const req = idb.deleteDatabase("WealthTrajectory");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadRealState / saveRealState round-trip", () => {
  it("returns null when nothing has been saved yet", async () => {
    const { loadRealState } = await freshModule();
    const out = await loadRealState();
    expect(out).toBeNull();
  });

  it("saves a state and reads it back with all optional fields preserved", async () => {
    const { loadRealState, saveRealState } = await freshModule();
    await saveRealState({
      household: EMPTY_HH,
      assumptions: ASSUMP,
      memberAssumptions: { m1: { withdrawalRate: 0.035 } },
      preferredMemberId: "m1",
      goals: [],
      budgetItems: [],
      scenarios: [],
      driveEncryptionEnabled: true,
      householdAnnualIncomeUSD: 180_000,
    });
    const out = await loadRealState();
    // Every optional field round-trips. A regression that
    // dropped one on the save (e.g. forgot to spread an arg)
    // would surface as undefined here.
    expect(out).not.toBeNull();
    expect(out!.household).toEqual(EMPTY_HH);
    expect(out!.assumptions).toEqual(ASSUMP);
    expect(out!.memberAssumptions).toEqual({ m1: { withdrawalRate: 0.035 } });
    expect(out!.preferredMemberId).toBe("m1");
    expect(out!.driveEncryptionEnabled).toBe(true);
    expect(out!.householdAnnualIncomeUSD).toBe(180_000);
    // savedAt is stamped at save time — must be a recent ms epoch.
    expect(out!.savedAt).toBeGreaterThan(0);
  });

  it("returns null when the persisted schema version doesn't match (future-proof rejection)", async () => {
    const { loadRealState, saveRealState } = await freshModule();
    await saveRealState({ household: EMPTY_HH, assumptions: ASSUMP });

    // Manually corrupt the stored row's schemaVersion to simulate
    // an older save format that a newer client shouldn't load.
    const { default: Dexie } = await import("dexie");
    const db = new Dexie("WealthTrajectory");
    db.version(2).stores({ kv: "key", snapshots: "t" });
    const row = await db.table("kv").get("real-state");
    row.value.schemaVersion = 999;
    await db.table("kv").put(row);
    db.close();

    const out = await loadRealState();
    // Schema-version mismatch → null, NOT a crash. The hydrator
    // then falls back to the demo, which is the safe default.
    expect(out).toBeNull();
  });

  it("clearRealState wipes both kv and snapshots tables", async () => {
    const { clearRealState, loadRealState, loadSnapshots, recordSnapshot, saveRealState } =
      await freshModule();
    await saveRealState({ household: EMPTY_HH, assumptions: ASSUMP });
    await recordSnapshot({ t: 1_700_000_000_000, netWorthUSD: 500_000 });
    expect(await loadRealState()).not.toBeNull();
    expect(await loadSnapshots()).toHaveLength(1);

    await clearRealState();
    // Both tables must be empty — sign-out should leave NO
    // residue. A regression that only cleared one table would
    // leak stale data into a fresh sign-in's session.
    expect(await loadRealState()).toBeNull();
    expect(await loadSnapshots()).toHaveLength(0);
  });
});

describe("snapshots — record / load / delete / move", () => {
  it("recordSnapshot + loadSnapshots round-trips with full household composition", async () => {
    const { loadSnapshots, recordSnapshot } = await freshModule();
    const snap = {
      t: 1_700_000_000_000,
      netWorthUSD: 1_234_567,
      household: EMPTY_HH,
      label: "Pre-promotion",
    };
    await recordSnapshot(snap);
    const out = await loadSnapshots();
    expect(out).toHaveLength(1);
    // Full shape preserved — the chart's "snapshot tooltip"
    // reads label + household.composition; both must survive.
    expect(out[0]).toEqual(snap);
  });

  it("loadSnapshots prunes NaN/Infinity ONLY — keeps zero and negative NW (legitimate underwater state)", async () => {
    // Audit R1 MED: a user with high mortgage debt and low assets
    // (early-career, post-divorce, etc.) legitimately has negative
    // NW and must be able to record snapshots of that state. Only
    // genuinely-corrupt NaN/Infinity rows are purged.
    const { loadSnapshots, recordSnapshot } = await freshModule();
    await recordSnapshot({ t: 1, netWorthUSD: 100_000 });
    await recordSnapshot({ t: 2, netWorthUSD: 0 });           // legitimate zero
    await recordSnapshot({ t: 3, netWorthUSD: -500 });        // legitimate negative
    await recordSnapshot({ t: 4, netWorthUSD: Number.NaN });  // corrupt
    await recordSnapshot({ t: 5, netWorthUSD: 200_000 });
    const out = await loadSnapshots();
    // Zero + negative are kept; only NaN is purged from IDB.
    expect(out.map((s) => s.netWorthUSD)).toEqual([100_000, 0, -500, 200_000]);
    const reloaded = await loadSnapshots();
    expect(reloaded).toEqual(out);
  });

  it("snapshots load in ascending t order regardless of insert order", async () => {
    const { loadSnapshots, recordSnapshot } = await freshModule();
    await recordSnapshot({ t: 300, netWorthUSD: 30 });
    await recordSnapshot({ t: 100, netWorthUSD: 10 });
    await recordSnapshot({ t: 200, netWorthUSD: 20 });
    const out = await loadSnapshots();
    // The history chart paints left→right in time; a Dexie query
    // that returned them in insert order instead of sorted-by-t
    // would render a sawtooth.
    expect(out.map((s) => s.t)).toEqual([100, 200, 300]);
  });

  it("deleteSnapshot removes the row at the given t", async () => {
    const { deleteSnapshot, loadSnapshots, recordSnapshot } = await freshModule();
    await recordSnapshot({ t: 100, netWorthUSD: 10 });
    await recordSnapshot({ t: 200, netWorthUSD: 20 });
    await deleteSnapshot(100);
    const out = await loadSnapshots();
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe(200);
  });

  it("moveSnapshot relocates the row from oldT to newT, preserving payload", async () => {
    const { loadSnapshots, moveSnapshot, recordSnapshot } = await freshModule();
    const original = {
      t: 100,
      netWorthUSD: 99_999,
      household: EMPTY_HH,
      label: "Original",
    };
    await recordSnapshot(original);
    await moveSnapshot(100, 500);
    const out = await loadSnapshots();
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe(500);
    // Payload (NW, household, label) survives the move. The
    // snapshot manager UI uses moveSnapshot when the user
    // backdates an entry; losing the household composition
    // would silently break the past-composition chart.
    expect(out[0].netWorthUSD).toBe(99_999);
    expect(out[0].household).toEqual(EMPTY_HH);
    expect(out[0].label).toBe("Original");
  });

  it("moveSnapshot is a no-op when oldT doesn't exist", async () => {
    const { loadSnapshots, moveSnapshot, recordSnapshot } = await freshModule();
    await recordSnapshot({ t: 100, netWorthUSD: 10 });
    await moveSnapshot(999, 500); // 999 doesn't exist
    const out = await loadSnapshots();
    // The existing snapshot at t=100 must NOT be touched. A
    // regression that wrote a default to newT could create a
    // phantom snapshot in the user's history.
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe(100);
  });
});

describe("maybeRecordSnapshot — auto-snapshot guard", () => {
  it("refuses zero or negative net worth (poison guard)", async () => {
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    await maybeRecordSnapshot(0);
    await maybeRecordSnapshot(-1);
    await maybeRecordSnapshot(Number.NaN);
    // None of those should have produced a snapshot — the
    // canonical bug the function exists to prevent is
    // PersistenceHydrator firing before household state hydrates,
    // landing a $0 snapshot that poisons every chart bucket.
    expect(await loadSnapshots()).toHaveLength(0);
  });

  it("refuses to record when household has no accounts (still hydrating)", async () => {
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    await maybeRecordSnapshot(100_000, EMPTY_HH); // EMPTY_HH has zero accounts
    expect(await loadSnapshots()).toHaveLength(0);
  });

  it("debounces to once per minIntervalMs", async () => {
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const start = 1_700_000_000_000;
    await maybeRecordSnapshot(100_000, hh, start);
    // Second call inside the 12h debounce window — must be a no-op.
    await maybeRecordSnapshot(110_000, hh, start + 60_000);
    const out = await loadSnapshots();
    expect(out).toHaveLength(1);
    expect(out[0].netWorthUSD).toBe(100_000);
  });

  it("records a new snapshot after minIntervalMs has elapsed", async () => {
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const start = 1_700_000_000_000;
    await maybeRecordSnapshot(100_000, hh, start);
    // Skip past the 12h debounce window.
    await maybeRecordSnapshot(150_000, hh, start + 13 * 60 * 60 * 1000);
    const out = await loadSnapshots();
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.netWorthUSD).sort()).toEqual([100_000, 150_000]);
  });

  it("applies a custom minIntervalMs override", async () => {
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const start = 1_700_000_000_000;
    // Very small interval — any subsequent call > 100ms apart
    // should land a new snapshot. Lets tests verify the param
    // is wired through, not hardcoded.
    await maybeRecordSnapshot(100_000, hh, start, 100);
    await maybeRecordSnapshot(110_000, hh, start + 500, 100);
    expect(await loadSnapshots()).toHaveLength(2);
  });

  it("returns true when a row is written, false on every no-op path (R1-D7 audit pin)", async () => {
    // R1-D7 audit CRITICAL: PersistenceHydrator's auto-snapshotter
    // calls bumpSnapshotsRevision only when a row is ACTUALLY
    // written. The function must therefore distinguish between
    // "wrote a row" (true) and "skipped" (false). Without this
    // signal, callers either bump every 1.5s (amplifying upload
    // debounce) or never bump (silent local-only auto-snapshots).
    const { maybeRecordSnapshot } = await freshModule();
    // Invalid NW → false
    expect(await maybeRecordSnapshot(0)).toBe(false);
    expect(await maybeRecordSnapshot(-1)).toBe(false);
    expect(await maybeRecordSnapshot(Number.NaN)).toBe(false);
    // Empty household → false
    expect(await maybeRecordSnapshot(100_000, EMPTY_HH)).toBe(false);
    // Valid first write → true
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const start = 1_700_000_000_000;
    expect(await maybeRecordSnapshot(100_000, hh, start)).toBe(true);
    // Second call inside debounce window → false (no-op).
    expect(
      await maybeRecordSnapshot(110_000, hh, start + 60_000),
    ).toBe(false);
    // Outside debounce → true.
    expect(
      await maybeRecordSnapshot(150_000, hh, start + 13 * 60 * 60 * 1000),
    ).toBe(true);
  });
});
