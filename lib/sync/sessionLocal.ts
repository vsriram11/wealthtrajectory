/**
 * Per-device session marker kept in localStorage. The sessionId is
 * compared against the marker on Drive — mismatch means another
 * device claimed the session and this one should sign out.
 *
 * We also track `claimedAt`, the moment we wrote this sid locally,
 * so callers can apply a grace period after a fresh claim. Without
 * a grace period, a slow Drive eventual-consistency read (or a
 * leftover stale duplicate session file) right after sign-in can
 * appear to differ from our local sid and trigger an immediate
 * self-kick — even when the user is the only one signed in.
 */

const STORAGE_KEY_V2 = "wealthtrajectory.session.v2";
// Legacy key (sid-only string). Read for back-compat; never write.
const STORAGE_KEY_V1 = "wealthtrajectory.sessionId.v1";

/**
 * How long after a claim to skip remote-marker mismatch kicks. Drive
 * file writes are not strictly read-your-writes-consistent, and our
 * past bug of creating duplicate files can leave a window where a
 * read returns a stale sid. 60s comfortably covers that.
 */
export const SESSION_CLAIM_GRACE_MS = 60 * 1000;

type LocalSession = { sid: string; claimedAt: number };

export function readLocalSession(): LocalSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalSession>;
      if (
        parsed &&
        typeof parsed.sid === "string" &&
        typeof parsed.claimedAt === "number"
      ) {
        return parsed as LocalSession;
      }
    }
    // v1 fallback (string-only). Treat as claimed long ago so the
    // grace period doesn't apply to legacy sessions, but the sid is
    // still usable for validation.
    const legacy = localStorage.getItem(STORAGE_KEY_V1);
    if (legacy) return { sid: legacy, claimedAt: 0 };
  } catch {
    /* fallthrough */
  }
  return null;
}

export function readLocalSessionId(): string | null {
  return readLocalSession()?.sid ?? null;
}

export function isWithinClaimGrace(now = Date.now()): boolean {
  const s = readLocalSession();
  if (!s) return false;
  return now - s.claimedAt < SESSION_CLAIM_GRACE_MS;
}

export function writeLocalSessionId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id) {
      const body: LocalSession = { sid: id, claimedAt: Date.now() };
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(body));
      // Mirror to v1 for any reader we haven't migrated yet.
      localStorage.setItem(STORAGE_KEY_V1, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_V2);
      localStorage.removeItem(STORAGE_KEY_V1);
    }
  } catch {
    /* quota — ignore */
  }
}

export function generateSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
