"use client";

import { useMemo, useState } from "react";
import {
  allocationAtAge,
  GLIDE_PATH_PRESETS,
  type GlidePath,
  type GlidePathWaypoint,
} from "@/lib/portfolio/glidePath";

/**
 * Custom waypoint editor for the lifecycle glide-path. Users build
 * an arbitrary {age, equity%, bond%} sequence; the engine supports
 * any shape (rising-equity / U-curve / step-function) and the
 * existing PathVisualization (kept in GlidePathCard) draws what
 * they configure.
 *
 * Design choices:
 *   1. Per-row equity + bond inputs are FROM-100 split sliders —
 *      adjusting equity auto-fills bond = 1 - equity. Sum-to-1
 *      becomes structural rather than something to validate. Users
 *      asking for cash / crypto allocations in a glide-path are
 *      vanishingly rare (the published Pfau/Vanguard/Fidelity
 *      glides are all equity/bond); supporting them via this
 *      editor would push it from "fast" to "complex" without
 *      proportional value. Cash + alts stay first-class for the
 *      STATIC target allocation card.
 *   2. Ages are sorted on save (via the slice's
 *      normalizeGlidePath), so users can type in any order — the
 *      list re-orders on save. Minimum 2 waypoints (engine still
 *      works at 1, but a single-waypoint "glide" is just a static
 *      target — the user should use the StaticTarget card for that
 *      shape).
 *   3. Validation feedback is inline + non-blocking — the editor
 *      lets the user save even with rough numbers but surfaces
 *      "fix me" hints. Hard-blocking save on every invalid
 *      intermediate state would punish the user who's still
 *      typing.
 *
 * Engine already accepts any waypoint shape — see
 * lib/portfolio/glidePath.ts. No engine changes needed.
 */
