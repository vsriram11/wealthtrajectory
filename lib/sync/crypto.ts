/**
 * Web Crypto helpers for end-to-end encrypted Drive backups
 * (IP §6.2). The user supplies a passphrase; we derive an
 * AES-256-GCM key via PBKDF2 (250K iterations, random salt per
 * envelope) and seal the JSON payload. The passphrase never
 * touches the wire and is never persisted server-side — it lives
 * in memory for the session, optionally in sessionStorage if the
 * user opts in.
 *
 * Envelope format (JSON, base64-encoded binary fields):
 *   {
 *     schema: "fp-enc-v1",
 *     salt: "<base64>",          // 16 random bytes
 *     iv: "<base64>",            // 12 random bytes (AES-GCM nonce)
 *     ciphertext: "<base64>"     // includes the GCM auth tag
 *   }
 *
 * The schema field lets the loader differentiate ciphertext from
 * legacy plaintext JSON.
 */

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_LENGTH_BITS = 256;

export type EncryptedEnvelope = {
  schema: "fp-enc-v1";
  salt: string;
  iv: string;
  ciphertext: string;
};

export function looksEncrypted(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { schema?: string };
    return parsed?.schema === "fp-enc-v1";
  } catch {
    return false;
  }
}

/**
 * Try to surface plaintext JSON regardless of whether the input is a
 * legacy plaintext export or an fp-enc-v1 envelope. When ciphertext
 * is detected, attempts decryption with the provided passphrase;
 * throws a typed error the caller can branch on (the AuthHydrator /
 * GoogleSyncCard surface a passphrase prompt on `EncryptedRequiresPassphrase`).
 */
export class EncryptedRequiresPassphrase extends Error {
  constructor() {
    super(
      "Backup is encrypted; supply a passphrase to decrypt",
    );
    this.name = "EncryptedRequiresPassphrase";
  }
}

export async function unwrapBackup(
  text: string,
  passphrase: string | null,
): Promise<string> {
  if (!looksEncrypted(text)) return text;
  if (!passphrase) throw new EncryptedRequiresPassphrase();
  return decryptString(text, passphrase);
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  // Pass the Uint8Array view rather than `.buffer` — Node 20's Web
  // Crypto implementation rejects raw ArrayBuffer for the
  // `Pbkdf2Params.salt` slot (it accepts ArrayBufferView only).
  // Browsers + Node 22+ accept either, so the typed-array form
  // works everywhere.
  const passKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(
  plaintext: string,
  passphrase: string,
): Promise<string> {
  if (!passphrase) throw new Error("Set a passphrase before encrypting.");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  const envelope: EncryptedEnvelope = {
    schema: "fp-enc-v1",
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(cipherBuf)),
  };
  return JSON.stringify(envelope);
}

export async function decryptString(
  envelopeJson: string,
  passphrase: string,
): Promise<string> {
  if (!passphrase) throw new Error("Enter your passphrase to decrypt.");
  const env = JSON.parse(envelopeJson) as Partial<EncryptedEnvelope>;
  if (env.schema !== "fp-enc-v1" || !env.salt || !env.iv || !env.ciphertext) {
    throw new Error("This file isn't a recognized Independence Path encrypted backup.");
  }
  const salt = fromBase64(env.salt);
  const iv = fromBase64(env.iv);
  const cipher = fromBase64(env.ciphertext);
  const key = await deriveKey(passphrase, salt);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error("Wrong passphrase, or the backup is corrupted.");
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  // Explicit ArrayBuffer-backed Uint8Array. TS 5.7+ made TypedArrays
  // generic on the buffer kind (ArrayBuffer vs SharedArrayBuffer);
  // Web Crypto's BufferSource only accepts the non-shared variant,
  // so callers need the precise type.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
