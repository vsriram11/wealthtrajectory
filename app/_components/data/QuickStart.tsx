"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { NumberField } from "@/app/_components/ui/NumberField";
import { formatUSD, formatYearsMonths } from "@/lib/format";
import { projectIndependence } from "@/lib/projection/independence";

/**
 * Per PRD §7.1: "User receives first meaningful insight in under 30
 * seconds." Three inputs (current net worth, monthly savings, Independence
 * target) → instant projection, then a one-tap "Save & continue"
 * that seeds a single brokerage account so the rest of the app has
 * something to work with.
 *
 * Shown in place of the EmptyState when the user is signed in with
 * no accounts yet. The bigger "+ Add account" workflow stays
 * available below for users who already know exactly what they want
 * to enter.
 */
export function QuickStart() {
  const mode = useAppStore((s) => s.mode);
  const user = useAppStore((s) => s.user);
  const hasAccounts = useAppStore((s) => s.household.accounts.length > 0);
  const members = useAppStore((s) => s.household.members);
  const createAccount = useAppStore((s) => s.createAccount);
  const createHolding = useAppStore((s) => s.createHolding);
  const setAssumption = useAppStore((s) => s.setAssumption);
  const assumptions = useAppStore((s) => s.assumptions);

  const [netWorth, setNetWorth] = useState<number>(0);
  const [monthlySavings, setMonthlySavings] = useState<number>(0);
  const [independenceTarget, setIndependenceTarget] = useState<number>(2_500_000);
  const [saving, setSaving] = useState(false);

  if (mode !== "real" || hasAccounts || !user) return null;

  // Instant projection from the three inputs.
  const projection = (() => {
    if (netWorth <= 0 && monthlySavings <= 0) return null;
    const ownerId = members[0]?.id ?? "real-member-1";
    const draft = {
      id: "draft",
      members,
      accounts: [
        {
          id: "draft-acct",
          category: "BROKERAGE" as const,
          displayName: "Starter",
          ownerId,
          monthlyContributionUSD: Math.max(0, monthlySavings),
          holdings: [
            {
              kind: "cash" as const,
              id: "draft-cash",
              valueUSD: Math.max(0, netWorth),
              // Default to a balanced 5% real return — a plausible
              // long-term blended growth rate the user can refine
              // later by adding actual holdings.
              expectedRealCAGR: 0.05,
              geography: { US: 1, DEVELOPED: 0, EMERGING: 0 },
            },
          ],
        },
      ],
      liabilities: [],
    };
    return projectIndependence(draft, {
      ...assumptions,
      targetNetWorthUSD: Math.max(1, independenceTarget),
    });
  })();

  const months = projection?.monthsToIndependence ?? null;
  const independenceDate = projection?.independenceDate ?? null;

  const handleSeed = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ownerId = members[0]?.id ?? "real-member-1";
      const id = createAccount({
        displayName: "Starter account",
        category: "BROKERAGE",
        ownerId,
        monthlyContributionUSD: Math.max(0, monthlySavings),
      });
      if (netWorth > 0) {
        createHolding(id, {
          kind: "cash",
          valueUSD: netWorth,
          expectedRealCAGR: 0.05,
        });
      }
      setAssumption("targetNetWorthUSD", Math.max(1, independenceTarget));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="px-5 pt-6">
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-accent">
          Quick start · ~30 seconds
        </div>
        <div className="mt-1 text-sm font-medium text-text">
          Tell us three numbers — get an instant Independence projection
        </div>
        <p className="mt-1 text-[11px] text-text-muted">
          You can refine later by adding actual accounts and holdings.
          This just gets you to a meaningful chart on the home page.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Current net worth" prefix="$" hint="all-in, today">
            <NumberField
              value={netWorth}
              onChange={setNetWorth}
              precision={0}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
          </Field>
          <Field label="Monthly savings" prefix="$" hint="every month">
            <NumberField
              value={monthlySavings}
              onChange={setMonthlySavings}
              precision={0}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
          </Field>
          <Field label="Independence target" prefix="$" hint="goal at retirement">
            <NumberField
              value={independenceTarget}
              onChange={setIndependenceTarget}
              precision={0}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
          </Field>
        </div>

        {projection != null && (
          <div className="mt-4 rounded-xl border border-border bg-bg-surface p-4">
            <div className="text-[11px] uppercase tracking-wider text-text-dim">
              You hit Independence in
            </div>
            <div className="num mt-1 text-2xl font-semibold text-accent">
              {months == null
                ? "—"
                : months === 0
                  ? "you're there"
                  : formatYearsMonths(months)}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {independenceDate
                ? // Force the "en-US" locale here. `toLocaleDateString
                  // (undefined, ...)` uses the runtime's default
                  // locale, which differs between Node (server-render)
                  // and the user's browser — that mismatch trips a
                  // hydration warning. Pinning the locale also keeps
                  // the header readable for non-English users (the
                  // numeric content of the projection doesn't translate
                  // anyway).
                  `≈ ${independenceDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                  })}`
                : `Reach ${formatUSD(independenceTarget)} on a 5% real return`}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleSeed}
            disabled={saving || (netWorth <= 0 && monthlySavings <= 0)}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-bg disabled:opacity-40 active:opacity-80"
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  prefix,
  hint,
  children,
}: {
  label: string;
  prefix?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1">
        {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
        {children}
      </div>
      {hint && <div className="mt-1 text-[10px] text-text-dim">{hint}</div>}
    </label>
  );
}
