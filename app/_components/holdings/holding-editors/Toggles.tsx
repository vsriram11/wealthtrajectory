"use client";

/**
 * Holding-level boolean flags. Each toggle wires a single store
 * action to a {@link LabeledToggle} primitive.
 *
 * Both flags affect the same downstream computation — whether a
 * holding is included in the "Liquid" net-worth and Independence
 * projection. Primary residence is the common, opinionated case
 * (a house you live in); illiquid is the catch-all for any other
 * asset you wouldn't realistically tap for retirement spending
 * (private equity stake, restricted RSUs, art).
 */

import { useAppStore } from "@/lib/store";
import { LabeledToggle } from "./fields";

export function PrimaryResidenceToggle({
  holdingId,
  value,
}: {
  holdingId: string;
  value: boolean;
}) {
  const setFlag = useAppStore((s) => s.setHoldingIsPrimaryResidence);
  return (
    <LabeledToggle
      title="Primary residence"
      description={
        <>
          When on, this property is treated as illiquid — excluded
          from the home-page net-worth + Independence projection
          when the view is set to &ldquo;Liquid&rdquo;.
        </>
      }
      checked={value}
      onChange={(next) => setFlag(holdingId, next)}
      ariaLabel="Primary residence"
    />
  );
}

export function IlliquidToggle({
  holdingId,
  value,
}: {
  holdingId: string;
  value: boolean;
}) {
  const setFlag = useAppStore((s) => s.setHoldingIsIlliquid);
  return (
    <LabeledToggle
      title="Treat as illiquid"
      description={
        <>
          Use for assets you wouldn&apos;t realistically tap for retirement
          spending — e.g. a stake in a friend&apos;s startup, restricted
          RSUs, art, or collectibles. Excluded from the home-page net
          worth + Independence projection when the view is set to
          &ldquo;Liquid&rdquo;.
        </>
      }
      checked={value}
      onChange={(next) => setFlag(holdingId, next)}
      ariaLabel="Treat as illiquid"
    />
  );
}

/**
 * Per-holding opt-out for the MC stress-test's cash-bucket auto-sale.
 *
 * When the user enables the "Cash-bucket priority" toggle on the
 * Historical MC card AND requests a bucket larger than their
 * projected cash share, the simulator models the cost of raising
 * that cash: it sells highest-leverage holdings first, applies
 * capital-gains tax to the taxable-account portion, and deducts the
 * tax from the simulator's starting NW.
 *
 * Flipping this toggle ON for a holding tells that auto-sale path:
 * "preserve this — don't sell it." Useful for high-conviction
 * positions, employer-share concentration plays the user can't
 * unwind, or tax-loss-carryforward setups that depend on holding
 * a specific lot through retirement.
 *
 * This flag is DISTINCT from `isIlliquid`:
 *   - `isIlliquid`: structural exclusion from liquid net-worth + the
 *     deterministic Independence projection (affects EVERY view).
 *   - `excludeFromCashBucketSale`: opt-out from the MC cash-bucket
 *     auto-sale specifically — the holding still counts toward your
 *     liquid net-worth, just doesn't get auto-sold by the bucket
 *     policy.
 */
export function ExcludeFromCashBucketSaleToggle({
  holdingId,
  value,
}: {
  holdingId: string;
  value: boolean;
}) {
  const setFlag = useAppStore(
    (s) => s.setHoldingExcludeFromCashBucketSale,
  );
  return (
    <LabeledToggle
      title="Don't sell for cash-bucket funding"
      description={
        <>
          When the MC stress test&apos;s &ldquo;Cash-bucket priority&rdquo;
          toggle is on AND you&apos;ve sized the bucket above your
          projected cash share, the simulator auto-sells highest-
          leverage holdings to raise the difference. Flip this on to
          keep THIS holding off the chopping block (e.g. high-conviction
          positions, employer-share plays you can&apos;t unwind, lots
          you&apos;re holding for cap-gains-management reasons).
          Doesn&apos;t affect your liquid net worth or the
          deterministic Independence projection.
        </>
      }
      checked={value}
      onChange={(next) => setFlag(holdingId, next)}
      ariaLabel="Don't sell for cash-bucket funding"
    />
  );
}
