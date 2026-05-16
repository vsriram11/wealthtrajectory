"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import type { DrawdownPhase } from "@/lib/types";
import { resolveAssumptionsForMember } from "@/lib/projection/useActiveProjection";
import { ProGate } from "@/app/_components/ui/ProGate";
import { NumberField } from "@/app/_components/ui/NumberField";

export function DrawdownPhasesCard() {
  return (
    <ProGate
      title="Multi-phase drawdown"
      description="Model retirement in stages — e.g. a higher draw before Social Security kicks in, then drop to a sustainable rate when it does. The engine recomputes the monthly withdrawal at the start of each phase."
      bullets={[
        "Pre-SS bridge (higher rate, fixed years)",
        "Steady-state post-SS phase",
        "Late-life conservative tail",
      ]}
    >
      <PhasesEditor />
    </ProGate>
  );
}

function PhasesEditor() {
  const householdAssumptions = useAppStore((s) => s.assumptions);
  const memberAssumptions = useAppStore((s) => s.memberAssumptions);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const setAssumption = useAppStore((s) => s.setAssumption);
  const setMemberAssumption = useAppStore((s) => s.setMemberAssumption);

  // Effective view per the current member filter. Without this,
  // editing on a per-member-filtered view writes to the household
  // default — the same bug class BudgetPanel had.
  const assumptions = useMemo(
    () =>
      resolveAssumptionsForMember(
        householdAssumptions,
        memberAssumptions,
        selectedMemberId,
      ),
    [householdAssumptions, memberAssumptions, selectedMemberId],
  );
  const phases = assumptions.drawdownPhases ?? [];

  const sorted = [...phases].sort(
    (a, b) => a.startMonthsAfterIndependence - b.startMonthsAfterIndependence,
  );

  const setPhases = (next: DrawdownPhase[]) => {
    if (selectedMemberId) {
      setMemberAssumption(selectedMemberId, "drawdownPhases", next);
    } else {
      setAssumption("drawdownPhases", next);
    }
  };

  const addPhase = () => {
    const last = sorted[sorted.length - 1];
    const startYears = last ? Math.round(last.startMonthsAfterIndependence / 12) + 5 : 10;
    setPhases([
      ...phases,
      { startMonthsAfterIndependence: startYears * 12, withdrawalRate: 0.03 },
    ]);
  };

  const updatePhase = (index: number, patch: Partial<DrawdownPhase>) => {
    setPhases(phases.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const removePhase = (index: number) => {
    setPhases(phases.filter((_, i) => i !== index));
  };

  return (
    <section className="px-5 pt-6">
      <h2 className="mb-3 px-1 text-xs font-medium uppercase tracking-wider text-text-muted">
        Drawdown phases
      </h2>
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-[11px] text-text-dim">
          Phase 0 uses your baseline withdrawal rate ({(assumptions.withdrawalRate * 100).toFixed(1)}%)
          starting at Independence. Add phases below to change the rate at later
          points in retirement.
        </div>

        {phases.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border-strong p-4 text-center text-[11px] text-text-dim">
            No additional phases. Single rate held for life.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {phases.map((p, i) => (
              <li
                key={i}
                className="rounded-lg border border-border bg-bg-elevated p-3"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-text-dim">
                      Starts (years after Independence)
                    </div>
                    <span className="mt-1 flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2.5 py-1.5">
                      <NumberField
                        value={p.startMonthsAfterIndependence / 12}
                        precision={1}
                        allowNegative={false}
                        onChange={(v) =>
                          updatePhase(i, {
                            startMonthsAfterIndependence: Math.round(v * 12),
                          })
                        }
                        className="num w-16 bg-transparent text-right text-sm font-medium text-text outline-none"
                      />
                      <span className="text-xs text-text-muted">yrs</span>
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-text-dim">
                      Withdrawal rate
                    </div>
                    <span className="mt-1 flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2.5 py-1.5">
                      <NumberField
                        value={+(p.withdrawalRate * 100).toFixed(2)}
                        precision={2}
                        allowNegative={false}
                        onChange={(v) =>
                          updatePhase(i, { withdrawalRate: v / 100 })
                        }
                        className="num w-16 bg-transparent text-right text-sm font-medium text-text outline-none"
                      />
                      <span className="text-xs text-text-muted">%</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhase(i)}
                    className="self-end rounded-md border border-negative/40 bg-bg-surface px-2 py-1.5 text-[11px] font-medium text-negative active:opacity-70"
                    aria-label="Remove phase"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addPhase}
          className="mt-3 w-full rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent active:opacity-70"
        >
          + Add phase
        </button>
      </div>
    </section>
  );
}
