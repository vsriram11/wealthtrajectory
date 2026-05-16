import { describe, expect, it } from "vitest";
import { staleManualHoldings } from "@/lib/data/staleness";
import type { Household } from "@/lib/types";

const NOW = new Date("2026-05-11T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function manualPrivateStock(
  id: string,
  pricedAt: number | null,
): Household {
  return {
    id: "t",
    members: [{ id: "m1", displayName: "Y" }],
    accounts: [
      {
        id: "a1",
        category: "OTHER",
        displayName: "PS",
        ownerId: "m1",
        monthlyContributionUSD: 0,
        holdings: [
          {
            kind: "private_stock",
            id,
            symbol: "ACME",
            shares: 1000,
            lastPriceUSD: 10,
            lastPricedAt: pricedAt,
            isManualPrice: true,
            enteredAsShares: true,
            acquiredAt: null,
            valueUSD: 10_000,
            expectedRealCAGR: 0.1,
            leverage: 1,
            preferredRoundPricePerShareUSD: null,
          },
        ],
      },
    ],
    liabilities: [],
  };
}

describe("staleManualHoldings", () => {
  it("flags a manual holding priced > 60 days ago", () => {
    const h = manualPrivateStock("h1", NOW - 90 * DAY);
    const out = staleManualHoldings(h, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe("ACME");
    expect(out[0].daysSinceUpdate).toBe(90);
  });

  it("skips a manual holding priced recently", () => {
    const h = manualPrivateStock("h1", NOW - 30 * DAY);
    const out = staleManualHoldings(h, NOW);
    expect(out).toHaveLength(0);
  });

  it("skips when lastPricedAt is null (never priced)", () => {
    const h = manualPrivateStock("h1", null);
    const out = staleManualHoldings(h, NOW);
    expect(out).toHaveLength(0);
  });

  it("ignores cash / real_estate / other holdings (face-value-by-design)", () => {
    const h: Household = {
      id: "t",
      members: [{ id: "m1", displayName: "Y" }],
      accounts: [
        {
          id: "a1",
          category: "CHECKING",
          displayName: "Cash",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "cash",
              id: "c",
              valueUSD: 100_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
        {
          id: "a2",
          category: "OTHER",
          displayName: "Stuff",
          ownerId: "m1",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "other",
              id: "o",
              name: "Art",
              valueUSD: 10_000,
              expectedRealCAGR: 0.02,
              acquiredAt: null,
            },
          ],
        },
      ],
      liabilities: [],
    };
    expect(staleManualHoldings(h, NOW)).toEqual([]);
  });

  it("returns at most `limit` results sorted by most-stale first", () => {
    const memberId = "m1";
    const ages = [30, 90, 120, 200, 365];
    const h: Household = {
      id: "t",
      members: [{ id: memberId, displayName: "Y" }],
      accounts: ages.map((d, i) => ({
        id: `a${i}`,
        category: "OTHER" as const,
        displayName: `A${i}`,
        ownerId: memberId,
        monthlyContributionUSD: 0,
        holdings: [
          {
            kind: "private_stock" as const,
            id: `h${i}`,
            symbol: `SYM${i}`,
            shares: 1,
            lastPriceUSD: 1,
            lastPricedAt: NOW - d * DAY,
            isManualPrice: true,
            enteredAsShares: false,
            acquiredAt: null,
            valueUSD: 1000,
            expectedRealCAGR: 0,
            leverage: 1,
            preferredRoundPricePerShareUSD: null,
          },
        ],
      })),
      liabilities: [],
    };
    const out = staleManualHoldings(h, NOW, 3);
    expect(out).toHaveLength(3);
    // Stalest first: 365, 200, 120
    expect(out[0].daysSinceUpdate).toBe(365);
    expect(out[1].daysSinceUpdate).toBe(200);
    expect(out[2].daysSinceUpdate).toBe(120);
  });
});
