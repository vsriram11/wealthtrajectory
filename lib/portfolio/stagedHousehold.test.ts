import { describe, expect, it } from "vitest";
import { DEMO_HOUSEHOLD } from "@/lib/demo";
import { householdNetWorth } from "@/lib/types";
import {
  dropAccount,
  dropHolding,
  scaleHousehold,
  setHoldingValue,
  summarizeStagingDiff,
} from "./stagedHousehold";

describe("stagedHousehold — pure helpers (no store dependency)", () => {
  it("scaleHousehold(factor=1) returns an unchanged clone (immutability check)", () => {
    const beforeNW = householdNetWorth(DEMO_HOUSEHOLD);
    const out = scaleHousehold(DEMO_HOUSEHOLD, 1);
    const afterNW = householdNetWorth(out);
    expect(afterNW).toBeCloseTo(beforeNW, 0);
    // Confirm immutability — the caller's household must be untouched.
    expect(out).not.toBe(DEMO_HOUSEHOLD);
    expect(out.accounts).not.toBe(DEMO_HOUSEHOLD.accounts);
  });

  it("scaleHousehold(0.5) halves every holding's value", () => {
    const before = householdNetWorth(DEMO_HOUSEHOLD);
    const out = scaleHousehold(DEMO_HOUSEHOLD, 0.5);
    const after = householdNetWorth(out);
    // NW = assets - liabilities. Only assets scale (liabilities
    // unchanged), so after-NW ≠ before-NW × 0.5 exactly — but the
    // total assets should be halved.
    const beforeAssets = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings)
      .reduce((s, h) => s + h.valueUSD, 0);
    const afterAssets = out.accounts
      .flatMap((a) => a.holdings)
      .reduce((s, h) => s + h.valueUSD, 0);
    expect(afterAssets).toBeCloseTo(beforeAssets * 0.5, 1);
    // And NW correctly reflects the asset scaling minus the
    // (unchanged) liabilities total.
    const liab = DEMO_HOUSEHOLD.liabilities.reduce(
      (s, l) => s + l.balanceUSD,
      0,
    );
    expect(after).toBeCloseTo(beforeAssets * 0.5 - liab, 0);
    // Doesn't mutate input.
    expect(householdNetWorth(DEMO_HOUSEHOLD)).toBeCloseTo(before, 0);
  });

  it("scaleHousehold preserves shares for priced holdings (price moves, not shares)", () => {
    const out = scaleHousehold(DEMO_HOUSEHOLD, 0.5);
    for (const a of out.accounts) {
      for (const h of a.holdings) {
        if (
          h.kind === "equity" ||
          h.kind === "bond" ||
          h.kind === "commodity" ||
          h.kind === "crypto"
        ) {
          // Pull the corresponding holding from the base
          const base = DEMO_HOUSEHOLD.accounts
            .flatMap((acc) => acc.holdings)
            .find((b) => b.id === h.id);
          if (base && "shares" in base) {
            expect(h.shares).toBeCloseTo(base.shares, 6);
          }
        }
      }
    }
  });

  it("scaleHousehold rejects non-finite factor (NaN-safety)", () => {
    const before = householdNetWorth(DEMO_HOUSEHOLD);
    const out = scaleHousehold(DEMO_HOUSEHOLD, Number.NaN);
    const after = householdNetWorth(out);
    // NaN factor → clamped to lo (0) → assets = 0, NW = -liabilities.
    expect(after).toBeLessThanOrEqual(0);
    // Original household untouched.
    expect(householdNetWorth(DEMO_HOUSEHOLD)).toBeCloseTo(before, 0);
  });

  it("dropHolding removes one holding by id; account stays", () => {
    const acct = DEMO_HOUSEHOLD.accounts[0];
    const targetH = acct.holdings[0];
    const before = householdNetWorth(DEMO_HOUSEHOLD);
    const out = dropHolding(DEMO_HOUSEHOLD, acct.id, targetH.id);
    const newAcct = out.accounts.find((a) => a.id === acct.id);
    expect(newAcct).toBeDefined();
    expect(newAcct!.holdings.find((h) => h.id === targetH.id)).toBeUndefined();
    expect(newAcct!.holdings.length).toBe(acct.holdings.length - 1);
    const after = householdNetWorth(out);
    expect(after).toBeCloseTo(before - targetH.valueUSD, 0);
    // Input untouched.
    expect(DEMO_HOUSEHOLD.accounts[0].holdings.length).toBe(acct.holdings.length);
  });

  it("dropAccount removes the entire account", () => {
    const acct = DEMO_HOUSEHOLD.accounts[1];
    const acctValue = acct.holdings.reduce((s, h) => s + h.valueUSD, 0);
    const before = householdNetWorth(DEMO_HOUSEHOLD);
    const out = dropAccount(DEMO_HOUSEHOLD, acct.id);
    expect(out.accounts.find((a) => a.id === acct.id)).toBeUndefined();
    const after = householdNetWorth(out);
    expect(after).toBeCloseTo(before - acctValue, 0);
  });

  it("dropAccount on unknown id is a safe no-op", () => {
    const before = householdNetWorth(DEMO_HOUSEHOLD);
    const out = dropAccount(DEMO_HOUSEHOLD, "no-such-account");
    expect(out.accounts.length).toBe(DEMO_HOUSEHOLD.accounts.length);
    expect(householdNetWorth(out)).toBeCloseTo(before, 0);
  });

  it("setHoldingValue overrides one holding's value (and price for share-priced kinds)", () => {
    const acct = DEMO_HOUSEHOLD.accounts.find((a) =>
      a.holdings.some((h) => h.kind === "equity"),
    )!;
    const h = acct.holdings.find((x) => x.kind === "equity")!;
    const out = setHoldingValue(DEMO_HOUSEHOLD, acct.id, h.id, 999);
    const newH = out.accounts
      .find((a) => a.id === acct.id)!
      .holdings.find((x) => x.id === h.id)!;
    expect(newH.valueUSD).toBe(999);
    if (newH.kind === "equity") {
      expect(newH.lastPriceUSD).toBeCloseTo(999 / newH.shares, 6);
    }
  });

  it("setHoldingValue rejects non-finite or negative input", () => {
    const acct = DEMO_HOUSEHOLD.accounts[0];
    const h = acct.holdings[0];
    const beforeVal = h.valueUSD;
    const outNaN = setHoldingValue(
      DEMO_HOUSEHOLD,
      acct.id,
      h.id,
      Number.NaN,
    );
    const outNeg = setHoldingValue(DEMO_HOUSEHOLD, acct.id, h.id, -100);
    const same1 = outNaN.accounts
      .find((a) => a.id === acct.id)!
      .holdings.find((x) => x.id === h.id)!;
    const same2 = outNeg.accounts
      .find((a) => a.id === acct.id)!
      .holdings.find((x) => x.id === h.id)!;
    expect(same1.valueUSD).toBeCloseTo(beforeVal, 0);
    expect(same2.valueUSD).toBeCloseTo(beforeVal, 0);
  });

  it("summarizeStagingDiff reports unchanged on no-op", () => {
    const diff = summarizeStagingDiff(DEMO_HOUSEHOLD, DEMO_HOUSEHOLD);
    expect(diff.unchanged).toBe(true);
    expect(diff.deltaUSD).toBe(0);
  });

  it("summarizeStagingDiff counts dropped holdings, dropped accounts, modified holdings", () => {
    const acctA = DEMO_HOUSEHOLD.accounts[0];
    const acctB = DEMO_HOUSEHOLD.accounts[1];
    const targetH = acctA.holdings[0];
    // 1) drop a holding from acctA (still present)
    let staged = dropHolding(DEMO_HOUSEHOLD, acctA.id, targetH.id);
    // 2) drop acctB entirely
    staged = dropAccount(staged, acctB.id);
    // 3) modify one holding in a 3rd account
    const acctC = DEMO_HOUSEHOLD.accounts[2];
    const otherH = acctC.holdings[0];
    staged = setHoldingValue(staged, acctC.id, otherH.id, otherH.valueUSD * 2);

    const diff = summarizeStagingDiff(DEMO_HOUSEHOLD, staged);
    expect(diff.unchanged).toBe(false);
    expect(diff.droppedAccounts).toBe(1);
    expect(diff.droppedHoldings).toBe(1);
    expect(diff.modifiedHoldings).toBe(1);
    expect(diff.deltaUSD).not.toBe(0);
  });

  it("PROPERTY: scaling never mutates the input household", () => {
    // Take a deep-frozen snapshot of input NW + assets. Apply
    // several different scale factors. After each, the input must
    // still reflect its original state.
    const baselineNW = householdNetWorth(DEMO_HOUSEHOLD);
    for (const f of [0, 0.1, 0.5, 1, 2, 5]) {
      scaleHousehold(DEMO_HOUSEHOLD, f);
      expect(householdNetWorth(DEMO_HOUSEHOLD)).toBeCloseTo(baselineNW, 0);
    }
  });

  it("PROPERTY: composing drop + scale + drop matches expected NW (left-fold ordering)", () => {
    const acctA = DEMO_HOUSEHOLD.accounts[0];
    const acctB = DEMO_HOUSEHOLD.accounts[1];
    let staged = dropAccount(DEMO_HOUSEHOLD, acctA.id);
    staged = scaleHousehold(staged, 0.5);
    staged = dropAccount(staged, acctB.id);

    // Manual expected: drop A's value, halve remaining assets,
    // drop B's already-halved value, subtract unchanged liabilities.
    const aValue = acctA.holdings.reduce((s, h) => s + h.valueUSD, 0);
    const bValue = acctB.holdings.reduce((s, h) => s + h.valueUSD, 0);
    const allAssets = DEMO_HOUSEHOLD.accounts
      .flatMap((a) => a.holdings)
      .reduce((s, h) => s + h.valueUSD, 0);
    const liab = DEMO_HOUSEHOLD.liabilities.reduce(
      (s, l) => s + l.balanceUSD,
      0,
    );
    const expected = (allAssets - aValue) * 0.5 - bValue * 0.5 - liab;
    expect(householdNetWorth(staged)).toBeCloseTo(expected, 0);
  });
});
