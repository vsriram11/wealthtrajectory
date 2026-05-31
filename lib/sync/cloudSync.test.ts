// @vitest-environment jsdom
/**
 * cloudSync.ts is the load-bearing safety layer between the
 * household state and Drive. Every code path that touches Drive
 * MUST go through pullFromDrive / pushToDrive — direct
 * uploadBackup calls bypass the shrinkage guard + encryption
 * checks and have shipped data-loss bugs.
 *
 * These tests mock googleAuth + googleDrive at module level so
 * we can drive the full pull/push flow through the safety
 * checks without hitting the network. We DON'T mock crypto or
 * dataIO — those are pure and exercised end-to-end here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ───── Module mocks ──────────────────────────────────────────
//
// Hoisted via vi.mock so the cloudSync import below picks them up.
vi.mock("@/lib/sync/googleAuth", () => ({
  getAccessToken: vi.fn(async () => "test-access-token"),
}));

vi.mock("@/lib/sync/googleDrive", () => ({
  findBackupFile: vi.fn(),
  downloadBackup: vi.fn(),
  uploadBackup: vi.fn(),
}));

import { useAppStore } from "@/lib/store";
import { pullFromDrive, pushToDrive } from "@/lib/sync/cloudSync";
import {
  findBackupFile,
  downloadBackup,
  uploadBackup,
} from "@/lib/sync/googleDrive";

const findBackupFileMock = vi.mocked(findBackupFile);
const downloadBackupMock = vi.mocked(downloadBackup);
const uploadBackupMock = vi.mocked(uploadBackup);

beforeEach(() => {
  useAppStore.getState().resetToDemo();
  // Reset the sync slice fields too — resetToDemo doesn't wipe
  // them, so blocked-reason / passphrase / encryption-flag /
  // lastSyncAt from a previous test would leak. Without this
  // every test that relies on a clean googleSyncBlockedReason
  // sees the residue of the last test that set it.
  useAppStore.getState().setGoogleSyncState({
    googleSyncing: false,
    googleSyncError: null,
    googleLastSyncAt: null,
    googleSyncBlockedReason: null,
    googleUploadScheduled: false,
  });
  useAppStore.setState({
    encryptionPassphrase: null,
    driveEncryptionEnabled: false,
    // Clear demo seeds the sync tests don't need. resetToDemo()
    // now restores DEMO_INCOME_STREAMS + DEMO_BUDGET (and other
    // late-seeded collections may follow); the cloud-sync tests
    // check sync MECHANICS, not data round-trips, so we explicitly
    // null these so the shrinkage guard doesn't spuriously fire on
    // a Drive payload that just doesn't bother including them.
    incomeStreams: [],
    budgetItems: [],
    // Layer 1 added `household.accounts` to the shrinkage-guarded set,
    // so the same clear-for-sync-test reasoning applies: zero out
    // local accounts so a Drive payload with [] accounts doesn't
    // trip a false-positive shrinkage on every sync test.
    household: {
      ...useAppStore.getState().household,
      accounts: [],
    },
    // Sign in.
    user: {
      sub: "test-sub",
      email: "test@test",
      name: "Test",
      pictureUrl: null,
      emailVerified: true,
    },
  });
  findBackupFileMock.mockReset();
  downloadBackupMock.mockReset();
  uploadBackupMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────
// pullFromDrive — pre-flight guards
// ─────────────────────────────────────────────────────────────

describe("pullFromDrive — pre-flight guards", () => {
  it("bails 'no-backup' when no user is signed in", async () => {
    useAppStore.setState({ user: null });
    expect(await pullFromDrive(useAppStore)).toBe("no-backup");
  });

  it("bails 'throttled' when googleSyncing is already in flight", async () => {
    useAppStore.getState().setGoogleSyncState({ googleSyncing: true });
    expect(await pullFromDrive(useAppStore)).toBe("throttled");
  });

  it("bails 'throttled' when a time-travel session is active (Audit R10)", async () => {
    // A pull mid-session would call importPayload, which replaces
    // the in-memory household — destroying the session's
    // hypothetical edits AND the baseline pointer used by
    // exitTimeTravelDiscard. The user's backdated work would vanish
    // silently. Particularly important post-PR-#18, where a demo
    // user can enter time-travel and then sign in.
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2020-01-01",
      baselineHousehold: useAppStore.getState().household,
      baselineAssumptions: useAppStore.getState().assumptions,
    });
    expect(await pullFromDrive(useAppStore)).toBe("throttled");
  });

  it("bails 'throttled' when an upload is queued (race protection)", async () => {
    // Race scenario: a backgrounded tab's CloudSyncer queued an
    // upload via setTimeout. Tab returns. pullFromDrive must NOT
    // pull in this window — overwriting local edits with stale
    // Drive state, then the queued upload would push the
    // overwritten payload out. Catastrophic data loss.
    useAppStore.getState().setGoogleSyncState({ googleUploadScheduled: true });
    expect(await pullFromDrive(useAppStore)).toBe("throttled");
    // Setting the flag is the CloudSyncer's job — pullFromDrive
    // must not touch it on a guarded bail.
    expect(useAppStore.getState().googleUploadScheduled).toBe(true);
  });

  it("force: true bypasses throttle / sync-in-flight / queued-upload checks", async () => {
    // Used by SyncShrinkageBanner's "Accept Drive (lose local)"
    // flow. The user has explicitly opted to overwrite local;
    // a debounced CloudSyncer upload (scheduled by the very
    // setState that cleared local for the override) would
    // otherwise re-trigger the throttle check and block the
    // consent. Regression for the bug where the shrinkage-
    // recovery banner would loop on "Re-pull failed
    // (shrinkage-blocked)" because the throttle returned first.
    const { findBackupFile, downloadBackup } = await import(
      "@/lib/sync/googleDrive"
    );
    (
      findBackupFile as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null); // no Drive backup → "no-backup" result, but
    // critically that means we got PAST the throttle checks. Existing
    // test infra mocks Drive responses; what matters here is that
    // googleUploadScheduled=true + googleSyncing=true don't short-
    // circuit when force is set.
    useAppStore.getState().setGoogleSyncState({
      googleSyncing: true,
      googleUploadScheduled: true,
      googleLastSyncAt: Date.now(),
    });
    const result = await pullFromDrive(useAppStore, { force: true });
    // We got past the throttle checks — result is "no-backup" because
    // findBackupFile returned null, not "throttled".
    expect(result).toBe("no-backup");
    void downloadBackup; // referenced for type-only import below
  });

  it("bails 'throttled' when last sync was within throttle window", async () => {
    useAppStore.getState().setGoogleSyncState({
      googleLastSyncAt: Date.now() - 10_000, // 10s ago
    });
    expect(
      await pullFromDrive(useAppStore, { throttle: true, throttleMs: 60_000 }),
    ).toBe("throttled");
  });

  it("allows the pull through when last sync was outside the throttle window", async () => {
    useAppStore.getState().setGoogleSyncState({
      googleLastSyncAt: Date.now() - 5 * 60 * 1000, // 5 min ago
    });
    findBackupFileMock.mockResolvedValueOnce(null);
    expect(
      await pullFromDrive(useAppStore, { throttle: true, throttleMs: 60_000 }),
    ).toBe("no-backup");
  });
});

// ─────────────────────────────────────────────────────────────
// pullFromDrive — main flow
// ─────────────────────────────────────────────────────────────

describe("pullFromDrive — main flow", () => {
  it("returns 'no-backup' and clears blocked reason when Drive has no file", async () => {
    findBackupFileMock.mockResolvedValueOnce(null);
    useAppStore
      .getState()
      .setGoogleSyncState({ googleSyncBlockedReason: "encrypted" });
    expect(await pullFromDrive(useAppStore)).toBe("no-backup");
    // googleSyncBlockedReason gets cleared on no-backup so a
    // stale "encrypted" banner doesn't linger once Drive
    // confirms there's nothing to read.
    expect(useAppStore.getState().googleSyncBlockedReason).toBeNull();
    expect(useAppStore.getState().googleSyncing).toBe(false);
  });

  it("returns 'ok' and imports a plaintext payload", async () => {
    findBackupFileMock.mockResolvedValueOnce({
      id: "file-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    // Build a valid export payload using the real exportData so
    // parseImport accepts it. Importing a fresh household with
    // members so the demo-fixture import doesn't reset to demo.
    const { exportData } = await import("@/lib/persistence/dataIO");
    const payload = exportData({
      household: {
        id: "h-pulled",
        members: [{ id: "m-pulled", displayName: "From Drive" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      scenarios: [],
    });
    downloadBackupMock.mockResolvedValueOnce(payload);
    const out = await pullFromDrive(useAppStore);
    expect(out).toBe("ok");
    // Household replaced with the imported one.
    expect(useAppStore.getState().household.id).toBe("h-pulled");
    expect(useAppStore.getState().googleSyncing).toBe(false);
    // Successful sync stamps lastSyncAt; future throttled calls
    // would now bail until that stamp ages out.
    expect(useAppStore.getState().googleLastSyncAt).not.toBeNull();
    expect(useAppStore.getState().googleSyncError).toBeNull();
  });

  it("returns 'encrypted' when Drive ciphertext is present but no passphrase loaded", async () => {
    findBackupFileMock.mockResolvedValueOnce({
      id: "file-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    // Encrypt an empty payload with a passphrase.
    const { encryptString } = await import("@/lib/sync/crypto");
    const ciphertext = await encryptString("{}", "test-passphrase");
    downloadBackupMock.mockResolvedValueOnce(ciphertext);
    // No passphrase in store — unwrap will throw EncryptedRequiresPassphrase.
    useAppStore.setState({ encryptionPassphrase: null });

    const out = await pullFromDrive(useAppStore);
    expect(out).toBe("encrypted");
    // Encryption blocked reason set so the unlock banner shows.
    expect(useAppStore.getState().googleSyncBlockedReason).toBe("encrypted");
    // driveEncryptionEnabled flag persisted so a fresh tab on
    // the same device knows to prompt for the passphrase
    // before even attempting a sync.
    expect(useAppStore.getState().driveEncryptionEnabled).toBe(true);
  });

  it("returns 'ok' when ciphertext + correct passphrase are present", async () => {
    findBackupFileMock.mockResolvedValueOnce({
      id: "file-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const { exportData } = await import("@/lib/persistence/dataIO");
    const plaintext = exportData({
      household: {
        id: "h-enc",
        members: [{ id: "m-enc", displayName: "From Encrypted Drive" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      scenarios: [],
    });
    const { encryptString } = await import("@/lib/sync/crypto");
    const ciphertext = await encryptString(plaintext, "right-passphrase");
    downloadBackupMock.mockResolvedValueOnce(ciphertext);
    useAppStore.setState({ encryptionPassphrase: "right-passphrase" });

    expect(await pullFromDrive(useAppStore)).toBe("ok");
    expect(useAppStore.getState().household.id).toBe("h-enc");
  });

  it("returns 'shrinkage-blocked' when accepting Drive would wipe non-empty local scenarios", async () => {
    findBackupFileMock.mockResolvedValueOnce({
      id: "file-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    // Drive payload has empty scenarios; local has scenarios.
    const { exportData } = await import("@/lib/persistence/dataIO");
    const payload = exportData({
      household: {
        id: "h",
        members: [{ id: "m", displayName: "Test" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      scenarios: [],
    });
    downloadBackupMock.mockResolvedValueOnce(payload);
    // Seed local scenarios so the guard fires.
    useAppStore.setState({
      scenarios: [
        {
          id: "sc-local",
          name: "Local Scenario",
          color: "#000",
          createdAt: 0,
          overrides: {},
        },
      ],
    });

    const out = await pullFromDrive(useAppStore);
    expect(out).toBe("shrinkage-blocked");
    expect(useAppStore.getState().googleSyncBlockedReason).toBe(
      "import-shrinkage",
    );
    // Local scenarios preserved — the WHOLE point of the guard.
    expect(useAppStore.getState().scenarios).toHaveLength(1);
    expect(useAppStore.getState().scenarios[0].id).toBe("sc-local");
  });

  it("skipShrinkageCheck: true imports the Drive payload anyway, replacing local (Accept Drive recovery)", async () => {
    // Regression for the bug where SyncShrinkageBanner's "Accept
    // Drive (lose local)" looped on shrinkage-blocked because
    // pre-clearing local collections couldn't reliably win the
    // race against subscribers / timing. The semantic fix is
    // for the caller to declare consent explicitly via
    // skipShrinkageCheck, and for pullFromDrive to honor it.
    findBackupFileMock.mockResolvedValueOnce({
      id: "file-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const { exportData } = await import("@/lib/persistence/dataIO");
    // Drive payload has empty scenarios; local has scenarios.
    const payload = exportData({
      household: {
        id: "h-from-drive",
        members: [{ id: "m", displayName: "FromDrive" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      scenarios: [],
    });
    downloadBackupMock.mockResolvedValueOnce(payload);
    // Seed local scenarios — without skipShrinkageCheck this WOULD
    // trip the guard.
    useAppStore.setState({
      scenarios: [
        {
          id: "sc-local",
          name: "Local Scenario",
          color: "#000",
          createdAt: 0,
          overrides: {},
        },
      ],
    });

    const out = await pullFromDrive(useAppStore, {
      skipShrinkageCheck: true,
    });
    // Got past the guard and imported Drive's content.
    expect(out).toBe("ok");
    expect(useAppStore.getState().googleSyncBlockedReason).toBeNull();
    // Local scenarios were OVERWRITTEN with Drive's empty array —
    // exactly the "lose local" semantics the user opted into.
    expect(useAppStore.getState().scenarios).toEqual([]);
    expect(useAppStore.getState().household.id).toBe("h-from-drive");
  });

  it("returns 'error' when getAccessToken rejects (network / auth failure)", async () => {
    const { getAccessToken } = await import("@/lib/sync/googleAuth");
    vi.mocked(getAccessToken).mockRejectedValueOnce(new Error("auth blew up"));
    const out = await pullFromDrive(useAppStore);
    expect(out).toBe("error");
    expect(useAppStore.getState().googleSyncError).toContain("auth blew up");
    expect(useAppStore.getState().googleSyncing).toBe(false);
    // Restore for subsequent tests.
    vi.mocked(getAccessToken).mockResolvedValue("test-access-token");
  });
});

// ─────────────────────────────────────────────────────────────
// pushToDrive — pre-flight guards
// ─────────────────────────────────────────────────────────────

describe("pushToDrive — pre-flight guards", () => {
  it("returns 'error' when no user is signed in", async () => {
    useAppStore.setState({ user: null });
    expect(await pushToDrive(useAppStore)).toBe("error");
  });

  it("returns 'error' when mode is still demo", async () => {
    // resetToDemo in beforeEach already sets demo mode.
    expect(useAppStore.getState().mode).toBe("demo");
    // Initial sync gate also kicks in, but mode === demo wins.
    expect(await pushToDrive(useAppStore)).toBe("error");
  });

  it("returns 'error' when household is still the verbatim demo seed (Layer 3)", async () => {
    // Layer 3 guard: even after auto-promotion to real mode, a
    // verbatim demo household must not be pushed to Drive. The
    // catastrophic scenario is a user signing in on a new device
    // with real Drive data; if findBackupFile returns null on a
    // stale-index race, the eager push would PATCH the real backup
    // with the demo seed. This guard refuses the push at the
    // chokepoint regardless of which caller routed here.
    const { DEMO_HOUSEHOLD } = await import("@/lib/demo");
    useAppStore.setState({
      mode: "real",
      // Reset the test's pre-cleared accounts back to the demo
      // shape so isDemoHouseholdStrict returns true.
      household: DEMO_HOUSEHOLD,
      googleLastSyncAt: Date.now(),
    });
    const out = await pushToDrive(useAppStore);
    expect(out).toBe("error");
    // Surfaces a user-visible message so a "Sync now" click
    // doesn't fail silently — the user needs to know what to do.
    expect(useAppStore.getState().googleSyncError).toMatch(/demo seed/i);
  });

  it("returns 'error' when a time-travel session is active (Audit R10)", async () => {
    // A user mid-backdating-session has a HYPOTHETICAL household in
    // memory. Pushing it to Drive would overwrite their actual
    // present-day backup. Sign-in is the failure path PR #18 made
    // reachable: demo + time-travel + first holding-edit promotes
    // to real, and a sign-in click at that moment used to call
    // pushToDrive with the hypothetical household.
    useAppStore.setState({
      mode: "real",
      household: {
        id: "h-real",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
      timeTravelActive: true,
      timeTravelDate: "2020-01-01",
      baselineHousehold: {
        id: "h-real",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
      baselineAssumptions: useAppStore.getState().assumptions,
    });
    expect(await pushToDrive(useAppStore)).toBe("error");
    // Surface an explanatory message — "Sync now" clicks while
    // mid-session shouldn't fail silently. Pinned so a future
    // refactor doesn't drop the user-facing reason.
    expect(useAppStore.getState().googleSyncError).toMatch(
      /time-travel/i,
    );
  });

  it("returns 'blocked-by-encryption' when blocked reason is already 'encrypted'", async () => {
    useAppStore.setState({
      mode: "real",
      household: {
        id: "h-real",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
    });
    useAppStore
      .getState()
      .setGoogleSyncState({ googleSyncBlockedReason: "encrypted" });
    expect(await pushToDrive(useAppStore)).toBe("blocked-by-encryption");
  });

  it("returns 'blocked-by-encryption' when this device knows encryption is set up but has no passphrase loaded", async () => {
    useAppStore.setState({
      mode: "real",
      household: {
        id: "h-real",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
      driveEncryptionEnabled: true,
      encryptionPassphrase: null,
    });
    // Critical cross-device guard: a freshly-signed-in second
    // device that hasn't yet unlocked must NOT upload plaintext
    // on top of the encrypted Drive backup. Silent encryption
    // downgrade is the data-loss bug this guards against.
    expect(await pushToDrive(useAppStore)).toBe("blocked-by-encryption");
    expect(useAppStore.getState().googleSyncBlockedReason).toBe("encrypted");
  });

  it("returns 'blocked-by-initial-sync' when googleLastSyncAt is null and bypass is off", async () => {
    useAppStore.setState({ mode: "real" });
    useAppStore.setState({
      household: {
        id: "h",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
    });
    useAppStore.getState().setGoogleSyncState({ googleLastSyncAt: null });
    expect(await pushToDrive(useAppStore)).toBe("blocked-by-initial-sync");
    expect(useAppStore.getState().googleSyncError).toContain("initial");
  });

  it("allows push through when bypassInitialSyncGate is true (fresh-account upload-local)", async () => {
    useAppStore.setState({ mode: "real" });
    useAppStore.setState({
      household: {
        id: "h",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
    });
    useAppStore.getState().setGoogleSyncState({ googleLastSyncAt: null });
    findBackupFileMock.mockResolvedValueOnce(null);
    uploadBackupMock.mockResolvedValueOnce({
      id: "new",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const out = await pushToDrive(useAppStore, { bypassInitialSyncGate: true });
    expect(out).toBe("ok");
    expect(uploadBackupMock).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────
// pushToDrive — main flow
// ─────────────────────────────────────────────────────────────

describe("pushToDrive — main flow", () => {
  function seedRealHousehold() {
    useAppStore.setState({
      mode: "real",
      household: {
        id: "h",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
    });
    useAppStore
      .getState()
      .setGoogleSyncState({ googleLastSyncAt: Date.now() });
  }

  it("returns 'ok' and uploads plaintext when no passphrase is set", async () => {
    seedRealHousehold();
    findBackupFileMock.mockResolvedValueOnce(null); // no existing file
    uploadBackupMock.mockResolvedValueOnce({
      id: "new",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const out = await pushToDrive(useAppStore);
    expect(out).toBe("ok");
    // Plaintext payload — first call to uploadBackup gets the
    // raw exportData JSON, no envelope wrapping.
    expect(uploadBackupMock).toHaveBeenCalledOnce();
    const [, body] = uploadBackupMock.mock.calls[0];
    expect(body).toContain('"household"');
  });

  it("returns 'ok' and uploads ciphertext when a passphrase is set", async () => {
    seedRealHousehold();
    useAppStore.setState({
      encryptionPassphrase: "right-passphrase",
      driveEncryptionEnabled: true,
    });
    findBackupFileMock.mockResolvedValueOnce(null);
    uploadBackupMock.mockResolvedValueOnce({
      id: "new",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const out = await pushToDrive(useAppStore);
    expect(out).toBe("ok");
    const [, body] = uploadBackupMock.mock.calls[0];
    // Ciphertext envelope rather than plaintext JSON — the
    // payload starts with the envelope schema marker.
    expect(body).toContain('"schema":"fp-enc-v1"');
    // The original plaintext "household" key must NOT appear.
    expect(body).not.toContain('"household"');
  });

  it("returns 'blocked-by-shrinkage' when Drive has scenarios but local doesn't", async () => {
    seedRealHousehold();
    // Drive has 2 scenarios; local has 0.
    findBackupFileMock.mockResolvedValueOnce({
      id: "drive-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const { exportData } = await import("@/lib/persistence/dataIO");
    const driveText = exportData({
      household: {
        id: "h",
        members: [{ id: "m", displayName: "U" }],
        accounts: [],
        liabilities: [],
      },
      assumptions: useAppStore.getState().assumptions,
      scenarios: [
        {
          id: "sc-1",
          name: "On Drive",
          color: "#000",
          createdAt: 0,
          overrides: {},
        },
        {
          id: "sc-2",
          name: "Also on Drive",
          color: "#000",
          createdAt: 0,
          overrides: {},
        },
      ],
    });
    downloadBackupMock.mockResolvedValueOnce(driveText);

    const out = await pushToDrive(useAppStore);
    expect(out).toBe("blocked-by-shrinkage");
    expect(useAppStore.getState().googleSyncBlockedReason).toBe(
      "import-shrinkage",
    );
    // Upload NEVER fires when the shrinkage guard trips.
    expect(uploadBackupMock).not.toHaveBeenCalled();
  });

  it("returns 'blocked-by-encryption' when Drive is encrypted and the shrinkage check can't decrypt", async () => {
    seedRealHousehold();
    findBackupFileMock.mockResolvedValueOnce({
      id: "drive-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const { encryptString } = await import("@/lib/sync/crypto");
    const driveCipher = await encryptString("{}", "drive-passphrase");
    downloadBackupMock.mockResolvedValueOnce(driveCipher);
    // No passphrase in store — the shrinkage check fails-closed
    // with DriveUnreadableError("encrypted"), which we surface as
    // blocked-by-encryption to route the user to the unlock banner.
    useAppStore.setState({ encryptionPassphrase: null });

    const out = await pushToDrive(useAppStore);
    expect(out).toBe("blocked-by-encryption");
    expect(useAppStore.getState().googleSyncBlockedReason).toBe("encrypted");
    expect(uploadBackupMock).not.toHaveBeenCalled();
  });

  it("bypassShrinkageGuard: true skips the guard and uploads anyway (manual override)", async () => {
    seedRealHousehold();
    // Even with a shrinkage condition, the bypass flag lets the
    // upload proceed. Used by SyncShrinkageBanner's "keep local"
    // action — an explicit, acknowledged data-loss override.
    findBackupFileMock.mockResolvedValueOnce({
      id: "drive-id",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    uploadBackupMock.mockResolvedValueOnce({
      id: "new",
      modifiedTime: "2026-05-15T00:00:00Z",
    });
    const out = await pushToDrive(useAppStore, { bypassShrinkageGuard: true });
    expect(out).toBe("ok");
    // The Drive-read step is skipped entirely on bypass; only
    // the upload itself fires.
    expect(downloadBackupMock).not.toHaveBeenCalled();
    expect(uploadBackupMock).toHaveBeenCalledOnce();
  });

  it("returns 'error' when uploadBackup itself rejects", async () => {
    seedRealHousehold();
    findBackupFileMock.mockResolvedValueOnce(null);
    uploadBackupMock.mockRejectedValueOnce(new Error("network down"));
    const out = await pushToDrive(useAppStore);
    expect(out).toBe("error");
    expect(useAppStore.getState().googleSyncError).toContain("network down");
    expect(useAppStore.getState().googleSyncing).toBe(false);
  });
});
