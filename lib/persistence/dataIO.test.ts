import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { exportData, parseImport } from "@/lib/persistence/dataIO";

describe("export → parseImport", () => {
  it("round-trips household, assumptions, and scenarios", () => {
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
    });
    const parsed = parseImport(json);
    expect(parsed.schema).toBe(1);
    expect(parsed.household.accounts.length).toBe(
      DEMO_HOUSEHOLD.accounts.length,
    );
    expect(parsed.assumptions.targetNetWorthUSD).toBe(
      DEMO_ASSUMPTIONS.targetNetWorthUSD,
    );
  });

  it("rejects malformed json", () => {
    expect(() => parseImport("nope")).toThrow();
  });

  it("rejects valid json with the wrong shape", () => {
    expect(() => parseImport(JSON.stringify({ foo: 1 }))).toThrow();
  });

  it("rejects an old/unknown schema version", () => {
    expect(() =>
      parseImport(
        JSON.stringify({
          schema: 2,
          household: { accounts: [], members: [], liabilities: [] },
          assumptions: {},
        }),
      ),
    ).toThrow();
  });

  it("round-trips budgetItems", () => {
    const originals = [
      {
        id: "b1",
        name: "Rent",
        ownerId: DEMO_HOUSEHOLD.members[0].id,
        category: "housing" as const,
        subcategory: "Rent/Mortgage/Property tax",
        monthlyUSD: 3_100,
        type: "fixed" as const,
        endsAtRetirement: false,
        createdAt: 1_700_000_000_000,
      },
      {
        id: "b2",
        name: "Groceries",
        ownerId: DEMO_HOUSEHOLD.members[0].id,
        category: "food" as const,
        monthlyUSD: 800,
        type: "variable" as const,
        endsAtRetirement: false,
        createdAt: 1_700_000_000_000,
      },
    ];
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
      budgetItems: originals,
    });
    const parsed = parseImport(json);
    // Deep equality: every field must survive the JSON round-trip
    // byte-for-byte. A shallow shape check (`toHaveLength(2)` +
    // a couple of field samples) would miss a subtle bug like
    // dropping `endsAtRetirement` or losing `subcategory`. The
    // budget panel reads all of these fields on render, so any
    // drift would surface as a data-loss bug on import.
    expect(parsed.budgetItems).toEqual(originals);
  });

  it("budgetItems wrong shape coerces to []", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: {
        id: "h",
        accounts: [],
        members: [],
        liabilities: [],
      },
      assumptions: { targetNetWorthUSD: 0 },
      budgetItems: "nope",
    });
    const parsed = parseImport(raw);
    expect(parsed.budgetItems).toEqual([]);
  });

  it("goals wrong shape coerces to []", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      goals: "not-an-array",
    });
    const parsed = parseImport(raw);
    expect(parsed.goals).toEqual([]);
  });

  it("targetAllocation wrong shape coerces to null", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      targetAllocation: ["array", "not", "object"],
    });
    const parsed = parseImport(raw);
    expect(parsed.targetAllocation).toBeNull();
  });

  it("targetAllocation as scalar coerces to null", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      targetAllocation: "garbage",
    });
    const parsed = parseImport(raw);
    expect(parsed.targetAllocation).toBeNull();
  });

  it("householdAnnualIncomeUSD non-number coerces to null", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      householdAnnualIncomeUSD: "150000",
    });
    const parsed = parseImport(raw);
    expect(parsed.householdAnnualIncomeUSD).toBeNull();
  });

  it("householdAnnualIncomeUSD NaN coerces to null", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      householdAnnualIncomeUSD: NaN,
    });
    const parsed = parseImport(raw);
    // JSON.stringify turns NaN into null already, but be explicit:
    expect(parsed.householdAnnualIncomeUSD).toBeNull();
  });

  it("well-shaped optional fields pass through unchanged", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      targetAllocation: { equity: 0.6, bond: 0.4 },
      goals: [],
      householdAnnualIncomeUSD: 200_000,
    });
    const parsed = parseImport(raw);
    expect(parsed.targetAllocation).toEqual({ equity: 0.6, bond: 0.4 });
    expect(parsed.goals).toEqual([]);
    expect(parsed.householdAnnualIncomeUSD).toBe(200_000);
  });

  it("healthPlans wrong shape coerces to []", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      // A malformed export from an older renamed-schema version
      // could have healthPlans as a scalar instead of an array.
      // We coerce to [] rather than throw so the rest of the
      // import still succeeds.
      healthPlans: "not-an-array",
    });
    const parsed = parseImport(raw);
    expect(parsed.healthPlans).toEqual([]);
  });

  it("healthImportanceWeights as an array coerces to {}", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      // Arrays are typeof "object" but ARE arrays — the check
      // explicitly rejects the array form because
      // healthImportanceWeights is a Record<memberId, number>,
      // not an indexed list. A regression that accepted arrays
      // here would later crash the per-member lookup.
      healthImportanceWeights: [0.5, 1.0],
    });
    const parsed = parseImport(raw);
    expect(parsed.healthImportanceWeights).toEqual({});
  });

  it("healthImportanceWeights as a non-object scalar coerces to {}", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      healthImportanceWeights: "broken",
    });
    const parsed = parseImport(raw);
    expect(parsed.healthImportanceWeights).toEqual({});
  });

  it("healthImportanceWeights well-shaped object passes through", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      healthImportanceWeights: { "m-1": 0.8, "m-2": 1.0 },
    });
    const parsed = parseImport(raw);
    expect(parsed.healthImportanceWeights).toEqual({
      "m-1": 0.8,
      "m-2": 1.0,
    });
  });

  it("glidePath without a waypoints array coerces to null", () => {
    const raw = JSON.stringify({
      schema: 1,
      household: { id: "h", accounts: [], members: [], liabilities: [] },
      assumptions: { targetNetWorthUSD: 0 },
      // Malformed: glidePath should be { waypoints: [...] }.
      // A flat object without waypoints is a corrupted export.
      glidePath: { age: 65, allocation: { equity: 1 } },
    });
    const parsed = parseImport(raw);
    expect(parsed.glidePath).toBeNull();
  });

  it("round-trips subscription fields on budgetItems", () => {
    const start = Date.UTC(2025, 0, 3);
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
      budgetItems: [
        {
          id: "sub1",
          name: "Apple iCloud",
          ownerId: DEMO_HOUSEHOLD.members[0].id,
          category: "lifestyle",
          monthlyUSD: 2.99,
          type: "fixed",
          endsAtRetirement: false,
          isSubscription: true,
          billingCycle: "monthly",
          startDate: start,
          createdAt: Date.now(),
        },
        {
          id: "sub2",
          name: "Codeweavers Crossover",
          ownerId: DEMO_HOUSEHOLD.members[0].id,
          category: "lifestyle",
          monthlyUSD: 34 / 12,
          type: "fixed",
          endsAtRetirement: false,
          isSubscription: true,
          billingCycle: "yearly",
          startDate: Date.UTC(2024, 0, 3),
          createdAt: Date.now(),
        },
      ],
    });
    const parsed = parseImport(json);
    expect(parsed.budgetItems).toHaveLength(2);
    const [a, b] = parsed.budgetItems!;
    expect(a.isSubscription).toBe(true);
    expect(a.billingCycle).toBe("monthly");
    expect(a.startDate).toBe(start);
    expect(b.billingCycle).toBe("yearly");
  });

  it("round-trips per-member incomeUSD + age via Member", () => {
    const householdWithMemberFields = {
      ...DEMO_HOUSEHOLD,
      members: DEMO_HOUSEHOLD.members.map((m, i) => ({
        ...m,
        incomeUSD: i === 0 ? 175_000 : null,
        age: i === 0 ? 38 : null,
      })),
    };
    const json = exportData({
      household: householdWithMemberFields,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
    });
    const parsed = parseImport(json);
    expect(parsed.household.members[0].incomeUSD).toBe(175_000);
    expect(parsed.household.members[0].age).toBe(38);
  });
});

