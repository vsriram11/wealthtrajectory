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

  it("DOES record an underwater user (negative NW with real accounts — audit fix)", async () => {
    // Round-2 audit fix: the prior <=0 guard locked out
    // legitimately-underwater users (high mortgage + early
    // career = negative NW with non-empty accounts) from any
    // auto-history. With household provided + accounts present,
    // the guard now allows the write to proceed.
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const wrote = await maybeRecordSnapshot(-50_000, hh, 1_700_000_000_000);
    expect(wrote).toBe(true);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0].netWorthUSD).toBe(-50_000);
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

describe("maybeRecordMonthlySnapshot — monthly auto-snapshot policy (R-monthly)", () => {
  const HH = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
  // Pick a non-DST boundary in 2024 so calendar-month math is stable.
  const MARCH_15_2024 = Date.UTC(2024, 2, 15, 10, 0, 0, 0);
  const APRIL_2_2024 = Date.UTC(2024, 3, 2, 14, 0, 0, 0);
  const APRIL_20_2024 = Date.UTC(2024, 3, 20, 8, 0, 0, 0);

  it("writes a row anchored to first-of-month at noon UTC", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    const wrote = await maybeRecordMonthlySnapshot(100_000, HH, MARCH_15_2024);
    expect(wrote).toBe(true);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    // Anchor is March 1 2024 at noon UTC, NOT the call time.
    expect(rows[0].t).toBe(Date.UTC(2024, 2, 1, 12, 0, 0, 0));
    expect(rows[0].netWorthUSD).toBe(100_000);
  });

  it("same-month idempotency: second call within the same calendar month is a no-op", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    expect(
      await maybeRecordMonthlySnapshot(100_000, HH, MARCH_15_2024),
    ).toBe(true);
    expect(
      await maybeRecordMonthlySnapshot(110_000, HH, MARCH_15_2024 + 10 * 24 * 60 * 60 * 1000), // March 25
    ).toBe(false);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    // First call won — the value from the second call did NOT overwrite.
    expect(rows[0].netWorthUSD).toBe(100_000);
  });

  it("new calendar month → new row (April writes alongside the March row)", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    await maybeRecordMonthlySnapshot(100_000, HH, MARCH_15_2024);
    await maybeRecordMonthlySnapshot(125_000, HH, APRIL_2_2024);
    // Another April call still no-ops (April 2 already won this month).
    expect(
      await maybeRecordMonthlySnapshot(135_000, HH, APRIL_20_2024),
    ).toBe(false);
    const rows = await loadSnapshots();
    expect(rows.map((r) => r.netWorthUSD)).toEqual([100_000, 125_000]);
  });

  it("refuses to record on invalid NW / empty household / corrupt input", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    // NaN is always rejected (defense against pathological input).
    expect(await maybeRecordMonthlySnapshot(Number.NaN, HH, MARCH_15_2024)).toBe(false);
    // Empty household is always rejected (no accounts = data not loaded).
    expect(await maybeRecordMonthlySnapshot(100_000, EMPTY_HH, MARCH_15_2024)).toBe(false);
    // No household provided + 0/negative NW → rejected (boot-default guard).
    expect(await maybeRecordMonthlySnapshot(0, undefined, MARCH_15_2024)).toBe(false);
    expect(await maybeRecordMonthlySnapshot(-100, undefined, MARCH_15_2024)).toBe(false);
    expect(await loadSnapshots()).toHaveLength(0);
  });

  it("DOES record an underwater user (negative NW with real accounts — audit fix)", async () => {
    // Round-2 audit underwater-user fix: with a real household
    // (accounts present), negative NW is legitimate (high
    // mortgage + early career) and should be auto-captured.
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    const wrote = await maybeRecordMonthlySnapshot(
      -50_000,
      HH,
      MARCH_15_2024,
    );
    expect(wrote).toBe(true);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0].netWorthUSD).toBe(-50_000);
  });

  it("prunes oldest auto-snapshots when total exceeds maxAutoRows (240-row cap default)", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    // Write 5 monthly rows with a small cap (3) so we can verify
    // the oldest get pruned. Use maxAutoRows=3 so months 1+2 get
    // removed after month 5 is written.
    for (let m = 0; m < 5; m++) {
      const t = Date.UTC(2024, m, 15, 12, 0, 0, 0);
      await maybeRecordMonthlySnapshot(100_000 + m * 1_000, HH, t, 3);
    }
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(3);
    // Newest 3 months remain (Mar/Apr/May = months 2, 3, 4).
    expect(rows.map((r) => r.netWorthUSD)).toEqual([
      102_000, // March
      103_000, // April
      104_000, // May
    ]);
  });

  it("does NOT prune user-labeled snapshots when applying the cap", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot, recordSnapshot } =
      await freshModule();
    // Insert a user-labeled snapshot from JANUARY (very old).
    await recordSnapshot({
      t: Date.UTC(2020, 0, 1, 12, 0, 0, 0),
      netWorthUSD: 50_000,
      label: "Pre-promotion baseline",
      source: "manual",
    });
    // Then write 4 monthly auto-snapshots with cap=2. After the
    // dust settles, the user-labeled row should still be there
    // AND the newest 2 auto-snapshots.
    for (let m = 0; m < 4; m++) {
      const t = Date.UTC(2024, m, 15, 12, 0, 0, 0);
      await maybeRecordMonthlySnapshot(100_000 + m * 1_000, HH, t, 2);
    }
    const rows = await loadSnapshots();
    // 1 labeled + 2 newest auto = 3 total.
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.label === "Pre-promotion baseline")).toBe(true);
    // Auto-rows present: months 2 and 3 (Mar + Apr).
    const autos = rows.filter((r) => r.source === "auto");
    expect(autos.map((r) => r.netWorthUSD).sort()).toEqual([102_000, 103_000]);
  });

  it("does NOT prune UNLABELED MANUAL snapshots (audit BLOCK fix #2 regression pin)", async () => {
    // Critical audit finding: the prior `label == null` heuristic
    // conflated "auto" with "unlabeled user save," silently
    // destroying user data on 240+ month horizons. The
    // source-field fix distinguishes them explicitly.
    const { loadSnapshots, maybeRecordMonthlySnapshot, recordSnapshot } =
      await freshModule();
    // User manually saves WITHOUT a label (SnapshotsManager allows
    // this — draftLabel is optional). Pre-fix, this would be
    // misclassified as auto-prunable.
    await recordSnapshot({
      t: Date.UTC(2020, 0, 1, 12, 0, 0, 0),
      netWorthUSD: 50_000,
      // No label!
      source: "manual",
    });
    // Drive the auto-snapshotter past its cap with cap=2.
    for (let m = 0; m < 4; m++) {
      const t = Date.UTC(2024, m, 15, 12, 0, 0, 0);
      await maybeRecordMonthlySnapshot(100_000 + m * 1_000, HH, t, 2);
    }
    const rows = await loadSnapshots();
    // The unlabeled manual row from 2020 MUST survive.
    expect(rows.some((r) => r.t === Date.UTC(2020, 0, 1, 12, 0, 0, 0))).toBe(true);
    // And it's classified as manual, not auto.
    const manualRow = rows.find(
      (r) => r.t === Date.UTC(2020, 0, 1, 12, 0, 0, 0),
    );
    expect(manualRow?.source).toBe("manual");
  });

  it("LEGACY rows (no source field) are treated as untouchable on prune (back-compat)", async () => {
    // Pre-feature IDB rows lack `source` entirely. The pruner
    // MUST NOT delete them under the source-fix, because we can't
    // tell whether they were auto or manual.
    const { loadSnapshots, maybeRecordMonthlySnapshot, recordSnapshot } =
      await freshModule();
    // Simulate a pre-feature row.
    await recordSnapshot({
      t: Date.UTC(2020, 0, 1, 12, 0, 0, 0),
      netWorthUSD: 50_000,
      // No source, no label — exactly what existed in IDB before this PR.
    });
    for (let m = 0; m < 4; m++) {
      const t = Date.UTC(2024, m, 15, 12, 0, 0, 0);
      await maybeRecordMonthlySnapshot(100_000 + m * 1_000, HH, t, 2);
    }
    const rows = await loadSnapshots();
    // The legacy row must still be there.
    expect(rows.some((r) => r.t === Date.UTC(2020, 0, 1, 12, 0, 0, 0))).toBe(true);
  });

  it("does NOT auto-backfill the monthAnchor slot after the user moves a row elsewhere in the same month (audit fix #4 — phantom row)", async () => {
    // Audit BLOCK: user has a manual snapshot at e.g. May 1.
    // They edit it via SnapshotsManager and move to May 10
    // (different t). May 1 slot is now empty. Auto-snapshotter
    // fires later in May. Old code: sees the May 1 slot empty,
    // writes today's holdings tagged as May 1 → phantom row.
    // Fix: check for ANY row within the current calendar month,
    // not just at the exact anchor.
    const { loadSnapshots, maybeRecordMonthlySnapshot, recordSnapshot } =
      await freshModule();
    // User manually saves at May 10 (after editing the May 1 anchor away).
    const may10 = Date.UTC(2024, 4, 10, 12, 0, 0, 0);
    await recordSnapshot({
      t: may10,
      netWorthUSD: 200_000,
      source: "manual",
      label: "Pre-promotion",
    });
    // Auto-snapshotter fires later in May. Should see the May 10
    // row and skip — NO phantom row at May 1.
    const may20 = Date.UTC(2024, 4, 20, 14, 0, 0, 0);
    const wrote = await maybeRecordMonthlySnapshot(250_000, HH, may20);
    expect(wrote).toBe(false);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe(may10);
  });

  it("moveSnapshot preserves the source field (round-3 audit WARN #7)", async () => {
    // Round-3 audit gap: SnapshotsManager.handleSaveEdit
    // explicitly upgrades source to "manual" on edit, but the
    // underlying moveSnapshot just spreads the row — if a
    // future caller bypasses handleSaveEdit and uses
    // moveSnapshot directly on an auto-row, the row's source
    // must stay intact so prune policy classification stays
    // accurate.
    const { loadSnapshots, moveSnapshot, recordSnapshot } =
      await freshModule();
    await recordSnapshot({
      t: 100,
      netWorthUSD: 1000,
      source: "auto",
    });
    await moveSnapshot(100, 200);
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0].t).toBe(200);
    expect(rows[0].source).toBe("auto");
    // Also for manual rows.
    await moveSnapshot(200, 300);
    const moved = (await loadSnapshots())[0];
    expect(moved.source).toBe("auto"); // unchanged
  });

  it("replaceAllSnapshots is atomic — bulkPut failure rolls back the clear() (round-3 audit gap)", async () => {
    // Documented load-bearing atomicity guarantee in
    // replaceAllSnapshots. If bulkPut throws mid-transaction,
    // the prior clear() MUST also be rolled back so IDB retains
    // the user's pre-restore data. Without this guarantee, a
    // failed Drive restore would silently delete all local
    // snapshots.
    const { loadSnapshots, recordSnapshot, replaceAllSnapshots } =
      await freshModule();
    // Seed two good rows.
    await recordSnapshot({ t: 1, netWorthUSD: 100, source: "manual" });
    await recordSnapshot({ t: 2, netWorthUSD: 200, source: "manual" });
    // Try to restore with a row that will fail the put (using
    // an undefined/NaN primary key — Dexie will reject).
    const badRows = [
      { t: Number.NaN, netWorthUSD: 99 },
    ] as never;
    let threw = false;
    try {
      await replaceAllSnapshots(badRows);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Rollback semantics: the seed rows MUST still be present.
    const rows = await loadSnapshots();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.netWorthUSD).sort()).toEqual([100, 200]);
  });

  it("concurrent maybeRecordSnapshot calls don't double-write (audit fix #7 — transactionality)", async () => {
    // Audit finding: two concurrent invocations both passed the
    // min-interval check before either wrote, then both wrote
    // ~1.5s apart with different `t` values. Wrap-in-transaction
    // fix should serialize the read-check-write.
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const now = 1_700_000_000_000;
    // Fire 5 concurrent calls all "at" the same time.
    const results = await Promise.all([
      maybeRecordSnapshot(100_000, HH, now),
      maybeRecordSnapshot(100_000, HH, now + 1),
      maybeRecordSnapshot(100_000, HH, now + 2),
      maybeRecordSnapshot(100_000, HH, now + 3),
      maybeRecordSnapshot(100_000, HH, now + 4),
    ]);
    // Exactly ONE should have written; the rest no-op via the
    // min-interval guard (now-last.t = 0..4 ms << 12h window).
    const wrote = results.filter((r) => r === true).length;
    expect(wrote).toBe(1);
    expect(await loadSnapshots()).toHaveLength(1);
  });
});

