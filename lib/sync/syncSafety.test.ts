import { describe, expect, it } from "vitest";
import {
  DriveUnreadableError,
  SHRINKAGE_GUARDED_ARRAY_COLLECTIONS,
  SHRINKAGE_GUARDED_MAP_COLLECTIONS,
  checkShrinkage,
  checkShrinkageAgainstDrive,
} from "@/lib/sync/syncSafety";

describe("checkShrinkage", () => {
  const empty = {
    scenarios: [],
    goals: [],
    budgetItems: [],
    incomeStreams: [],
    healthPlans: [],
    healthImportanceWeights: {},
    memberAssumptions: {},
  };

  it("returns null when no shrinkage", () => {
    expect(checkShrinkage(empty, empty)).toBeNull();
  });

  it("returns null when Drive is empty (nothing to lose)", () => {
    expect(
      checkShrinkage(empty, {
        scenarios: [{ id: "s1" }],
        goals: [],
        budgetItems: [],
        incomeStreams: [],
        healthPlans: [],
        healthImportanceWeights: {},
    memberAssumptions: {},
      }),
    ).toBeNull();
  });

  it("returns null when both have data (not a wipe)", () => {
    expect(
      checkShrinkage(
        { scenarios: [{ id: "s1" }], goals: [], budgetItems: [] },
        {
          scenarios: [{ id: "s2" }],
          goals: [],
          budgetItems: [],
          incomeStreams: [],
          healthPlans: [],
          healthImportanceWeights: {},
    memberAssumptions: {},
        },
      ),
    ).toBeNull();
  });

  it("flags scenarios wipe", () => {
    const r = checkShrinkage(
      { scenarios: [{ id: "s1" }, { id: "s2" }] },
      empty,
    );
    expect(r).not.toBeNull();
    expect(r!.shrinking).toEqual(["scenarios"]);
    expect(r!.driveCounts.scenarios).toBe(2);
    expect(r!.currentCounts.scenarios).toBe(0);
  });

  it("flags multiple wipes", () => {
    const r = checkShrinkage(
      {
        scenarios: [{ id: "s1" }],
        goals: [{ id: "g1" }],
        budgetItems: [{ id: "b1" }],
      },
      empty,
    );
    expect(r!.shrinking.sort()).toEqual(
      ["budgetItems", "goals", "scenarios"].sort(),
    );
  });

  it("treats non-array Drive fields as empty (safe)", () => {
    const r = checkShrinkage(
      { scenarios: undefined, goals: undefined, budgetItems: undefined },
      empty,
    );
    expect(r).toBeNull();
  });

  it("does not flag when current has equal or larger collection", () => {
    const r = checkShrinkage(
      { scenarios: [{ id: "s1" }] },
      {
        scenarios: [{ id: "s1" }],
        goals: [],
        budgetItems: [],
        incomeStreams: [],
        healthPlans: [],
        healthImportanceWeights: {},
    memberAssumptions: {},
      },
    );
    expect(r).toBeNull();
  });

  it("flags healthPlans wipe (Health-tab data has the same N→0 risk)", () => {
    const r = checkShrinkage(
      { healthPlans: [{ id: "hp1" }, { id: "hp2" }] },
      empty,
    );
    expect(r).not.toBeNull();
    expect(r!.shrinking).toEqual(["healthPlans"]);
    expect(r!.driveCounts.healthPlans).toBe(2);
    expect(r!.currentCounts.healthPlans).toBe(0);
  });

  it("flags healthImportanceWeights wipe (sparse-map collection, same risk)", () => {
    // Outbound check: about-to-upload `current` (empty) would wipe
    // Drive's existing weights. THAT is the shrinkage event we
    // refuse — exactly the bug the user-reported guards exist for.
    const r = checkShrinkage(
      { healthImportanceWeights: { m1: { premiumAffordability: 0.8 } } },
      empty,
    );
    expect(r).not.toBeNull();
    expect(r!.shrinking).toContain("healthImportanceWeights");
    expect(r!.driveCounts.healthImportanceWeights).toBe(1);
    expect(r!.currentCounts.healthImportanceWeights).toBe(0);
  });

  it("doesn't flag healthImportanceWeights when both sides have entries", () => {
    const r = checkShrinkage(
      { healthImportanceWeights: { m1: { premiumAffordability: 0.5 } } },
      {
        ...empty,
        healthImportanceWeights: { m2: { mentalHealth: 0.7 } },
      },
    );
    // Neither side is empty → not a shrinkage event.
    expect(r).toBeNull();
  });
});

