import { describe, expect, it } from "vitest";
import { DEMO_ASSUMPTIONS, DEMO_HOUSEHOLD } from "@/lib/demo";
import { projectIndependence } from "@/lib/projection/independence";
import { generateInsights } from "@/lib/insights/insights";

describe("generateInsights (demo)", () => {
  const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
  const insights = generateInsights(
    DEMO_HOUSEHOLD,
    DEMO_ASSUMPTIONS,
    projection,
  );

  it("includes a progress insight with title + detail and a non-empty tone", () => {
    const progress = insights.find((i) => i.id === "progress");
    expect(progress).toBeDefined();
    // The card panel renders all three — a "defined" insight with
    // an empty title or unset tone would silently produce an
    // unstyled blank card. Guard each field.
    expect(progress!.title.length).toBeGreaterThan(0);
    expect(progress!.detail.length).toBeGreaterThan(0);
    expect(progress!.tone).toMatch(/^(positive|neutral|warning)$/);
  });

  it("includes a growth-mix insight with populated title + detail", () => {
    const growthMix = insights.find((i) => i.id === "growth-mix");
    expect(growthMix).toBeDefined();
    expect(growthMix!.title.length).toBeGreaterThan(0);
    expect(growthMix!.detail.length).toBeGreaterThan(0);
  });

  it("flags the high-rate auto loan liability", () => {
    const flag = insights.find((i) => i.id === "high-rate-liability");
    expect(flag).toBeDefined();
    expect(flag?.tone).toBe("warning");
  });
});

describe("generateInsights with empty household", () => {
  it("yields no growth-mix or sensitivity insights when net worth is zero", () => {
    const empty = {
      ...DEMO_HOUSEHOLD,
      accounts: [],
      liabilities: [],
    };
    const projection = projectIndependence(empty, DEMO_ASSUMPTIONS);
    const insights = generateInsights(empty, DEMO_ASSUMPTIONS, projection);
    expect(insights.find((i) => i.id === "growth-mix")).toBeUndefined();
    expect(insights.find((i) => i.id === "sensitivity")).toBeUndefined();
  });
});

