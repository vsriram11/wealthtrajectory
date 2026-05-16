// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { resolveActiveProjection } from "@/lib/projection/useActiveProjection";
import { useAppStore } from "@/lib/store";
import { isLiquid, type Household } from "@/lib/types";

/**
 * The resolver is the single source of truth for "what household +
 * assumptions does the current view show." It must apply BOTH
 * global filters: selectedMemberId and liquidityView. Earlier the
 * hook ignored liquidityView entirely, so toggling Liquid/Total
 * at the top of the app failed to affect downstream cards like
 * effective leverage, weighted real CAGR, drawdown buckets, etc.
 *
 * Tests below pin both filters at the source so the bug can't
 * silently come back.
 */

function snapshot() {
  const s = useAppStore.getState();
  return {
    household: s.household,
    assumptions: s.assumptions,
    memberAssumptions: s.memberAssumptions,
    scenarios: s.scenarios,
    activeId: s.activeScenarioId,
  };
}

function householdHasIlliquid(h: Household): boolean {
  for (const a of h.accounts) {
    for (const hh of a.holdings) {
      if (!isLiquid(hh)) return true;
    }
  }
  return false;
}

beforeEach(() => {
  useAppStore.getState().resetToDemo();
  useAppStore.getState().switchToReal();
});

