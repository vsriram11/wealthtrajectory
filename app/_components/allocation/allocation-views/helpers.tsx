"use client";

/**
 * Shared UI primitives used by the AllocationPanel main shell and
 * the per-class detail views. Each one is pure presentation —
 * no store reads, no class-specific logic.
 */

import { pluralLabel } from "@/lib/portfolio/holdingKinds";
import type { AssetClass } from "@/lib/types";
import type { GeoScope } from "@/lib/portfolio/portfolio";

export function Metric({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className={`mt-1 ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-text-dim">{sub}</div>
    </div>
  );
}

/** SVG chevron used to indicate expand/collapse state. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-dim transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Face-value vs effective-exposure toggle for the AllocationPanel. */
export function BasisToggle({
  basis,
  onChange,
}: {
  basis: "face" | "exposure";
  onChange: (b: "face" | "exposure") => void;
}) {
  return (
    <div className="flex rounded-full border border-border bg-bg-surface p-0.5">
      <ToggleBtn
        active={basis === "face"}
        onClick={() => onChange("face")}
        label="Face"
      />
      <ToggleBtn
        active={basis === "exposure"}
        onClick={() => onChange("exposure")}
        label="Exposure"
      />
    </div>
  );
}

export function ToggleBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition active:opacity-70 ${
        active
          ? "bg-bg-elevated text-text"
          : "text-text-dim hover:text-text-muted"
      }`}
    >
      {label}
    </button>
  );
}

const GEO_LABEL: Record<Exclude<GeoScope, "ALL">, string> = {
  US: "US",
  DEVELOPED: "Dev",
  EMERGING: "EM",
};

/**
 * Caption like "Stocks · US" combining class tab + geo scope.
 * Class labels delegate to the registry so they stay in sync with
 * every other allocation surface (dashboard chips, target-mix
 * drift, asset-location audit, future-allocation card).
 */
export function sliceLabel(
  classTab: "ALL" | AssetClass,
  geoScope: GeoScope,
): string {
  const classText = classTab === "ALL" ? "All" : pluralLabel(classTab);
  if (geoScope === "ALL") return classText;
  return `${classText} · ${GEO_LABEL[geoScope]}`;
}
