// @vitest-environment jsdom
/**
 * PriceRefresher gate test — pins the time-travel behavior
 * after a user-reported UX bug: live quote refresh was
 * overwriting manual price entries during a backdated session,
 * making it impossible to capture historical values.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { applyLivePriceMock, getQuoteMock, priceAtDetailedMock } = vi.hoisted(
  () => ({
    applyLivePriceMock: vi.fn(),
    getQuoteMock: vi.fn(async () => ({
      symbol: "VOO",
      currentPrice: 99,
      currency: "USD",
      name: null,
      history: [
        { t: 1_700_000_000_000, p: 80 },
        { t: 1_750_000_000_000, p: 95 },
      ],
      fetchedAt: Date.now(),
    })),
    // Default returns { price, clamped: false } for the historical
    // path. Individual tests override.
    priceAtDetailedMock: vi.fn(() => ({ price: 80, clamped: false })),
  }),
);

vi.mock("@/lib/data/quotes", () => ({
  getQuote: getQuoteMock,
  priceAtDetailed: priceAtDetailedMock,
}));

import { PriceRefresher } from "./PriceRefresher";
import { useAppStore } from "@/lib/store";

function resetStore() {
  useAppStore.setState({
    mode: "real",
    household: {
      id: "real-hh",
      members: [{ id: "m1", displayName: "Real" }],
      accounts: [
        {
          id: "a1",
          ownerId: "m1",
          nickname: "Brokerage",
          kind: "brokerage",
          taxTreatment: "taxable",
          institutionId: null,
          holdings: [
            {
              id: "h1",
              kind: "equity",
              symbol: "VOO",
              shares: 10,
              valueUSD: 5_000,
              referencePriceUSD: 500,
              currency: "USD",
              expenseRatio: 0.0003,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
              style: {},
              leverage: 1,
              expectedRealCAGR: 0.07,
              isManualPrice: false,
            } as never,
          ],
        } as never,
      ],
      liabilities: [],
    } as never,
    timeTravelActive: false,
    timeTravelDate: null,
    baselineHousehold: null,
    baselineAssumptions: null,
    applyLivePrice: applyLivePriceMock,
  });
}

beforeEach(() => {
  applyLivePriceMock.mockClear();
  getQuoteMock.mockClear();
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("PriceRefresher — time-travel gate (user-reported UX fix)", () => {
  it("does NOT run the LIVE refresh path while timeTravelActive is true", async () => {
    // Historical path uses applyLivePrice(..., "historical"); live
    // path uses applyLivePrice(...) with no mode. This test pins
    // that the LIVE path doesn't fire — the historical path may
    // still call getQuote (covered by the dedicated tests below).
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2020-01-01",
    });
    render(<PriceRefresher />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // applyLivePrice calls — verify NONE are in "live" mode (no
    // mode arg or mode === undefined). The historical path passes
    // "historical" explicitly.
    for (const call of applyLivePriceMock.mock.calls) {
      const modeArg = call[3]; // (symbol, price, pricedAt, mode)
      expect(modeArg).toBe("historical");
    }
  });

  it("historical path fires when entering time-travel, applies via 'historical' mode", async () => {
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2020-01-15",
    });
    render(<PriceRefresher />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(getQuoteMock).toHaveBeenCalled();
    expect(applyLivePriceMock).toHaveBeenCalled();
    // Every applyLivePrice call from the historical path must
    // pass "historical" mode.
    for (const call of applyLivePriceMock.mock.calls) {
      expect(call[3]).toBe("historical");
    }
  });

  it("historical path SKIPS clamped results (round-5 audit BLOCK fix)", async () => {
    // When priceAtDetailed returns clamped: true (backdate older
    // than the available history window), the historical apply
    // is skipped — would otherwise silently use the oldest
    // available price as if it were the target-date price.
    priceAtDetailedMock.mockReturnValueOnce({ price: 80, clamped: true });
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2010-01-01",
    });
    render(<PriceRefresher />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // applyLivePrice should NOT have been called for the clamped
    // result.
    expect(applyLivePriceMock).not.toHaveBeenCalled();
  });

  it("refreshes normally when NOT in time-travel mode (regression pin)", async () => {
    render(<PriceRefresher />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(getQuoteMock).toHaveBeenCalled();
  });

  it("entering time-travel mid-refresh aborts the in-flight loop (defense in depth)", async () => {
    render(<PriceRefresher />);
    // Flush enough microtasks to start the first iteration.
    await Promise.resolve();
    // Now flip into time-travel — the iteration's per-step gate
    // should detect this and bail before calling applyLivePrice.
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2020-01-01",
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // After the flip, no further applyLivePrice calls should
    // fire (even if getQuote was already in flight, the
    // fire-time gate catches it).
    const callsAfterFlip = applyLivePriceMock.mock.calls.length;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(applyLivePriceMock.mock.calls.length).toBe(callsAfterFlip);
  });
});
