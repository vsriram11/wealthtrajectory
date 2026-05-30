import { describe, expect, it } from "vitest";
import { withdrawalSequence } from "@/lib/tax/withdrawalSequence";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

function account(
  id: string,
  category: Household["accounts"][number]["category"],
  displayName: string,
  valueUSD: number,
): Household["accounts"][number] {
  return {
    id,
    category,
    displayName,
    ownerId: "m1",
    monthlyContributionUSD: 0,
    holdings: [
      {
        id: `${id}-h`,
        kind: "equity",
        symbol: "VTI",
        shares: 1,
        lastPriceUSD: valueUSD,
        lastPricedAt: null,
        isManualPrice: true,
        enteredAsShares: false,
        acquiredAt: null,
        valueUSD,
        expectedRealCAGR: 0.07,
        leverage: 1,
        styleBox: styleBoxOf({ LARGE_BLEND: 1 }),
        geography: geographyOf({ US: 1 }),
      },
    ],
  };
}

function household(
  accounts: Household["accounts"],
): Household {
  return {
    id: "hh",
    members: [{ id: "m1", displayName: "You" }],
    accounts,
    liabilities: [],
  };
}

describe("withdrawalSequence", () => {
  it("orders taxable → pre-tax → Roth → HSA", () => {
    const hh = household([
      account("a1", "401K", "401k", 200_000),
      account("a2", "ROTH_IRA", "Roth IRA", 100_000),
      account("a3", "BROKERAGE", "Brokerage", 50_000),
      account("a4", "HSA", "HSA", 25_000),
    ]);
    const seq = withdrawalSequence(hh, 60_000);
    const order = seq.rows.map((r) => r.bucket);
    // Round-5 audit: education bucket added (priority 5) so 529 +
    // Trump Account positions show up but stay last and ineligible
    // for drawdown.
    expect(order).toEqual(["taxable", "pre_tax", "roth", "hsa", "education"]);
  });

  it("aggregates within bucket (401k + Trad IRA both pre-tax)", () => {
    const hh = household([
      account("a1", "401K", "401k", 200_000),
      account("a2", "TRAD_IRA", "Trad IRA", 50_000),
    ]);
    const seq = withdrawalSequence(hh, 60_000);
    const preTax = seq.rows.find((r) => r.bucket === "pre_tax")!;
    expect(preTax.totalUSD).toBe(250_000);
    expect(preTax.accounts).toHaveLength(2);
  });

  it("computes months-of-runway per bucket", () => {
    const hh = household([account("a1", "BROKERAGE", "Brok", 60_000)]);
    const seq = withdrawalSequence(hh, 60_000);
    // 60k at 60k/yr = 12 mo
    const taxable = seq.rows.find((r) => r.bucket === "taxable")!;
    expect(taxable.monthsOfRunway).toBe(12);
  });

  it("returns null runway when annualSpend = 0", () => {
    const hh = household([account("a1", "BROKERAGE", "Brok", 60_000)]);
    const seq = withdrawalSequence(hh, 0);
    const taxable = seq.rows.find((r) => r.bucket === "taxable")!;
    expect(taxable.monthsOfRunway).toBeNull();
  });

  it("sorts accounts within bucket by value desc", () => {
    const hh = household([
      account("a1", "BROKERAGE", "Small Brokerage", 10_000),
      account("a2", "BROKERAGE", "Big Brokerage", 200_000),
      account("a3", "SAVINGS", "Savings", 50_000),
    ]);
    const seq = withdrawalSequence(hh, 60_000);
    const taxable = seq.rows.find((r) => r.bucket === "taxable")!;
    expect(taxable.accounts.map((a) => a.name)).toEqual([
      "Big Brokerage",
      "Savings",
      "Small Brokerage",
    ]);
  });

  it("treats Roth 401k as roth bucket", () => {
    const hh = household([account("a1", "ROTH_401K", "Roth 401k", 100_000)]);
    const seq = withdrawalSequence(hh, 60_000);
    const roth = seq.rows.find((r) => r.bucket === "roth")!;
    expect(roth.totalUSD).toBe(100_000);
  });

  it("treats CRYPTO / REAL_ESTATE / OTHER as taxable", () => {
    const hh = household([
      account("a1", "CRYPTO", "Coinbase", 25_000),
      account("a2", "REAL_ESTATE", "Rental", 100_000),
      account("a3", "OTHER", "Other", 10_000),
    ]);
    const seq = withdrawalSequence(hh, 60_000);
    const taxable = seq.rows.find((r) => r.bucket === "taxable")!;
    expect(taxable.totalUSD).toBe(135_000);
  });

  describe("Round 5 audit: education bucket separation", () => {
    it("FIVE_29 routes to 'education' bucket, NOT roth (regression)", () => {
      // Round-5 audit CRITICAL fix: 529 accounts previously
      // collapsed into Roth, silently inflating tax-free retirement
      // runway by the 529 balance. Now its own bucket so the card
      // shows + excludes it.
      const hh = household([
        account("a1", "ROTH_IRA", "Roth IRA", 100_000),
        account("a2", "FIVE_29", "Kid's 529", 200_000),
      ]);
      const seq = withdrawalSequence(hh, 60_000);
      const roth = seq.rows.find((r) => r.bucket === "roth")!;
      const edu = seq.rows.find((r) => r.bucket === "education")!;
      expect(roth.totalUSD).toBe(100_000);
      expect(edu.totalUSD).toBe(200_000);
    });

    it("TRUMP_ACCOUNT routes to 'education' bucket too", () => {
      const hh = household([
        account("a1", "TRUMP_ACCOUNT", "Newborn Trump Acct", 50_000),
      ]);
      const seq = withdrawalSequence(hh, 60_000);
      const edu = seq.rows.find((r) => r.bucket === "education")!;
      expect(edu.totalUSD).toBe(50_000);
    });

    it("education bucket has lowest priority (renders last)", () => {
      const hh = household([
        account("a1", "BROKERAGE", "Brokerage", 100_000),
        account("a2", "FIVE_29", "529", 50_000),
        account("a3", "HSA", "HSA", 25_000),
      ]);
      const seq = withdrawalSequence(hh, 60_000);
      // Should be ordered: taxable (1), pretax (2 - empty),
      // roth (3 - empty), hsa (4), education (5).
      const order = seq.rows.map((r) => r.bucket);
      expect(order.indexOf("education")).toBe(order.length - 1);
    });
  });
});
