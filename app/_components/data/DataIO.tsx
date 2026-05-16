"use client";

import { useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { exportData, parseImport } from "@/lib/persistence/dataIO";
import { encryptString, looksEncrypted, unwrapBackup } from "@/lib/sync/crypto";

/**
 * Local export / import. Available to every user — no Google
 * sign-in required.
 *
 * Encryption integration:
 *   - When the user has set up a passphrase (via EncryptionCard),
 *     EXPORT seals the JSON payload with AES-256-GCM in the same
 *     fp-enc-v1 envelope format Drive sync uses. The downloaded
 *     file is byte-for-byte equivalent to what Drive would have
 *     stored.
 *   - IMPORT auto-detects encrypted files. If the loaded
 *     passphrase decrypts successfully, the import proceeds.
 *     Otherwise the card surfaces an inline passphrase entry so
 *     the user can try a different passphrase without leaving
 *     the Data page.
 *   - Plaintext exports + imports continue to work for users
 *     who haven't enabled encryption. Legacy files (pre-feature)
 *     import cleanly via the plaintext path.
 *
 * Pro gating: this card is intentionally OUTSIDE any ProGate or
 * SignInGate. The export/import path is the free, sign-in-free,
 * cross-device alternative to Drive sync — see
 * docs/OAUTH_VERIFICATION.md for the rationale on why the OSS
 * build keeps this universal.
 */
export function DataIO() {
  const household = useAppStore((s) => s.household);
  const assumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const preferredMemberId = useAppStore((s) => s.preferredMemberId);
  const targetAllocation = useAppStore((s) => s.targetAllocation);
  const glidePath = useAppStore((s) => s.glidePath);
  const householdAnnualIncomeUSD = useAppStore(
    (s) => s.householdAnnualIncomeUSD,
  );
  const scenarios = useAppStore((s) => s.scenarios);
  const goals = useAppStore((s) => s.goals);
  const budgetItems = useAppStore((s) => s.budgetItems);
  const incomeStreams = useAppStore((s) => s.incomeStreams);
  const healthPlans = useAppStore((s) => s.healthPlans);
  const healthImportanceWeights = useAppStore(
    (s) => s.healthImportanceWeights,
  );
  const importPayload = useAppStore((s) => s.importPayload);
  const passphrase = useAppStore((s) => s.encryptionPassphrase);

  const [error, setError] = useState<string | null>(null);
  // Pending-decrypt state — when the user picks an encrypted
  // file and the loaded passphrase (if any) can't decrypt it.
  // We hold the ciphertext + show an inline passphrase entry so
  // the user can supply the right one without leaving the page.
  const [pendingCiphertext, setPendingCiphertext] = useState<string | null>(
    null,
  );
  const [decryptInput, setDecryptInput] = useState("");
  const [showDecrypt, setShowDecrypt] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onPick = () => {
    setError(null);
    setPendingCiphertext(null);
    setDecryptInput("");
    fileRef.current?.click();
  };

  /**
   * Common path: given decrypted plaintext JSON, parse + dispatch
   * to the store. Surfaces parse / shape errors inline.
   */
  const ingestPlaintext = (plaintext: string) => {
    try {
      const parsed = parseImport(plaintext);
      importPayload({
        household: parsed.household,
        assumptions: parsed.assumptions,
        scenarios: parsed.scenarios ?? [],
        memberAssumptions: parsed.memberAssumptions,
        preferredMemberId: parsed.preferredMemberId,
        targetAllocation: parsed.targetAllocation,
        glidePath: parsed.glidePath,
        householdAnnualIncomeUSD: parsed.householdAnnualIncomeUSD,
        goals: parsed.goals,
        budgetItems: parsed.budgetItems,
        incomeStreams: parsed.incomeStreams,
        healthPlans: parsed.healthPlans,
        healthImportanceWeights: parsed.healthImportanceWeights,
      });
      setError(null);
      setPendingCiphertext(null);
      setDecryptInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await f.text();
    if (!looksEncrypted(text)) {
      // Plaintext import — common case for users without
      // encryption enabled, and for legacy exports.
      ingestPlaintext(text);
      return;
    }
    // Encrypted import. Try the currently-loaded passphrase
    // first — if it works, the user doesn't have to retype.
    if (passphrase) {
      try {
        const plain = await unwrapBackup(text, passphrase);
        ingestPlaintext(plain);
        return;
      } catch {
        // Loaded passphrase didn't work — fall through to the
        // inline entry. Don't surface "wrong passphrase" yet;
        // the user might be importing a file from a different
        // session.
      }
    }
    // Surface the inline passphrase entry. The ciphertext is
    // held in state until the user types the right key (or
    // cancels).
    setPendingCiphertext(text);
  };

  const tryDecryptPending = async () => {
    setError(null);
    if (!pendingCiphertext || !decryptInput) {
      setError("Enter the passphrase that was used when exporting.");
      return;
    }
    try {
      const plain = await unwrapBackup(pendingCiphertext, decryptInput);
      ingestPlaintext(plain);
    } catch {
      // Decryption failed — almost certainly a wrong
      // passphrase, though a corrupted envelope would also
      // land here. We don't distinguish in the UI because the
      // user's action is the same either way: try again.
      setError(
        "That passphrase didn't decrypt the file. Check for typos and try again.",
      );
    }
  };

  const cancelDecrypt = () => {
    setPendingCiphertext(null);
    setDecryptInput("");
    setError(null);
  };

  const onExport = async () => {
    setError(null);
    try {
      const plainJSON = exportData({
        household,
        assumptions,
        scenarios,
        memberAssumptions,
        preferredMemberId,
        targetAllocation,
        glidePath,
        householdAnnualIncomeUSD,
        goals,
        budgetItems,
        incomeStreams,
        healthPlans,
        healthImportanceWeights,
      });
      // Seal with the loaded passphrase when present —
      // otherwise emit plaintext. The user opts into
      // encryption via the EncryptionCard above; this card
      // just respects whatever they chose there.
      const payload = passphrase
        ? await encryptString(plainJSON, passphrase)
        : plainJSON;
      if (typeof window === "undefined") return;
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      const suffix = passphrase ? "-encrypted" : "";
      a.href = url;
      a.download = `wealthtrajectory-${stamp}${suffix}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">Your data</span>
              {passphrase ? (
                <span
                  className="rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-positive"
                  title="Exports will be encrypted with your loaded passphrase."
                >
                  Encrypted
                </span>
              ) : (
                <span
                  className="rounded-full border border-border-strong bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted"
                  title="Exports will be plaintext JSON. Set up a passphrase above to encrypt them."
                >
                  Plaintext
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Export to JSON for backup or moving between browsers,
              devices, or cloud-storage providers. Importing replaces
              your current data and switches to the imported state.
              {passphrase
                ? " Files are sealed with your passphrase — even if intercepted, they're unreadable without it."
                : " Set up a passphrase above to encrypt exports before they leave the tab."}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onExport}
              aria-label={
                passphrase
                  ? "Export encrypted JSON"
                  : "Export plaintext JSON"
              }
              className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              Export
            </button>
            <button
              type="button"
              onClick={onPick}
              aria-label="Import JSON file"
              className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onFile}
            />
          </div>
        </div>

        {pendingCiphertext && (
          <div
            className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 p-3"
            role="region"
            aria-label="Encrypted file passphrase entry"
          >
            <div className="text-[12px] font-medium text-amber-300">
              File is encrypted — enter the passphrase to decrypt
            </div>
            <p className="mt-1 text-[11px] text-text-dim">
              Your loaded passphrase didn&apos;t match this file. Try
              the one you used when you exported it.
            </p>
            <input
              type={showDecrypt ? "text" : "password"}
              value={decryptInput}
              onChange={(e) => setDecryptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void tryDecryptPending();
              }}
              placeholder="Passphrase used for this file"
              autoComplete="current-password"
              aria-label="Passphrase used for this file"
              className="mt-2 w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
            />
            <label className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={showDecrypt}
                onChange={(e) => setShowDecrypt(e.target.checked)}
                className="accent-accent"
              />
              Show
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={cancelDecrypt}
                className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-xs text-text-muted active:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={tryDecryptPending}
                className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg active:opacity-80"
              >
                Decrypt & import
              </button>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-negative/40 bg-negative/10 px-2 py-1 text-[11px] text-negative"
          >
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
