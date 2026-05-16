"use client";

import { useAppStore } from "@/lib/store";

export function ScenarioPicker() {
  const scenarios = useAppStore((s) => s.scenarios);
  const activeId = useAppStore((s) => s.activeScenarioId);
  const setActive = useAppStore((s) => s.setActiveScenario);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  if (scenarios.length === 0) return null;

  return (
    <section className="px-5 pt-2 pb-1">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
        <Chip active={activeId == null} onClick={() => setActive(null)}>
          Baseline
        </Chip>
        {scenarios.map((s) => (
          <Chip
            key={s.id}
            active={activeId === s.id}
            color={s.color}
            onClick={() => setActive(s.id)}
          >
            {s.name}
          </Chip>
        ))}
        <button
          type="button"
          onClick={() => setCurrentPage("projections")}
          className="shrink-0 rounded-full border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-text-muted active:opacity-70"
        >
          Manage
        </button>
      </div>
    </section>
  );
}

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition active:opacity-70 ${
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border bg-bg-surface text-text-muted hover:text-text"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {color && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span>{children}</span>
      </span>
    </button>
  );
}
