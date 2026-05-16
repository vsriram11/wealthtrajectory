import { projectIndependence, type IndependenceProjection } from "@/lib/projection/independence";
import {
  blendedCAGRFromLegs,
  type Assumptions,
  type Household,
  type Scenario,
  type ScenarioOverrides,
} from "@/lib/types";

export function applyScenario(
  household: Household,
  assumptions: Assumptions,
  overrides: ScenarioOverrides,
): { household: Household; assumptions: Assumptions } {
  const mult = overrides.contributionMultiplier ?? 1;
  const cagrDelta = overrides.cagrDelta ?? 0;
  const acctOverrides = overrides.accountContributions ?? {};
  const cagrOverrides = overrides.holdingCAGRs ?? {};

  const nextHousehold: Household = {
    ...household,
    accounts: household.accounts.map((a) => {
      const baseContrib =
        a.id in acctOverrides
          ? acctOverrides[a.id]
          : a.monthlyContributionUSD;
      return {
        ...a,
        monthlyContributionUSD: baseContrib * mult,
        holdings: a.holdings.map((h) => {
          const overriddenCAGR =
            h.id in cagrOverrides ? cagrOverrides[h.id] : null;
          const baseCAGR =
            overriddenCAGR != null ? overriddenCAGR : h.expectedRealCAGR;
          if (cagrDelta === 0 && overriddenCAGR == null) return h;
          // Composition-aware scenario application: when the holding
          // carries multi-asset legs (NTSX, GDE, …), propagate the
          // cagrDelta to each leg's expectedRealCAGR and re-derive the
          // wrapper's blended scalar so the leg-driven
          // computePortfolio.weightedRealCAGR stays consistent with
          // the wrapper-driven projectIndependence. holdingCAGRs is a hard
          // wrapper-level override; it doesn't touch legs (the user
          // explicitly said "this holding returns X%").
          const isCompositionWrapper =
            (h.kind === "equity" ||
              h.kind === "bond" ||
              h.kind === "crypto" ||
              h.kind === "commodity") &&
            h.composition &&
            h.composition.length > 0;
          if (isCompositionWrapper && cagrDelta !== 0) {
            const nextLegs = h.composition!.map((leg) => ({
              ...leg,
              expectedRealCAGR:
                (leg.expectedRealCAGR ??
                  defaultLegFallback(leg.kind)) + cagrDelta,
            }));
            return {
              ...h,
              composition: nextLegs,
              // When holdingCAGRs override is also set, that wins.
              expectedRealCAGR:
                overriddenCAGR != null
                  ? overriddenCAGR + cagrDelta
                  : blendedCAGRFromLegs(nextLegs),
            } as typeof h;
          }
          return { ...h, expectedRealCAGR: baseCAGR + cagrDelta };
        }),
      };
    }),
  };

  const nextAssumptions: Assumptions = {
    ...assumptions,
    withdrawalRate: overrides.withdrawalRate ?? assumptions.withdrawalRate,
    targetNetWorthUSD:
      overrides.targetNetWorthUSD ?? assumptions.targetNetWorthUSD,
    legacyFloorUSD: overrides.legacyFloorUSD ?? assumptions.legacyFloorUSD,
  };

  return { household: nextHousehold, assumptions: nextAssumptions };
}

// Mirror of types.ts/defaultLegCAGR. Kept local so scenarios.ts has no
// runtime dep on the helper-export — and the values can't drift without
// the types.ts test catching it (presets.test.ts hits the same numbers).
function defaultLegFallback(kind: string): number {
  switch (kind) {
    case "equity":
      return 0.07;
    case "bond":
      return 0.015;
    case "cash":
      return 0;
    case "crypto":
      return 0.05;
    case "commodity":
      return 0.01;
    case "other":
      return 0.03;
    default:
      return 0;
  }
}

export type ScenarioRun = {
  scenario: Scenario;
  projection: IndependenceProjection;
};

export function runScenarios(
  household: Household,
  assumptions: Assumptions,
  scenarios: Scenario[],
  now: Date = new Date(),
): ScenarioRun[] {
  return scenarios.map((s) => {
    const { household: h, assumptions: a } = applyScenario(
      household,
      assumptions,
      s.overrides,
    );
    return { scenario: s, projection: projectIndependence(h, a, now) };
  });
}

export const SCENARIO_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#4ade80",
  "#fb7185",
  "#fbbf24",
];

export function nextScenarioColor(existing: Scenario[]): string {
  return SCENARIO_COLORS[existing.length % SCENARIO_COLORS.length];
}
