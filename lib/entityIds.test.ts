import { describe, expect, it } from "vitest";
import type {
  AccountId,
  HoldingId,
  LiabilityId,
  MemberId,
} from "@/lib/entityIds";
import {
  castAccountId,
  castHoldingId,
  castLiabilityId,
  castMemberId,
} from "@/lib/entityIds";

describe("branded entity ids — runtime", () => {
  it("cast* helpers are pure pass-throughs at runtime", () => {
    expect(castHoldingId("h-1")).toBe("h-1");
    expect(castAccountId("a-1")).toBe("a-1");
    expect(castLiabilityId("l-1")).toBe("l-1");
    expect(castMemberId("m-1")).toBe("m-1");
  });

  it("branded ids compare with plain strings via ===", () => {
    const hid: HoldingId = castHoldingId("h-1");
    expect(hid === "h-1").toBe(true);
  });
});

/**
 * Compile-time tests for the brand-distinction invariant.
 *
 * Each block below contains code that MUST fail to type-check.
 * The `@ts-expect-error` directive turns "the line below fails
 * to compile" into a passing condition: if the line ever
 * starts compiling, TS reports "unused @ts-expect-error" and
 * the build fails. That's the exact contract we want — branded
 * ids should remain non-substitutable for each other forever.
 *
 * Wrapped in `if (false)` so the bodies are dead at runtime
 * but TS still type-checks them. The tests have no runtime
 * assertions because the assertion *is* compilation success:
 * if tsc passes (the CI typecheck step), the invariant holds;
 * if it doesn't, CI fails before vitest ever runs.
 */
describe("branded entity ids — compile-time distinction", () => {
  it("rejects HoldingId where AccountId is expected", () => {
    if (false as boolean) {
      const hid: HoldingId = castHoldingId("h-1");
      const takeAccount = (_id: AccountId): void => {};
      // @ts-expect-error — HoldingId is not assignable to AccountId
      takeAccount(hid);
    }
  });

  it("rejects AccountId where HoldingId is expected", () => {
    if (false as boolean) {
      const aid: AccountId = castAccountId("a-1");
      const takeHolding = (_id: HoldingId): void => {};
      // @ts-expect-error — AccountId is not assignable to HoldingId
      takeHolding(aid);
    }
  });

  it("rejects MemberId where LiabilityId is expected", () => {
    if (false as boolean) {
      const mid: MemberId = castMemberId("m-1");
      const takeLiability = (_id: LiabilityId): void => {};
      // @ts-expect-error — MemberId is not assignable to LiabilityId
      takeLiability(mid);
    }
  });

  it("accepts plain strings into branded slots (soft brand)", () => {
    // This block MUST compile — that's the soft-brand affordance.
    // It keeps test fixtures and external-payload parsing
    // ergonomic; branded distinction only matters between brands.
    if (false as boolean) {
      const takeHolding = (_id: HoldingId): void => {};
      takeHolding("plain-string");
    }
  });
});
