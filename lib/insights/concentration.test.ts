import { describe, expect, it } from "vitest";
import { concentrationFindings } from "@/lib/insights/concentration";
import { geographyOf, styleBoxOf, type Household } from "@/lib/types";

function equity(
  id: string,
  symbol: string,
  valueUSD: number,
): Household["accounts"][number]["holdings"][number] {
  return {
    id,
    kind: "equity",
    symbol,
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
  };
}

function household(
  accounts: Household["accounts"],
  members: Household["members"] = [{ id: "m1", displayName: "You" }],
  liabilities: Household["liabilities"] = [],
): Household {
  return { id: "hh", members, accounts, liabilities };
}

describe("concentrationFindings", () => {
  it("flags single-ticker > 20% as high", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          equity("h1", "TSLA", 30_000),
          equity("h2", "VTI", 70_000),
        ],
      },
    ]);
    const findings = concentrationFindings(hh);
    const tsla = findings.find((f) => f.label === "TSLA");
    // TSLA is 30k/100k = 30%, which is above the high threshold
    // (>20%). The watch threshold is 10–20%; VTI at 70% would
    // exceed the high threshold too. Both should surface.
    expect(tsla).toBeDefined();
    expect(tsla!.kind).toBe("ticker");
    expect(tsla!.severity).toBe("high");
    expect(tsla!.fraction).toBeCloseTo(0.3, 6);
    expect(tsla!.bucketUSD).toBe(30_000);
  });

  it("aggregates same ticker across accounts", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [equity("h1", "AAPL", 12_000), equity("h2", "VTI", 50_000)],
      },
      {
        id: "a2",
        category: "401K",
        displayName: "401k",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [equity("h3", "AAPL", 10_000)],
      },
    ]);
    const findings = concentrationFindings(hh);
    const apple = findings.find((f) => f.label === "AAPL");
    expect(apple).toBeDefined();
    // Total NW = 12k + 50k + 10k = 72k. AAPL aggregated across the
    // two accounts is 12k + 10k = 22k = ~30.56% — above the high
    // threshold (>20%). If concentration.ts ever stopped
    // aggregating across accounts, this fraction would drop to
    // ~16.7% (12k / 72k) and severity would degrade to "watch",
    // so this is a load-bearing assertion.
    expect(apple!.bucketUSD).toBe(22_000);
    expect(apple!.fraction).toBeCloseTo(22_000 / 72_000, 6);
    expect(apple!.severity).toBe("high");
  });

  it("does not flag well-diversified portfolio", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          equity("h1", "VTI", 25_000),
          equity("h2", "VXUS", 25_000),
          equity("h3", "BND", 25_000),
          equity("h4", "GLD", 25_000),
        ],
      },
    ]);
    const findings = concentrationFindings(hh);
    // 25% each — over watch threshold of 10%, so all 4 should fire as watch
    expect(findings.filter((f) => f.kind === "ticker").length).toBe(4);
  });

  it("flags single-account > 50% as watch", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Big",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          equity("h1", "VTI", 30_000),
          equity("h2", "VXUS", 30_000),
        ],
      },
      {
        id: "a2",
        category: "401K",
        displayName: "Small",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [equity("h3", "VTI", 50_000)],
      },
    ]);
    // Big = 60K of 110K = 54.5% → watch (account thresholds:
    // >50% watch, >75% high). 54.5% sits inside the watch band.
    const findings = concentrationFindings(hh);
    const big = findings.find((f) => f.kind === "account" && f.label === "Big");
    expect(big).toBeDefined();
    expect(big!.severity).toBe("watch");
    expect(big!.fraction).toBeCloseTo(60_000 / 110_000, 6);
    expect(big!.bucketUSD).toBe(60_000);
  });

  it("flags single-member > 80% in multi-member household", () => {
    const hh = household(
      [
        {
          id: "a1",
          category: "BROKERAGE",
          displayName: "A",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [equity("h1", "VTI", 90_000)],
        },
        {
          id: "a2",
          category: "BROKERAGE",
          displayName: "B",
          ownerId: "m2",
          monthlyContributionUSD: 0,
          holdings: [equity("h2", "VTI", 10_000)],
        },
      ],
      [
        { id: "m1", displayName: "Alice" },
        { id: "m2", displayName: "Bob" },
      ],
    );
    const findings = concentrationFindings(hh);
    const alice = findings.find(
      (f) => f.kind === "member" && f.label === "Alice",
    );
    expect(alice).toBeDefined();
    // Alice = 90k / 100k = 90%. Member thresholds: >80% high.
    expect(alice!.severity).toBe("high");
    expect(alice!.fraction).toBeCloseTo(0.9, 6);
    expect(alice!.bucketUSD).toBe(90_000);
  });

  it("does not flag member concentration for single-member household", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Only",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [equity("h1", "VTI", 100_000)],
      },
    ]);
    const findings = concentrationFindings(hh);
    expect(findings.filter((f) => f.kind === "member").length).toBe(0);
  });

  it("findings sorted by fraction desc", () => {
    const hh = household([
      {
        id: "a1",
        category: "BROKERAGE",
        displayName: "Brokerage",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          equity("h1", "TSLA", 30_000),
          equity("h2", "AAPL", 15_000),
          equity("h3", "VTI", 55_000),
        ],
      },
    ]);
    const findings = concentrationFindings(hh);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].fraction).toBeLessThanOrEqual(findings[i - 1].fraction);
    }
  });
});