describe("resolveActiveProjection — both global filters apply at the source", () => {
  it("Total view returns the full household (no filter)", () => {
    const s = snapshot();
    const totalAccts = s.household.accounts.length;
    const out = resolveActiveProjection({
      ...s,
      memberId: null,
      liquidityView: "total",
    });
    expect(out.household.accounts.length).toBe(totalAccts);
  });

  it("Liquid view drops illiquid holdings (real-estate primary residence)", () => {
    // Seed an illiquid holding.
    const memberId = useAppStore.getState().household.members[0].id;
    const accId = useAppStore.getState().createAccount({
      displayName: "Real estate",
      category: "BROKERAGE",
      ownerId: memberId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accId, {
      kind: "real_estate",
      name: "Primary",
      valueUSD: 750_000,
      expectedRealCAGR: 0.02,
      isPrimaryResidence: true,
      leverage: 1,
    });
    const s = snapshot();
    expect(householdHasIlliquid(s.household)).toBe(true);

    const liquidOut = resolveActiveProjection({
      ...s,
      memberId: null,
      liquidityView: "liquid",
    });
    expect(householdHasIlliquid(liquidOut.household)).toBe(false);
  });

  it("Member filter narrows to one member's accounts, even in total view", () => {
    if (useAppStore.getState().household.members.length < 2) {
      useAppStore.getState().addMember("Partner");
    }
    const [memberA, memberB] = useAppStore
      .getState()
      .household.members.map((m) => m.id);
    useAppStore.getState().createAccount({
      displayName: "B brokerage",
      category: "BROKERAGE",
      ownerId: memberB,
      monthlyContributionUSD: 0,
    });
    const s = snapshot();
    const out = resolveActiveProjection({
      ...s,
      memberId: memberA,
      liquidityView: "total",
    });
    const ownersInView = new Set(out.household.accounts.map((a) => a.ownerId));
    expect(ownersInView.has(memberB)).toBe(false);
  });

  it("Both filters stack: member + liquid drops illiquid even within the member's slice", () => {
    if (useAppStore.getState().household.members.length < 2) {
      useAppStore.getState().addMember("Partner");
    }
    const [memberA] = useAppStore
      .getState()
      .household.members.map((m) => m.id);
    const accA = useAppStore.getState().createAccount({
      displayName: "A illiquid",
      category: "BROKERAGE",
      ownerId: memberA,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().createHolding(accA, {
      kind: "real_estate",
      name: "A primary",
      valueUSD: 500_000,
      expectedRealCAGR: 0.02,
      isPrimaryResidence: true,
      leverage: 1,
    });

    const s = snapshot();
    const out = resolveActiveProjection({
      ...s,
      memberId: memberA,
      liquidityView: "liquid",
    });
    // All accounts are A's, and none contain real-estate.
    for (const a of out.household.accounts) {
      expect(a.ownerId).toBe(memberA);
      for (const h of a.holdings) {
        expect(h.kind).not.toBe("real_estate");
      }
    }
  });

  it("memberId is echoed back in the result for downstream cards", () => {
    const memberId = useAppStore.getState().household.members[0].id;
    const s = snapshot();
    expect(
      resolveActiveProjection({
        ...s,
        memberId,
        liquidityView: "total",
      }).memberId,
    ).toBe(memberId);
    expect(
      resolveActiveProjection({
        ...s,
        memberId: null,
        liquidityView: "total",
      }).memberId,
    ).toBeNull();
  });
});

describe("resolveActiveProjection — rollup-include flag cascades through the resolver", () => {
  // The user's reported bug: excluding a member did not change
  // headline NW because accounts/liabilities owned by the member
  // were still rolling up. Pin the fix at the SINGLE composition
  // point so it can't silently regress.
  it("household view drops accounts owned by an excluded member", () => {
    // Add a partner with their own account, then flag them out
    // of rollups. The household-aggregate view should no longer
    // include their account.
    useAppStore.getState().addMember("Partner");
    const [_alex, partnerId] = useAppStore
      .getState()
      .household.members.map((m) => m.id);
    useAppStore.getState().createAccount({
      displayName: "Partner brokerage",
      category: "BROKERAGE",
      ownerId: partnerId,
      monthlyContributionUSD: 0,
    });

    const beforeIds = new Set(
      resolveActiveProjection({
        ...snapshot(),
        memberId: null,
        liquidityView: "total",
      }).household.accounts.map((a) => a.id),
    );
    expect(
      [...beforeIds].some((id) => id.startsWith("acc-")),
    ).toBe(true); // partner's account is in the household view

    useAppStore.getState().setMemberIncludeInRollup(partnerId, false);
    const afterAccts = resolveActiveProjection({
      ...snapshot(),
      memberId: null,
      liquidityView: "total",
    }).household.accounts;
    for (const a of afterAccts) {
      expect(a.ownerId).not.toBe(partnerId);
    }
    // And the household.members in the resolved view drops them.
    const resolvedMemberIds = new Set(
      resolveActiveProjection({
        ...snapshot(),
        memberId: null,
        liquidityView: "total",
      }).household.members.map((m) => m.id),
    );
    expect(resolvedMemberIds.has(partnerId)).toBe(false);
  });

  it("per-member view shows the excluded member's own data when picked explicitly", () => {
    // The semantic boundary: excluding a member from rollups
    // does NOT hide them from per-member view. If the user
    // picks them, they see their data. (Important: the user
    // needs a way to inspect an excluded member's accounts to
    // decide whether to re-include them.)
    useAppStore.getState().addMember("Partner");
    const partnerId =
      useAppStore.getState().household.members[1].id;
    const partnerAcct = useAppStore.getState().createAccount({
      displayName: "Partner brokerage",
      category: "BROKERAGE",
      ownerId: partnerId,
      monthlyContributionUSD: 0,
    });
    useAppStore.getState().setMemberIncludeInRollup(partnerId, false);

    const out = resolveActiveProjection({
      ...snapshot(),
      memberId: partnerId,
      liquidityView: "total",
    });
    expect(
      out.household.accounts.some((a) => a.id === partnerAcct),
    ).toBe(true);
  });

  it("returns reference-stable household when nothing is excluded (memo guard)", () => {
    // householdForRollups short-circuits to the same reference
    // when every member is included. This matters for downstream
    // useMemo dependency checks — without identity stability,
    // every dashboard card would recompute on every render.
    const s = snapshot();
    const out = resolveActiveProjection({
      ...s,
      memberId: null,
      liquidityView: "total",
    });
    // The resolver may shallow-clone (e.g. for scenario apply),
    // but in the steady-state path with no scenario active,
    // accounts identity should pass through.
    expect(out.household.accounts).toBe(s.household.accounts);
  });
});

describe("resolveActiveProjection — active-scenario overlay", () => {
  // The resolver has two return paths: no-scenario (returns the
  // base household + assumptions) and scenario-active (applies
  // the scenario's overrides). This block covers the second
  // path, which the rest of the test file doesn't exercise —
  // the gap was at 74% line coverage (271-282), where the
  // scenario-apply branch lives.

  it("scenario overlay surfaces the scenario's name in the result", () => {
    const scenarioId = useAppStore
      .getState()
      .addScenario({ name: "What if I retire early?", overrides: {} });
    useAppStore.getState().setActiveScenario(scenarioId);
    const out = resolveActiveProjection({
      ...snapshot(),
      memberId: null,
      liquidityView: "total",
    });
    expect(out.scenarioName).toBe("What if I retire early?");
    // Cleanup — leave the store untouched for the next test.
    useAppStore.getState().setActiveScenario(null);
  });

  it("scenario overrides modify the resolved assumptions", () => {
    // Pin the rule: an active scenario that bumps the target
    // SHOULD produce a resolved assumption with the new
    // target. Without this, the scenario-active branch could
    // silently no-op and no caller would notice (the scenario
    // chip would highlight but every projection card would
    // still use base assumptions).
    const baseTarget = useAppStore.getState().assumptions.targetNetWorthUSD;
    const scenarioId = useAppStore.getState().addScenario({
      name: "Bigger nest egg",
      overrides: { targetNetWorthUSD: baseTarget * 2 },
    });
    useAppStore.getState().setActiveScenario(scenarioId);

    const out = resolveActiveProjection({
      ...snapshot(),
      memberId: null,
      liquidityView: "total",
    });
    expect(out.assumptions.targetNetWorthUSD).toBe(baseTarget * 2);
    useAppStore.getState().setActiveScenario(null);
  });

  it("non-existent activeId falls back to the no-scenario branch", () => {
    // Defensive: a stale activeScenarioId pointing at a deleted
    // scenario shouldn't crash — it should behave as if no
    // scenario is active.
    const out = resolveActiveProjection({
      ...snapshot(),
      memberId: null,
      liquidityView: "total",
      activeId: "ghost-scenario-id",
    });
    expect(out.scenarioName).toBeNull();
  });
});
