"use client";

/**
 * Sticky-feel sub-section header used to visually group related cards
 * within a long page. Distinct from the page-level title (which is
 * navigated via the hamburger menu).
 *
 * Used on Projections + Plan pages where multiple distinct sub-areas
 * (e.g. "Tax optimization" vs "Safety net" within Plan) coexist.
 * Keeps user orientation intact without forcing a tab navigation.
 */
export function SectionHeader({
  label,
  sub,
}: {
  label: string;
  sub?: string;
}) {
  return (
    <header className="px-5 pt-5">
      <div className="flex items-baseline gap-2 border-t border-border pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </h2>
        {sub && (
          <span className="text-[10px] text-text-dim">— {sub}</span>
        )}
      </div>
    </header>
  );
}
