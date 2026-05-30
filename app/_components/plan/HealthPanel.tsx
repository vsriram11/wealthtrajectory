"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  DEFAULT_IMPORTANCE_WEIGHTS,
  plansForMember,
  rollupHealthPlans,
  type HealthImportanceWeights,
  type HealthPlan,
} from "@/lib/health/healthPlans";
import { formatUSD } from "@/lib/format";
import { activeMemberIds, type Household } from "@/lib/types";
import { SectionHeader } from "@/app/_components/ui/SectionHeader";
import { ImportanceCard } from "./health/ImportanceCard";
import {
  DependentPlanCard,
  SubscribedPlanCard,
} from "./health/PlanCards";
import { AddPlanFromTemplate } from "./health/AddPlanFromTemplate";

/**
 * Plan → Health tab.
 *
 * Member-filter behavior:
 *   - HOUSEHOLD view: read-only aggregate. Lists every plan once
 *     (deduped) with no edit affordance; tapping a plan deep-links
 *     into the owner's member view. Total monthly cost uses the
 *     no-double-count rollup so a family-of-4 plan owned by Alice
 *     doesn't sum 4× against the household.
 *   - MEMBER view: editable. The member sees plans they OWN (with
 *     full edit + Add-to-Budget controls) and a read-only list of
 *     plans where they're covered as a dependent. Importance
 *     weights are per-member.
 *
 * Why importance is per-member, not per-plan:
 *   A spouse may rank mental-health coverage above premium; the
 *   breadwinner may rank premium above all. Putting weights on the
 *   member lets each person compare candidate plans through their
 *   own lens without conflating views.
 */