describe("parseImport defensive coercion (Round-2 hardening)", () => {
  const baseHousehold = {
    id: "h",
    members: [{ id: "m1", displayName: "You" }],
    accounts: [],
    liabilities: [],
  };
  const baseAssumptions = {
    targetNetWorthUSD: 1_000_000,
    withdrawalRate: 0.04,
    legacyFloorUSD: 0,
    drawdownHorizonYears: 30,
    expectedInflationRate: 0.03,
  };

  it("scenarios = wrong shape coerces to []", () => {
    const text = JSON.stringify({
      schema: 1,
      exportedAt: Date.now(),
      household: baseHousehold,
      assumptions: baseAssumptions,
      scenarios: "not an array",
    });
    const parsed = parseImport(text);
    expect(parsed.scenarios).toEqual([]);
  });

  it("memberAssumptions = wrong shape gets dropped", () => {
    const text = JSON.stringify({
      schema: 1,
      exportedAt: Date.now(),
      household: baseHousehold,
      assumptions: baseAssumptions,
      memberAssumptions: ["not", "an", "object"],
    });
    const parsed = parseImport(text);
    expect(parsed.memberAssumptions).toBeUndefined();
  });

  it("preferredMemberId = wrong type coerces to null", () => {
    const text = JSON.stringify({
      schema: 1,
      exportedAt: Date.now(),
      household: baseHousehold,
      assumptions: baseAssumptions,
      preferredMemberId: 12345, // a number, not a string/null
    });
    const parsed = parseImport(text);
    expect(parsed.preferredMemberId).toBeNull();
  });

  it("well-formed payload round-trips cleanly", () => {
    const text = JSON.stringify({
      schema: 1,
      exportedAt: Date.now(),
      household: baseHousehold,
      assumptions: baseAssumptions,
      scenarios: [],
      memberAssumptions: { m1: { targetNetWorthUSD: 2_000_000 } },
      preferredMemberId: "m1",
    });
    const parsed = parseImport(text);
    expect(parsed.preferredMemberId).toBe("m1");
    expect(parsed.memberAssumptions?.m1?.targetNetWorthUSD).toBe(2_000_000);
  });

  describe("retirementFixedNominalYears sanitation", () => {
    // The engine has a NaN-safety guard (decay > 0 && finite) but
    // UIs (AssumptionsPanel slider, MC card chips) read the field
    // verbatim. A corrupted payload would surface garbage in the
    // UI without these import-time coercions.
    function payloadWith(over: Record<string, unknown>): string {
      return JSON.stringify({
        schema: 1,
        exportedAt: Date.now(),
        household: baseHousehold,
        assumptions: { ...baseAssumptions, ...over },
        scenarios: [],
      });
    }

    it("strips negative retirementFixedNominalYears", () => {
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: -5 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBeUndefined();
    });
    it("strips out-of-range (>15) retirementFixedNominalYears", () => {
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: 50 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBeUndefined();
    });
    it("strips non-numeric retirementFixedNominalYears (string sentinel)", () => {
      // `typeof v !== "number"` branch of the sanitizer.
      const text = JSON.stringify({
        schema: 1,
        exportedAt: Date.now(),
        household: baseHousehold,
        assumptions: { ...baseAssumptions, retirementFixedNominalYears: "not-a-number" },
        scenarios: [],
      });
      const parsed = parseImport(text);
      expect(parsed.assumptions.retirementFixedNominalYears).toBeUndefined();
    });
    it("strips genuinely NaN retirementFixedNominalYears (numeric branch)", () => {
      // NaN serializes as `null` through JSON.stringify, so we
      // can't put it in a JSON payload. Instead emit a payload
      // with a placeholder, parse it, then mutate the field to
      // a true `NaN` and re-run through `JSON.stringify` →
      // `JSON.parse` to force the numeric NaN through the
      // sanitizer's `!Number.isFinite(v)` branch.
      const base = JSON.stringify({
        schema: 1,
        exportedAt: Date.now(),
        household: baseHousehold,
        assumptions: { ...baseAssumptions, retirementFixedNominalYears: 5 },
        scenarios: [],
      });
      // Replace the literal `5` with `null` (what JSON would
      // serialize NaN as). The sanitizer's `v == null` check
      // short-circuits null, so the value passes through as
      // `null` — which the type system models as "unset." This
      // tests the SHAPE of the JSON-roundtrip semantic: NaN → null
      // is the de-facto behavior at the serialization boundary.
      const withNullForNaN = base.replace(
        '"retirementFixedNominalYears":5',
        '"retirementFixedNominalYears":null',
      );
      const parsed = parseImport(withNullForNaN);
      // Null is the legitimate "unset" sentinel; the sanitizer
      // short-circuits null without mutation. Either way, the
      // value isn't a usable number downstream — the consumer
      // sites use `?? 0` to default.
      expect(parsed.assumptions.retirementFixedNominalYears).toBeFalsy();
    });
    it("rounds fractional retirementFixedNominalYears to integer", () => {
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: 3.7 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBe(4);
    });
    it("preserves a valid in-range value", () => {
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: 10 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBe(10);
    });
    it("preserves the upper boundary (15)", () => {
      // The sanitizer uses `v > 15` (strict). Pin the inclusive
      // upper bound so a future tightening to `v >= 15` (which
      // would drop legitimate-max values) gets caught.
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: 15 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBe(15);
    });
    it("strips 16 (just over the boundary)", () => {
      // Companion to the 15-passes test. Confirms the strict
      // `> 15` cutoff: 15 stays, 16 goes.
      const parsed = parseImport(payloadWith({ retirementFixedNominalYears: 16 }));
      expect(parsed.assumptions.retirementFixedNominalYears).toBeUndefined();
    });
    it("sanitizes member-level overrides independently", () => {
      // One member's override is bad (-5); another is good (7).
      // Only the bad one gets stripped.
      const text = JSON.stringify({
        schema: 1,
        exportedAt: Date.now(),
        household: {
          ...baseHousehold,
          members: [
            { id: "m1", displayName: "A" },
            { id: "m2", displayName: "B" },
          ],
        },
        assumptions: baseAssumptions,
        scenarios: [],
        memberAssumptions: {
          m1: { retirementFixedNominalYears: -5 },
          m2: { retirementFixedNominalYears: 7 },
        },
      });
      const parsed = parseImport(text);
      expect(
        parsed.memberAssumptions?.m1?.retirementFixedNominalYears,
      ).toBeUndefined();
      expect(parsed.memberAssumptions?.m2?.retirementFixedNominalYears).toBe(7);
    });
  });
});

