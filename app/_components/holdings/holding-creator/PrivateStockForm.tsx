"use client";

import { useState } from "react";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import { NumberField } from "@/app/_components/ui/NumberField";
import { Field } from "./fields";
import { SubmitButton } from "./SubmitButton";

/**
 * Private-company stock entry. Five fields: company, shares, 409A
 * FMV, optional preferred-round price, expected real-CAGR.
 *
 * The 409A vs preferred-round distinction is the most important UX
 * affordance here — common shares trade at 20-40% of preferred,
 * and entering preferred as the FMV silently overstates net worth
 * by several multiples. A prominent amber callout under the FMV
 * field flags this.
 */
export function PrivateStockForm({
  onCreate,
}: {
  onCreate: (input: HoldingCreateInput) => void;
}) {
  const [company, setCompany] = useState("");
  const [shares, setShares] = useState(0);
  const [fmv, setFmv] = useState(0);
  const [preferred, setPreferred] = useState(0);
  const [cagrPct, setCagrPct] = useState(0);

  const canSave = company.trim().length > 0 && shares > 0 && fmv > 0;
  const submit = () => {
    if (!canSave) return;
    onCreate({
      kind: "private_stock",
      company: company.trim(),
      shares,
      fmvPricePerShareUSD: fmv,
      preferredRoundPricePerShareUSD: preferred > 0 ? preferred : null,
      expectedRealCAGR: cagrPct / 100,
    });
  };

  const positionValueUSD = shares > 0 && fmv > 0 ? shares * fmv : null;

  return (
    <div className="mt-4 space-y-3">
      <Field label="Company">
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="e.g. Acme Inc."
          className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
      </Field>
      <Field label="Shares granted / exercised">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <NumberField
            value={shares}
            onChange={setShares}
            precision={0}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
          <span className="text-sm text-text-muted">sh</span>
        </span>
      </Field>
      <Field label="409A fair-market-value per share">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={fmv}
            onChange={setFmv}
            precision={4}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
        <div className="mt-1.5 text-[11px] text-amber-300">
          ⚠ Use the 409A FMV, not the latest preferred-round price.
          Common shares are typically valued at 20–40% of the preferred —
          treating preferred as your share value will significantly
          overstate your net worth.
        </div>
        {positionValueUSD != null && (
          <div className="mt-1.5 text-[11px] text-text-dim">
            ≈ ${positionValueUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
        )}
      </Field>
      <Field label="Preferred-round price per share (optional)">
        <span className="flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2">
          <span className="text-sm text-text-muted">$</span>
          <NumberField
            value={preferred}
            onChange={setPreferred}
            precision={4}
            allowNegative={false}
            className="num w-full bg-transparent text-right text-sm font-medium text-text outline-none"
          />
        </span>
        <div className="mt-1.5 text-[11px] text-text-dim">
          Display-only. Captured for context so you can see the gap
          between the headline number and your actual share value.
        </div>
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
          Default 0% — private equity is binary (most go to zero). Be
          honest about your expected outcome.
        </div>
      </Field>
      <SubmitButton canSave={canSave} onClick={submit} />
    </div>
  );
}
