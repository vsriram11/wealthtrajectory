"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { pullFromDrive } from "@/lib/sync/cloudSync";

/**
 * End-to-end encryption preference card. Available to every user
 * — no sign-in required. The same AES-256-GCM passphrase
 * controls BOTH:
 *
 *   - Local exports / imports on the Data page (Drive-free path)
 *   - Drive backup ciphertext, when the user signs in (Pro path)
 *
 * Same crypto module (`lib/crypto.ts`), same envelope format
 * (`schema: "fp-enc-v1"`). A file exported locally and uploaded
 * back to Drive is byte-for-byte equivalent to a file Drive
 * would have synced directly. Users move freely between paths
 * without re-encrypting.
 *
 * UX model:
 *   - Setting a passphrase enables encryption for both surfaces.
 *   - The passphrase is in-memory only — never persisted to IDB
 *     or Drive. Closing the tab clears it; on next open the user
 *     re-enters it before they can read their encrypted data.
 *   - Clearing the passphrase reverts to plaintext for both
 *     surfaces. Existing encrypted backups won't auto-decrypt;
 *     the user must re-enter the passphrase to read them.
 *
 * Anti-foot-gun safety:
 *   - Two-field entry on first set (confirm) so a typo doesn't
 *     lock the user out of their next session.
 *   - "We can't recover this passphrase" hint — encryption is
 *     real, no escrow.
 *   - When the user is signed in, the next Drive write after
 *     enabling re-uploads the existing data as ciphertext,
 *     automatically rotating the plaintext copy on Drive.
 *
 * Back-compat note on naming: the underlying flag is named
 * `driveEncryptionEnabled` for historical reasons (encryption
 * shipped first for Drive). Semantically it now means
 * "encryption is enabled at all" — applies to local exports too.
 * Renaming the flag would risk back-compat (it lives in IDB +
 * Drive payloads from previous sessions); the field name stays,
 * the meaning generalizes.
 */
export function EncryptionCard() {
  const user = useAppStore((s) => s.user);
  const passphrase = useAppStore((s) => s.encryptionPassphrase);
  const driveEncryptionEnabled = useAppStore(
    (s) => s.driveEncryptionEnabled,
  );
  const setPassphrase = useAppStore((s) => s.setEncryptionPassphrase);
  const disableDriveEncryption = useAppStore(
    (s) => s.disableDriveEncryption,
  );

  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlocked = passphrase != null;
  // Three states: never enabled, remembered-but-locked (flag
  // set, passphrase wiped by tab close), and unlocked
  // (passphrase loaded into the in-memory slice).
  const remembered = driveEncryptionEnabled && !unlocked;
  const enabled = unlocked;
  const signedIn = user != null;

  const enable = () => {
    setError(null);
    if (!draft || draft.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (draft !== confirm) {
      setError("Passphrase and confirmation don't match.");
      return;
    }
    setPassphrase(draft);
    setDraft("");
    setConfirm("");
  };

  const unlock = async () => {
    setError(null);
    if (!draft) {
      setError("Enter your passphrase to decrypt.");
      return;
    }
    setPassphrase(draft);
    // If the user is signed in, immediately re-pull from Drive
    // with the new passphrase so they don't have to chase a
    // separate "Sync now" button. If the passphrase was wrong,
    // pullFromDrive returns "encrypted" — clear it so the next
    // attempt starts clean. Without Drive sign-in, the unlock
    // just loads the passphrase into memory for local-export
    // use; nothing to sync.
    if (signedIn) {
      const result = await pullFromDrive(useAppStore, { silent: true });
      if (result === "encrypted") {
        setPassphrase(null);
        setError(
          "That passphrase didn't unlock the backup. Check for typos and try again.",
        );
        return;
      }
    }
    setDraft("");
  };

  const disable = () => {
    disableDriveEncryption();
    setDraft("");
    setConfirm("");
    setError(null);
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              End-to-end encryption
              {enabled && (
                <span className="rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-positive">
                  Active
                </span>
              )}
              {remembered && (
                <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                  Locked
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {enabled
                ? signedIn
                  ? "Encryption active for this tab — local exports + your Drive backup are sealed with AES-256-GCM."
                  : "Encryption active for this tab — local exports are sealed with AES-256-GCM. Sign in for Drive sync to extend the seal across devices."
                : remembered
                  ? "You set up encryption before. The passphrase is kept in-memory only, so this tab needs it again to read encrypted exports + any Drive backup."
                  : "Set a passphrase to encrypt your local exports with AES-256-GCM. The passphrase stays in this tab only — we never send or store it. Signed-in users get the same seal applied to Drive sync."}
            </div>
          </div>
        </div>

        {remembered && (
          <div className="mt-3 space-y-2">
            <input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlock();
              }}
              placeholder="Enter your passphrase to unlock"
              autoComplete="current-password"
              aria-label="Encryption passphrase"
              className="w-full rounded-md border border-amber-300/50 bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
            />
            <label className="flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="accent-accent"
              />
              Show
            </label>
            {error && (
              <div
                role="alert"
                className="rounded-md border border-negative/40 bg-negative/5 px-2 py-1 text-[11px] text-negative"
              >
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={unlock}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg active:opacity-80"
            >
              {signedIn ? "Unlock & sync" : "Unlock"}
            </button>
            <div className="text-[10px] text-text-dim">
              We remember that encryption is set up, but the passphrase
              itself only lives in this tab — never on disk and never
              sent over the network.
            </div>
            <button
              type="button"
              onClick={disable}
              className="mt-1 w-full rounded-md border border-negative/40 bg-bg-elevated px-3 py-2 text-[11px] font-medium text-negative active:opacity-70"
            >
              Forgot it? Stop using encryption (future exports
              {signedIn ? " + Drive writes " : " "}will be plaintext)
            </button>
          </div>
        )}

        {!enabled && !remembered && (
          <div className="mt-3 space-y-2">
            <input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Passphrase (≥ 8 chars)"
              aria-label="New encryption passphrase"
              className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
              autoComplete="new-password"
            />
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm passphrase"
              aria-label="Confirm passphrase"
              className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
              autoComplete="new-password"
            />
            <label className="flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="accent-accent"
              />
              Show
            </label>
            {error && (
              <div
                role="alert"
                className="rounded-md border border-negative/40 bg-negative/5 px-2 py-1 text-[11px] text-negative"
              >
                {error}
              </div>
            )}
            <div className="rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[11px] text-amber-300">
              <span className="font-medium">No recovery.</span> If you
              forget this passphrase, your encrypted exports
              {signedIn ? " + Drive backup " : " "}are unreadable.
              Keep it somewhere safe (password manager, paper).
            </div>
            <button
              type="button"
              onClick={enable}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg active:opacity-80"
            >
              Enable encryption
            </button>
          </div>
        )}

        {enabled && (
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[11px] text-text-dim">
              Passphrase loaded for this tab. Closing or refreshing
              clears it from memory; you&apos;ll re-enter it on next
              open to decrypt
              {signedIn
                ? " local imports or your Drive backup."
                : " local imports."}
            </div>
            <button
              type="button"
              onClick={disable}
              className="w-full rounded-md border border-negative/40 bg-bg-elevated px-3 py-2 text-sm font-medium text-negative active:opacity-70"
            >
              Disable encryption (future exports
              {signedIn ? " + Drive writes" : ""} will be plaintext)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
