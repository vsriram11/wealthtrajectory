"use client";

import { useMemo } from "react";
import { emergencyFundAdequacy } from "@/lib/budget/emergencyFund";
import { useActiveProjection } from "@/lib/projection/useActiveProjection";
import { formatUSDCompact } from "@/lib/format";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

/**
 * Emergency-fund adequacy meter. Cash + savings vs N months of
 * monthly burn — the single most legible "am I safe?" check in
 * personal finance.
 *
 * Monthly burn is *derived from the user's budget* (passed in by
 * BudgetPanel via the `monthlyBurnUSD` prop) rather than entered
 * separately. Single source of truth: the user types their expenses
 * once and the emergency-fund math updates live.
 *
 * Recommended-months preset (3 / 6 / 9 / 12) still lives in
 * localStorage so it survives refresh without paying for a sync
 * round-trip on a single integer.
 *
 * Renders a friendly stub when there's no budget yet (zero burn),
 * and nothing at all when there are no SAVINGS / CHECKING accounts
 * (we'd have nothing to meter against either way).
 */
const LS_MONTHS = "fp.efRecommendedMonths";

// Parse / serialize defined at module scope so their identities are
// stable across renders — `useLocalStorageState` keys its snapshot
// memoization on them.
function parseRecommendedMonths(raw: string | null): number {
  if (raw == null) return 6;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 24) return 6;
  return n;
}
function serializeMonths(v: number): string {
  return String(v);
}

export function EmergencyFundCard({
  monthlyBurnUSD,
  essentialsBurnUSD,
}: {
  monthlyBurnUSD: number;
  /**
   * Fixed-only monthly burn — the "essentials" floor used for the
   * second runway figure ("X months on essentials only"). Optional
   * for back-compat; defaults to the same value as `monthlyBurnUSD`
   * (which collapses the dual-runway display to a single number).
   */
  essentialsBurnUSD?: number;
}) {
  const { household } = useActiveProjection();

  const hasCashy = useMemo(
    () =>
      household.accounts.some(
        (a) => a.category === "SAVINGS" || a.category === "CHECKING",
      ),
    [household.accounts],
  );

  const [recommendedMonths, setRecommendedMonths] = useLocalStorageState<number>(
    LS_MONTHS,
    6,
    parseRecommendedMonths,
    serializeMonths,
  );

  // Use the full monthly burn as the primary runway driver — that's
  // the one the status pill (under-funded / adequate / ample) is
  // computed against, because falling short of essentials *only* is
  // a much more severe state than falling short of full lifestyle.
  const adequacy = useMemo(
    () =>
      monthlyBurnUSD > 0
        ? emergencyFundAdequacy(household, monthlyBurnUSD, recommendedMonths)
        : null,
    [household, monthlyBurnUSD, recommendedMonths],
  );

  // Second runway: how far does the same cash stretch if the user
  // cuts to essentials only? When essentialsBurnUSD isn't provided
  // (or equals monthlyBurnUSD because there are no variable items),
  // we collapse to a single-runway view.
  const showDualRunway =
    essentialsBurnUSD != null &&
    essentialsBurnUSD > 0 &&
    essentialsBurnUSD < monthlyBurnUSD;
  const essentialsAdequacy = useMemo(
    () =>
      showDualRunway && essentialsBurnUSD
        ? emergencyFundAdequacy(household, essentialsBurnUSD, recommendedMonths)
        : null,
    [household, essentialsBurnUSD, recommendedMonths, showDualRunway],
  );

  if (!hasCashy) return null;

  const statusTone = adequacy
    ? adequacy.status === "ample"
      ? "border-positive/40 bg-positive/5 text-positive"
      : adequacy.status === "okay"
        ? "border-accent/40 bg-accent/5 text-accent"
        : "border-amber-300/40 bg-amber-300/5 text-amber-300"
    : "";

  const statusLabel = adequacy
    ? adequacy.status === "ample"
      ? "Ample"
      : adequacy.status === "okay"
        ? "Adequate"
        : "Under-funded"
    : "—";

  return (
    <div className="mt-3 rounded-md border border-border-strong bg-bg-elevated p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-wider text-text-dim">
          Emergency fund
        </div>
        <select
          value={recommendedMonths}
          onChange={(e) => setRecommendedMonths(Number(e.target.value))}
          className="rounded-md border border-border-strong bg-bg-surface px-2 py-0.5 text-[10px] text-text-muted outline-none focus:border-accent"
          aria-label="Recommended months of runway"
        >
          <option value={3}>3 mo target</option>
          <option value={6}>6 mo target</option>
          <option value={9}>9 mo target</option>
          <option value={12}>12 mo target</option>
        </select>
      </div>

      {!adequacy ? (
        <div className="mt-2 text-[11px] text-text-dim">
          Add expenses below to see how many months your cash &amp; savings
          would cover.
        </div>
      ) : (
        <>
          <div
            className={`mt-2 grid gap-2 ${
              showDualRunway ? "grid-cols-3" : "grid-cols-2"
            }`}
          >
            <div className="rounded-md border border-border bg-bg-surface px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-dim">
                Current burn
              </div>
              <div className="num mt-0.5 text-base font-semibold text-text">
                {adequacy.monthsOfRunway.toFixed(1)}
                <span className="text-[10px] font-normal text-text-muted">
                  {" "}
                  mo
                </span>
              </div>
              <div className="text-[10px] text-text-dim">
                on{" "}
                <span className="num">
                  {formatUSDCompact(adequacy.emergencyFundUSD)}
                </span>{" "}
                cash
              </div>
            </div>
            {showDualRunway && essentialsAdequacy && (
              <div className="rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-300/90">
                  Essentials only
                </div>
                <div className="num mt-0.5 text-base font-semibold text-amber-200">
                  {essentialsAdequacy.monthsOfRunway.toFixed(1)}
                  <span className="text-[10px] font-normal text-amber-300/80">
                    {" "}
                    mo
                  </span>
                </div>
                <div className="text-[10px] text-amber-300/80">
                  if you cut variable spend
                </div>
              </div>
            )}
            <div className={`rounded-md border px-3 py-2 ${statusTone}`}>
              <div className="text-[10px] uppercase tracking-wider opacity-80">
                Status
              </div>
              <div className="mt-0.5 text-base font-semibold">
                {statusLabel}
              </div>
              {adequacy.shortfallUSD > 0 && (
                <div className="num text-[10px] opacity-80">
                  +{formatUSDCompact(adequacy.shortfallUSD)} to target
                </div>
              )}
            </div>
          </div>
          {adequacy.contributors.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {adequacy.contributors.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between text-[11px]"
                >
                  <span className="text-text-muted">{c.name}</span>
                  <span className="num text-text-dim">
                    {formatUSDCompact(c.valueUSD)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="mt-2 text-[10px] leading-snug text-text-dim">
        Burn comes from your budget below; threshold stored on device only.
        Park your fund in a high-yield savings account (~4–5% APY) so it
        doesn&apos;t lose purchasing power.
      </div>
    </div>
  );
}
