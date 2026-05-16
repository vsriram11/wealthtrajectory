/**
 * Google Identity + Drive auth. Combines:
 * - OpenID (openid email profile) for the user identity
 * - drive.appdata for the per-app private folder
 *
 * Access tokens are short-lived and kept in memory. The user *profile*
 * (email, name, picture, etc.) is cached in localStorage so the UI can
 * render the signed-in state immediately on reload without round-trip.
 */

const CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "1007716664645-ogbsqnaubh91dg2kvt3uob8mh3uvpb3s.apps.googleusercontent.com";

const SCOPE =
  "openid email profile https://www.googleapis.com/auth/drive.appdata";

const PROFILE_KEY = "wealthtrajectory.googleProfile.v1";

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string | null;
  pictureUrl: string | null;
  emailVerified: boolean;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string; hint?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (err: unknown) => void;
            hint?: string;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGIS(): Promise<void> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("not in browser"));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("failed to load GIS")),
        );
        return;
      }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("failed to load GIS"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

let cached: { token: string; expiresAt: number } | null = null;

export function readProfile(): GoogleProfile | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as GoogleProfile) : null;
  } catch {
    return null;
  }
}

function writeProfile(p: GoogleProfile | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore quota */
  }
}

async function fetchUserInfo(token: string): Promise<GoogleProfile> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  const data = (await res.json()) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };
  return {
    sub: data.sub,
    email: data.email,
    name: data.name ?? null,
    pictureUrl: data.picture ?? null,
    emailVerified: data.email_verified === true,
  };
}

/**
 * Pop the consent / token flow. On success returns the access token AND
 * persists the resolved profile in localStorage so the UI can render
 * "signed in" immediately on subsequent reloads.
 */
export async function signIn(): Promise<{ token: string; profile: GoogleProfile }> {
  await loadGIS();
  const g = window.google;
  if (!g) throw new Error("Google Identity Services unavailable");
  const token = await new Promise<string>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.access_token) {
          cached = {
            token: response.access_token,
            expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          };
          resolve(response.access_token);
        } else {
          reject(new Error(response.error ?? "no token"));
        }
      },
      error_callback: (err) => reject(err),
    });
    client.requestAccessToken({ prompt: "consent" });
  });
  const profile = await fetchUserInfo(token);
  writeProfile(profile);
  return { token, profile };
}

/**
 * Request a fresh token using the cached profile's email as a hint,
 * so Google can return a token silently if the user is still signed
 * into Google in this browser. Falls back to a popup if not.
 */
export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  await loadGIS();
  const g = window.google;
  if (!g) throw new Error("Google Identity Services unavailable");
  const hint = readProfile()?.email;
  return new Promise<string>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.access_token) {
          cached = {
            token: response.access_token,
            expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          };
          resolve(response.access_token);
        } else {
          reject(new Error(response.error ?? "no token"));
        }
      },
      error_callback: (err) => reject(err),
      hint,
    });
    client.requestAccessToken({ prompt: "", hint });
  });
}

export function signOut(): void {
  if (cached && typeof window !== "undefined") {
    window.google?.accounts.oauth2.revoke(cached.token, () => {});
  }
  cached = null;
  writeProfile(null);
}

export function hasGoogleClientId(): boolean {
  return CLIENT_ID.length > 0;
}