describe("checkShrinkageAgainstDrive: encryption fail-closed", () => {
  const empty = {
    scenarios: [],
    goals: [],
    budgetItems: [],
    incomeStreams: [],
    healthPlans: [],
    healthImportanceWeights: {},
    memberAssumptions: {},
  };

  it("returns null when Drive content is null (no backup)", async () => {
    expect(await checkShrinkageAgainstDrive(null, null, empty)).toBeNull();
    expect(await checkShrinkageAgainstDrive(undefined, null, empty)).toBeNull();
  });

  it("throws DriveUnreadableError (parse) when Drive content is gibberish", async () => {
    await expect(
      checkShrinkageAgainstDrive("not-json-not-encrypted", null, empty),
    ).rejects.toBeInstanceOf(DriveUnreadableError);
  });

  it("throws DriveUnreadableError (encrypted) when Drive is encrypted and no passphrase", async () => {
    // Forge an encrypted envelope shape (fp-enc-v1). With no
    // passphrase, unwrapBackup throws EncryptedRequiresPassphrase;
    // our wrapper should surface that as a typed error so the
    // caller knows to refuse the upload (rather than silently
    // allowing over the ciphertext).
    const encryptedEnvelope = JSON.stringify({
      schema: "fp-enc-v1",
      salt: "abcd",
      iv: "abcd",
      ciphertext: "abcd",
    });
    let caught: unknown = null;
    try {
      await checkShrinkageAgainstDrive(encryptedEnvelope, null, empty);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DriveUnreadableError);
    expect((caught as DriveUnreadableError).reason).toBe("encrypted");
  });

  it("returns shrinkage report normally for plaintext valid Drive content", async () => {
    const drivePayload = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      scenarios: [{ id: "s1" }],
      goals: [],
      budgetItems: [],
    });
    const r = await checkShrinkageAgainstDrive(drivePayload, null, empty);
    expect(r).not.toBeNull();
    expect(r!.shrinking).toContain("scenarios");
  });
});

/**
 * Regression suite for the "recovery banner doesn't clear every
 * shrinkage-guarded collection" bug. The previous bug: the banner
 * cleared scenarios/goals/budgetItems/healthPlans/healthImportanceWeights
 * on "Accept Drive (lose local)" but FORGOT incomeStreams. Re-pull
 * then re-fired the same guard, leaving users stuck.
 *
 * The fix routes both the guard and the banner through these
 * exported constants. These tests pin the invariant that every
 * collection in the constants list is actually a real shrinkage
 * vector — if anyone removes a collection from the guard logic
 * but forgets to update the constants (or vice versa), one of
 * these tests breaks.
 */
describe("SHRINKAGE_GUARDED constants — symmetric coverage", () => {
  function emptyState() {
    return {
      scenarios: [],
      goals: [],
      budgetItems: [],
      incomeStreams: [],
      healthPlans: [],
      healthImportanceWeights: {},
    memberAssumptions: {},
    };
  }

  it("array collections list includes incomeStreams (regression for the recovery-banner bug)", () => {
    expect(
      (SHRINKAGE_GUARDED_ARRAY_COLLECTIONS as readonly string[]).includes(
        "incomeStreams",
      ),
    ).toBe(true);
  });

  it("every guarded array collection actually triggers checkShrinkage when populated locally and missing from drive", () => {
    // For each collection in the list, construct a state where Drive
    // is empty but local has one item of that collection. The guard
    // must flag THAT collection by name. If we add a collection to
    // the constant but forget to wire it into the loop, this test
    // catches it.
    for (const k of SHRINKAGE_GUARDED_ARRAY_COLLECTIONS) {
      const populatedLocal = { ...emptyState(), [k]: [{ id: "x" }] };
      // checkShrinkage compares (drive, current) flagging Drive>0 && current=0.
      // The inbound-direction test uses the reverse — and is covered
      // separately in cloudSync's path. Here we test the OUTBOUND
      // direction: a previously-populated Drive vs an empty current
      // state should flag the same collection.
      const r = checkShrinkage(populatedLocal, emptyState());
      expect(r, `should flag ${k}`).not.toBeNull();
      expect(r!.shrinking).toContain(k);
    }
  });

  it("every guarded map collection actually triggers checkShrinkage when populated", () => {
    for (const k of SHRINKAGE_GUARDED_MAP_COLLECTIONS) {
      const populatedLocal = {
        ...emptyState(),
        [k]: { someKey: "someValue" },
      };
      const r = checkShrinkage(populatedLocal, emptyState());
      expect(r, `should flag ${k}`).not.toBeNull();
      expect(r!.shrinking).toContain(k);
    }
  });
});
