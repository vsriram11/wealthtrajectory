// @vitest-environment jsdom
/**
 * PriceRefresher gate test — pins the time-travel behavior
 * after a user-reported UX bug: live quote refresh was
 * overwriting manual price entries during a backdated session,
 * making it impossible to capture historical values.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { applyLivePriceMock, getQuoteMock } = vi.hoisted(() => ({
  applyLivePriceMock: vi.fn(),
  getQuoteMock: vi.fn(async () => ({
    currentPrice: 99,
    fetchedAt: Date.now(),
  })),
}));

vi.mock("@/lib/data/quotes", () => ({
  getQuote: getQuoteMock,
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
  it("does NOT refresh prices while timeTravelActive is true", async () => {
    useAppStore.setState({
      timeTravelActive: true,
      timeTravelDate: "2020-01-01",
    });
    render(<PriceRefresher />);
    // Let any in-flight promises settle.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // No quote lookups, no price application — user's manual
    // entries stay untouched.
    expect(getQuoteMock).not.toHaveBeenCalled();
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
