/**
 * Google Drive REST calls scoped to the per-app `appDataFolder`.
 * This folder is invisible in the user's regular Drive UI and is
 * isolated to this Client ID; we can only read/write files we
 * created here.
 */

import { encryptString, unwrapBackup } from "@/lib/sync/crypto";

const STATE_FILE_NAME = "wealthtrajectory-real-state.json";
const QUOTES_FILE_NAME = "wealthtrajectory-quotes.json";
const SESSION_FILE_NAME = "wealthtrajectory-session.json";

export type DriveBackupRef = {
  id: string;
  modifiedTime: string;
};

async function authed<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function findFile(
  token: string,
  name: string,
): Promise<DriveBackupRef | null> {
  const all = await findAllFiles(token, name);
  return all[0] ?? null;
}

/**
 * Drive's appdata folder does NOT enforce filename uniqueness. Past
 * uploadFile bugs (e.g. when findFile returned null on a stale index
 * and we POSTed a new file alongside an existing one) can leave
 * orphaned duplicates with the same name. Always sort by
 * modifiedTime desc so the freshest one wins; callers can also
 * delete the older copies.
 *
 * We sort client-side rather than using `orderBy=modifiedTime%20desc`
 * because the server-side orderBy was observed to 403 with
 * "Insufficient Permission" in some accounts even with the right
 * drive.appdata scope — likely an interaction between the scope and
 * the orderBy parameter on appDataFolder queries. Client-side sort
 * is the safe, scope-agnostic equivalent.
 */
async function findAllFiles(
  token: string,
  name: string,
): Promise<DriveBackupRef[]> {
  const q = encodeURIComponent(`name = '${name}'`);
  const data = await authed<{
    files: Array<{ id: string; name: string; modifiedTime: string }>;
  }>(
    token,
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=${q}`,
  );
  const refs = (data.files ?? []).map((f) => ({
    id: f.id,
    modifiedTime: f.modifiedTime,
  }));
  // RFC 3339 timestamps sort lexicographically equivalent to time order.
  refs.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return refs;
}

async function deleteFile(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    /* best-effort cleanup */
  });
}

async function downloadFile(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive download ${res.status}`);
  return res.text();
}

/**
 * Google Drive simple-upload (uploadType=media) and multipart-upload
 * (uploadType=multipart) both cap at 5 MB. Beyond that, the API
 * requires resumable upload (uploadType=resumable), which involves a
 * preflight session URL + chunked PUTs. R1-D8 audit MED fix: refuse
 * to attempt a > 4 MB upload (1 MB safety margin) and surface a
 * clear, user-actionable error instead of letting Drive return a
 * generic 413 / 400. Resumable upload support is a follow-up
 * (tracked separately); for now the guard prevents silent failures
 * for long-tail users with many history-bearing snapshots.
 */
const DRIVE_UPLOAD_SAFETY_BYTES = 4 * 1024 * 1024;

export class DrivePayloadTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(
      `Drive backup payload is ${(sizeBytes / 1024 / 1024).toFixed(2)} MB — exceeds the 4 MB safety threshold. Trim older snapshots (Data → History snapshots) and try again.`,
    );
    this.name = "DrivePayloadTooLargeError";
  }
}

async function uploadFile(
  token: string,
  name: string,
  content: string,
): Promise<DriveBackupRef> {
  // R1-D8 audit MED guard: refuse oversized uploads with a clear
  // error rather than letting Drive 413 and surface a generic
  // "Drive create 413" string in googleSyncError.
  // TextEncoder.encode() gives us the actual UTF-8 byte count
  // (which is what Drive's content-length sees). For all-ASCII
  // payloads this equals string length, but cyrillic / emoji /
  // non-ASCII characters in user labels would otherwise produce
  // false negatives on a string.length check.
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > DRIVE_UPLOAD_SAFETY_BYTES) {
    throw new DrivePayloadTooLargeError(bytes);
  }
  const all = await findAllFiles(token, name);
  if (all.length > 0) {
    // PATCH the newest. If duplicates exist (from past races), delete
    // the older ones so future reads can't pick a stale copy.
    const [primary, ...dupes] = all;
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${primary.id}?uploadType=media&fields=id,modifiedTime`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: content,
      },
    );
    if (!res.ok) throw new Error(`Drive update ${res.status}`);
    const data = (await res.json()) as { id: string; modifiedTime: string };
    if (dupes.length > 0) {
      // Best-effort cleanup; don't fail the write if a delete fails.
      await Promise.all(dupes.map((d) => deleteFile(token, d.id)));
    }
    return { id: data.id, modifiedTime: data.modifiedTime };
  }

  const boundary = "wealthtrajectory-boundary-" + Math.random().toString(36).slice(2);
  const metadata = {
    name,
    parents: ["appDataFolder"],
    mimeType: "application/json",
  };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive create ${res.status}`);
  const data = (await res.json()) as { id: string; modifiedTime: string };
  return { id: data.id, modifiedTime: data.modifiedTime };
}

