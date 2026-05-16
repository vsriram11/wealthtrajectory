"use client";

import { useAppStore } from "@/lib/store";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
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
      {children}
    </button>
  );
}

export function MemberFilter() {
  const members = useAppStore((s) => s.household.members);
  const selected = useAppStore((s) => s.selectedMemberId);
  const setSelected = useAppStore((s) => s.setSelectedMember);
  const openMembers = useAppStore((s) => s.openMembersSheet);

  return (
    <section className="px-5 pt-2 pb-1">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {members.length > 1 && (
          <Chip active={selected == null} onClick={() => setSelected(null)}>
            Household
          </Chip>
        )}
        {members.map((m) => (
          <Chip
            key={m.id}
            active={selected === m.id || members.length === 1}
            onClick={() => setSelected(m.id)}
          >
            {m.displayName}
          </Chip>
        ))}
        <button
          type="button"
          onClick={openMembers}
          className="shrink-0 rounded-full border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-text-muted active:opacity-70"
        >
          Manage
        </button>
      </div>
    </section>
  );
}
