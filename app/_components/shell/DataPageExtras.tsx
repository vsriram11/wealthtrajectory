"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";

export function DataPageExtras() {
  const mode = useAppStore((s) => s.mode);
  const user = useAppStore((s) => s.user);
  const members = useAppStore((s) => s.household.members);
  const accounts = useAppStore((s) => s.household.accounts);
  const liabilities = useAppStore((s) => s.household.liabilities);
  const openMembers = useAppStore((s) => s.openMembersSheet);
  const switchToReal = useAppStore((s) => s.switchToReal);
  const resetToDemo = useAppStore((s) => s.resetToDemo);
  const hasData = accounts.length > 0;
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const onMode = () => {
    if (mode === "demo") {
      switchToReal();
      return;
    }
    if (hasData && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    resetToDemo();
  };

  return (
    <>
      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-text">
                  Household members
                </div>
              </div>
              <div className="mt-0.5 text-[11px] text-text-dim">
                {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
                {accounts.length} account{accounts.length === 1 ? "" : "s"}
                {liabilities.length > 0 &&
                  ` · ${liabilities.length} liabilit${liabilities.length === 1 ? "y" : "ies"}`}
              </div>
            </div>
            <button
              type="button"
              onClick={openMembers}
              className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
            >
              Manage
            </button>
          </div>
        </div>
      </section>

      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-text">
                {mode === "demo"
                  ? "You're viewing the mock starter data"
                  : user
                    ? "You're signed in — synced to your Drive"
                    : "You're viewing your own data"}
              </div>
              <div className="mt-0.5 text-[11px] text-text-dim">
                {mode === "demo"
                  ? "Your first edit converts the mock data into your own — edits then auto-save locally."
                  : user
                    ? "All edits auto-save locally and back up to your private Google Drive folder."
                    : "All edits are auto-saved locally to this browser."}
              </div>
            </div>
            {/*
              Hide the mode-toggle button entirely when signed in.
              "Back to mock" would resetToDemo, and even though
              CloudSyncer now refuses to upload while mode !== "real",
              showing the button is confusing and users have already
              been bitten by the Drive-overwrite footgun.
            */}
            {!user && (
              <button
                type="button"
                onClick={onMode}
                className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium active:opacity-70 ${
                  mode === "demo"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : confirming
                      ? "border-negative/40 bg-negative/10 text-negative"
                      : "border-border-strong bg-bg-elevated text-text-muted"
                }`}
              >
                {mode === "demo"
                  ? "Start fresh →"
                  : confirming
                    ? "Tap again to wipe"
                    : "Back to mock"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="px-5 pt-3">
        <div className="rounded-2xl border border-border bg-bg-surface p-4">
          <div className="text-sm font-medium text-text">
            Where your data lives
          </div>
          <ul className="mt-2 space-y-2 text-[11px] text-text-dim">
            <li>
              <span className="font-medium text-text-muted">
                On this device:
              </span>{" "}
              All financial data (accounts, holdings, balances, projections)
              is stored in this browser&apos;s IndexedDB and computed locally.
              No server-side database, no per-user account on our end.
            </li>
            <li>
              <span className="font-medium text-text-muted">
                Google Drive (when signed in):
              </span>{" "}
              A JSON backup mirrors to your private{" "}
              <span className="font-mono text-text-muted">appDataFolder</span>
              {" "}— a per-app sandbox in your own Google account that doesn&apos;t
              appear in your normal Drive UI and that no other app (including
              this one&apos;s developers) can access. The backup uploads
              browser → Google directly; we never see it.
            </li>
            <li>
              <span className="font-medium text-text-muted">
                End-to-end encryption (optional):
              </span>{" "}
              Set a passphrase and your Drive backup is sealed with AES-256-GCM
              before it leaves your device. Google stores ciphertext only — an
              account-level compromise of your Google account still can&apos;t
              read your financials without the passphrase. The passphrase
              lives in memory only; we never receive it and can&apos;t recover
              it for you.
            </li>
            <li>
              <span className="font-medium text-text-muted">
                Live prices via our server:
              </span>{" "}
              Ticker lookups (e.g. &quot;VTI&quot;) hit our quote proxy, which
              relays anonymously to Yahoo Finance / Finnhub and caches results.
              The proxy sees ticker symbols and your IP (any web request does)
              but no balances, no account names, no portfolio composition,
              and no Google identity.
            </li>
            <li>
              <span className="font-medium text-text-muted">
                No portfolio analytics:
              </span>{" "}
              We don&apos;t run analytics, tracking pixels, A/B tests, or any
              third-party scripts on your portfolio. No Mixpanel, no GA, no
              Sentry session replay.
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Next <Link> for client-side nav. Using <a href> here
                would trigger a full page reload, which: (a) loses
                the zustand store state so /security and /review
                show empty data, and (b) regenerates the local
                session ID so when the user clicks Back, the
                AuthHydrator's session-validation logic sees a
                mismatch against Drive and signs them out as
                "other-device." Both bugs reported by the user. */}
            <Link
              href="/security"
              className="inline-block rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent active:opacity-70"
            >
              Read the full security & privacy story →
            </Link>
            <Link
              href="/review"
              className="inline-block rounded-md border border-border-strong bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70 hover:text-text"
            >
              Annual Review (printable)
            </Link>
          </div>
        </div>
      </section>

      <Disclosures />
    </>
  );
}

/**
 * Legal-disclosures surface. Distinct from the privacy section so
 * users can see "here's where my data goes" and "here's the legal
 * framing" as separate cards rather than a single wall of text.
 *
 * Disclaimers follow common-practice fintech-tool defaults: not a
 * registered advisor, no fiduciary relationship, projections are
 * estimates not guarantees, tax math is simplified, user-supplied
 * inputs are not verified, no warranty. Designed to be honest and
 * legible rather than dense legalese.
 */
function Disclosures() {
  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4">
        <div className="text-sm font-medium text-amber-200">
          Important — please read
        </div>
        <ul className="mt-2 space-y-2 text-[11px] leading-snug text-amber-300/80">
          <li>
            <span className="font-semibold">Not investment advice.</span>{" "}
            Independence Path Tracker is an educational planning tool. It is{" "}
            <span className="font-medium">not</span> a registered investment
            advisor, broker-dealer, or financial planner. Using this tool does
            not create a fiduciary or advisor–client relationship between you
            and us.
          </li>
          <li>
            <span className="font-semibold">
              Projections are estimates, not guarantees.
            </span>{" "}
            Independence timelines, net-worth doublings, sensitivity, scenarios,
            stress tests, and lifetime fee/tax estimates are model outputs
            based on the inputs and assumptions you provide. Real-world
            returns vary; past performance does not predict future results.
          </li>
          <li>
            <span className="font-semibold">User-supplied data.</span> You
            enter your own balances, holdings, contributions, and assumptions.
            We don&apos;t verify accuracy, reconcile against brokerages, or
            audit values. Garbage in / garbage out applies — keep inputs
            current.
          </li>
          <li>
            <span className="font-semibold">Tax calculations are simplified.</span>{" "}
            The Roth-ladder estimator and drawdown sequencer use illustrative
            federal-bracket math. They don&apos;t model state tax, IRMAA,
            ACA-subsidy cliffs, Social Security taxation, NIIT, or interaction
            with capital gains / qualified dividends. Confirm with a licensed
            CPA or fee-only fiduciary before executing any strategy.
          </li>
          <li>
            <span className="font-semibold">Benchmarks are directional.</span>{" "}
            The net-worth percentile uses 2022 Federal Reserve SCF data and
            interpolates between published breakpoints. Treat as a rough
            comparison, not a verdict.
          </li>
          <li>
            <span className="font-semibold">Provided as-is.</span> No express
            or implied warranty of merchantability, fitness for a particular
            purpose, or accuracy. We are not liable for any financial loss
            arising from decisions made using this tool. You are responsible
            for verifying outputs and consulting a qualified professional.
          </li>
        </ul>
      </div>
    </section>
  );
}