// State backup ──────────────────────────────────────────────────────────
export async function findBackupFile(
  token: string,
): Promise<DriveBackupRef | null> {
  return findFile(token, STATE_FILE_NAME);
}

export async function downloadBackup(
  token: string,
  fileId: string,
): Promise<string> {
  return downloadFile(token, fileId);
}

export async function uploadBackup(
  token: string,
  content: string,
): Promise<DriveBackupRef> {
  return uploadFile(token, STATE_FILE_NAME, content);
}

// Per-user quote history cache ──────────────────────────────────────────
export type QuoteCacheEntry = {
  history: Array<{ t: number; p: number }>;
  currentPrice: number | null;
  name: string | null;
  fetchedAt: number;
};

export type QuoteCache = {
  schema: 1;
  bySymbol: Record<string, QuoteCacheEntry>;
};

export async function loadQuoteCache(
  token: string,
  passphrase: string | null = null,
): Promise<QuoteCache | null> {
  try {
    const file = await findFile(token, QUOTES_FILE_NAME);
    if (!file) return null;
    const text = await downloadFile(token, file.id);
    // Decrypt-if-encrypted. The quote cache carries the user's full
    // ticker list + names + 5y price history — that's enough metadata
    // to fingerprint the portfolio. The main backup is encrypted with
    // the user's passphrase; this auxiliary file MUST match the same
    // promise. `unwrapBackup` handles both fp-enc-v1 envelopes (with
    // passphrase) and plaintext (back-compat for pre-fix saved files).
    const plain = await unwrapBackup(text, passphrase);
    const parsed = JSON.parse(plain) as Partial<QuoteCache>;
    if (parsed && parsed.schema === 1 && parsed.bySymbol) {
      return parsed as QuoteCache;
    }
    return null;
  } catch {
    // Includes EncryptedRequiresPassphrase when the file is encrypted
    // but no passphrase was provided — degrade silently to "no cache,"
    // matching the existing "couldn't fetch from upstream" behavior.
    return null;
  }
}

export async function saveQuoteCache(
  token: string,
  cache: QuoteCache,
  passphrase: string | null = null,
): Promise<void> {
  const plain = JSON.stringify(cache);
  // Encrypt-if-passphrase-set, mirroring the main backup envelope
  // (lib/sync/cloudSync.ts pushToDrive). Without this, a user with
  // encryption enabled silently leaks portfolio composition (ticker
  // list + 5y prices) on every quote-cache write.
  const body = passphrase ? await encryptString(plain, passphrase) : plain;
  await uploadFile(token, QUOTES_FILE_NAME, body);
}

// Active-session marker ─────────────────────────────────────────────────
// Used to enforce single-active-session-per-account: when a device
// signs in, it writes its sessionId here. Other devices polling Drive
// see the mismatch and self-sign-out.
export type ActiveSession = {
  sessionId: string;
  signedInAt: number;
};

export async function loadActiveSession(
  token: string,
): Promise<ActiveSession | null> {
  try {
    const file = await findFile(token, SESSION_FILE_NAME);
    if (!file) return null;
    const text = await downloadFile(token, file.id);
    const parsed = JSON.parse(text) as Partial<ActiveSession>;
    if (
      parsed &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.signedInAt === "number"
    ) {
      return parsed as ActiveSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function claimActiveSession(
  token: string,
  sessionId: string,
): Promise<void> {
  const body: ActiveSession = { sessionId, signedInAt: Date.now() };
  await uploadFile(token, SESSION_FILE_NAME, JSON.stringify(body));
}