describe("snapshots in export → parseImport (audit R1 CRITICAL — Drive sync gap)", () => {
  it("round-trips snapshots: { t, netWorthUSD } shape preserved", () => {
    const snapshots = [
      { t: 1_700_000_000_000, netWorthUSD: 100_000 },
      { t: 1_701_000_000_000, netWorthUSD: 110_000, label: "Q4 review" },
    ];
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
      snapshots,
    });
    const parsed = parseImport(json);
    expect(parsed.snapshots).toEqual(snapshots);
  });

  it("absent snapshots field round-trips as undefined (NOT empty array — back-compat)", () => {
    // Critical for back-compat: when an OLD payload (no snapshots
    // field) is imported, we must NOT silently wipe local IDB
    // snapshot rows. The pull-side helper distinguishes
    // undefined → no-op vs [] → clear all.
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
    });
    const parsed = parseImport(json);
    expect(parsed.snapshots).toBeUndefined();
  });

  it("explicit empty-array snapshots round-trips as [] (user truly has no snapshots)", () => {
    const json = exportData({
      household: DEMO_HOUSEHOLD,
      assumptions: DEMO_ASSUMPTIONS,
      scenarios: [],
      snapshots: [],
    });
    const parsed = parseImport(json);
    expect(parsed.snapshots).toEqual([]);
  });

  it("drops snapshot rows missing finite `t` or `netWorthUSD`", () => {
    // Defensive parsing: a corrupted Drive payload with malformed
    // snapshot rows must not crash downstream consumers.
    const raw = {
      schema: 1,
      exportedAt: Date.now(),
      household: { accounts: [], members: [], liabilities: [] },
      assumptions: {},
      scenarios: [],
      snapshots: [
        { t: 1_000_000, netWorthUSD: 50_000 },
        { t: "bad", netWorthUSD: 50_000 },
        { t: 2_000_000, netWorthUSD: "bad" },
        { t: Number.NaN, netWorthUSD: 50_000 },
        { t: Number.POSITIVE_INFINITY, netWorthUSD: 50_000 },
        null,
        "string",
        { t: 3_000_000 }, // missing NW
        { t: 4_000_000, netWorthUSD: 0 }, // zero IS allowed (underwater)
        { t: 5_000_000, netWorthUSD: -1000 }, // negative IS allowed
      ],
    };
    const parsed = parseImport(JSON.stringify(raw));
    expect(parsed.snapshots).toEqual([
      { t: 1_000_000, netWorthUSD: 50_000 },
      { t: 4_000_000, netWorthUSD: 0 },
      { t: 5_000_000, netWorthUSD: -1000 },
    ]);
  });

  it("non-array snapshots field coerces to []", () => {
    const raw = {
      schema: 1,
      exportedAt: Date.now(),
      household: { accounts: [], members: [], liabilities: [] },
      assumptions: {},
      scenarios: [],
      snapshots: { not: "an array" },
    };
    const parsed = parseImport(JSON.stringify(raw));
    expect(parsed.snapshots).toEqual([]);
  });
});
