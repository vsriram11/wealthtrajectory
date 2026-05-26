"use client";

/**
 * Plan → Income tab.
 *
 * UI for managing future-income streams (consulting gigs,
 * pensions, Social Security, rental income, etc.). Each stream:
 *
 *   - free-text label (no enum — too many real-world sources)
 *   - start year + end year (inclusive on both)
 *   - annual real-dollar amount
 *   - real growth rate (default 0 = inflation-protected)
 *   - owner (one of the household's members)
 *
 * Mental model the panel surfaces:
 *
 *   - Each stream is a separate row; the user maintains them in
 *     the same way they maintain budget items.
 *   - The summary card up top shows the AGGREGATE per-year
 *     income for the next 30 years so the user can sanity-check
 *     "do my streams add up to what I expected this year?"
 *   - Streams flow into Monte Carlo + Independence projection
 *     automatically via the engine helpers — the panel itself
 *     doesn't trigger projections.
 *
 * Accessibility:
 *
 *   - Each row carries its own labeled inputs.
 *   - Delete uses confirm-then-delete (same two-step pattern as
 *     MembersSheet) so a stray tap doesn't lose data.
 *   - The "Add stream" affordance is a button, not an icon-only
 *     fab — discoverable via screen-reader buttons listing.
 *   - Form fields use real <label> elements with their NumberField
 *     children, so VoiceOver / NVDA announce the field purpose.
 *
 * Composition with other features:
 *
 *   - The owner picker shows ACTIVE members only when the user
 *     isn't filtered to a specific person (matches the rest of
 *     the rollup-include semantics). If they pick a specific
 *     member, that member's streams show regardless of their
 *     rollup-include flag.
 *   - Empty state explains the value prop ("model consulting,
 *     pension, Social Security, rental income — boosts
 *     Independence Day and Monte Carlo survival rates").
 */

import { Fragment, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  filterIncomeStreamsForRollups,
  incomeForYear,
  lifetimeTotalReal,
  totalIncomeForYear,
  type IncomeStream,
} from "@/lib/budget/incomeStreams";
import { activeMemberIds, activeMembers } from "@/lib/types";
import { formatUSD, formatUSDCompact } from "@/lib/format";
import { NumberField } from "@/app/_components/ui/NumberField";
import { SectionHeader } from "@/app/_components/ui/SectionHeader";

