import { describe, expect, it } from "vitest";
import {
  filterHouseholdByTaxBucket,
  type Household,
} from "@/lib/types";

function hh(...accounts: Household["accounts"]): Household {
  return {
    id: "hh",
    members: [{ id: "m1", displayName: "M" }],
    accounts,
    liabilities: [],
  };
}

function emptyAccount(
  id: string,
  category: Household["accounts"][number]["category"],
) {
  return {
    id,
    displayName: id,
    category,
    ownerId: "m1",
    monthlyContributionUSD: 0,
    holdings: [],
  };
}

describe("filterHouseholdByTaxBucket", () => {
  it("null bucket returns the input unchanged (identity)", () => {
    const h = hh(emptyAccount("a1", "BROKERAGE"));
    expect(filterHouseholdByTaxBucket(h, null)).toBe(h);
  });

  it("ROTH keeps only Roth IRA + Roth 401k accounts", () => {
    const h = hh(
      emptyAccount("brok", "BROKERAGE"),
      emptyAccount("roth-ira", "ROTH_IRA"),
      emptyAccount("roth-401k", "ROTH_401K"),
      emptyAccount("401k", "401K"),
      emptyAccount("hsa", "HSA"),
    );
    const r = filterHouseholdByTaxBucket(h, "ROTH");
    expect(r.accounts.map((a) => a.id).sort()).toEqual(
      ["roth-401k", "roth-ira"].sort(),
    );
  });

  it("PRE_TAX keeps Traditional IRA + 401k (not Roth variants)", () => {
    const h = hh(
      emptyAccount("401k", "401K"),
      emptyAccount("trad-ira", "TRAD_IRA"),
      emptyAccount("roth-401k", "ROTH_401K"),
      emptyAccount("brok", "BROKERAGE"),
    );
    const r = filterHouseholdByTaxBucket(h, "PRE_TAX");
    expect(r.accounts.map((a) => a.id).sort()).toEqual(
      ["401k", "trad-ira"].sort(),
    );
  });

  it("TAXABLE keeps Brokerage, Savings, Checking, Crypto, Real Estate, Other", () => {
    const h = hh(
      emptyAccount("brok", "BROKERAGE"),
      emptyAccount("savings", "SAVINGS"),
      emptyAccount("checking", "CHECKING"),
      emptyAccount("crypto", "CRYPTO"),
      emptyAccount("re", "REAL_ESTATE"),
      emptyAccount("other", "OTHER"),
      emptyAccount("hsa", "HSA"),
    );
    const r = filterHouseholdByTaxBucket(h, "TAXABLE");
    expect(r.accounts.length).toBe(6);
    expect(r.accounts.find((a) => a.id === "hsa")).toBeUndefined();
  });

  it("HSA keeps only the HSA", () => {
    const h = hh(
      emptyAccount("hsa", "HSA"),
      emptyAccount("brok", "BROKERAGE"),
    );
    const r = filterHouseholdByTaxBucket(h, "HSA");
    expect(r.accounts.map((a) => a.id)).toEqual(["hsa"]);
  });

  it("EDUCATION keeps only 529 accounts", () => {
    const h = hh(
      emptyAccount("brok", "BROKERAGE"),
      emptyAccount("529", "FIVE_29"),
    );
    const r = filterHouseholdByTaxBucket(h, "EDUCATION");
    expect(r.accounts.map((a) => a.id)).toEqual(["529"]);
  });

  it("liabilities pass through (they don't carry a tax bucket)", () => {
    const h: Household = {
      ...hh(emptyAccount("roth", "ROTH_IRA")),
      liabilities: [
        {
          id: "l1",
          name: "Mortgage",
          category: "MORTGAGE",
          balanceUSD: 100_000,
          ownerId: "m1",
          interestRate: 0.05,
          monthlyPaymentUSD: 1_000,
        } as never,
      ],
    };
    const r = filterHouseholdByTaxBucket(h, "ROTH");
    expect(r.liabilities.length).toBe(1);
  });
});
