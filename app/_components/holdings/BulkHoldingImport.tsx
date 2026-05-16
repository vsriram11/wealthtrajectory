"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { getPreset } from "@/lib/portfolio/presets";

/**
 * Bulk-add holdings to an account by pasting one ticker per line.
 *
 * Accepted formats (whitespace, comma, or tab delimited):
 *   SYMBOL SHARES                e.g. "VOO 100"
 *   SYMBOL SHARES PRICE          e.g. "VOO 100 540.50"
 *   SYMBOL=$VALUE                e.g. "VOO=$54000" (interpreted as a
 *                                 dollar value at preset / live price)
 *
 * Lines starting with # are treated as comments. Empty lines are
 * skipped. Unknown symbols still create a holding but flagged as
 * "needs price" — the user can refine in the editor.
 */
export function BulkHoldingImport() {
  const accounts = useAppStore((s) => s.household.accounts);
  const createHolding = useAppStore((s) => s.createHolding);
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
  } | null>(null);

  const parsed = useMemo(() => parseBulk(paste), [paste]);

  if (accounts.length === 0) return null;

  const handleImport = async () => {
    if (!accountId || parsed.rows.length === 0) return;
    setBusy(true);
    setResult(null);
    let added = 0;
    let skipped = 0;
    for (const row of parsed.rows) {
      try {
        if (row.kind === "shares") {
          createHolding(accountId, {
            kind: "equity",
            symbol: row.symbol,
            shares: row.shares,
          });
        } else {
          createHolding(accountId, {
            kind: "equity",
            symbol: row.symbol,
            valueUSD: row.valueUSD,
          });
        }
        added++;
      } catch {
        skipped++;
      }
    }
    setBusy(false);
    setResult({ added, skipped });
    if (skipped === 0) {
      // Auto-close on full success after a brief confirmation.
      setTimeout(() => {
        setOpen(false);
        setPaste("");
        setResult(null);
      }, 1200);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border-strong bg-bg-elevated px-2.5 py-1.5 text-[11px] font-medium text-text-muted active:opacity-70"
        aria-label="Bulk add holdings"
      >
        Bulk add
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-border-strong bg-bg-surface pb-10 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md sm:rounded-3xl sm:border">
            <div className="px-5 pt-3">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-text-dim">
                    Bulk add holdings
                  </div>
                  <div className="text-xl font-semibold text-text">
                    Paste a list
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-border-strong bg-bg-elevated px-3 py-1.5 text-xs text-text-muted active:opacity-70"
                >
                  Cancel
                </button>
              </div>

              <label className="mt-4 block">
                <div className="mb-1 px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
                  Account
                </div>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-text outline-none focus:border-accent"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-3 block">
                <div className="mb-1 px-0.5 text-[11px] uppercase tracking-wider text-text-dim">
                  Holdings
                </div>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={8}
                  placeholder={`VOO 100\nBND 50\nAAPL 25\n# comments are ignored\nTQQQ=$5000`}
                  className="w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 font-mono text-[12px] text-text outline-none placeholder:text-text-dim focus:border-accent"
                />
                <div className="mt-1 text-[10px] text-text-dim">
                  One per line. <span className="font-mono">SYMBOL SHARES</span>{" "}
                  or <span className="font-mono">SYMBOL=$VALUE</span>.
                </div>
              </label>

              {parsed.rows.length > 0 && (
                <div className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-text-dim">
                    Preview · {parsed.rows.length} rows
                  </div>
                  <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-[11px]">
                    {parsed.rows.map((r, i) => {
                      const preset = getPreset(r.symbol);
                      return (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="num font-medium text-text">
                            {r.symbol}
                          </span>
                          <span className="text-text-muted">
                            {r.kind === "shares"
                              ? `${r.shares} sh`
                              : `$${r.valueUSD.toLocaleString()}`}
                          </span>
                          <span
                            className={
                              preset ? "text-positive" : "text-text-dim"
                            }
                          >
                            {preset ? "✓ known" : "manual"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {parsed.errors.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-[11px] text-amber-300">
                  {parsed.errors.length} unparseable line
                  {parsed.errors.length === 1 ? "" : "s"} skipped
                </div>
              )}

              {result && (
                <div className="mt-2 rounded-md border border-positive/30 bg-positive/5 px-3 py-2 text-[11px] text-positive">
                  Added {result.added}
                  {result.skipped > 0 ? ` · skipped ${result.skipped}` : ""}
                </div>
              )}

              <button
                type="button"
                onClick={handleImport}
                disabled={busy || parsed.rows.length === 0 || !accountId}
                className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
              >
                {busy ? "Adding…" : `Add ${parsed.rows.length} holding${parsed.rows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type ParsedRow =
  | { kind: "shares"; symbol: string; shares: number }
  | { kind: "value"; symbol: string; valueUSD: number };

function parseBulk(text: string): { rows: ParsedRow[]; errors: string[] } {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // "SYMBOL=$VALUE" → dollar value entry
    const eq = line.match(/^([A-Z0-9.\-^]+)\s*=\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/i);
    if (eq) {
      const valueUSD = parseFloat(eq[2].replace(/,/g, ""));
      if (Number.isFinite(valueUSD) && valueUSD > 0) {
        rows.push({
          kind: "value",
          symbol: eq[1].toUpperCase(),
          valueUSD,
        });
        continue;
      }
    }
    // "SYMBOL SHARES" or "SYMBOL,SHARES" or "SYMBOL\tSHARES"
    const parts = line.split(/[\s,\t]+/).filter(Boolean);
    if (parts.length < 2) {
      errors.push(line);
      continue;
    }
    const symbol = parts[0].toUpperCase();
    const shares = parseFloat(parts[1].replace(/,/g, ""));
    if (!/^[A-Z0-9.\-^]+$/.test(symbol) || !Number.isFinite(shares) || shares <= 0) {
      errors.push(line);
      continue;
    }
    rows.push({ kind: "shares", symbol, shares });
  }
  return { rows, errors };
}