export function IncomePanel() {
  const allStreams = useAppStore((s) => s.incomeStreams);
  const household = useAppStore((s) => s.household);
  const memberId = useAppStore((s) => s.selectedMemberId);
  const addStream = useAppStore((s) => s.addIncomeStream);
  const updateStream = useAppStore((s) => s.updateIncomeStream);
  const removeStream = useAppStore((s) => s.removeIncomeStream);

  // Same scoping rule the projection + MC use. Per-member view
  // shows that member's streams (even if they're rollup-
  // excluded); household view shows active members' streams.
  const activeIds = useMemo(() => activeMemberIds(household), [household]);
  const streams = useMemo(
    () => filterIncomeStreamsForRollups(allStreams, memberId, activeIds),
    [allStreams, memberId, activeIds],
  );

  const [creating, setCreating] = useState(false);

  // Members the user can assign a new stream to. In per-member
  // view, the picker is pre-filled and disabled. Falls back to
  // an empty list when the household has no members yet — the
  // panel shows an "Add a member first" notice instead.
  const ownerOptions = useMemo(
    () => (memberId ? household.members : activeMembers(household)),
    [household, memberId],
  );

  return (
    <>
      <SectionHeader
        label="Future income"
        sub="Part-time work, pension, Social Security, rentals — anything that pays you in a given year"
      />

      {streams.length > 0 && <IncomeSummaryCard streams={streams} />}

      <ul className="mx-5 mt-4 space-y-2">
        {streams.length === 0 && <EmptyState />}
        {streams.map((s) => (
          <IncomeStreamRow
            key={s.id}
            stream={s}
            ownerName={
              household.members.find((m) => m.id === s.ownerId)?.displayName ??
              "Unknown"
            }
            ownerOptions={household.members}
            onChange={(patch) => updateStream(s.id, patch)}
            onRemove={() => removeStream(s.id)}
          />
        ))}
      </ul>

      <div className="mx-5 mt-3">
        {!creating && (
          <button
            type="button"
            onClick={() => {
              if (ownerOptions.length === 0) return;
              setCreating(true);
            }}
            disabled={ownerOptions.length === 0}
            className="w-full rounded-md border border-dashed border-border-strong bg-bg-elevated px-3 py-2.5 text-sm font-medium text-text-muted hover:text-text active:opacity-70 disabled:opacity-40"
            aria-label="Add an income stream"
          >
            + Add income stream
          </button>
        )}
      </div>

      {creating && (
        <IncomeStreamCreator
          memberPreselect={memberId ?? ownerOptions[0]?.id ?? ""}
          ownerOptions={ownerOptions}
          onCancel={() => setCreating(false)}
          onSave={(s) => {
            addStream(s);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Aggregate per-year preview. Shows the user the next ~10 years
 * of income across all their streams so they can sanity-check
 * the additivity. Years with no income are skipped to keep the
 * card compact.
 */
function IncomeSummaryCard({ streams }: { streams: IncomeStream[] }) {
  const currentYear = new Date().getFullYear();
  const HORIZON = 15;
  const previewYears = useMemo(() => {
    const rows: { year: number; total: number }[] = [];
    for (let i = 0; i < HORIZON; i++) {
      const y = currentYear + i;
      const total = totalIncomeForYear(streams, y);
      if (total > 0) rows.push({ year: y, total });
    }
    return rows;
  }, [streams, currentYear]);

  if (previewYears.length === 0) return null;

  return (
    <section
      className="mx-5 mt-4 rounded-xl border border-border bg-bg-elevated p-4"
      aria-label="Income summary by year"
    >
      <div className="mb-2 text-[11px] uppercase tracking-wider text-text-dim">
        Aggregate per year — next {HORIZON} years
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {previewYears.map((row) => (
          <div key={row.year} className="flex items-baseline justify-between">
            <span className="text-text-muted">{row.year}</span>
            <span className="num font-medium text-text">
              {formatUSDCompact(row.total)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] leading-snug text-text-dim">
        Years with no income are hidden. Streams flow into Independence
        projection and Monte Carlo automatically.
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <li className="rounded-xl border border-dashed border-border bg-bg-elevated p-4">
      <div className="text-sm text-text">No income streams yet</div>
      <p className="mt-1 text-[12px] leading-snug text-text-muted">
        Model part-time consulting, pension, Social Security, rental
        income, or any other income that pays you in a specific year
        range. Streams reduce the portfolio drawdown the simulator
        sees — they pull Independence Day sooner during accumulation
        and lift Monte Carlo survival rates during retirement.
      </p>
    </li>
  );
}

function IncomeStreamRow({
  stream,
  ownerName,
  ownerOptions,
  onChange,
  onRemove,
}: {
  stream: IncomeStream;
  ownerName: string;
  ownerOptions: { id: string; displayName: string }[];
  onChange: (patch: Partial<Omit<IncomeStream, "id">>) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(stream.label);
  const [confirming, setConfirming] = useState(false);
  const currentYear = new Date().getFullYear();
  const thisYear = incomeForYear(stream, currentYear);
  const lifetime = lifetimeTotalReal(stream);

  return (
    <li
      className={`rounded-xl border bg-bg-elevated p-3 ${
        stream.annualUSD < 0
          ? "border-amber-300/40"
          : "border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const trimmed = label.trim();
            if (trimmed && trimmed !== stream.label) onChange({ label: trimmed });
            else setLabel(stream.label);
          }}
          aria-label="Stream label"
          className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
        {stream.annualUSD < 0 && (
          <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
            Distribution
          </span>
        )}
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-negative/40 bg-bg-surface px-2.5 py-2 text-xs font-medium text-negative active:opacity-70"
            aria-label={`Delete ${stream.label}`}
          >
            Delete
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            Start year
          </span>
          <NumberField
            value={stream.startYear}
            onChange={(v) => onChange({ startYear: v })}
            precision={0}
            allowNegative={false}
            ariaLabel="Start year"
            className="num w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-right text-sm font-medium text-text outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            End year
          </span>
          <NumberField
            value={stream.endYear}
            onChange={(v) => onChange({ endYear: v })}
            precision={0}
            allowNegative={false}
            ariaLabel="End year"
            className="num w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-right text-sm font-medium text-text outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            Annual $
          </span>
          <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-surface px-2 py-1.5">
            <span className="text-xs text-text-muted">$</span>
            <NumberField
              value={stream.annualUSD}
              onChange={(v) => onChange({ annualUSD: v })}
              precision={0}
              allowNegative={true}
              ariaLabel="Annual amount in real dollars (negative = distribution)"
              className={`num w-full bg-transparent text-right text-sm font-medium outline-none ${
                stream.annualUSD < 0 ? "text-amber-300" : "text-text"
              }`}
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
            Real growth %
          </span>
          <NumberField
            value={stream.realGrowthRate * 100}
            onChange={(v) => onChange({ realGrowthRate: v / 100 })}
            precision={2}
            allowNegative={true}
            ariaLabel="Real growth rate, percent above inflation"
            className="num w-full rounded-md border border-border-strong bg-bg-surface px-2 py-1.5 text-right text-sm font-medium text-text outline-none"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Owner</span>
          <select
            value={stream.ownerId}
            onChange={(e) => onChange({ ownerId: e.target.value })}
            aria-label="Stream owner"
            className="rounded-md border border-border-strong bg-bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent"
          >
            {ownerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="text-right text-text-muted">
          {thisYear > 0 && (
            <span className="num mr-2">{formatUSD(thisYear)}/yr now ·</span>
          )}
          <span className="num">{formatUSDCompact(lifetime)} lifetime total</span>
        </div>
      </div>

      {confirming && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-xs text-text-muted active:opacity-70"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            className="flex-1 rounded-md bg-negative px-3 py-2 text-xs font-semibold text-bg active:opacity-80"
          >
            Delete forever
          </button>
        </div>
      )}
    </li>
  );
}

function IncomeStreamCreator({
  memberPreselect,
  ownerOptions,
  onCancel,
  onSave,
}: {
  memberPreselect: string;
  ownerOptions: { id: string; displayName: string }[];
  onCancel: () => void;
  onSave: (input: Omit<IncomeStream, "id">) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [label, setLabel] = useState("");
  const [startYear, setStartYear] = useState(currentYear + 1);
  const [endYear, setEndYear] = useState(currentYear + 5);
  // Display the amount as a positive number; sign is applied via
  // the kind chip at save time. Keeps the entry field intuitive
  // ("enter $20k", not "enter −$20k") while the engine model stays
  // signed.
  const [annualUSD, setAnnualUSD] = useState(50_000);
  const [kind, setKind] = useState<"income" | "distribution">("income");
  const [growthPct, setGrowthPct] = useState(0);
  const [ownerId, setOwnerId] = useState(memberPreselect);

  const isValid =
    label.trim().length > 0 &&
    endYear >= startYear &&
    annualUSD >= 0 &&
    ownerOptions.some((m) => m.id === ownerId);

  return (
    <Fragment>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add income stream"
        className="fixed inset-0 z-50"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
          <div className="px-5 pt-3">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-text-dim">
                  Plan
                </div>
                <div className="text-xl font-semibold text-text">
                  Add income stream
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancel"
                className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
              >
                Cancel
              </button>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                Label
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  kind === "distribution"
                    ? "Partial-coast bridge · Sabbatical"
                    : "Consulting · Social Security · Rental"
                }
                aria-label="Stream label"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
              />
            </label>

            {/* Type chip — income vs distribution. Sign is applied
                at save time; the engine model is signed
                annualUSD. Negative streams pull from the
                portfolio (partial-coast / sabbatical / step-down
                pattern). See incomeStreams.ts file-level
                docstring for engine semantics. */}
            <div className="mt-3">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                Type
              </span>
              <div className="inline-flex gap-0.5 rounded-full border border-border bg-bg-elevated p-0.5">
                <button
                  type="button"
                  onClick={() => setKind("income")}
                  aria-pressed={kind === "income"}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
                    kind === "income"
                      ? "bg-accent text-bg"
                      : "text-text-muted"
                  }`}
                >
                  Income
                </button>
                <button
                  type="button"
                  onClick={() => setKind("distribution")}
                  aria-pressed={kind === "distribution"}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition active:opacity-70 ${
                    kind === "distribution"
                      ? "bg-amber-300 text-bg"
                      : "text-text-muted"
                  }`}
                >
                  Distribution
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-text-dim">
                {kind === "income"
                  ? "Money flowing IN (consulting, pension, Social Security, rental). Offsets retirement withdrawals."
                  : "Money flowing OUT (partial-coast bridge, sabbatical, step-down). Pulls from the portfolio in the active years."}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                  Start year
                </span>
                <NumberField
                  value={startYear}
                  onChange={setStartYear}
                  precision={0}
                  allowNegative={false}
                  ariaLabel="Start year"
                  className="num w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-right text-sm font-medium text-text outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                  End year
                </span>
                <NumberField
                  value={endYear}
                  onChange={setEndYear}
                  precision={0}
                  allowNegative={false}
                  ariaLabel="End year"
                  className="num w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-right text-sm font-medium text-text outline-none"
                />
              </label>
            </div>

            {endYear < startYear && (
              <p className="mt-1 text-[11px] text-negative">
                End year must be on or after start year.
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                  Annual amount
                </span>
                <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-2">
                  <span className="text-xs text-text-muted">$</span>
                  <NumberField
                    value={annualUSD}
                    onChange={setAnnualUSD}
                    precision={0}
                    allowNegative={false}
                    ariaLabel="Annual amount in real dollars"
                    className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
                  />
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                  Real growth % / yr
                </span>
                <NumberField
                  value={growthPct}
                  onChange={setGrowthPct}
                  precision={2}
                  allowNegative={true}
                  ariaLabel="Real growth rate, percent above inflation"
                  className="num w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-right text-sm font-medium text-text outline-none"
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-text-dim">
              All amounts in today&apos;s dollars (real terms). Growth of 0
              means the stream keeps pace with inflation. Social Security
              is COLA-indexed → 0%. Most legacy pensions aren&apos;t →
              use −2 to −3%.
            </p>

            <label className="mt-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-dim">
                Owner
              </span>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                aria-label="Owner"
                className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent"
              >
                {ownerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-muted active:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!isValid}
                onClick={() =>
                  onSave({
                    label: label.trim(),
                    startYear,
                    endYear,
                    // Sign the amount based on the kind chip.
                    // Stored signed; UI surfaces re-derive the
                    // chip via Math.sign for editing.
                    annualUSD:
                      kind === "distribution" ? -annualUSD : annualUSD,
                    realGrowthRate: growthPct / 100,
                    ownerId,
                  })
                }
                className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg active:opacity-80 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  );
}
