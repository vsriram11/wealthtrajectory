"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  isLivePriceable,
  isPricedHolding,
  type Holding,
} from "@/lib/types";
import { formatLeverage, formatPercent, formatUSD } from "@/lib/format";
import { singularLabel } from "@/lib/portfolio/holdingKinds";
import { bondLeverageFromDuration } from "@/lib/portfolio/bondLeverage";
import {
  DailyResetLeverageNote,
  MortgageLeverageNote,
} from "./holding-creator/LeverageNotes";
import {
  DateField,
  FieldNumber,
  ReadOnlyField,
  SectionHeader,
  formatRelative,
} from "./holding-editors/fields";
import { StyleBoxEditor } from "./holding-editors/StyleBoxEditor";
import { BondTypeEditor } from "./holding-editors/BondTypeEditor";
import { GeographyEditor } from "./holding-editors/GeographyEditor";
import { CompositionEditor } from "./holding-editors/CompositionEditor";
import { CommodityBreakdownEditor } from "./holding-editors/CommodityBreakdownEditor";
import {
  ExcludeFromCashBucketSaleToggle,
  IlliquidToggle,
  PrimaryResidenceToggle,
} from "./holding-editors/Toggles";

export function HoldingEditor() {
  const editingId = useAppStore((s) => s.editingHoldingId);
  const close = useAppStore((s) => s.closeHoldingEditor);
  const household = useAppStore((s) => s.household);

  const holding = useMemo(() => {
    if (!editingId) return null;
    for (const a of household.accounts)
      for (const h of a.holdings) if (h.id === editingId) return h;
    return null;
  }, [editingId, household]);

  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, close]);

  if (!editingId || !holding) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Edit holding"
    >
      {/* Decorative backdrop — no click-to-close to prevent
          accidental data loss on in-progress edits. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <EditorBody holding={holding} onClose={close} />
      </div>
    </div>
  );
}

function EditorBody({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const setHoldingValue = useAppStore((s) => s.setHoldingValue);
  const setHoldingShares = useAppStore((s) => s.setHoldingShares);
  const setHoldingPrice = useAppStore((s) => s.setHoldingPrice);
  const applyLivePrice = useAppStore((s) => s.applyLivePrice);
  const setHoldingCAGR = useAppStore((s) => s.setHoldingCAGR);
  // Time-travel awareness: change copy + behavior of the
  // price-refresh affordance so it doesn't mislead users into
  // thinking the editor is pulling current market data while
  // they're editing a backdated session.
  const timeTravelActive = useAppStore((s) => s.timeTravelActive);
  const timeTravelDate = useAppStore((s) => s.timeTravelDate);
  const setHoldingLeverage = useAppStore((s) => s.setHoldingLeverage);
  const setHoldingStyleBox = useAppStore((s) => s.setHoldingStyleBox);
  const setHoldingGeography = useAppStore((s) => s.setHoldingGeography);
  const setHoldingBondType = useAppStore((s) => s.setHoldingBondType);
  const setHoldingDuration = useAppStore((s) => s.setHoldingDuration);
  const resetBondLeverageToAuto = useAppStore(
    (s) => s.resetBondLeverageToAuto,
  );
  const setHoldingAcquiredAt = useAppStore((s) => s.setHoldingAcquiredAt);
  const removeHolding = useAppStore((s) => s.removeHolding);
  const convertToLive = useAppStore((s) => s.convertHoldingToLive);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const classLabel = singularLabel(holding.kind);
  const symbol =
    holding.kind === "cash"
      ? "Cash"
      : holding.kind === "real_estate" || holding.kind === "other"
        ? holding.name
        : holding.symbol;

  // Surface refresh errors visibly — silent no-op was a
  // user-reported bug. When the upstream returns null OR
  // unavailable, the user sees a concrete diagnostic instead
  // of "nothing happened."
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshPrice = async () => {
    if (!isLivePriceable(holding)) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const { getQuote, priceAtDetailed } = await import("@/lib/data/quotes");
      // Time-travel awareness: pull HISTORICAL closing price for
      // the chosen backdate (range=max to access multi-decade
      // history when available). Live-mode keeps the original
      // current-price behavior.
      if (timeTravelActive && timeTravelDate) {
        const { parseISODate } = await import("@/lib/dateInput");
        const targetMs = parseISODate(timeTravelDate);
        if (targetMs === null) {
          setRefreshError(`Invalid backdate "${timeTravelDate}".`);
          return;
        }
        const q = await getQuote(holding.symbol, { range: "max" });
        if (!q) {
          setRefreshError(
            `Couldn't fetch ${holding.symbol}: network error (see browser console).`,
          );
          return;
        }
        if (q.unavailable) {
          setRefreshError(
            `Couldn't fetch ${holding.symbol}: ${q.error ?? "upstream unavailable"}.`,
          );
          return;
        }
        const r = priceAtDetailed(q, targetMs);
        if (r === null) {
          setRefreshError(
            `No historical data for ${holding.symbol} — enter price manually below.`,
          );
          return;
        }
        if (r.clamped) {
          setRefreshError(
            `Historical data for ${holding.symbol} doesn't extend back to ${timeTravelDate}. Enter price manually below.`,
          );
          return;
        }
        if (r.price > 0) {
          applyLivePrice(holding.symbol, r.price, targetMs, "historical");
        } else {
          setRefreshError(
            `Got non-positive historical price for ${holding.symbol}.`,
          );
        }
        return;
      }
      // Live-mode path (unchanged behavior, now with visible errors).
      const q = await getQuote(holding.symbol);
      if (!q) {
        setRefreshError(
          `Couldn't fetch ${holding.symbol}: network error (see browser console).`,
        );
        return;
      }
      if (q.unavailable) {
        setRefreshError(
          `Couldn't fetch ${holding.symbol}: ${q.error ?? "upstream unavailable"}.`,
        );
        return;
      }
      if (q.currentPrice > 0) {
        applyLivePrice(holding.symbol, q.currentPrice, q.fetchedAt);
      } else {
        setRefreshError(
          `Got non-positive price (${q.currentPrice}) for ${holding.symbol}.`,
        );
      }
    } catch (e) {
      setRefreshError(
        `Refresh threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRefreshing(false);
    }
  };

  const tryLive = async () => {
    if (!isLivePriceable(holding)) return;
    setRefreshing(true);
    setConvertError(null);
    try {
      const { getQuote } = await import("@/lib/data/quotes");
      const q = await getQuote(holding.symbol);
      if (q && q.currentPrice > 0) {
        convertToLive(holding.id, q.currentPrice, q.fetchedAt);
        return;
      }
      const { getPreset } = await import("@/lib/portfolio/presets");
      const preset = getPreset(holding.symbol);
      if (preset) {
        // Recognized ticker but Yahoo is down; use the registry reference
        // price so the holding leaves manual mode. The next successful
        // PriceRefresher run will update it to the live price.
        convertToLive(holding.id, preset.referencePriceUSD, Date.now());
        return;
      }
      setConvertError(
        `Couldn't fetch a live price for ${holding.symbol} and it's not in our preset registry. Stays on manual.`,
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="px-5 pt-3">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-text-dim">
            {classLabel}
          </div>
          <div className="num text-xl font-semibold text-text">{symbol}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
        >
          Done
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <FieldNumber
          label="Value"
          prefix="$"
          value={holding.valueUSD}
          step={500}
          min={0}
          precision={2}
          onChange={(v) => setHoldingValue(holding.id, v)}
          help={
            isPricedHolding(holding) && !holding.isManualPrice
              ? `${holding.shares.toFixed(4)} ${holding.kind === "crypto" ? "units" : "shares"} × ${formatUSD(holding.lastPriceUSD)}`
              : isPricedHolding(holding) && holding.isManualPrice
                ? "Manual price — value entered directly"
                : formatUSD(holding.valueUSD)
          }
        />
        {/* Shares + Price + Refresh affordance shown for ALL priced
            holdings (live AND manual), not just live. User report:
            "manual entry screen that only lets me input value (not
            shares and price, feel like that could be an option as
            well)." Manual-priced holdings now get the same editor
            controls; entering Shares or Price recomputes Value
            from the relationship V = shares × price. */}
        {isPricedHolding(holding) && (
          <>
            <FieldNumber
              label={holding.kind === "crypto" ? "Units" : "Shares"}
              value={+holding.shares.toFixed(6)}
              step={holding.kind === "crypto" ? 0.0001 : 0.001}
              min={0}
              precision={6}
              onChange={(v) => setHoldingShares(holding.id, v)}
              help={
                timeTravelActive
                  ? holding.kind === "crypto"
                    ? "Editing units re-prices the position at the historical per-unit price you set below"
                    : "Editing shares re-prices the position at the historical price you set below"
                  : holding.kind === "crypto"
                    ? "Editing units re-prices the position at the current per-unit price"
                    : "Editing shares re-prices the position at the current market price"
              }
            />
            <FieldNumber
              label="Price"
              prefix="$"
              value={+holding.lastPriceUSD.toFixed(4)}
              step={0.01}
              min={0}
              onChange={(v) => setHoldingPrice(holding.id, v, { manual: true })}
              help={
                timeTravelActive
                  ? `Enter the per-share price as of ${timeTravelDate ?? "the backdate"}. Value = shares × price.`
                  : holding.lastPricedAt
                    ? `Last refreshed ${formatRelative(holding.lastPricedAt)}`
                    : "Tap Refresh to pull live"
              }
            />
            {isLivePriceable(holding) && (
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated px-4 py-2.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">
                    {timeTravelActive
                      ? `Backdated to ${timeTravelDate ?? "history"} (historical close)`
                      : "Auto-refreshing from live data"}
                  </span>
                  <button
                    type="button"
                    onClick={refreshPrice}
                    disabled={refreshing}
                    className="rounded-md border border-border-strong bg-bg-surface px-2.5 py-1 text-[11px] font-medium text-accent disabled:opacity-50 active:opacity-70"
                  >
                    {refreshing
                      ? timeTravelActive
                        ? "Fetching historical…"
                        : "Refreshing…"
                      : timeTravelActive
                        ? "Fetch historical price"
                        : "Refresh price"}
                  </button>
                </div>
                {refreshError && (
                  <div
                    role="alert"
                    className="rounded-md border border-negative/40 bg-negative/10 px-2 py-1 text-[10px] leading-snug text-negative break-words"
                  >
                    {refreshError}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {isPricedHolding(holding) && holding.isManualPrice && (
          <div className="rounded-xl border border-border bg-bg-elevated px-4 py-3 text-[11px] text-text-muted">
            <div>
              Manual price — {holding.kind === "crypto" ? "crypto positions are tracked manually." : <>last fetch for <span className="text-text">{holding.symbol}</span> didn&apos;t return data.</>} Edit Value above directly{isLivePriceable(holding) ? ", or retry live tracking below." : "."}
            </div>
            {isLivePriceable(holding) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-text-dim">
                  Switching to live keeps your current Value and computes shares
                  from the new price.
                </span>
                <button
                  type="button"
                  onClick={tryLive}
                  disabled={refreshing}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent disabled:opacity-50 active:opacity-70"
                >
                  {refreshing ? "Trying…" : "Try live tracking"}
                </button>
              </div>
            )}
            {convertError && (
              <div className="mt-2 text-amber-300">{convertError}</div>
            )}
          </div>
        )}
        {/* When the holding has a multi-asset composition, the wrapper's
            expectedRealCAGR is derived from the legs (exposure-weighted
            blend) and any manual edit here would be silently overwritten
            on the next composition tweak. Render as read-only with a
            "from legs" hint so users edit at the leg level. */}
        {(holding.kind === "equity" ||
          holding.kind === "bond" ||
          holding.kind === "crypto" ||
          holding.kind === "commodity") &&
        holding.composition &&
        holding.composition.length > 0 ? (
          <ReadOnlyField
            label="Expected real CAGR"
            value={`${formatPercent(holding.expectedRealCAGR)}`}
            help="Auto-derived from your composition legs (exposure-weighted blend). Edit a leg's CAGR below to change this."
          />
        ) : (
          <FieldNumber
            label="Expected real CAGR"
            suffix="%"
            step={0.5}
            min={-10}
            max={50}
            value={+(holding.expectedRealCAGR * 100).toFixed(2)}
            onChange={(v) => setHoldingCAGR(holding.id, v / 100)}
            help={`${formatPercent(holding.expectedRealCAGR)} per year, inflation-adjusted`}
          />
        )}

        {(holding.kind === "equity" ||
          holding.kind === "bond" ||
          holding.kind === "real_estate" ||
          holding.kind === "private_stock") &&
          (() => {
            const leverageValue = holding.leverage ?? 1;
            // For bonds we auto-derive leverage from duration unless
            // the user (or a leveraged preset like TMF) overrode it.
            // Existing holdings predating this feature default to
            // manual (preserves their leverage on duration edits).
            const isBond = holding.kind === "bond";
            const bondIsAuto =
              isBond && !(holding.bondLeverageIsManual ?? true);
            const derived = isBond
              ? bondLeverageFromDuration(holding.averageDurationYears)
              : null;
            const label =
              holding.kind === "real_estate"
                ? "Leverage (mortgage)"
                : "Leverage";
            const help =
              holding.kind === "real_estate"
                ? `Property moves with ${formatLeverage(leverageValue)} of your equity. E.g. 5× = $100K equity in a $500K home.`
                : holding.kind === "private_stock"
                  ? `Default 1× — owned outright. Bump up if you levered the acquisition (e.g. margin-funded exercise).`
                  : isBond
                    ? bondIsAuto
                      ? `Auto-derived from duration (${holding.averageDurationYears.toFixed(1)}y → ${formatLeverage(derived ?? 0)}). Edit to override.`
                      : `Manual override. ${derived != null ? `Auto would suggest ${formatLeverage(derived)} for ${holding.averageDurationYears.toFixed(1)}y duration.` : ""}`
                    : `Effective exposure = position × ${formatLeverage(leverageValue)}`;
            return (
              <>
                <FieldNumber
                  label={label}
                  suffix="x"
                  step={holding.kind === "real_estate" ? 0.1 : 0.25}
                  min={
                    holding.kind === "real_estate" ||
                    holding.kind === "private_stock"
                      ? 1
                      : isBond
                        ? 0
                        : 0.25
                  }
                  max={10}
                  value={leverageValue}
                  onChange={(v) => setHoldingLeverage(holding.id, v)}
                  help={help}
                  rightSlot={
                    isBond ? (
                      bondIsAuto ? (
                        <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                          Auto
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            resetBondLeverageToAuto(holding.id)
                          }
                          className="rounded-full border border-border-strong bg-bg-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted active:opacity-70 hover:text-text"
                        >
                          Reset to auto
                        </button>
                      )
                    ) : null
                  }
                />
                {holding.kind === "real_estate" && leverageValue > 1.01 && (
                  <MortgageLeverageNote />
                )}
                {(holding.kind === "equity" || holding.kind === "bond") &&
                  leverageValue > 1.01 && <DailyResetLeverageNote />}
              </>
            );
          })()}
        {holding.kind !== "cash" && (
          <DateField
            label="Acquired on"
            value={holding.acquiredAt}
            onChange={(t) => setHoldingAcquiredAt(holding.id, t)}
            help={
              holding.acquiredAt
                ? "Historical reconstruction excludes this holding before this date."
                : "Optional. Set to backdate when you opened the position."
            }
          />
        )}
        {holding.kind === "real_estate" && (
          <PrimaryResidenceToggle holdingId={holding.id} value={holding.isPrimaryResidence === true} />
        )}
        {(holding.kind === "equity" ||
          holding.kind === "bond" ||
          holding.kind === "cash" ||
          holding.kind === "crypto" ||
          holding.kind === "commodity" ||
          holding.kind === "other") && (
          <IlliquidToggle
            holdingId={holding.id}
            value={holding.isIlliquid === true}
          />
        )}
        {/* Non-primary real estate can also be flagged illiquid — useful
            for rentals tied up with tenants, raw land held for sale,
            or properties in a partnership. Primary residence already
            implies illiquid via its dedicated toggle above. */}
        {holding.kind === "real_estate" && !holding.isPrimaryResidence && (
          <IlliquidToggle
            holdingId={holding.id}
            value={holding.isIlliquid === true}
          />
        )}
        {/* Cash-bucket auto-sale opt-out. Available on every kind
            except private_stock (which is already excluded
            structurally via isLiquid) and primary residence
            (also structurally excluded). Cash itself is included
            for symmetry though selling cash for cash is a no-op
            in the engine. */}
        {(holding.kind === "equity" ||
          holding.kind === "bond" ||
          holding.kind === "cash" ||
          holding.kind === "crypto" ||
          holding.kind === "commodity" ||
          holding.kind === "other" ||
          (holding.kind === "real_estate" && !holding.isPrimaryResidence)) && (
          <ExcludeFromCashBucketSaleToggle
            holdingId={holding.id}
            value={holding.excludeFromCashBucketSale === true}
          />
        )}
        {holding.kind === "private_stock" && (
          <div className="rounded-xl border border-border bg-bg-elevated px-4 py-3 text-[11px] text-text-dim">
            Private company stock is always treated as illiquid (excluded
            from the home-page Liquid view).
          </div>
        )}
        {holding.kind === "bond" && (
          <FieldNumber
            label="Average duration"
            suffix="yrs"
            step={0.5}
            min={0}
            max={30}
            value={+holding.averageDurationYears.toFixed(1)}
            onChange={(v) => setHoldingDuration(holding.id, v)}
            help={(() => {
              const sensitivity =
                holding.averageDurationYears < 3
                  ? "Short-term bonds — low rate sensitivity"
                  : holding.averageDurationYears < 10
                    ? "Intermediate — moderate rate sensitivity"
                    : "Long-term — high rate sensitivity";
              const auto = !(holding.bondLeverageIsManual ?? true);
              return auto
                ? `${sensitivity}. Leverage will follow (${formatLeverage(bondLeverageFromDuration(holding.averageDurationYears))}).`
                : sensitivity;
            })()}
          />
        )}
      </div>

      {holding.kind === "equity" && (
        <>
          <SectionHeader
            title="Multi-asset composition"
            subtitle="For funds like NTSX (90/60 stocks/bonds) or GDE (90/60 stocks/gold) — a single ticker with exposure to several asset classes. Leg weights can sum to more than 100% (intrinsic leverage)."
          />
          <CompositionEditor holding={holding} />
          <SectionHeader
            title="Style box"
            subtitle="Allocate this holding across the 9 size × style cells"
          />
          <StyleBoxEditor
            allocation={holding.styleBox}
            onChange={(next) => setHoldingStyleBox(holding.id, next)}
          />
        </>
      )}
      {holding.kind === "bond" && (
        <>
          <SectionHeader
            title="Type"
            subtitle="Government vs Corporate (sums to 100%)"
          />
          <BondTypeEditor
            allocation={holding.bondType}
            onChange={(next) => setHoldingBondType(holding.id, next)}
          />
        </>
      )}

      {(holding.kind === "equity" ||
        holding.kind === "bond" ||
        holding.kind === "cash") && (
        <>
          <SectionHeader
            title="Geography"
            subtitle="US / Developed Intl / Emerging Intl (sums to 100%)"
          />
          <GeographyEditor
            allocation={holding.geography}
            onChange={(next) => setHoldingGeography(holding.id, next)}
          />
        </>
      )}

      {/* Composition editor for bond, crypto, commodity wrappers.
          Equity wrappers' composition is rendered inline above with
          their style box. The others go here at the bottom so the
          class-specific metadata (bond duration, etc.) is set first. */}
      {(holding.kind === "bond" ||
        holding.kind === "crypto" ||
        holding.kind === "commodity") && (
          <>
            <SectionHeader
              title="Multi-asset composition"
              subtitle={
                holding.kind === "bond"
                  ? "Use for TIPS-anchored multi-asset wrappers — e.g. an 85% TIPS / 10% bitcoin / 7.5% gold / 7.5% silver fund. Legs can sum to more than 100% (intrinsic leverage)."
                  : holding.kind === "crypto"
                    ? "Use for crypto-dominant wrappers that overlay other exposure. Most spot crypto ETFs (IBIT, FBTC) are pure crypto and don't need this."
                    : "Use for commodity wrappers that overlay other exposure. A pure gold position (GLD, jewelry) doesn't need this."
              }
            />
            <CompositionEditor holding={holding} />
          </>
        )}
      {/* Commodity sub-classification: Metals (gold, silver, copper,
          aluminum, lead, …) vs Energy / Agriculture (crude oil, natural
          gas, wheat, corn, …). Pre-populated from preset when known
          (GLD = 100% gold; DBC = the actual broad mix). */}
      {holding.kind === "commodity" && (
        <>
          <SectionHeader
            title="Commodity breakdown"
            subtitle="Metals (precious + base) vs Energy / Agriculture, then per-contract weights within each tier."
          />
          <CommodityBreakdownEditor holding={holding} />
        </>
      )}

      <div className="mt-6 rounded-xl border border-negative/30 bg-negative/5 p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-negative">
          Danger zone
        </div>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-2 w-full rounded-md border border-negative/40 bg-bg-surface px-3 py-2 text-sm font-medium text-negative active:opacity-70"
          >
            Delete holding
          </button>
        ) : (
          <div>
            <div className="mt-2 text-sm text-text">
              Delete <span className="font-semibold">{symbol}</span> ({formatUSD(holding.valueUSD)})?
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-muted active:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  removeHolding(holding.id);
                  onClose();
                }}
                className="flex-1 rounded-md bg-negative px-3 py-2 text-sm font-semibold text-bg active:opacity-80"
              >
                Delete forever
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

