"use client";

import { useState } from "react";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { DollarInput, Field } from "./fields";
import { MortgageLeverageNote } from "./LeverageNotes";
import { SubmitButton } from "./SubmitButton";

const DEFAULT_RE_REAL_CAGR_PCT = 2;

/**
 * Real-estate entry. Net-equity model (user enters the equity
 * portion they actually own; the leverage field captures the
 * mortgage ratio). When leverage > 1× a {@link MortgageLeverageNote}
 * appears inline to reassure that mortgage leverage is structurally
 * safer than synthetic / LETF leverage at the same nominal ratio.
 */
export function RealEstateForm({ onCreate }: { onCreate: (input: HoldingCreateInput) => void }) {
  const [name, setName] = useState("");
  const [equityValue, setEquityValue] = useState(0);
  const [leverage, setLeverage] = useState(1);
  const [cagrPct, setCagrPct] = useState(DEFAULT_RE_REAL_CAGR_PCT);
  const [isPrimary, setIsPrimary] = useState(false);

  const canSave = name.trim().length > 0 && equityValue > 0;
  const submit = () => {
    if (!canSave) return;
    onCreate({
      kind: "real_estate",
      name: name.trim(),
      valueUSD: equityValue,
      expectedRealCAGR: cagrPct / 100,
      leverage: Math.max(1, leverage),
      isPrimaryResidence: isPrimary,
    });
  };

  return (
    <div className="mt-4 space-y-3">
      <Field label="Property name / address">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 123 Main St"
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
      </Field>
      <Field label="Current equity (net of mortgage)">
        <DollarInput value={equityValue} onChange={setEquityValue} />
        <div className="mt-1.5 text-[11px] text-text-dim">
          Enter the portion you actually own — property value minus
          outstanding mortgage balance. The leverage field below
          captures the gross/equity ratio so the app still knows
          your exposure. <strong>Don&apos;t also create a separate
          mortgage liability for this property</strong> — it would
          double-count, since your equity already nets the loan out.
        </div>
      </Field>
      <Field label="Inherent leverage (mortgage)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <NumberField
            value={leverage}
            onChange={setLeverage}
            precision={2}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          <span className="text-sm text-text-muted">×</span>
        </span>
        <div className="mt-1.5 text-[11px] text-text-dim">
          e.g. $100K equity in a $500K home → 5×. Owned outright → 1×.
        </div>
      </Field>
      {leverage > 1.01 && <MortgageLeverageNote />}
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
          This is your <strong>equity</strong> growth rate (the value
          field above). Historical US residential property is ≈ 1-2%
          real on the full property — at 5× leverage that&apos;s roughly
          5-10% real on your equity. Adjust here for your specific
          market and how much of the mortgage you expect to pay
          down over the projection horizon.
        </div>
      </Field>
      <label className="block rounded-md border border-border bg-bg-elevated px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text">
              This is my primary residence
            </div>
            <div className="mt-0.5 text-[11px] text-text-dim">
              Marks the property as illiquid — excluded from
              retirement-drawdown math when you toggle the home
              page to &ldquo;Liquid&rdquo;.
            </div>
          </div>
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-5 w-5 accent-accent"
            aria-label="Primary residence"
          />
        </div>
      </label>
      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