export function HealthPanel() {
  const household = useAppStore((s) => s.household);
  const selectedMemberId = useAppStore((s) => s.selectedMemberId);
  const plans = useAppStore((s) => s.healthPlans);
  const weightsByMember = useAppStore((s) => s.healthImportanceWeights);

  // R3 audit HIGH / rollup-contract gap: Member.includeInRollup is
  // the single switch for "include this member in household
  // aggregates," and HealthPlan.ownerId is a rollup-aware key. Use
  // activeMemberIds (which respects includeInRollup) instead of
  // raw household.members so an excluded member's premium drops
  // out of the household total — consistent with how every other
  // ownerId-keyed collection cascades. ALSO pre-filter the plans
  // themselves so a plan owned by an excluded member's premium
  // never lands in totalMonthlyUSD.
  const activeIds = useMemo(() => activeMemberIds(household), [household]);
  const memberIds = useMemo(() => Array.from(activeIds), [activeIds]);
  const rollupPlans = useMemo(
    () => plans.filter((p) => activeIds.has(p.ownerId)),
    [plans, activeIds],
  );
  const rollup = useMemo(
    () => rollupHealthPlans(rollupPlans, memberIds),
    [rollupPlans, memberIds],
  );

  const inMemberView = selectedMemberId != null;
  const selectedMember = inMemberView
    ? household.members.find((m) => m.id === selectedMemberId) ?? null
    : null;

  return (
    <>
      <SectionHeader
        label="Plans & coverage"
        sub={
          inMemberView && selectedMember
            ? `Per-plan exploration for ${selectedMember.displayName}`
            : "Household rollup — switch to a member to edit"
        }
      />

      <RollupCard
        rollup={rollup}
        memberCount={memberIds.length}
        memberNamesById={Object.fromEntries(
          household.members.map((m) => [m.id, m.displayName]),
        )}
      />

      {inMemberView && selectedMemberId && selectedMember ? (
        <MemberHealthView
          memberId={selectedMemberId}
          memberName={selectedMember.displayName}
          plans={plans}
          household={household}
          weights={
            weightsByMember[selectedMemberId] ?? DEFAULT_IMPORTANCE_WEIGHTS
          }
        />
      ) : (
        <HouseholdPlanList plans={plans} household={household} />
      )}

      <Disclaimer />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rollup card                                                          */
/* ------------------------------------------------------------------ */

function RollupCard({
  rollup,
  memberCount,
  memberNamesById,
}: {
  rollup: ReturnType<typeof rollupHealthPlans>;
  memberCount: number;
  memberNamesById: Record<string, string>;
}) {
  const uncoveredNames = rollup.uncoveredMemberIds
    .map((id) => memberNamesById[id])
    .filter((n): n is string => !!n);

  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Household monthly health cost
            </div>
            <div className="num mt-1 text-3xl font-semibold text-text">
              {formatUSD(rollup.totalMonthlyUSD)}
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {rollup.planCount} {rollup.planCount === 1 ? "plan" : "plans"}
              {" · "}
              {rollup.coveredMemberIds.length} of {memberCount} members covered
            </div>
          </div>
          <div className="text-right">
            <div className="num text-sm font-medium text-text-muted">
              {formatUSD(rollup.totalMonthlyUSD * 12)}/yr
            </div>
            <div className="mt-0.5 text-[10px] text-text-dim">annualized</div>
          </div>
        </div>
        {uncoveredNames.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-[11px] text-amber-300">
            Not on any plan: {uncoveredNames.join(", ")}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Household view (read-only list)                                      */
/* ------------------------------------------------------------------ */

function HouseholdPlanList({
  plans,
  household,
}: {
  plans: HealthPlan[];
  household: Household;
}) {
  const setSelected = useAppStore((s) => s.setSelectedMember);
  const memberName = (id: string) =>
    household.members.find((m) => m.id === id)?.displayName ?? "—";

  if (plans.length === 0) {
    return <EmptyStateCard isHousehold />;
  }

  return (
    <>
      <SectionHeader
        label="All plans"
        sub="Read-only. Tap to switch to the owner's view to edit."
      />
      <section className="px-5 pt-3">
        <ul className="space-y-2">
          {plans.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-border bg-bg-surface p-4"
            >
              <button
                type="button"
                onClick={() => setSelected(p.ownerId)}
                className="block w-full text-left active:opacity-70"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-dim">
                      Subscriber: {memberName(p.ownerId)}
                      {p.coveredMemberIds.length > 1 && (
                        <>
                          {" · covers "}
                          {p.coveredMemberIds
                            .map(memberName)
                            .join(", ")}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-semibold text-text">
                      {formatUSD(p.monthlyPremiumUSD)}
                    </div>
                    <div className="text-[10px] text-text-dim">/mo</div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Member view (editable)                                               */
/* ------------------------------------------------------------------ */

function MemberHealthView({
  memberId,
  memberName,
  plans,
  household,
  weights,
}: {
  memberId: string;
  memberName: string;
  plans: HealthPlan[];
  household: Household;
  weights: HealthImportanceWeights;
}) {
  const { subscribed, coveredAsDependent } = useMemo(
    () => plansForMember(plans, memberId),
    [plans, memberId],
  );
  const [adding, setAdding] = useState(false);

  return (
    <>
      <ImportanceCard memberId={memberId} weights={weights} />

      <SectionHeader
        label={`${memberName}'s plans`}
        sub="Plans where you're the subscriber. Edit, score, push to Budget."
      />
      <section className="px-5 pt-3">
        {subscribed.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-surface p-4 text-[12px] text-text-dim">
            No plans yet. Pick a template below to start exploring.
          </div>
        ) : (
          <ul className="space-y-2">
            {subscribed.map((p) => (
              <SubscribedPlanCard
                key={p.id}
                plan={p}
                weights={weights}
                household={household}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <AddPlanFromTemplate
            memberId={memberId}
            householdMemberIds={household.members.map((m) => m.id)}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 w-full rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent active:opacity-70"
          >
            + Add a plan
          </button>
        )}
      </section>

      {coveredAsDependent.length > 0 && (
        <>
          <SectionHeader
            label="Covered as a dependent"
            sub="Read-only — edit on the subscriber's view."
          />
          <section className="px-5 pt-3">
            <ul className="space-y-2">
              {coveredAsDependent.map((p) => (
                <DependentPlanCard
                  key={p.id}
                  plan={p}
                  ownerName={
                    household.members.find((m) => m.id === p.ownerId)
                      ?.displayName ?? "—"
                  }
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Importance sliders                                                   */
/* ------------------------------------------------------------------ */




/* ------------------------------------------------------------------ */

function EmptyStateCard({ isHousehold }: { isHousehold: boolean }) {
  return (
    <section className="px-5 pt-3">
      <div className="rounded-2xl border border-border bg-bg-surface p-4">
        <div className="text-sm font-medium text-text">
          No health plans yet
        </div>
        <div className="mt-1 text-[11px] text-text-dim">
          {isHousehold
            ? "Switch to a member to add a plan. The household view aggregates plans across members."
            : "Add a plan to score it against your priorities and roll its premium into your Healthcare budget."}
        </div>
      </div>
    </section>
  );
}

function Disclaimer() {
  return (
    <section className="px-5 pt-4 pb-2">
      <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-[10px] leading-snug text-text-dim">
        <span className="font-medium text-text-muted">Templates, not quotes.</span>{" "}
        Default premium / deductible / OOP-max figures come from public
        benchmarks (KFF employer surveys, ACA marketplace tier
        definitions, university SHIP disclosures). They are NOT live
        quotes from healthcare.gov, state exchanges, or specific
        carriers — get a real quote and override the numbers above
        before relying on plan scores for a real decision.
      </div>
    </section>
  );
}
