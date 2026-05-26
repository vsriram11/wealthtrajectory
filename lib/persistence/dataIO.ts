import type { Assumptions, Household, Scenario } from "@/lib/types";
import type { TargetAllocation } from "@/lib/portfolio/targetAllocation";

export type ExportPayload = {
  schema: 1;
  exportedAt: number;
  household: Household;
  assumptions: Assumptions;
  scenarios: Scenario[];
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
}): string {
  const payload: ExportPayload = {
    schema: 1,
    exportedAt: Date.now(),
    ...args,
  };
  return JSON.stringify(payload, null, 2);
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
  // Double cast through `unknown` is the standard TS pattern for
  // narrowing a permissive parsing intermediate into a specific
  // type after we've validated/coerced every field above. The
  // alternative — writing a runtime zod-style schema — would be
  // heavier than the value it adds for a personal-data export.
  return coerced as unknown as ExportPayload;
}
