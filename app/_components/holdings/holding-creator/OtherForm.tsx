"use client";

import { useState } from "react";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { DollarInput, Field } from "./fields";
import { SubmitButton } from "./SubmitButton";

/**
 * Catch-all "Other" asset (watches, vehicles, art, an unclassified
 * business stake). Three fields: name, value, expected real-CAGR.
 * No leverage, no live-pricing — anything that needs those should
 * pick a more specific class.
 */
export function OtherForm({ onCreate }: { onCreate: (input: HoldingCreateInput) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState(0);
  const [cagrPct, setCagrPct] = useState(0);

  const canSave = name.trim().length > 0 && value > 0;
  const submit = () => {
    if (!canSave) return;
    onCreate({
      kind: "other",
      name: name.trim(),
      valueUSD: value,
      expectedRealCAGR: cagrPct / 100,
    });
  };

  return (
    <div className="mt-4 space-y-3">
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Watch collection, vehicle, art"
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
        <div className="mt-1.5 text-[11px] text-text-dim">
          Catch-all for assets that don&apos;t fit the other kinds —
          collectibles, jewelry, vehicles, an unclassified business
          stake, etc.
        </div>
      </Field>
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
        <div className="mt-1.5 text-[11px] text-text-dim">
          0% if the asset just holds value (e.g. a car depreciates,
          cash equivalents). Set positive if you expect it to
          appreciate in real terms.
        </div>
      </Field>
      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
