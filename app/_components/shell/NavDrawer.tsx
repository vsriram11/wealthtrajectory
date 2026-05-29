"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import type { PageId } from "@/lib/store";

const NAV: { id: PageId; label: string; sub: string; pro?: boolean }[] = [
  {
    id: "home",
    label: "Home",
    sub: "Net worth, Independence date, milestones, goals",
  },
  {
    id: "accounts",
    label: "Accounts",
    sub: "Holdings, contributions, liabilities",
  },
  {
    id: "allocation",
    label: "Allocation",
    sub: "Stocks · bonds · cash · tax buckets",
  },
  {
    id: "projections",
    label: "Projections",
    sub: "What-ifs, scenarios, stress, future composition",
  },
  {
    id: "plan",
    label: "Plan",
    sub: "Assumptions, safety, tax strategy, benchmarks",
  },
  {
    id: "data",
    label: "Data",
    sub: "Backup, encryption, members, disclosures",
  },
  {
    id: "calculators",
    label: "Static Calculators",
    sub: "Static planning tools",
  },
  {
    id: "glossary",
    label: "Glossary",
    sub: "Plain-language definitions + sources for every term",
  },
];

export function NavDrawer() {
  const open = useAppStore((s) => s.navOpen);
  const setNavOpen = useAppStore((s) => s.setNavOpen);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setNavOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Main navigation"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setNavOpen(false)}
      />
      <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto border-r border-border-strong bg-bg-surface pb-8 shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-text-dim">
              Navigate
            </div>
            <div className="text-base font-semibold text-text">Independence</div>
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            className="rounded-full border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-xs text-text-muted active:opacity-70"
          >
            Close
          </button>
        </div>
        <ul className="mt-3">
          {NAV.map((n) => {
            const active = currentPage === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setCurrentPage(n.id)}
                  className={`block w-full px-5 py-3 text-left transition active:opacity-70 ${
                    active
                      ? "bg-accent/10 border-l-2 border-accent"
                      : "border-l-2 border-transparent hover:bg-bg-elevated"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        active ? "text-accent" : "text-text"
                      }`}
                    >
                      {n.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    {n.sub}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
