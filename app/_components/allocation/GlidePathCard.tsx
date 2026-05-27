"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  allocationAtAge,
  GLIDE_PATH_PRESETS,
  type GlidePath,
} from "@/lib/portfolio/glidePath";
import { WaypointEditor } from "./WaypointEditor";

/**
 * Lifecycle glide-path editor. Lets users pick a target-date-fund-
 * style allocation that shifts with age across waypoints. The data
 * model supports per-class waypoints with linear interpolation;
 * this UI starts with three named presets (Vanguard-style,
 * conservative, perpetual-aggressive) plus an "off" state.
 *
 * Why this matters: most retirement planners assume a static
 * allocation forever. Real users glide — 90/10 in their 30s,
 * 60/40 at retirement, 30/70 in their 80s. The drift card and
 * projection engine can read the age-resolved allocation from
 * here when set.
 *
 * Mounted on the Allocation page next to the static target.
 * Either-or is fine: when a glide-path is set, it should shadow
 * the static target — but enforcing that is a follow-up; this
 * v1 just persists the model.
 */
export function GlidePathCard() {
  const glidePath = useAppStore((s) => s.glidePath);
  const setGlidePath = useAppStore((s) => s.setGlidePath);
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);

  // The age we visualize "current allocation" at — the selected
  // member's age, or the oldest household member, or 40 as a
  // sensible default for visualization.
  const previewAge = useMemo(() => {
    const m =
      (memberId
        ? household.members.find((mem) => mem.id === memberId)
        : null) ?? household.members[0];
    if (m?.age && m.age > 0) return m.age;
    const ages = household.members
      .map((mm) => mm.age)
      .filter((a): a is number => a != null && a > 0);
    if (ages.length > 0) return Math.max(...ages);
    return 40;
  }, [household.members, memberId]);

  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  // Default-collapsed because this card carries a lot of visual
  // weight (curve, preset list, waypoint grid) but most users
  // only need to revisit it occasionally. Expanding is one tap.
  const [expanded, setExpanded] = useState(false);

  const isOn = glidePath != null;
  const presetName = useMemo(() => {
    if (!glidePath) return null;
    for (const [name, gp] of Object.entries(GLIDE_PATH_PRESETS)) {
      if (samePath(gp, glidePath)) return name;
    }
    return "custom";
  }, [glidePath]);

  // Mirrors TargetAllocationCard's collapsed-subtitle convention.
  // When the card is collapsed, this is the one-line status the
  // user reads. Doesn't reveal the curve / waypoint detail until
  // expanded — same dense-by-default rhythm as the target card.
  const subtitle = isOn
    ? presetName && presetName !== "custom"
      ? `Active · ${PRESET_LABELS[presetName] ?? presetName}`
      : "Active · custom"
    : "Choose a glide-path to track allocation by age";

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface">
        {/* Header — visual + structural twin of TargetAllocationCard
            above. Same paddings, same fonts, same chevron. The two
            cards sit next to each other on the Allocation page;
            they should look like siblings, not cousins. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:opacity-70"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-text-muted">
                Lifecycle glide-path
              </span>
              {isOn && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-accent">
                  On
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-text">
              {subtitle}
            </div>
          </div>
          <CardChevron expanded={expanded} />
        </button>

        {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
        <div className="text-[11px] text-text-dim">
          Target allocation that shifts with age — the way
          Vanguard / Fidelity / Schwab target-date funds
          actually work. Stocks-heavy in your 30s, gradually
          taper toward retirement.
        </div>

        {!isOn ? (
          <>
            <div className="mt-3 rounded-md border border-dashed border-border-strong bg-bg-elevated px-3 py-3 text-[11px] text-text-dim">
              No glide-path set. Pick a preset below — or build a
              custom shape (rising-equity, U-curve, etc.).
            </div>
            <PresetGrid onPick={(gp) => setGlidePath(gp)} />
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 w-full rounded-md border border-dashed border-border-strong bg-bg-elevated px-3 py-2 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              + Build a custom glide-path
            </button>
          </>
        ) : (
          <>
            <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-accent">
                    Active glide-path
                  </div>
                  <div className="num mt-0.5 text-sm font-semibold text-accent">
                    {presetName === "custom"
                      ? "Custom"
                      : presetName
                        ? PRESET_LABELS[presetName] ?? presetName
                        : "Custom"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPicker(!showPicker)}
                    className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent active:opacity-70"
                  >
                    {showPicker ? "Done" : "Change"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded-md border border-border-strong bg-bg-elevated px-2 py-1 text-[10px] font-medium text-text active:opacity-70"
                  >
                    Edit waypoints
                  </button>
                </div>
              </div>
            </div>
            {showPicker && (
              <PresetGrid onPick={(gp) => setGlidePath(gp)} />
            )}
            <PathVisualization gp={glidePath!} previewAge={previewAge} />
            <WaypointList waypoints={glidePath!.waypoints} />
          </>
        )}

        {editing && (
          <WaypointEditor
            initial={glidePath}
            onSave={(gp) => {
              setGlidePath(gp);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        )}

        <div className="mt-3 text-[10px] leading-snug text-text-dim">
          Interpolation is linear between waypoints. Before the
          first / after the last waypoint, the allocation is held
          constant. Need a rising-equity / Pfau-style shape? Pick
          &ldquo;rising_equity_pfau&rdquo; from the presets or
          build your own with{" "}
          <span className="text-text">Edit waypoints</span>.
        </div>
        {isOn && (
          <button
            type="button"
            onClick={() => setGlidePath(null)}
            className="mt-3 w-full rounded-md border border-negative/30 bg-bg-elevated px-3 py-2 text-[11px] font-medium text-negative active:opacity-70"
          >
            Turn off glide-path
          </button>
        )}
        </div>
        )}
      </div>
    </section>
  );
}

/**
 * Down-pointing chevron that rotates 180° when expanded — exact
 * same shape + sizing as TargetAllocationCard's so the two cards
 * read as a matched pair.
 */
function CardChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 text-text-muted transition-transform ${
        expanded ? "rotate-180" : ""
      }`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const PRESET_LABELS: Record<string, string> = {
  vanguard_target_retirement: "Vanguard target-date style",
  conservative: "Conservative (Fidelity Freedom style)",
  perpetual_aggressive: "Perpetual aggressive (Independence 80/20)",
  rising_equity_pfau: "Rising equity (Pfau/Kitces)",
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  vanguard_target_retirement:
    "Stocks-heavy until ~55, then tapers to 50/50 at retirement and 30/70 thereafter.",
  conservative:
    "Slightly faster taper; 70/30 at 50, 45/55 at 65, 30/70 at 75.",
  perpetual_aggressive:
    "Stays 80%+ stocks across the lifecycle — suits a long Independence horizon where corpus needs to last 40-50 years.",
  rising_equity_pfau:
    "U-shape: 60% equity at 30 → 40% at 45 (mitigate SORR) → ramp back to 60% at 60 and 80% by 80. Research-cited; useful when the early-retirement years are the danger zone.",
};

function PresetGrid({ onPick }: { onPick: (gp: GlidePath) => void }) {
  return (
    <ul className="mt-3 space-y-2">
      {Object.entries(GLIDE_PATH_PRESETS).map(([key, gp]) => (
        <li key={key}>
          <button
            type="button"
            onClick={() => onPick(gp)}
            className="block w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-left active:opacity-70"
          >
            <div className="text-[12px] font-semibold text-text">
              {PRESET_LABELS[key] ?? key}
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-text-dim">
              {PRESET_DESCRIPTIONS[key] ?? ""}
            </div>
            <div className="mt-1.5 text-[10px] text-text-muted">
              {gp.waypoints.length} waypoints: age{" "}
              {gp.waypoints[0].age}–
              {gp.waypoints[gp.waypoints.length - 1].age}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PathVisualization({
  gp,
  previewAge,
}: {
  gp: GlidePath;
  previewAge: number;
}) {
  // Render an SVG showing stocks % from age 25 to 95.
  const W = 320;
  const H = 96;
  const PAD = 8;
  const ageMin = Math.max(20, Math.min(25, gp.waypoints[0].age));
  const ageMax = Math.max(
    95,
    gp.waypoints[gp.waypoints.length - 1].age + 5,
  );
  const points: Array<{ age: number; equity: number; bond: number }> = [];
  for (let a = ageMin; a <= ageMax; a += 1) {
    const alloc = allocationAtAge(gp, a);
    points.push({
      age: a,
      equity: alloc?.equity ?? 0,
      bond: alloc?.bond ?? 0,
    });
  }
  const x = (age: number) =>
    PAD + ((age - ageMin) / (ageMax - ageMin)) * (W - 2 * PAD);
  const y = (frac: number) => PAD + (1 - frac) * (H - 2 * PAD);

  const equityPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.age)} ${y(p.equity)}`)
    .join(" ");
  const bondPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.age)} ${y(p.bond)}`)
    .join(" ");

  // Vertical marker for current preview age.
  const markerX = x(Math.max(ageMin, Math.min(ageMax, previewAge)));
  const previewAlloc = allocationAtAge(gp, previewAge);

  return (
    <div className="mt-3 rounded-md border border-border bg-bg-elevated p-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          Glide curve
        </div>
        {previewAlloc && (
          <div className="text-[10px] text-text-muted">
            Age {previewAge}:{" "}
            <span className="num text-text">
              {Math.round((previewAlloc.equity ?? 0) * 100)}/
              {Math.round((previewAlloc.bond ?? 0) * 100)}
            </span>
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-20 w-full"
        preserveAspectRatio="none"
      >
        {/* Marker line at preview age. */}
        <line
          x1={markerX}
          y1={PAD}
          x2={markerX}
          y2={H - PAD}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          className="text-text-dim"
        />
        <path
          d={equityPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-accent"
        />
        <path
          d={bondPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-positive"
        />
        {/* Waypoint dots. */}
        {gp.waypoints.map((w) => (
          <circle
            key={w.age}
            cx={x(w.age)}
            cy={y(w.allocation.equity ?? 0)}
            r={2}
            fill="currentColor"
            className="text-accent"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-text-dim">
        <span>Age {ageMin}</span>
        <span>
          <span className="text-accent">— Stocks</span>{" "}
          <span className="text-positive">— Bonds</span>
        </span>
        <span>Age {ageMax}</span>
      </div>
    </div>
  );
}

function WaypointList({
  waypoints,
}: {
  waypoints: { age: number; allocation: Record<string, number | undefined> }[];
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {waypoints.map((w) => (
        <div
          key={w.age}
          className="rounded-md border border-border bg-bg-elevated px-2 py-1.5"
        >
          <div className="text-[9px] uppercase tracking-wider text-text-muted">
            Age {w.age}
          </div>
          <div className="num mt-0.5 text-[11px] font-medium text-text">
            {Math.round((w.allocation.equity ?? 0) * 100)}/
            {Math.round((w.allocation.bond ?? 0) * 100)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cheap structural compare to detect whether the saved glidePath matches a preset. */
function samePath(a: GlidePath, b: GlidePath): boolean {
  if (a.waypoints.length !== b.waypoints.length) return false;
  for (let i = 0; i < a.waypoints.length; i++) {
    if (a.waypoints[i].age !== b.waypoints[i].age) return false;
    const aa = a.waypoints[i].allocation;
    const bb = b.waypoints[i].allocation;
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      const v1 = (aa as Record<string, number | undefined>)[k] ?? 0;
      const v2 = (bb as Record<string, number | undefined>)[k] ?? 0;
      if (Math.abs(v1 - v2) > 1e-9) return false;
    }
  }
  return true;
}
