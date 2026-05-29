import type { Assumptions, Household, Scenario } from "@/lib/types";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";
import type { Snapshot } from "@/lib/persistence/persistence";

export type ExportPayload = {
  schema: 1;
  exportedAt: number;
  household: Household;
  assumptions: Assumptions;
  scenarios: Scenario[];
  /**
   * Historical snapshots — point-in-time NW records that drive the
   * History chart and YoY comparisons. Stored in IndexedDB on the
   * user's device, NOT in the live Zustand state slice, so the
   * sync/export layer must load them from IDB at export time and
   * write them back to IDB at import time. Optional in the payload
   * for back-compat: older exports (and the very first Drive sync
   * before this field was added) simply have no snapshots field,
   * and the importer leaves IDB rows untouched in that case
   * (rather than wiping them).
   * Round-1 audit CRITICAL fix: previously snapshots were NEVER
   * synced, so any user who wiped local data / changed devices /
   * cleared cookies lost their entire snapshot history.
   */
  snapshots?: Snapshot[];
  /**
   * Per-member assumption overrides. Optional in the payload so older
   * exports (pre-feature) still parse. Old payloads simply have no
   * per-member overrides on import.
   */
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  /**
   * Persisted "default member-filter view on open" preference. Null /
   * undefined = land on Household. A memberId = land on that
   * member's slice. Validated against the imported household on
   * load so a deleted-member id can't ghost across devices.
   */
  preferredMemberId?: string | null;
  /** Optional user-defined target allocation. */
  targetAllocation?: TargetAllocation | null;
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  /** Optional household-level annual gross income for savings-rate insight. */
  householdAnnualIncomeUSD?: number | null;
  /** Non-Independence financial goals. Optional + back-compat. */
  goals?: import("@/lib/insights/goals").Goal[];
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  /** Future income streams (consulting, pension, SS, rental, etc.). Optional + back-compat. */
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  /** Health-insurance plans tracked in Plan → Health. Optional + back-compat. */
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  /** Per-member health-plan factor importance weights. */
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
};

export function exportData(args: {
  household: Household;
  assumptions: Assumptions;
  scenarios: Scenario[];
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  preferredMemberId?: string | null;
  targetAllocation?: TargetAllocation | null;
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  householdAnnualIncomeUSD?: number | null;
  goals?: import("@/lib/insights/goals").Goal[];
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
  snapshots?: Snapshot[];
}): string {
  const payload: ExportPayload = {
    schema: 1,
    exportedAt: Date.now(),
    ...args,
  };
  // R1-D2 audit HIGH fix: compact JSON drops ~30% off the wire-and-
  // disk size of every Drive backup AND every JSON export. With the
  // new snapshot field carrying a full household clone per row,
  // payloads can balloon quickly — the indent was pure cosmetics
  // that nothing downstream reads. Users who really want pretty
  // JSON can pipe through `jq`.
  return JSON.stringify(payload);
}

