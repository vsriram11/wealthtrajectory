"use client";

import { useState } from "react";
import { getPreset } from "@/lib/portfolio/presets";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { Field } from "./fields";
import { SubmitButton } from "./SubmitButton";

const DEFAULT_CRYPTO_REAL_CAGR_PCT = 8;

/**
 * Crypto entry. Two flow paths driven by the symbol:
 *
 *   - Live-priceable ETF preset (IBIT / FBTC / GBTC / ETHA / ETHE
 *     / BITX / BITO): mirrors the equity flow — single "Value"
 *     input, store back-solves shares against the reference price.
 *
 *   - Native crypto (BTC / ETH / USDC) or unrecognized symbol:
 *     Units + per-unit price form, manually priced.
 *
 * The form auto-switches based on what's typed; no manual mode
 * toggle needed.
 */
export function CryptoForm({
  onCreate,
}: {
  onCreate: (input: HoldingCreateInput) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [value, setValue] = useState(0);
  const [units, setUnits] = useState(0);
  const [pricePerUnit, setPricePerUnit] = useState(0);
  const [cagrPct, setCagrPct] = useState(DEFAULT_CRYPTO_REAL_CAGR_PCT);

  const symbolValid = symbol.trim().length > 0;
  const preset = symbolValid ? getPreset(symbol.trim().toUpperCase()) : null;
  const cryptoPreset = preset?.assetClass === "crypto" ? preset : null;
  const isLiveETF =
    cryptoPreset != null &&
    "livePriceable" in cryptoPreset &&
    cryptoPreset.livePriceable === true;

  const canSave = isLiveETF
    ? symbolValid && value > 0
    : symbolValid && units > 0 && pricePerUnit > 0;

  const submit = () => {
    if (!canSave) return;
    const sym = symbol.trim().toUpperCase();
    if (isLiveETF) {
      onCreate({
        kind: "crypto",
        symbol: sym,
        valueUSD: value,
        expectedRealCAGR: cagrPct / 100,
      });
      return;
    }
    onCreate({
      kind: "crypto",
      symbol: sym,
      shares: units,
      pricePerUnit,
      expectedRealCAGR: cagrPct / 100,
    });
  };

  const positionValueUSD = units > 0 && pricePerUnit > 0 ? units * pricePerUnit : null;

  return (
    <div className="mt-4 space-y-3">
      <Field label="Ticker">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="e.g. BTC, ETH, IBIT, FBTC, BITX"
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        {symbolValid && isLiveETF && cryptoPreset && (
          <div className="mt-1.5 text-[11px] text-positive">
            ✓ {cryptoPreset.name} — live-priced
            {cryptoPreset.leverage && cryptoPreset.leverage > 1
              ? ` · ${cryptoPreset.leverage}× leverage`
              : ""}
          </div>
        )}
        {symbolValid && cryptoPreset && !isLiveETF && (
          <div className="mt-1.5 text-[11px] text-positive">
            ✓ {cryptoPreset.name} — defaults pre-loaded
          </div>
        )}
        {symbolValid && !cryptoPreset && (
          <div className="mt-1.5 text-[11px] text-text-dim">
            Crypto positions are manually priced — enter units and
            the current per-unit price below.
          </div>
        )}
      </Field>

      {isLiveETF ? (
        <Field label="Value">
          <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
            <span className="text-sm text-text-muted">$</span>
            <NumberField
              value={value}
              onChange={setValue}
              precision={2}
              allowNegative={false}
              className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
            />
          </span>
        </Field>
      ) : (
        <>
          <Field label="Units">
            <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
              <NumberField
                value={units}
                onChange={setUnits}
                precision={6}
                allowNegative={false}
                className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
              />
              <span className="text-sm text-text-muted">units</span>
            </span>
          </Field>
          <Field label="Current price per unit">
            <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
              <span className="text-sm text-text-muted">$</span>
              <NumberField
                value={pricePerUnit}
                onChange={setPricePerUnit}
                precision={2}
                allowNegative={false}
                className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
              />
            </span>
            {positionValueUSD != null && (
              <div className="mt-1.5 text-[11px] text-text-dim">
                ≈ ${positionValueUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
            )}
          </Field>
        </>
      )}

      <Field label="Expected real CAGR (after inflation)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <NumberField
            value={cagrPct}
            onChange={setCagrPct}
            precision={2}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          <span className="text-sm text-text-muted">%</span>
        </span>
      </Field>

      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
