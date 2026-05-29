// @vitest-environment jsdom
/**
 * End-to-end integration: snapshot lifecycle from write through
 * History-engine consumption. Catches breakage at the seams that
 * unit tests on individual modules don't see — e.g. a field added
 * to the Snapshot type but missed by the persistence write layer,
 * the dataIO coercion, or the engine that consumes the rows.
 *
 * Touches: persistence write/read, JSON round-trip, replaceAllSnapshots,
 * buildAssetClassSeries, summarizeClassReturns, captureSnapshotAppState.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshModules() {
  vi.resetModules();
  const { indexedDB: idb } = await import("fake-indexeddb");
  try {
    idb.deleteDatabase("WealthTrajectory");
  } catch {
    /* no-op on first run */
  }
  return {
    persistence: await import("@/lib/persistence/persistence"),
    snapshotAppState: await import("@/lib/persistence/snapshotAppState"),
    dataIO: await import("@/lib/persistence/dataIO"),
    historicalReturns: await import("@/lib/portfolio/historicalReturns"),
    demoSnapshots: await import("@/lib/demoSnapshots"),
    types: await import("@/lib/types"),
  };
}

beforeEach(async () => {
  const { indexedDB: idb } = await import("fake-indexeddb");
  try {
    idb.deleteDatabase("WealthTrajectory");
  } catch {
    /* no-op */
  }
});

