"use client";

import { useAppStore } from "@/lib/store";

/**
 * Persistent micro-footer with the bare-minimum legal frame:
 *
 *   "Educational tool — not investment advice."
 *
 * Plus a "Privacy & disclosures" link that routes to the Data page
 * where the full privacy / disclaimer surface lives. Renders on
 * every page so users can always find the long-form copy in one
 * tap from anywhere in the app.
 *
 * Intentionally low-contrast and small — present, not pushy. The
 * goal is to make the legal framing visible without making it the
 * dominant UI element.
 */
export function LegalFooter() {
  const setPage = useAppStore((s) => s.setCurrentPage);
  return (
    <footer className="px-5 pb-24 pt-6 text-center">
      <div className="text-[10px] leading-snug text-text-dim">
        Educational planning tool — not investment, tax, or legal advice.{" "}
        <button
          type="button"
          onClick={() => setPage("data")}
          className="underline decoration-text-dim/40 underline-offset-2 hover:text-text-muted"
        >
          Privacy &amp; disclosures
        </button>
      </div>
    </footer>
  );
}