export function WaypointEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: GlidePath | null;
  onSave: (gp: GlidePath) => void;
  onCancel: () => void;
}) {
  // Detect a pre-existing glide-path that includes non-equity-non-
  // bond classes (cash / commodity / alts). The editor's
  // equity-fills-bond model would silently nuke those classes on
  // first edit (set bond = 1 - equity, drop cash). Refuse to seed
  // from such a path; the user must explicitly opt-in to the
  // 2-class collapse OR continue editing it via the presets +
  // static-target route.
  const initialHasMultiClass = useMemo(
    () => initial != null && hasNonEquityBondClasses(initial),
    [initial],
  );
  const [seededFromMultiClass, setSeededFromMultiClass] = useState(false);
  // Seed from the active glide path; fall back to the Vanguard
  // preset so a first-time custom-editor user starts from a real
  // shape instead of an empty list.
  const [draft, setDraft] = useState<GlidePathWaypoint[]>(() => {
    if (
      initial &&
      initial.waypoints.length >= 2 &&
      !hasNonEquityBondClasses(initial)
    )
      return initial.waypoints.map(cloneWaypoint);
    return GLIDE_PATH_PRESETS.vanguard_target_retirement.waypoints.map(
      cloneWaypoint,
    );
  });

  const errors = useMemo(() => validateWaypoints(draft), [draft]);
  const canSave = errors.length === 0;

  // Block the editor entirely until the user accepts the 2-class
  // collapse. This avoids silent data loss on the cash/alts share
  // of a custom path; the alternative (collapsing into the bond
  // share at seed time) would silently rewrite the user's intent.
  //
  // The early-return must come AFTER all hooks so React's hook-
  // ordering invariant holds across re-renders (rules-of-hooks).
  if (initialHasMultiClass && !seededFromMultiClass) {
    return (
      <CollapseConsentNotice
        onCancel={onCancel}
        onAccept={() => {
          // Seed with equity-only from the original path, dropping
          // cash/alts. The user has now opted in to this collapse.
          if (initial) {
            setDraft(
              initial.waypoints.map((w) => ({
                age: w.age,
                allocation: {
                  equity: w.allocation.equity ?? 0,
                  bond: 1 - (w.allocation.equity ?? 0),
                },
              })),
            );
          }
          setSeededFromMultiClass(true);
        }}
      />
    );
  }

  const updateWaypoint = (idx: number, patch: Partial<WaypointEditState>) => {
    setDraft((cur) => {
      const next = cur.slice();
      const current = next[idx];
      const equity =
        patch.equity != null ? clamp01(patch.equity) : current.allocation.equity ?? 0;
      const age = patch.age != null ? patch.age : current.age;
      next[idx] = {
        age,
        allocation: { equity, bond: 1 - equity },
      };
      return next;
    });
  };

  const addWaypoint = () => {
    setDraft((cur) => {
      // Append a new waypoint 5 years after the last age, with the
      // last allocation as the seed — keeps the visual curve
      // continuous instead of jumping. The user typically edits the
      // new waypoint's equity right after adding.
      const last = cur[cur.length - 1] ?? {
        age: 65,
        allocation: { equity: 0.5, bond: 0.5 },
      };
      const newAge = Math.min(100, last.age + 5);
      return [
        ...cur,
        {
          age: newAge,
          allocation: {
            equity: last.allocation.equity ?? 0.5,
            bond: 1 - (last.allocation.equity ?? 0.5),
          },
        },
      ];
    });
  };

  const removeWaypoint = (idx: number) => {
    setDraft((cur) => cur.filter((_, i) => i !== idx));
  };

  const loadFromPreset = (key: string) => {
    const preset = GLIDE_PATH_PRESETS[key];
    if (!preset) return;
    setDraft(preset.waypoints.map(cloneWaypoint));
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-bg-elevated p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            Custom waypoints
          </div>
          <div className="text-[11px] text-text-dim">
            Edit ages + equity %. Bond fills the remainder.
          </div>
        </div>
        <select
          aria-label="Load preset into editor"
          onChange={(e) => {
            if (e.target.value) {
              loadFromPreset(e.target.value);
              e.target.value = "";
            }
          }}
          defaultValue=""
          className="rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-[11px] text-text outline-none focus:border-accent"
        >
          <option value="" disabled>
            Load preset…
          </option>
          {Object.keys(GLIDE_PATH_PRESETS).map((key) => (
            <option key={key} value={key}>
              {key.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-3 space-y-2">
        {draft.map((w, idx) => (
          <li
            key={idx}
            className="flex items-center gap-2 rounded-md border border-border bg-bg-surface px-2 py-2"
          >
            <label className="flex items-center gap-1 text-[10px] text-text-muted">
              Age
              <input
                type="number"
                value={w.age}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v))
                    updateWaypoint(idx, { age: Math.round(v) });
                }}
                min={18}
                max={110}
                step={1}
                className="num w-12 rounded-sm border border-border-strong bg-bg-elevated px-1 py-0.5 text-right text-[12px] text-text outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-1 items-center gap-1 text-[10px] text-text-muted">
              Equity
              <input
                type="number"
                value={Math.round((w.allocation.equity ?? 0) * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v))
                    updateWaypoint(idx, { equity: v / 100 });
                }}
                min={0}
                max={100}
                step={1}
                className="num w-14 rounded-sm border border-border-strong bg-bg-elevated px-1 py-0.5 text-right text-[12px] text-accent outline-none focus:border-accent"
              />
              %
            </label>
            <div className="text-[10px] text-text-muted">
              Bond{" "}
              <span className="num text-positive">
                {100 - Math.round((w.allocation.equity ?? 0) * 100)}%
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeWaypoint(idx)}
              aria-label={`Remove waypoint ${idx + 1}`}
              disabled={draft.length <= 2}
              className="rounded-sm px-1.5 text-text-dim hover:text-negative active:opacity-70 disabled:cursor-not-allowed disabled:text-text-dim/40 disabled:hover:text-text-dim/40"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addWaypoint}
        className="mt-3 w-full rounded-md border border-dashed border-border-strong bg-bg-surface px-3 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
      >
        + Add waypoint
      </button>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[10px] text-amber-300">
          {errors.map((err) => (
            <li key={err}>· {err}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md border border-border bg-bg-surface px-3 py-2 text-[11px] font-medium text-text-muted active:opacity-70"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({ waypoints: draft })}
          className="flex-1 rounded-md bg-accent px-3 py-2 text-[11px] font-semibold text-bg active:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save custom path
        </button>
      </div>

      {/* Preview-at-age sanity check: hint at the interpolated
          allocation at retirement-ish age so the user can spot
          accidentally-misordered waypoints visually. */}
      <PreviewAtAge waypoints={draft} />
    </div>
  );
}

type WaypointEditState = {
  age: number;
  equity: number;
};

/**
 * True when ANY waypoint in the path carries a class other than
 * equity/bond with a non-trivial share. The editor's "equity +
 * bond = 1" model would silently drop those shares on first edit,
 * so we refuse to seed from such a path without explicit consent.
 */
function hasNonEquityBondClasses(gp: GlidePath): boolean {
  const allowed = new Set(["equity", "bond"]);
  for (const w of gp.waypoints) {
    for (const [cls, share] of Object.entries(w.allocation)) {
      if (allowed.has(cls)) continue;
      if ((share ?? 0) > 0.001) return true;
    }
  }
  return false;
}

/**
 * Render-blocking notice surfaced when the user opens the editor
 * against a multi-class custom glide-path. Forces an explicit
 * choice rather than silently collapsing the cash / commodity /
 * alts shares to bond.
 */
function CollapseConsentNotice({
  onAccept,
  onCancel,
}: {
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 p-4">
      <div className="text-sm font-semibold text-amber-200">
        Your glide-path includes cash or alts
      </div>
      <p className="mt-1 text-[11px] leading-snug text-amber-200/80">
        This editor only supports equity + bond. Continuing will
        collapse cash / commodity / alts shares into bond at each
        waypoint and lose the original detail. Cancel and edit via
        Presets or the Static Target card to keep multi-class
        allocations intact.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-[11px] font-medium text-text-muted active:opacity-70"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="flex-1 rounded-md bg-amber-300 px-3 py-2 text-[11px] font-semibold text-bg active:opacity-70"
        >
          Continue (lose cash/alts detail)
        </button>
      </div>
    </div>
  );
}

function cloneWaypoint(w: GlidePathWaypoint): GlidePathWaypoint {
  return {
    age: w.age,
    allocation: { ...w.allocation },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function validateWaypoints(wps: GlidePathWaypoint[]): string[] {
  const errors: string[] = [];
  if (wps.length < 2) errors.push("Need at least 2 waypoints");
  // Duplicate-age check (the slice normalizes anyway, but warn the
  // user so they don't lose an edit silently).
  const seenAges = new Set<number>();
  for (const w of wps) {
    if (seenAges.has(w.age)) {
      errors.push(`Duplicate age ${w.age} — only the last edit wins`);
      break;
    }
    seenAges.add(w.age);
  }
  for (const w of wps) {
    if (!Number.isFinite(w.age) || w.age < 18 || w.age > 110) {
      errors.push(`Age ${w.age} is outside 18-110`);
      break;
    }
  }
  // sum-to-1 is structural per row (equity + bond = 1 by
  // construction), so no per-row sum check needed.
  return errors;
}

function PreviewAtAge({ waypoints }: { waypoints: GlidePathWaypoint[] }) {
  if (waypoints.length < 2) return null;
  const gp: GlidePath = {
    waypoints: waypoints
      .slice()
      .sort((a, b) => a.age - b.age),
  };
  const alloc65 = allocationAtAge(gp, 65);
  if (!alloc65) return null;
  return (
    <div className="mt-2 text-[10px] text-text-dim">
      At age 65 (interpolated):{" "}
      <span className="num text-text">
        {Math.round((alloc65.equity ?? 0) * 100)}% equity /{" "}
        {Math.round((alloc65.bond ?? 0) * 100)}% bond
      </span>
    </div>
  );
}