describe("snapshot lifecycle — end-to-end integration", () => {
  it("write → loadSnapshots → buildAssetClassSeries → summarizeClassReturns", async () => {
    const {
      persistence,
      historicalReturns,
      demoSnapshots,
    } = await freshModules();
    // Use the demo snapshot generator as the source of "realistic"
    // data. 60 monthly snapshots × multiple asset classes.
    const now = Date.UTC(2026, 4, 15, 12);
    const snaps = demoSnapshots.buildDemoSnapshots(now, 60);
    // Persist them all through the public write API.
    await persistence.replaceAllSnapshots(snaps);
    const loaded = await persistence.loadSnapshots();
    expect(loaded).toHaveLength(60);
    // The engine consumes them and produces per-class series.
    const buckets = historicalReturns.buildAssetClassSeries(loaded);
    expect(Object.keys(buckets).length).toBeGreaterThan(0);
    // Each bucket has one point per snapshot it appears in.
    for (const [, ser] of Object.entries(buckets)) {
      expect(ser!.length).toBeGreaterThan(0);
      expect(ser!.length).toBeLessThanOrEqual(60);
    }
    // Summary rows compute without throwing.
    const rows = historicalReturns.summarizeClassReturns(buckets);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // CAGR may be null for monotone or noisy series; if present,
      // must be finite.
      if (row.cagr != null) expect(Number.isFinite(row.cagr)).toBe(true);
      if (row.totalReturn != null)
        expect(Number.isFinite(row.totalReturn)).toBe(true);
    }
  });

  it("appState round-trips through write → loadSnapshots (no field stripping)", async () => {
    const { persistence } = await freshModules();
    const snap = {
      t: Date.UTC(2024, 5, 1, 12),
      netWorthUSD: 500_000,
      source: "manual" as const,
      label: "Mid-year",
      household: {
        id: "hh",
        members: [{ id: "m1", displayName: "Tester" }],
        accounts: [],
        liabilities: [],
      },
      appState: {
        assumptions: {
          targetNetWorthUSD: 2_000_000,
          withdrawalRate: 0.04,
          legacyFloorUSD: 0,
          drawdownHorizonYears: 30,
          expectedInflationRate: 0.03,
        },
        memberAssumptions: { m1: { withdrawalRate: 0.035 } },
        targetAllocation: { equity: 0.7, bond: 0.3 },
        glidePath: null,
        householdAnnualIncomeUSD: 250_000,
        goals: [],
        budgetItems: [],
        incomeStreams: [],
        scenarios: [],
        healthPlans: [],
        healthImportanceWeights: {},
      },
    };
    await persistence.recordSnapshot(snap as never);
    const [loaded] = await persistence.loadSnapshots();
    expect(loaded.source).toBe("manual");
    expect(loaded.appState?.memberAssumptions?.m1?.withdrawalRate).toBe(0.035);
    expect(loaded.appState?.targetAllocation).toEqual({
      equity: 0.7,
      bond: 0.3,
    });
    expect(loaded.appState?.householdAnnualIncomeUSD).toBe(250_000);
  });

  it("end-to-end JSON export → import preserves every Snapshot field", async () => {
    const {
      persistence,
      dataIO,
    } = await freshModules();
    // Write a snapshot with every field populated, then export to
    // JSON, then import, then verify all fields round-trip.
    const t0 = Date.UTC(2024, 5, 1, 12);
    const snap = {
      t: t0,
      netWorthUSD: 500_000,
      source: "manual" as const,
      label: "Round-trip test",
      household: {
        id: "hh",
        members: [{ id: "m1", displayName: "Tester" }],
        accounts: [],
        liabilities: [],
      },
      appState: {
        targetAllocation: { equity: 0.8 },
      },
    };
    await persistence.recordSnapshot(snap as never);
    const snapshots = await persistence.loadSnapshots();
    const json = dataIO.exportData({
      household: {
        id: "hh",
        members: [],
        accounts: [],
        liabilities: [],
      },
      assumptions: {
        targetNetWorthUSD: 2_000_000,
        withdrawalRate: 0.04,
        legacyFloorUSD: 0,
        drawdownHorizonYears: 30,
        expectedInflationRate: 0.03,
      },
      scenarios: [],
      snapshots,
    } as never);
    const parsed = dataIO.parseImport(json);
    expect(parsed.snapshots).toHaveLength(1);
    const row = (parsed.snapshots as Array<Record<string, unknown>>)[0];
    expect(row.t).toBe(t0);
    expect(row.source).toBe("manual");
    expect(row.label).toBe("Round-trip test");
    expect(row.household).toBeDefined();
    expect(row.appState).toEqual({ targetAllocation: { equity: 0.8 } });
  });

  it("Drive-restore scenario: replaceAllSnapshots preserves source + appState (audit fix regression pin)", async () => {
    const { persistence } = await freshModules();
    // Simulate a Drive pull: incoming snapshots have full payload.
    const incoming = [
      {
        t: Date.UTC(2024, 0, 1, 12),
        netWorthUSD: 100_000,
        source: "auto" as const,
        appState: {
          targetAllocation: { equity: 0.7 },
        },
      },
      {
        t: Date.UTC(2024, 1, 1, 12),
        netWorthUSD: 110_000,
        source: "manual" as const,
        label: "Promotion",
        household: {
          id: "hh",
          members: [],
          accounts: [],
          liabilities: [],
        },
      },
    ];
    await persistence.replaceAllSnapshots(incoming as never);
    const loaded = await persistence.loadSnapshots();
    expect(loaded).toHaveLength(2);
    const m1 = loaded.find((r) => r.netWorthUSD === 100_000);
    expect(m1?.source).toBe("auto");
    expect(m1?.appState?.targetAllocation).toEqual({ equity: 0.7 });
    const m2 = loaded.find((r) => r.netWorthUSD === 110_000);
    expect(m2?.source).toBe("manual");
    expect(m2?.label).toBe("Promotion");
  });

  it("rollup cascade: filtered household snapshots produce subset buckets", async () => {
    const { persistence, historicalReturns, types } = await freshModules();
    // Build a 2-member household: Alice owns equity, Bob owns bonds.
    const hh = {
      id: "hh",
      members: [
        { id: "m1", displayName: "Alice" },
        { id: "m2", displayName: "Bob" },
      ],
      accounts: [
        {
          id: "a1",
          ownerId: "m1",
          nickname: "Alice 401k",
          kind: "brokerage" as const,
          taxTreatment: "taxable" as const,
          institutionId: null,
          holdings: [
            {
              id: "h1",
              kind: "equity" as const,
              valueUSD: 100_000,
            },
          ],
        },
        {
          id: "a2",
          ownerId: "m2",
          nickname: "Bob IRA",
          kind: "brokerage" as const,
          taxTreatment: "taxable" as const,
          institutionId: null,
          holdings: [
            {
              id: "h2",
              kind: "bond" as const,
              valueUSD: 50_000,
            },
          ],
        },
      ],
      liabilities: [],
    };
    const snap = {
      t: Date.UTC(2024, 5, 1, 12),
      netWorthUSD: 150_000,
      household: hh,
      source: "manual" as const,
    };
    await persistence.recordSnapshot(snap as never);
    const loaded = await persistence.loadSnapshots();
    // Household-wide: both equity + bond buckets present.
    const householdBuckets = historicalReturns.buildAssetClassSeries(loaded);
    expect(householdBuckets.equity?.[0]?.valueUSD).toBe(100_000);
    expect(householdBuckets.bond?.[0]?.valueUSD).toBe(50_000);
    // Filter to Alice (m1): only equity should appear.
    const aliceScoped = loaded.map((s) => ({
      ...s,
      household: types.filterHousehold(s.household!, "m1"),
    }));
    const aliceBuckets = historicalReturns.buildAssetClassSeries(aliceScoped);
    expect(aliceBuckets.equity?.[0]?.valueUSD).toBe(100_000);
    expect(aliceBuckets.bond).toBeUndefined();
  });

  it("captureSnapshotAppState → recordSnapshot → loadSnapshots round-trip preserves identity-deep state", async () => {
    const { persistence, snapshotAppState } = await freshModules();
    // Build a fake "live state" subset matching SnapshotAppStateInput.
    const live = {
      assumptions: {
        targetNetWorthUSD: 2_000_000,
        withdrawalRate: 0.04,
        legacyFloorUSD: 0,
        drawdownHorizonYears: 30,
        expectedInflationRate: 0.03,
      },
      memberAssumptions: { m1: { withdrawalRate: 0.035 } },
      targetAllocation: { equity: 0.75, bond: 0.25 } as never,
      glidePath: null,
      householdAnnualIncomeUSD: 250_000,
      goals: [{ id: "g1", ownerId: "m1", name: "House", targetUSD: 300_000 } as never],
      budgetItems: [],
      incomeStreams: [],
      scenarios: [],
      healthPlans: [],
      healthImportanceWeights: {},
    };
    const captured = snapshotAppState.captureSnapshotAppState(live);
    // Mutate live state — captured must NOT see the change.
    live.assumptions.withdrawalRate = 0.099;
    expect(captured.assumptions?.withdrawalRate).toBe(0.04);
    // Round-trip through IDB.
    await persistence.recordSnapshot({
      t: 1_700_000_000_000,
      netWorthUSD: 500_000,
      appState: captured,
      source: "manual",
    });
    const [loaded] = await persistence.loadSnapshots();
    expect(loaded.appState?.assumptions?.withdrawalRate).toBe(0.04);
    expect(loaded.appState?.goals?.[0]).toMatchObject({ ownerId: "m1" });
  });
});
