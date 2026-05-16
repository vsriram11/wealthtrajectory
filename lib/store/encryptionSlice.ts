/**
 * End-to-end-encryption state for the Google Drive backup.
 *
 * The split between an in-memory `encryptionPassphrase` and a
 * persisted `driveEncryptionEnabled` flag exists because we don't
 * want the passphrase itself on disk (an attacker with IDB access
 * could decrypt the backup), but we DO need to remember across
 * sessions whether encryption is in use so the UI can show the
 * "unlock" prompt instead of treating a fresh tab as "encryption
 * was never set up."
 *
 * Setting a non-null passphrase implicitly flips the flag on;
 * clearing the passphrase (to null) does NOT touch the flag —
 * use `disableDriveEncryption()` for that.
 */

export type EncryptionSliceState = {
  /**
   * In-memory only. Set by the user at runtime; never serialized
   * to IndexedDB or transmitted to Drive. Cloud sync wraps the
   * export payload using this passphrase before upload.
   */
  encryptionPassphrase: string | null;
  /**
   * Persisted flag. True when the user has ever set a passphrase
   * for this app instance (or when a remote-encrypted backup was
   * detected on Drive). Drives the UI's "Drive is locked — enter
   * passphrase to sync" banner.
   */
  driveEncryptionEnabled: boolean;
};

export type EncryptionSliceActions = {
  /**
   * Sets the in-memory passphrase. Non-null values also flip
   * driveEncryptionEnabled on; explicit nulls clear the
   * passphrase but leave the flag alone (so the "Drive is
   * locked" UI still appears on the next session).
   */
  setEncryptionPassphrase: (passphrase: string | null) => void;
  /** Clears BOTH the passphrase and the persisted flag. */
  disableDriveEncryption: () => void;
};

export const ENCRYPTION_SLICE_INITIAL: EncryptionSliceState = {
  encryptionPassphrase: null,
  driveEncryptionEnabled: false,
};

export function createEncryptionSliceActions(
  set: (
    fn: (s: EncryptionSliceState) => Partial<EncryptionSliceState>,
  ) => void,
): EncryptionSliceActions {
  return {
    setEncryptionPassphrase: (passphrase) => {
      const valid =
        passphrase != null && passphrase.length > 0 ? passphrase : null;
      set((s) => ({
        encryptionPassphrase: valid,
        driveEncryptionEnabled: valid != null ? true : s.driveEncryptionEnabled,
      }));
    },
    disableDriveEncryption: () =>
      set(() => ({
        encryptionPassphrase: null,
        driveEncryptionEnabled: false,
      })),
  };
}
