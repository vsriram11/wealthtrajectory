"use client";

import { useState } from "react";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { DollarInput, Field } from "./fields";
import { SubmitButton } from "./SubmitButton";

const DEFAULT_CASH_REAL_CAGR_PCT = 0.5;

/**
 * Cash holding entry. Two fields: balance + expected real-CAGR.
 * Real-CAGR for cash is roughly the HYSA nominal yield minus CPI;
 * we surface it as a percent so the user can tweak based on
 * their actual account (high-yield savings vs checking).
 */
export function CashForm({ onCreate }: { onCreate: (input: HoldingCreateInput) => void }) {
  const [value, setValue] = useState(0);
  const [cagrPct, setCagrPct] = useState(DEFAULT_CASH_REAL_CAGR_PCT);

  const canSave = value > 0;
  const submit = () => {
    if (!canSave) return;
    onCreate({ kind: "cash", valueUSD: value, expectedRealCAGR: cagrPct / 100 });
  };

  return (
    <div className="mt-4 space-y-3">
      <Field label="Value">
        <DollarInput value={value} onChange={setValue} />
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
      </Field>
      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