describe("Snapshot.appState — back-compat + per-member preservation", () => {
  // Two-member household with per-member ownership chains —
  // accounts owned by m1, liabilities owned by m2. Verifies the
  // per-member attribution survives a snapshot round-trip.
  const TWO_MEMBER_HH: Household = {
    id: "hh-two",
    members: [
      { id: "m1", displayName: "Alice" },
      { id: "m2", displayName: "Bob" },
    ],
    accounts: [
      {
        id: "a1",
        ownerId: "m1",
        nickname: "Alice 401k",
        kind: "retirement",
        taxTreatment: "tax-deferred",
        institutionId: null,
        holdings: [
          {
            id: "h1",
            assetClass: "stocks",
            geoExposure: "us",
            valueUSD: 50_000,
          } as never,
        ],
      } as never,
    ],
    liabilities: [
      {
        id: "l1",
        ownerId: "m2",
        kind: "mortgage",
        principalUSD: 200_000,
        aprPct: 6.5,
      } as never,
    ],
  };

  const APP_STATE = {
    assumptions: ASSUMP,
    memberAssumptions: {
      m1: { withdrawalRate: 0.035 },
      m2: { expectedInflationRate: 0.04 },
    },
    targetAllocation: { stocks: 0.7, bonds: 0.3 } as never,
    glidePath: null,
    householdAnnualIncomeUSD: 250_000,
    goals: [
      { id: "g1", ownerId: "m1", name: "House", targetUSD: 300_000 } as never,
    ],
    budgetItems: [
      {
        id: "b1",
        ownerId: "m2",
        category: "Housing",
        amountUSD: 4_000,
      } as never,
    ],
    incomeStreams: [
      {
        id: "i1",
        ownerId: "m1",
        kind: "salary",
        annualUSD: 180_000,
      } as never,
    ],
    scenarios: [],
    healthPlans: [],
    healthImportanceWeights: {},
  };

  it("round-trips a snapshot with full appState including per-member overrides + per-member owned collections", async () => {
    const { loadSnapshots, recordSnapshot } = await freshModule();
    const snap = {
      t: Date.UTC(2024, 5, 1, 12, 0, 0, 0),
      netWorthUSD: 500_000,
      household: TWO_MEMBER_HH,
      appState: APP_STATE,
      label: "Mid-year check-in",
    };
    await recordSnapshot(snap as never);
    const [out] = await loadSnapshots();
    // Per-member roster intact.
    expect(out.household?.members.map((m) => m.id)).toEqual(["m1", "m2"]);
    // Per-member ownership chain intact: account → m1, liability → m2.
    expect(out.household?.accounts[0].ownerId).toBe("m1");
    expect(out.household?.liabilities[0].ownerId).toBe("m2");
    // Per-member assumption overrides preserved.
    expect(out.appState?.memberAssumptions?.m1?.withdrawalRate).toBe(0.035);
    expect(out.appState?.memberAssumptions?.m2?.expectedInflationRate).toBe(0.04);
    // Other owner-keyed collections preserved with ownership intact.
    expect(out.appState?.goals?.[0]).toMatchObject({ ownerId: "m1", name: "House" });
    expect(out.appState?.budgetItems?.[0]).toMatchObject({ ownerId: "m2" });
    expect(out.appState?.incomeStreams?.[0]).toMatchObject({ ownerId: "m1" });
    // Aim/target preserved.
    expect(out.appState?.targetAllocation).toEqual({ stocks: 0.7, bonds: 0.3 });
    expect(out.appState?.householdAnnualIncomeUSD).toBe(250_000);
  });

  it("legacy snapshot WITHOUT appState loads cleanly (back-compat with pre-feature JSON exports)", async () => {
    // Pre-feature exports / pre-feature in-IDB rows lack `appState`
    // entirely. The load path MUST tolerate that — consumers read
    // `snapshot.appState?.foo ?? fallback`. This test pins the
    // back-compat contract.
    const { loadSnapshots, recordSnapshot } = await freshModule();
    await recordSnapshot({
      t: Date.UTC(2022, 0, 1, 12, 0, 0, 0),
      netWorthUSD: 100_000,
      household: TWO_MEMBER_HH,
      // No `appState`, no `label` — legacy shape.
    });
    const [out] = await loadSnapshots();
    expect(out.appState).toBeUndefined();
    // Household still loads (the foundation of the legacy form).
    expect(out.household?.members).toHaveLength(2);
    // Consumer-side back-compat pattern works:
    expect(out.appState?.targetAllocation ?? null).toBeNull();
  });

  it("maybeRecordSnapshot persists the appState when supplied (auto-snapshot path)", async () => {
    // Pins that the auto-snapshotter actually writes the new field
    // — without this, the schema change would land silently on
    // manual saves only and the monthly history would have
    // appState=undefined for every auto row.
    const { loadSnapshots, maybeRecordSnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const wrote = await maybeRecordSnapshot(
      150_000,
      hh,
      Date.UTC(2024, 5, 1, 12, 0, 0, 0),
      undefined,
      APP_STATE,
    );
    expect(wrote).toBe(true);
    const [out] = await loadSnapshots();
    expect(out.appState?.assumptions?.withdrawalRate).toBe(0.04);
    expect(out.appState?.goals?.[0]?.id).toBe("g1");
  });

  it("maybeRecordMonthlySnapshot persists the appState when supplied (monthly auto path)", async () => {
    const { loadSnapshots, maybeRecordMonthlySnapshot } = await freshModule();
    const hh = { ...EMPTY_HH, accounts: [{ id: "a1" }] as never };
    const wrote = await maybeRecordMonthlySnapshot(
      150_000,
      hh,
      Date.UTC(2024, 5, 15, 12, 0, 0, 0),
      undefined,
      APP_STATE,
    );
    expect(wrote).toBe(true);
    const [out] = await loadSnapshots();
    expect(out.appState?.householdAnnualIncomeUSD).toBe(250_000);
    expect(out.appState?.memberAssumptions?.m1?.withdrawalRate).toBe(0.035);
  });

  it("replaceAllSnapshots PRESERVES appState (audit-fix regression pin)", async () => {
    // CRITICAL audit finding: the bulkPut row builder previously
    // whitelisted only {t, netWorthUSD, household, label} and
    // silently dropped appState on every Drive-restore / JSON-
    // import path. This test would have caught it.
    const { loadSnapshots, replaceAllSnapshots } = await freshModule();
    const snap = {
      t: Date.UTC(2024, 5, 1, 12),
      netWorthUSD: 500_000,
      household: TWO_MEMBER_HH,
      appState: APP_STATE,
      label: "Round-trip test",
    };
    await replaceAllSnapshots([snap as never]);
    const [out] = await loadSnapshots();
    expect(out.appState).toBeDefined();
    expect(out.appState?.targetAllocation).toEqual({
      stocks: 0.7,
      bonds: 0.3,
    });
    expect(out.appState?.memberAssumptions?.m1?.withdrawalRate).toBe(0.035);
  });

  it("captureSnapshotAppState deep-clones — mutating live state after capture does NOT alter the captured payload", async () => {
    const { captureSnapshotAppState } = await import(
      "@/lib/persistence/snapshotAppState"
    );
    const live = {
      assumptions: { ...ASSUMP },
      memberAssumptions: { m1: { withdrawalRate: 0.035 } },
      targetAllocation: { stocks: 0.7, bonds: 0.3 } as never,
      glidePath: null,
      householdAnnualIncomeUSD: 250_000,
      goals: [{ id: "g1", ownerId: "m1" } as never],
      budgetItems: [{ id: "b1", ownerId: "m2", amountUSD: 4_000 } as never],
      incomeStreams: [],
      scenarios: [],
      healthPlans: [],
      healthImportanceWeights: {},
    };
    const captured = captureSnapshotAppState(live);
    // Mutate the live state in place — captured must NOT change.
    live.assumptions.withdrawalRate = 0.099;
    live.memberAssumptions.m1.withdrawalRate = 0.099;
    (live.budgetItems[0] as { amountUSD: number }).amountUSD = 99_999;
    expect(captured.assumptions?.withdrawalRate).toBe(0.04);
    expect(captured.memberAssumptions?.m1?.withdrawalRate).toBe(0.035);
    expect(
      (captured.budgetItems?.[0] as unknown as { amountUSD: number })
        .amountUSD,
    ).toBe(4_000);
  });
});

describe("Time-travel session persistence — round-trip + lifecycle", () => {
  it("returns null when no session has been saved", async () => {
    const { loadTimeTravelSession } = await freshModule();
    const out = await loadTimeTravelSession();
    expect(out).toBeNull();
  });

  it("round-trips a full session (household + baseline + editing target)", async () => {
    const { loadTimeTravelSession, saveTimeTravelSession } =
      await freshModule();
    const baselineHh: Household = {
      ...EMPTY_HH,
      id: "hh-baseline" as never,
    };
    const editedHh: Household = {
      ...EMPTY_HH,
      id: "hh-edited" as never,
    };
    await saveTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: 1_700_000_000_000,
      household: editedHh,
      assumptions: ASSUMP,
      baselineHousehold: baselineHh,
      baselineAssumptions: ASSUMP,
    });
    const out = await loadTimeTravelSession();
    expect(out).not.toBeNull();
    expect(out!.timeTravelDate).toBe("2023-06-15");
    expect(out!.editingSnapshotT).toBe(1_700_000_000_000);
    expect(out!.household.id).toBe("hh-edited");
    expect(out!.baselineHousehold.id).toBe("hh-baseline");
    expect(out!.savedAt).toBeGreaterThan(0);
  });

  it("clearTimeTravelSession wipes the row independently of the live state", async () => {
    const {
      clearTimeTravelSession,
      loadRealState,
      loadTimeTravelSession,
      saveRealState,
      saveTimeTravelSession,
    } = await freshModule();
    await saveRealState({ household: EMPTY_HH, assumptions: ASSUMP });
    await saveTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: null,
      household: EMPTY_HH,
      assumptions: ASSUMP,
      baselineHousehold: EMPTY_HH,
      baselineAssumptions: ASSUMP,
    });
    await clearTimeTravelSession();
    // Session is gone — but the live state remains untouched.
    expect(await loadTimeTravelSession()).toBeNull();
    expect(await loadRealState()).not.toBeNull();
  });

  it("clearRealState ALSO removes any persisted session (wipe is atomic)", async () => {
    const {
      clearRealState,
      loadTimeTravelSession,
      saveRealState,
      saveTimeTravelSession,
    } = await freshModule();
    await saveRealState({ household: EMPTY_HH, assumptions: ASSUMP });
    await saveTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: null,
      household: EMPTY_HH,
      assumptions: ASSUMP,
      baselineHousehold: EMPTY_HH,
      baselineAssumptions: ASSUMP,
    });
    await clearRealState();
    expect(await loadTimeTravelSession()).toBeNull();
  });

  it("rejects a session row whose schemaVersion is from a future client", async () => {
    const { loadTimeTravelSession, saveTimeTravelSession } =
      await freshModule();
    await saveTimeTravelSession({
      timeTravelDate: "2023-06-15",
      editingSnapshotT: null,
      household: EMPTY_HH,
      assumptions: ASSUMP,
      baselineHousehold: EMPTY_HH,
      baselineAssumptions: ASSUMP,
    });
    const { default: Dexie } = await import("dexie");
    const db = new Dexie("WealthTrajectory");
    db.version(2).stores({ kv: "key", snapshots: "t" });
    const row = await db.table("kv").get("time-travel-session");
    row.value.schemaVersion = 999;
    await db.table("kv").put(row);
    db.close();
    expect(await loadTimeTravelSession()).toBeNull();
  });
});
