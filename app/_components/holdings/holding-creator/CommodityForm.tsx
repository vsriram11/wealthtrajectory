"use client";

import { useState } from "react";
import { getPreset } from "@/lib/portfolio/presets";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { Field } from "./fields";
import { SubmitButton } from "./SubmitButton";

const DEFAULT_COMMODITY_REAL_CAGR_PCT = 1;

type Mode = "ticker" | "custom";

/**
 * Commodity entry with a two-mode toggle:
 *   - Ticker: GLD / IAU / DBC — looks up the preset registry,
 *     enables live pricing where available.
 *   - Custom: "Gold jewelry" / "Bars in safe" — manual entry,
 *     no live quote attempted. Optionally flagged as illiquid.
 */
export function CommodityForm({
  onCreate,
}: {
  onCreate: (input: HoldingCreateInput) => void;
}) {
  const [mode, setMode] = useState<Mode>("ticker");
  const [symbol, setSymbol] = useState("");
  const [value, setValue] = useState(0);
  const [cagrPct, setCagrPct] = useState(DEFAULT_COMMODITY_REAL_CAGR_PCT);
  const [isIlliquid, setIsIlliquid] = useState(false);

  const symbolValid = symbol.trim().length > 0;
  const preset =
    mode === "ticker" && symbolValid ? getPreset(symbol.trim()) : null;
  const presetIsCommodity = preset?.assetClass === "commodity";

  const canSave = symbolValid && value > 0;

  const submit = () => {
    if (!canSave) return;
    const trimmed = symbol.trim();
    onCreate({
      kind: "commodity",
      symbol: mode === "custom" ? trimmed : trimmed.toUpperCase(),
      valueUSD: value,
      isCustom: mode === "custom",
      isIlliquid,
      expectedRealCAGR: cagrPct / 100,
    });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-elevated p-0.5">
        {(["ticker", "custom"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:opacity-70 ${
              mode === m
                ? "bg-accent/15 text-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {m === "ticker" ? "Ticker (GLD, IAU…)" : "Custom (jewelry, bars…)"}
          </button>
        ))}
      </div>

      <Field label={mode === "ticker" ? "Ticker" : "Name"}>
        <input
          type="text"
          value={symbol}
          onChange={(e) =>
            setSymbol(mode === "ticker" ? e.target.value.toUpperCase() : e.target.value)
          }
          placeholder={
            mode === "ticker"
              ? "GLD, IAU, GLDM, SLV, DBC, USO…"
              : "e.g. Gold jewelry, vault silver"
          }
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        {mode === "ticker" &&
          symbolValid &&
          (presetIsCommodity ? (
            <div className="mt-1.5 text-[11px] text-positive">
              ✓ {preset!.name} — live-priced
            </div>
          ) : (
            <div className="mt-1.5 text-[11px] text-text-dim">
              Not in our registry — will store as manual entry.
            </div>
          ))}
        {mode === "custom" && symbolValid && (
          <div className="mt-1.5 text-[11px] text-text-dim">
            Manual entry — no live pricing. Update the value
            yourself periodically.
          </div>
        )}
      </Field>

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
        <div className="mt-1.5 text-[11px] text-text-dim">
          Long-run real return baselines: gold ≈ 1%, broad
          commodities ≈ 0%, oil ≈ 0%.
        </div>
      </Field>

      {mode === "custom" && (
        <label className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={isIlliquid}
            onChange={(e) => setIsIlliquid(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-text">Mark as illiquid</span>
          <span className="text-[11px] text-text-dim">
            (jewelry, collectibles — won&apos;t fund retirement spend)
          </span>
        </label>
      )}

      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