export function downloadExport(args: {
  household: Household;
  assumptions: Assumptions;
  scenarios: Scenario[];
  memberAssumptions?: Record<string, Partial<Assumptions>>;
  preferredMemberId?: string | null;
  targetAllocation?: TargetAllocation | null;
  glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
  householdAnnualIncomeUSD?: number | null;
  goals?: import("@/lib/insights/goals").Goal[];
  budgetItems?: import("@/lib/budget/budget").BudgetItem[];
  incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
  healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
  healthImportanceWeights?: Record<
    string,
    import("@/lib/health/healthPlans").HealthImportanceWeights
  >;
  snapshots?: Snapshot[];
}): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([exportData(args)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `wealthtrajectory-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Apply a parsed `ExportPayload` to the live store + IndexedDB.
 *
 * Round-1 audit CRITICAL fix: snapshots live in IDB (not in
 * Zustand), so every import site must (a) call `importPayload(...)`
 * to replace store-backed slices AND (b) call `replaceAllSnapshots`
 * to mirror snapshot rows into IDB. Forgetting (b) silently leaves
 * an inconsistent state where the user's old snapshots stick around
 * after a "restore from backup". This helper bundles both steps so
 * call sites can't accidentally do half the job.
 *
 * `importAction` is the store's `importPayload` setter; passed in
 * (rather than imported) so dataIO has no runtime dep on the store
 * (keeps it usable from the engine layer + tests). Back-compat:
 * when `parsed.snapshots` is `undefined`, the IDB rows are left
 * intact — old payloads pre-date this field, and silently wiping
 * snapshot history on first restore from an old backup would be
 * worse than letting old+new coexist for one sync cycle.
 */
export async function applyImportedPayload(
  parsed: ExportPayload,
  importAction: (payload: {
    household: Household;
    assumptions: Assumptions;
    scenarios: Scenario[];
    memberAssumptions?: Record<string, Partial<Assumptions>>;
    preferredMemberId?: string | null;
    targetAllocation?: TargetAllocation | null;
    glidePath?: import("@/lib/portfolio/glidePath").GlidePath | null;
    householdAnnualIncomeUSD?: number | null;
    goals?: import("@/lib/insights/goals").Goal[];
    budgetItems?: import("@/lib/budget/budget").BudgetItem[];
    incomeStreams?: import("@/lib/budget/incomeStreams").IncomeStream[];
    healthPlans?: import("@/lib/health/healthPlans").HealthPlan[];
    healthImportanceWeights?: Record<
      string,
      import("@/lib/health/healthPlans").HealthImportanceWeights
    >;
  }) => void,
): Promise<void> {
  importAction({
    household: parsed.household,
    assumptions: parsed.assumptions,
    scenarios: parsed.scenarios ?? [],
    memberAssumptions: parsed.memberAssumptions,
    preferredMemberId: parsed.preferredMemberId,
    targetAllocation: parsed.targetAllocation,
    glidePath: parsed.glidePath,
    householdAnnualIncomeUSD: parsed.householdAnnualIncomeUSD,
    goals: parsed.goals,
    budgetItems: parsed.budgetItems,
    incomeStreams: parsed.incomeStreams,
    healthPlans: parsed.healthPlans,
    healthImportanceWeights: parsed.healthImportanceWeights,
  });
  // Snapshots branch — IMPORTANT: only fires when parsed.snapshots is
  // EXPLICITLY present in the payload (DO NOT change to
  // `parsed.snapshots ?? []`). When the field is missing entirely
  // (older export schema), we must preserve local IDB rows rather
  // than wipe them — silently nuking snapshot history on first
  // restore from an old backup would be a much worse failure than
  // letting old + new state coexist for one sync cycle. R1-D4 audit
  // pin: this comment is load-bearing; the dataIO test regression
  // pins the no-wipe invariant.
  if (parsed.snapshots !== undefined) {
    const { replaceAllSnapshots } = await import(
      "@/lib/persistence/persistence"
    );
    await replaceAllSnapshots(parsed.snapshots);
  }
}

export function parseImport(text: string): ExportPayload {
  const data = JSON.parse(text);
  if (
    typeof data !== "object" ||
    data == null ||
    data.schema !== 1 ||
    !data.household ||
    !data.assumptions ||
    !Array.isArray(data.household.accounts) ||
    !Array.isArray(data.household.members) ||
    !Array.isArray(data.household.liabilities)
  ) {
    throw new Error("Not a valid Independence Path export");
  }
  // Defensive coercion of optional fields: a payload from an older
  // schema or a corrupted Drive backup might have wrong-shaped values
  // that would crash downstream code (importPayload, store actions).
  // Coerce-or-drop instead of throwing so a partially-bad payload
  // still imports the well-formed parts.
  const coerced = data as Record<string, unknown>;
  if (!Array.isArray(coerced.scenarios)) {
    coerced.scenarios = [];
  }
  if (
    coerced.memberAssumptions != null &&
    (typeof coerced.memberAssumptions !== "object" ||
      Array.isArray(coerced.memberAssumptions))
  ) {
    delete coerced.memberAssumptions;
  }
  if (
    coerced.preferredMemberId !== undefined &&
    coerced.preferredMemberId !== null &&
    typeof coerced.preferredMemberId !== "string"
  ) {
    coerced.preferredMemberId = null;
  }
  if (coerced.budgetItems !== undefined && !Array.isArray(coerced.budgetItems)) {
    coerced.budgetItems = [];
  }
  if (
    coerced.incomeStreams !== undefined &&
    !Array.isArray(coerced.incomeStreams)
  ) {
    coerced.incomeStreams = [];
  }
  // Per-stream NaN-safety on import. The slice's coerceWritableFields
  // only runs on UI-driven add/update — direct import / Drive
  // hydration bypasses it. Strip non-finite annualUSD so a corrupted
  // payload (or a payload that survived a `JSON.stringify` Infinity
  // round-trip-as-null) can't poison downstream cash-flow accumulators.
  // Signed values are preserved; only NaN / Infinity / non-number are
  // coerced to 0 (matches the slice contract).
  if (Array.isArray(coerced.incomeStreams)) {
    coerced.incomeStreams = (coerced.incomeStreams as unknown[]).map((s) => {
      if (s == null || typeof s !== "object") return s;
      const stream = s as Record<string, unknown>;
      if (
        stream.annualUSD != null &&
        (typeof stream.annualUSD !== "number" ||
          !Number.isFinite(stream.annualUSD))
      ) {
        return { ...stream, annualUSD: 0 };
      }
      return stream;
    });
  }
  if (coerced.goals !== undefined && !Array.isArray(coerced.goals)) {
    coerced.goals = [];
  }
  if (
    coerced.targetAllocation !== undefined &&
    coerced.targetAllocation !== null &&
    (typeof coerced.targetAllocation !== "object" ||
      Array.isArray(coerced.targetAllocation))
  ) {
    coerced.targetAllocation = null;
  }
  if (
    coerced.glidePath !== undefined &&
    coerced.glidePath !== null &&
    (typeof coerced.glidePath !== "object" ||
      Array.isArray(coerced.glidePath) ||
      !Array.isArray((coerced.glidePath as { waypoints?: unknown }).waypoints))
  ) {
    coerced.glidePath = null;
  }
  // Range-validate `retirementFixedNominalYears` on Assumptions
  // and on every memberAssumptions override. The engine has a
  // finite/positive guard but consumer UIs (AssumptionsPanel
  // slider, MC card chips) display the field verbatim — a
  // corrupted Drive payload with `-50` or `NaN` would render
  // garbage in the slider. Coerce non-numeric / non-finite /
  // out-of-range values back to undefined so the assumption
  // falls back to "no freeze."
  const sanitizeFreezeYears = (obj: Record<string, unknown>): void => {
    const v = obj.retirementFixedNominalYears;
    if (v == null) return;
    // Range matches the AssumptionsPanel slider (0..15). A payload
    // outside that range can't round-trip — the slider would
    // truncate on next save, silently losing the user's number.
    // Refuse out-of-range values rather than ship a silent
    // truncation bug.
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 15) {
      delete obj.retirementFixedNominalYears;
    } else {
      // Round to integer (the slider stores integers; a fractional
      // year would behave oddly in the engine's geometric decay).
      obj.retirementFixedNominalYears = Math.round(v);
    }
  };
  if (coerced.assumptions && typeof coerced.assumptions === "object") {
    sanitizeFreezeYears(coerced.assumptions as Record<string, unknown>);
  }
  if (
    coerced.memberAssumptions &&
    typeof coerced.memberAssumptions === "object" &&
    !Array.isArray(coerced.memberAssumptions)
  ) {
    for (const k of Object.keys(coerced.memberAssumptions)) {
      const m = (coerced.memberAssumptions as Record<string, unknown>)[k];
      if (m && typeof m === "object" && !Array.isArray(m)) {
        sanitizeFreezeYears(m as Record<string, unknown>);
      }
    }
  }
  if (
    coerced.householdAnnualIncomeUSD !== undefined &&
    coerced.householdAnnualIncomeUSD !== null &&
    (typeof coerced.householdAnnualIncomeUSD !== "number" ||
      !Number.isFinite(coerced.householdAnnualIncomeUSD))
  ) {
    coerced.householdAnnualIncomeUSD = null;
  }
  if (coerced.healthPlans !== undefined && !Array.isArray(coerced.healthPlans)) {
    coerced.healthPlans = [];
  }
  if (
    coerced.healthImportanceWeights != null &&
    (typeof coerced.healthImportanceWeights !== "object" ||
      Array.isArray(coerced.healthImportanceWeights))
  ) {
    coerced.healthImportanceWeights = {};
  }
  // Snapshots — drop non-array or corrupt rows. Each row must have a
  // finite `t` (primary key) and finite `netWorthUSD`; everything
  // else is optional and tolerated. We do NOT drop zero/negative NW
  // rows here (legitimately underwater state is real — see Round-1
  // audit fix in persistence.loadSnapshots).
  if (coerced.snapshots !== undefined && !Array.isArray(coerced.snapshots)) {
    coerced.snapshots = [];
  }
  if (Array.isArray(coerced.snapshots)) {
    coerced.snapshots = (coerced.snapshots as unknown[]).flatMap((s) => {
      if (s == null || typeof s !== "object") return [];
      const row = s as Record<string, unknown>;
      if (
        typeof row.t !== "number" ||
        !Number.isFinite(row.t) ||
        typeof row.netWorthUSD !== "number" ||
        !Number.isFinite(row.netWorthUSD)
      ) {
        return [];
      }
      // Drop malformed `household` / `appState` rather than
      // letting them through to downstream consumers
      // (historicalReturns, HistoryTab) which dereference
      // .accounts / .members / nested fields without runtime
      // type guards. A hand-edited or malicious JSON with
      // `household: 42` or `appState: []` would otherwise crash
      // the engine on first deref. Surrounding fields (t,
      // netWorthUSD, label) are preserved so the row is still
      // useful as a lightweight NW-only checkpoint.
      if (
        row.household != null &&
        (typeof row.household !== "object" || Array.isArray(row.household))
      ) {
        delete row.household;
      }
      if (
        row.appState != null &&
        (typeof row.appState !== "object" || Array.isArray(row.appState))
      ) {
        delete row.appState;
      }
      return [row];
    });
  }
  // Double cast through `unknown` is the standard TS pattern for
  // narrowing a permissive parsing intermediate into a specific
  // type after we've validated/coerced every field above. The
  // alternative — writing a runtime zod-style schema — would be
  // heavier than the value it adds for a personal-data export.
  return coerced as unknown as ExportPayload;
}
