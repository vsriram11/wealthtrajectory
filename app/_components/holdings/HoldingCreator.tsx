"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { HOLDING_KINDS, pluralLabel } from "@/lib/portfolio/holdingKinds";
import type { HoldingCreateInput } from "@/lib/portfolio/holdingFactory";
import type { AssetClass } from "@/lib/types";
import { KindBtn } from "./holding-creator/fields";
import { CashForm } from "./holding-creator/CashForm";
import { CommodityForm } from "./holding-creator/CommodityForm";
import { CryptoForm } from "./holding-creator/CryptoForm";
import { OtherForm } from "./holding-creator/OtherForm";
import { PrivateStockForm } from "./holding-creator/PrivateStockForm";
import { RealEstateForm } from "./holding-creator/RealEstateForm";
import { TickerForm } from "./holding-creator/TickerForm";

// Re-export of the leverage notes so existing call sites in
// HoldingEditor continue to resolve. Internal callers (the forms
// in `./holding-creator/`) import these directly from
// `./holding-creator/LeverageNotes`.
export {
  DailyResetLeverageNote,
  MortgageLeverageNote,
} from "./holding-creator/LeverageNotes";

/**
 * Modal entry-point for adding a holding to an account.
 *
 * Responsibilities are deliberately thin:
 *   1. Resolve the target account from the store (id is set when
 *      the user taps "+ Add holding" on an account row).
 *   2. Render the modal chrome (overlay + sheet + cancel button).
 *   3. Render the asset-class tab row.
 *   4. Hand off to the active per-kind form, which owns its own
 *      state and validation. The forms call `onCreate(input)` and
 *      `onClose()`; this component wires those to the store.
 *
 * Per-kind state used to live in this component (19 useState calls
 * + a 25-line useEffect that reset them all on every account
 * change). Moving that state into the relevant per-kind form makes
 * each form self-contained and side-effect-free at the parent level.
 */
export function HoldingCreator() {
  const accountId = useAppStore((s) => s.creatingHoldingForAccountId);
  const close = useAppStore((s) => s.closeHoldingCreator);
  const create = useAppStore((s) => s.createHolding);
  const accounts = useAppStore((s) => s.household.accounts);

  const account = useMemo(
    () => (accountId ? accounts.find((a) => a.id === accountId) ?? null : null),
    [accountId, accounts],
  );

  const [kind, setKind] = useState<AssetClass>("equity");

  // Reset to the default tab whenever the modal opens for a new
  // account. In-render state adjustment — when accountId transitions
  // from null → set, snap `kind` back to "equity". The per-kind
  // forms are themselves remounted on `kind` change via the key
  // prop, so their internal state resets too.
  const [prevAccountId, setPrevAccountId] = useState(accountId);
  if (accountId !== prevAccountId) {
    setPrevAccountId(accountId);
    if (accountId) setKind("equity");
  }

  // Escape closes the modal.
  useEffect(() => {
    if (!accountId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accountId, close]);

  if (!accountId || !account) return null;

  const handleCreate = (input: HoldingCreateInput) => {
    create(account.id, input);
    // store.createHolding already clears creatingHoldingForAccountId.
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Decorative backdrop — no click-to-close to prevent
          accidental data loss on in-progress edits. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
        <div className="px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-dim">
                Add holding
              </div>
              <div className="text-xl font-semibold text-text">
                {account.displayName}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1 px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
              Asset class
            </div>
            <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-border bg-bg-elevated p-0.5">
              {HOLDING_KINDS.map((k) => (
                <KindBtn
                  key={k}
                  active={kind === k}
                  onClick={() => setKind(k)}
                  label={pluralLabel(k)}
                />
              ))}
            </div>
          </div>

          {/* The `key={kind}` remounts the form when the user
              switches tabs, so half-typed state from one kind
              doesn't leak into the next. */}
          <ActiveForm key={kind} kind={kind} onCreate={handleCreate} />
        </div>
      </div>
    </div>
  );
}

/** Dispatch to the appropriate per-kind form based on the active tab. */
function ActiveForm({
  kind,
  onCreate,
}: {
  kind: AssetClass;
  onCreate: (input: HoldingCreateInput) => void;
}) {
  switch (kind) {
    case "cash":
      return <CashForm onCreate={onCreate} />;
    case "equity":
    case "bond":
      return <TickerForm kind={kind} onCreate={onCreate} />;
    case "crypto":
      return <CryptoForm onCreate={onCreate} />;
    case "commodity":
      return <CommodityForm onCreate={onCreate} />;
    case "real_estate":
      return <RealEstateForm onCreate={onCreate} />;
    case "private_stock":
      return <PrivateStockForm onCreate={onCreate} />;
    case "other":
      return <OtherForm onCreate={onCreate} />;
  }
}
