"use client";

/**
 * Feature-gate wrapper.
 *
 * In this build every feature is free, so the wrapper renders its
 * children unconditionally — it's effectively a pass-through. It's
 * preserved (and still used at every historical gating site) for
 * two reasons:
 *
 *   1. **Single point of change**: section-level gating, if ever
 *      reintroduced for any reason, lives in one file instead of
 *      being scattered across consumers. Re-enabling gating means
 *      editing this component plus {@link useIsPro} — nothing else.
 *
 *   2. **Self-documenting**: each call site preserves the original
 *      design intent ("this surface was conceived as an advanced
 *      feature") which is useful context for a maintainer reading
 *      the code.
 *
 * The `title` / `description` / `bullets` / `variant` props are
 * accepted for back-compat with existing call sites and ignored
 * here — they would have driven an upsell CTA in a gated build.
 */
export function ProGate({
  children,
}: {
  children: React.ReactNode;
  title?: string;
  description?: string;
  bullets?: string[];
  variant?: "block" | "hide" | "section";
}) {
  return <>{children}</>;
}

/** Inline gating hook — always true in the OSS build. */
export function useIsPro(): boolean {
  return true;
}
