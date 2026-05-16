"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { signIn } from "@/lib/sync/googleAuth";

export function SignInGate({
  children,
  title = "Sign in required",
  description,
}: {
  children: React.ReactNode;
  title?: string;
  description: string;
}) {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <>{children}</>;

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { profile } = await signIn();
      setUser(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-dashed border-border-strong bg-bg-surface p-5 text-center">
        <div className="text-sm font-medium text-text">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-[11px] text-text-muted">
          {description}
        </p>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-medium text-accent disabled:opacity-50 active:opacity-70"
        >
          <svg width="12" height="12" viewBox="0 0 48 48" aria-hidden>
            <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && (
          <div className="mt-2 text-[11px] text-negative">{error}</div>
        )}
      </div>
    </section>
  );
}
