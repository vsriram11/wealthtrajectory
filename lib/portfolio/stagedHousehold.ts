import { householdNetWorth, type Account, type Holding, type Household } from "@/lib/types";

/**
 * Pure helpers that produce a NEW Household value with the requested
 * staging-time mutation applied. Engine-purity contract: bad inputs
 * (NaN, negative pct, missing ids) are tolerated and degrade
 * gracefully — bad input contributes 0 / no-op, not NaN or throw.
 *
 * These power the SnapshotsManager "Stage past holdings" panel,
 * which mutates a LOCAL copy of the household (held in React state)
 * to record a historical snapshot with different composition than
 * today. None of these helpers touch the Zustand store, IndexedDB,
 * or Drive sync — by design.
 */

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;

/** Defensive deep-clone — staging operations must NOT mutate the caller's state. */
function cloneHousehold(h: Household): Household {
  return structuredClone(h);
}

/**
 * Scale every priced holding's value by `factor` (e.g. 0.77 to
 * approximate "values were 23% lower then"). For share-priced
 * holdings (equity, bond, commodity, crypto) we keep `shares`
 * constant and adjust `lastPriceUSD` + `valueUSD` together so the
 * shares-times-price invariant the rest of the engines depend on
 * stays intact. For non-priced holdings (cash, real_estate, other,
 * private_stock) we scale `valueUSD` directly.
 *
 * factor is clamped to [0, 100]. Non-finite → no-op.
 */
export function scaleHousehold(h: Household, factor: number): Household {
  const f = clamp(factor, 0, 100);
  if (f === 1) return cloneHousehold(h);
  const next = cloneHousehold(h);
  for (const account of next.accounts) {
    for (const holding of account.holdings) {
      const newValue = Math.max(0, holding.valueUSD * f);
      holding.valueUSD = newValue;
      if (
        holding.kind === "equity" ||
        holding.kind === "bond" ||
        holding.kind === "commodity" ||
        holding.kind === "crypto"
      ) {
        // Preserve shares; move the price. Avoids dropping shares
        // to zero on factor=0 (so toggling back works) AND keeps
        // the "I owned these shares at this stale price" record
        // legible in the snapshot payload.
        const oldPrice = holding.lastPriceUSD;
        if (Number.isFinite(oldPrice) && oldPrice > 0) {
          holding.lastPriceUSD = oldPrice * f;
        }
      }
    }
  }
  return next;
}

/**
 * Set a holding's monetary value directly. Used for manual per-row
 * overrides ("on this date, my house was worth $400k equity, not
 * the current $230k"). For share-priced kinds we recompute price
 * from `valueUSD / shares` so the invariant holds; if shares = 0
 * we set the price to 0 and accept the round-trip loss (rare in
 * practice — staging on zero-share holdings is meaningless).
 *
 * Non-finite or negative `valueUSD` → no-op (returns the input).
 */
export function setHoldingValue(
  h: Household,
  accountId: string,
  holdingId: string,
  valueUSD: number,
): Household {
  if (!Number.isFinite(valueUSD) || valueUSD < 0) return cloneHousehold(h);
  const next = cloneHousehold(h);
  for (const account of next.accounts) {
    if (account.id !== accountId) continue;
    for (const holding of account.holdings) {
      if (holding.id !== holdingId) continue;
      holding.valueUSD = valueUSD;
      if (
        holding.kind === "equity" ||
        holding.kind === "bond" ||
        holding.kind === "commodity" ||
        holding.kind === "crypto"
      ) {
        if (holding.shares > 0) {
          holding.lastPriceUSD = valueUSD / holding.shares;
        }
      }
      return next;
    }
  }
  return next;
}

/**
 * Drop a single holding from its account. The account stays.
 * Useful for "I didn't own crypto yet at this date".
 */
export function dropHolding(
  h: Household,
  accountId: string,
  holdingId: string,
): Household {
  const next = cloneHousehold(h);
  for (const account of next.accounts) {
    if (account.id !== accountId) continue;
    account.holdings = account.holdings.filter((x) => x.id !== holdingId);
    return next;
  }
  return next;
}

/**
 * Drop an entire account. Useful for "I hadn't opened the Roth IRA
 * yet" or "the rental property hadn't been bought".
 */
export function dropAccount(h: Household, accountId: string): Household {
  const next = cloneHousehold(h);
  next.accounts = next.accounts.filter((a) => a.id !== accountId);
  return next;
}

export type StagingDiff = {
  /** NW delta: staged - base (negative if user rewound). */
  deltaUSD: number;
  baseNetWorthUSD: number;
  stagedNetWorthUSD: number;
  /** Count of accounts present in base but not staged. */
  droppedAccounts: number;
  /** Count of holdings present in base but not staged (within still-present accounts). */
  droppedHoldings: number;
  /** Count of holdings whose valueUSD changed by ≥ $1. */
  modifiedHoldings: number;
  /** True if the staged household is byte-equal to the base (or zero ops applied). */
  unchanged: boolean;
};

function holdingIndex(h: Household): Map<string, Holding> {
  const m = new Map<string, Holding>();
  for (const a of h.accounts) {
    for (const x of a.holdings) {
      m.set(x.id, x);
    }
  }
  return m;
}

/**
 * Diff a staged household against the base. Produces the summary
 * the UI shows above the Commit button ("Dropped 2 holdings, NW
 * $1.2M (was $1.6M)").
 */
export function summarizeStagingDiff(
  base: Household,
  staged: Household,
): StagingDiff {
  const baseNW = householdNetWorth(base);
  const stagedNW = householdNetWorth(staged);
  const baseAccountIds = new Set(base.accounts.map((a) => a.id));
  const stagedAccountIds = new Set(staged.accounts.map((a) => a.id));
  const droppedAccounts = [...baseAccountIds].filter(
    (id) => !stagedAccountIds.has(id),
  ).length;
  const baseHoldings = holdingIndex(base);
  const stagedHoldings = holdingIndex(staged);
  let droppedHoldings = 0;
  let modifiedHoldings = 0;
  for (const [id, baseH] of baseHoldings) {
    const stagedH = stagedHoldings.get(id);
    if (!stagedH) {
      // Only count as a "dropped holding" when the parent ACCOUNT
      // is still present in staged — otherwise it rolls up into
      // droppedAccounts. Avoids double-counting.
      const acct = base.accounts.find((a) =>
        a.holdings.some((x) => x.id === id),
      );
      if (acct && stagedAccountIds.has(acct.id)) droppedHoldings++;
      continue;
    }
    if (Math.abs(baseH.valueUSD - stagedH.valueUSD) >= 1) modifiedHoldings++;
  }
  return {
    deltaUSD: stagedNW - baseNW,
    baseNetWorthUSD: baseNW,
    stagedNetWorthUSD: stagedNW,
    droppedAccounts,
    droppedHoldings,
    modifiedHoldings,
    unchanged:
      droppedAccounts === 0 &&
      droppedHoldings === 0 &&
      modifiedHoldings === 0,
  };
}

/** Lightweight account-level summary used to render the staging UI list. */
export function summarizeAccount(account: Account): {
  totalUSD: number;
  holdingsCount: number;
} {
  let total = 0;
  for (const h of account.holdings) total += h.valueUSD;
  return { totalUSD: total, holdingsCount: account.holdings.length };
}