describe("concentration insight", () => {
  it("does not fire on a deliberately diversified household", () => {
    const diversified = {
      id: "h",
      members: [{ id: "m", displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE" as const,
          displayName: "B",
          ownerId: "m",
          monthlyContributionUSD: 0,
          holdings: [
            { kind: "cash" as const, id: "c1", valueUSD: 100_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
            { kind: "cash" as const, id: "c2", valueUSD: 100_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
            { kind: "cash" as const, id: "c3", valueUSD: 100_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
            { kind: "cash" as const, id: "c4", valueUSD: 100_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
            { kind: "cash" as const, id: "c5", valueUSD: 100_000, expectedRealCAGR: 0, geography: { US: 1, DEVELOPED: 0, EMERGING: 0 } },
          ],
        },
      ],
      liabilities: [],
    };
    const projection = projectIndependence(diversified, DEMO_ASSUMPTIONS);
    const insights = generateInsights(
      diversified,
      DEMO_ASSUMPTIONS,
      projection,
    );
    // All 5 cash holdings share the same key ("cash") under our
    // grouping — but cash isn't a concentration "position" in the
    // single-position-risk sense, so it doesn't get reported.
    // Actually our key scheme assigns no key to cash, so cash is
    // excluded from concentration analysis. Net effect: no warning
    // fires here.
    const c = insights.find((i) => i.id === "concentration");
    expect(c).toBeUndefined();
  });

  it("flags a holding that crosses the 25% threshold", async () => {
    // Build a household whose net worth is dominated by one position.
    const { DEMO_ASSUMPTIONS: a } = await import("@/lib/demo");
    const concentrated = {
      id: "h",
      members: [{ id: "m", displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE" as const,
          displayName: "Brokerage",
          ownerId: "m",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "equity" as const,
              id: "h1",
              symbol: "NVDA",
              shares: 100,
              lastPriceUSD: 1000,
              lastPricedAt: null,
              isManualPrice: true,
              enteredAsShares: true,
              acquiredAt: null,
              valueUSD: 100_000,
              expectedRealCAGR: 0.1,
              leverage: 1,
              styleBox: {
                LARGE_VALUE: 0, LARGE_BLEND: 0, LARGE_GROWTH: 1,
                MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0,
                SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0,
              },
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
            {
              kind: "cash" as const,
              id: "h2",
              valueUSD: 10_000,
              expectedRealCAGR: 0,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    const projection = projectIndependence(concentrated, a);
    const insights = generateInsights(concentrated, a, projection);
    const c = insights.find((i) => i.id === "concentration");
    expect(c).toBeDefined();
    expect(c!.title).toContain("NVDA");
  });
});

describe("monthly-gain insight", () => {
  it("does not fire without snapshots", () => {
    const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const insights = generateInsights(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      projection,
      [],
    );
    expect(insights.find((i) => i.id === "monthly-gain")).toBeUndefined();
  });

  it("fires when a snapshot ~30 days old shows a delta", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const m = computePortfolio(DEMO_HOUSEHOLD);
    const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    // Synthesize a snapshot from 40 days ago at 90% of current NW —
    // a +10% one-month gain.
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const insights = generateInsights(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      projection,
      [{ t: fortyDaysAgo, netWorthUSD: m.netWorthUSD * 0.9 }],
    );
    const mg = insights.find((i) => i.id === "monthly-gain");
    expect(mg).toBeDefined();
    expect(mg!.tone).toBe("positive");
  });

  it("uses 'lost' framing when delta is negative", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const m = computePortfolio(DEMO_HOUSEHOLD);
    const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const insights = generateInsights(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      projection,
      [{ t: fortyDaysAgo, netWorthUSD: m.netWorthUSD * 1.1 }],
    );
    const mg = insights.find((i) => i.id === "monthly-gain");
    expect(mg).toBeDefined();
    expect(mg!.title.toLowerCase()).toContain("lost");
    expect(mg!.tone).toBe("warning");
  });
});

describe("yoy-return insight", () => {
  it("fires when a snapshot ~365 days old is available", async () => {
    const { computePortfolio } = await import("@/lib/portfolio/portfolio");
    const m = computePortfolio(DEMO_HOUSEHOLD);
    const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const insights = generateInsights(
      DEMO_HOUSEHOLD,
      DEMO_ASSUMPTIONS,
      projection,
      [{ t: oneYearAgo, netWorthUSD: m.netWorthUSD * 0.85 }],
    );
    const y = insights.find((i) => i.id === "yoy-return");
    expect(y).toBeDefined();
    expect(y!.tone).toBe("positive");
    expect(y!.title.toLowerCase()).toContain("up");
  });

  it("does not fire when the only snapshot is too recent or too old", () => {
    const projection = projectIndependence(DEMO_HOUSEHOLD, DEMO_ASSUMPTIONS);
    const tooRecent = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const tooOld = Date.now() - 700 * 24 * 60 * 60 * 1000;
    for (const t of [tooRecent, tooOld]) {
      const insights = generateInsights(
        DEMO_HOUSEHOLD,
        DEMO_ASSUMPTIONS,
        projection,
        [{ t, netWorthUSD: 100_000 }],
      );
      expect(insights.find((i) => i.id === "yoy-return")).toBeUndefined();
    }
  });
});

describe("leverage warning insight", () => {
  it("fires when effective leverage crosses 2×", () => {
    const levered = {
      id: "h",
      members: [{ id: "m", displayName: "You" }],
      accounts: [
        {
          id: "a1",
          category: "BROKERAGE" as const,
          displayName: "Levered",
          ownerId: "m",
          monthlyContributionUSD: 0,
          holdings: [
            {
              kind: "equity" as const,
              id: "h1",
              symbol: "TQQQ",
              shares: 100,
              lastPriceUSD: 100,
              lastPricedAt: null,
              isManualPrice: true,
              enteredAsShares: true,
              acquiredAt: null,
              valueUSD: 10_000,
              expectedRealCAGR: 0.1,
              leverage: 3,
              styleBox: {
                LARGE_VALUE: 0, LARGE_BLEND: 0, LARGE_GROWTH: 1,
                MID_VALUE: 0, MID_BLEND: 0, MID_GROWTH: 0,
                SMALL_VALUE: 0, SMALL_BLEND: 0, SMALL_GROWTH: 0,
              },
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    const projection = projectIndependence(levered, DEMO_ASSUMPTIONS);
    const insights = generateInsights(
      levered,
      DEMO_ASSUMPTIONS,
      projection,
    );
    const w = insights.find((i) => i.id === "leverage-warning");
    expect(w).toBeDefined();
    expect(w!.tone).toBe("warning");
  });
});
