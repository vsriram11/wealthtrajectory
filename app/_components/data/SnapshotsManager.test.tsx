import { describe, expect, it } from "vitest";

import { summarize } from "./SnapshotsManager";
import type { Snapshot } from "@/lib/persistence/persistence";

describe("SnapshotsManager — summarize header text (truth table)", () => {
  const emptyList: Snapshot[] = [];
  const oneSnap: Snapshot[] = [{ t: Date.UTC(2024, 0, 15), netWorthUSD: 1 }];

  it("empty list, no member filter → 'capture one' prompt", () => {
    expect(summarize(emptyList, null, 0)).toMatch(/None yet/);
  });

  it("empty list, member filter, no legacy dropped → 'no snapshots for this member'", () => {
    expect(summarize(emptyList, "m1", 0)).toMatch(/No snapshots for this member/);
  });

  it("empty list, member filter, legacy dropped → 'M legacy NW-only hidden'", () => {
    expect(summarize(emptyList, "m1", 3)).toMatch(
      /No member-attributable snapshots \(3 legacy NW-only hidden/,
    );
  });

  it("non-empty list, no member filter → 'N recorded · oldest …' (no filter suffix)", () => {
    const s = summarize(oneSnap, null, 0);
    expect(s).toMatch(/1 recorded/);
    expect(s).toMatch(/oldest/);
    expect(s).not.toMatch(/filtered to selected member/);
  });

  it("non-empty list, member filter, no legacy dropped → filter suffix only", () => {
    const s = summarize(oneSnap, "m1", 0);
    expect(s).toMatch(/1 recorded/);
    expect(s).toMatch(/\(filtered to selected member\)$/);
  });

  it("non-empty list, member filter, legacy dropped → filter suffix + dropped count", () => {
    const s = summarize(oneSnap, "m1", 2);
    expect(s).toMatch(/1 recorded/);
    expect(s).toMatch(/2 legacy NW-only hidden/);
  });
});
