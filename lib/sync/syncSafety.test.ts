import { describe, expect, it } from "vitest";
import {
  DriveUnreadableError,
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
