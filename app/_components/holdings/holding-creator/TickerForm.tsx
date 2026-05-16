"use client";

import { useEffect, useState } from "react";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { getPreset } from "@/lib/portfolio/presets";
import { getQuote, type Quote } from "@/lib/data/quotes";
import { NumberField } from "@/app/_components/ui/NumberField";
import { DollarInput, Field } from "./fields";
import { DailyResetLeverageNote } from "./LeverageNotes";
import { SubmitButton } from "./SubmitButton";

const QUOTE_LOOKUP_DEBOUNCE_MS = 400;

/**
 * Equity / bond entry. Three resolution paths driven by the
 * typed symbol:
 *
 *   1. Preset-registry match (e.g. "VOO", "BND", "TLT", "TMF") —
 *      copies the preset's leverage / style box / bond duration
 *      defaults; shares back-solved from valueUSD. Live tracking
 *      stays on (PriceRefresher picks it up after first paint).
 *
 *   2. Unknown ticker but `/api/quote` returns a real price —
 *      live tracking still on, but with Large Blend US / generic
 *      defaults the user can refine post-create.
 *
 *   3. Unknown ticker, no live quote — manual face-value entry;
 *      single dollar input; user can flesh out details later.
 *
 * Live-quote lookups debounce so a user typing "VTSAX" doesn't
 * trigger five separate API hits.
 */
export function TickerForm({
  kind,
  onCreate,
}: {
  kind: "equity" | "bond";
  onCreate: (input: HoldingCreateInput) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState(0);
  const [value, setValue] = useState(0);
  const [liveQuote, setLiveQuote] = useState<Quote | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  // Debounced live-quote lookup. Skips when the symbol is empty,
  // when a preset already matches, or when the user is typing.
  //
  // The setLiveQuote(null) early-returns are guard clauses for "no
  // remote lookup needed"; they reset stale state. setLookingUp(true)
  // is the canonical start-of-async-load flag. The React 19
  // alternative would be Suspense + `use()`, which doesn't fit a
  // debounced lookup on user input — the input would suspend on
  // every keystroke. Keep the effect-based pattern; the setStates
  // are gated by the `symbol` dep so they don't cascade unprompted.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setLiveQuote(null);
      return;
    }
    if (getPreset(sym)) {
      setLiveQuote(null);
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    const handle = setTimeout(async () => {
      const quote = await getQuote(sym);
      if (cancelled) return;
      setLiveQuote(quote && quote.currentPrice > 0 ? quote : null);
      setLookingUp(false);
    }, QUOTE_LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      setLookingUp(false);
    };
  }, [symbol]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const trimmedSymbol = symbol.trim();
  const symbolValid = trimmedSymbol.length > 0;
  const preset = trimmedSymbol ? getPreset(trimmedSymbol) : null;
  // Narrow the preset to one that matches the requested kind so
  // downstream accesses to `leverage` / `referencePriceUSD` are
  // type-safe (CommodityPreset has no `leverage` field, for example).
  const matchedPreset =
    preset && preset.assetClass === kind ? preset : null;
  const presetMismatch =
    preset && !matchedPreset ? preset : null; // preset exists but for a different class
  const recognized = matchedPreset != null || liveQuote != null;

  const referencePrice = matchedPreset
    ? matchedPreset.referencePriceUSD
    : liveQuote
      ? liveQuote.currentPrice
      : 0;

  const estimatedValue = recognized ? shares * referencePrice : 0;
  const canSave = symbolValid && (recognized ? shares > 0 : value > 0);

  // Surface the auto-leverage warning for daily-reset LETFs even
  // before save — same heuristic the holding view uses.
  const recognizedLeverage = matchedPreset ? matchedPreset.leverage : 1;
  const showDailyResetWarning = recognized && recognizedLeverage > 1.01;

  const submit = () => {
    if (!canSave) return;
    const sym = trimmedSymbol.toUpperCase();
    const livePriceArg =
      !matchedPreset && liveQuote ? liveQuote.currentPrice : undefined;
    const nameArg =
      !matchedPreset && liveQuote ? liveQuote.name ?? undefined : undefined;

    // Fork on `kind` so each call site emits a single concrete
    // variant of HoldingCreateInput (TS can't collapse a "equity"
    // | "bond" union back into the discriminated input type).
    if (recognized) {
      if (kind === "equity") {
        onCreate({ kind: "equity", symbol: sym, shares, livePrice: livePriceArg, name: nameArg });
      } else {
        onCreate({ kind: "bond", symbol: sym, shares, livePrice: livePriceArg, name: nameArg });
      }
      return;
    }
    if (kind === "equity") {
      onCreate({ kind: "equity", symbol: sym, valueUSD: value });
    } else {
      onCreate({ kind: "bond", symbol: sym, valueUSD: value });
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <Field label="Ticker">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder={kind === "equity" ? "e.g. VOO" : "e.g. BND"}
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        {symbolValid && (
          <div className="mt-1.5 text-[11px]">
            {matchedPreset ? (
              <span className="text-positive">
                ✓ {matchedPreset.name} — defaults pre-loaded
              </span>
            ) : presetMismatch ? (
              <span className="text-amber-300">
                {presetMismatch.name} is in our registry as a{" "}
                {presetMismatch.assetClass === "equity" ? "stock" : "bond"} —
                switch the asset class above or use a different ticker.
              </span>
            ) : lookingUp ? (
              <span className="text-text-dim">Looking up…</span>
            ) : liveQuote ? (
              <span className="text-positive">
                ✓ {liveQuote.name ?? liveQuote.symbol} — live ${
                  liveQuote.currentPrice.toFixed(2)
                }/share
              </span>
            ) : (
              <span className="text-text-dim">
                Unrecognized ticker — falling back to manual entry.
              </span>
            )}
          </div>
        )}
      </Field>

      {recognized ? (
        <Field label="Shares">
          <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
            <NumberField
              value={shares}
              onChange={setShares}
              precision={4}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
            <span className="text-sm text-text-muted">sh</span>
          </span>
          {shares > 0 && (
            <div className="mt-1.5 text-[11px] text-text-dim">
              ≈ ${estimatedValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} at $
              {referencePrice.toFixed(2)}/share
              {matchedPreset ? " (will refresh to live price)" : ""}
            </div>
          )}
        </Field>
      ) : (
        <Field label="Value">
          <DollarInput value={value} onChange={setValue} />
          {symbolValid && (
            <div className="mt-1.5 text-[11px] text-text-dim">
              Unknown ticker — entering total dollar value. You can
              change share count later in the holding editor.
            </div>
          )}
        </Field>
      )}

      {showDailyResetWarning && <DailyResetLeverageNote />}

      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
