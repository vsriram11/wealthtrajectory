"use client";

import { useEffect, useMemo, useState } from "react";
import { projectIndependence } from "@/lib/projection/independence";
import { generateInsights, type Insight } from "@/lib/insights/insights";
import { memberFilteredSnapshots } from "@/lib/data/history";
import { loadSnapshots, type Snapshot } from "@/lib/persistence/persistence";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";

export function Insights() {
  const { household: filtered, assumptions, memberId } = useActiveProjection();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadSnapshots().then((s) => {
      if (!cancelled) setSnapshots(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = useMemo(() => {
    if (filtered.accounts.length === 0) return [];
    const projection = projectIndependence(filtered, assumptions);
    // Round-1 (snapshot audit) CRITICAL: pre-filter snapshots
    // through `memberFilteredSnapshots` so the engine's NW deltas
    // (YoY, monthly gain, etc.) compare apples-to-apples against
    // the member-scoped `filtered` household. Without this, a
    // user filtered to "Alex" sees insights computed from
    // household-wide snapshot NW vs Alex's slice → fictional
    // "down $4M this month" diagnostics.
    const filteredSnaps = memberFilteredSnapshots(snapshots, memberId);
    return generateInsights(filtered, assumptions, projection, filteredSnaps);
  }, [filtered, assumptions, snapshots, memberId]);

  if (insights.length === 0) return null;
  // Hide the carousel when there's only the "out of reach" warning and
  // nothing else useful — the Hero already surfaces that state.
  if (insights.length === 1 && insights[0].id === "progress" && insights[0].tone === "warning") {
    return null;
  }

  return (
    <section className="px-5 pt-4">
      {/*
        tabIndex + role="region" makes the horizontally-scrolling
        insight strip reachable by keyboard. Without these,
        keyboard users can't scroll through the cards even though
        the content extends past the viewport. Axe-core's
        scrollable-region-focusable rule (WCAG 2.1.1) caught this.
        Aria-label gives the strip a name in screen-reader output.
      */}
      <div
        className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 scrollbar-hide"
        tabIndex={0}
        role="region"
        aria-label="Smart insights"
      >
        {insights.map((i) => (
          <Card key={i.id} insight={i} />
        ))}
      </div>
    </section>
  );
}

function Card({ insight }: { insight: Insight }) {
  const tone =
    insight.tone === "positive"
      ? "border-positive/30 bg-positive/5"
      : insight.tone === "warning"
        ? "border-amber-300/30 bg-amber-300/5"
        : "border-border bg-bg-surface";
  return (
    <div
      className={`shrink-0 max-w-[78%] rounded-2xl border p-4 ${tone}`}
      style={{ minWidth: "70%" }}
    >
      <div className="text-sm font-medium leading-snug text-text">
        {insight.title}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-text-muted">
        {insight.detail}
      </div>
    </div>
  );
}
