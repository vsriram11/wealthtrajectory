// @vitest-environment jsdom
/**
 * BackupDiscoverabilityBanner — render-gate tests.
 *
 * Counter-proposal to issue #4: instead of demo-mode-only, the
 * banner triggers on the actual moment of need:
 *
 *   mode=real + has data + no Drive sync + not recently dismissed
 *
 * Pinned behaviors:
 *   1. Demo mode never shows the banner (no data worth backing up).
 *   2. Real mode + empty household → no banner.
 *   3. Real mode + has data + no Drive user → banner appears.
 *   4. Real mode + has data + Drive synced → no banner.
 *   5. Dismiss persists across renders (within the re-prompt window).
 *   6. Re-prompt fires after the 30-day window expires.
 *   7. "Set up backup" navigates to the Data page.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import {
  BackupDiscoverabilityBanner,
  BACKUP_DISCOVERABILITY_STORAGE_KEY,
  BACKUP_DISCOVERABILITY_REPROMPT_AFTER_MS,
} from "./BackupDiscoverabilityBanner";
import { castAccountId, castHouseholdId, castMemberId } from "@/lib/entityIds";
import type { Account, Household } from "@/lib/types";

function buildHousehold(opts: { withAccount: boolean }): Household {
  const accounts: Account[] = opts.withAccount
    ? [
        {
          id: castAccountId("acct-1"),
          category: "BROKERAGE",
          displayName: "Brokerage",
          ownerId: castMemberId("m1"),
          monthlyContributionUSD: 0,
          holdings: [],
        },
      ]
    : [];
  return {
    id: castHouseholdId("h"),
    members: [{ id: castMemberId("m1"), displayName: "Alex" }],
    accounts,
    liabilities: [],
  };
}

function seedStore(opts: {
  mode: "demo" | "real";
  hasData: boolean;
  signedIn?: boolean;
  lastSyncAt?: number | null;
}) {
  useAppStore.setState({
    mode: opts.mode,
    household: buildHousehold({ withAccount: opts.hasData }),
    user: opts.signedIn
      ? {
          sub: "u1",
          email: "u@example.com",
          name: "U",
          pictureUrl: "",
          emailVerified: true,
        }
      : null,
    googleLastSyncAt: opts.lastSyncAt ?? null,
    hydrated: true,
    currentPage: "home",
  });
}

afterEach(() => {
  cleanup();
  // Clear localStorage between tests so the dismissal state doesn't
  // leak.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

describe("BackupDiscoverabilityBanner — render gates", () => {
  it("does NOT render in demo mode (even with accounts)", () => {
    seedStore({ mode: "demo", hasData: true });
    const { container } = render(<BackupDiscoverabilityBanner />);
    expect(container.textContent).toBe("");
  });

  it("does NOT render in real mode when household has no accounts", () => {
    seedStore({ mode: "real", hasData: false });
    const { container } = render(<BackupDiscoverabilityBanner />);
    expect(container.textContent).toBe("");
  });

  it("RENDERS in real mode with accounts and no Drive sync configured", () => {
    seedStore({ mode: "real", hasData: true });
    render(<BackupDiscoverabilityBanner />);
    expect(screen.getByText(/Back up your plan/)).toBeInTheDocument();
    expect(screen.getByText(/Set up backup/)).toBeInTheDocument();
  });

  it("does NOT render when Drive sync has completed at least once", () => {
    seedStore({
      mode: "real",
      hasData: true,
      signedIn: true,
      lastSyncAt: Date.now() - 60_000,
    });
    const { container } = render(<BackupDiscoverabilityBanner />);
    expect(container.textContent).toBe("");
  });

  it("does NOT render before IDB hydration completes", () => {
    seedStore({ mode: "real", hasData: true });
    useAppStore.setState({ hydrated: false });
    const { container } = render(<BackupDiscoverabilityBanner />);
    expect(container.textContent).toBe("");
  });
});

describe("BackupDiscoverabilityBanner — dismissal persistence", () => {
  it("Dismiss writes localStorage and hides the banner immediately", () => {
    seedStore({ mode: "real", hasData: true });
    render(<BackupDiscoverabilityBanner />);
    expect(screen.getByText(/Back up your plan/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Dismiss backup reminder/));
    expect(screen.queryByText(/Back up your plan/)).not.toBeInTheDocument();
    // localStorage now has a numeric timestamp.
    const raw = window.localStorage.getItem(BACKUP_DISCOVERABILITY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(Number(raw)).toBeGreaterThan(0);
  });

  it("stays dismissed across re-mounts within the re-prompt window", () => {
    seedStore({ mode: "real", hasData: true });
    window.localStorage.setItem(
      BACKUP_DISCOVERABILITY_STORAGE_KEY,
      String(Date.now() - 60_000),
    );
    const { container } = render(<BackupDiscoverabilityBanner />);
    expect(container.textContent).toBe("");
  });

  it("re-surfaces after the re-prompt window expires (30+ days)", () => {
    seedStore({ mode: "real", hasData: true });
    // Old dismissal — 35 days ago, well past the 30-day re-prompt.
    window.localStorage.setItem(
      BACKUP_DISCOVERABILITY_STORAGE_KEY,
      String(Date.now() - BACKUP_DISCOVERABILITY_REPROMPT_AFTER_MS - 5 * 86_400_000),
    );
    render(<BackupDiscoverabilityBanner />);
    expect(screen.getByText(/Back up your plan/)).toBeInTheDocument();
  });
});

describe("BackupDiscoverabilityBanner — navigation", () => {
  it("Set up backup navigates to the Data page", () => {
    seedStore({ mode: "real", hasData: true });
    render(<BackupDiscoverabilityBanner />);
    fireEvent.click(screen.getByText(/Set up backup/));
    expect(useAppStore.getState().currentPage).toBe("data");
  });
});
