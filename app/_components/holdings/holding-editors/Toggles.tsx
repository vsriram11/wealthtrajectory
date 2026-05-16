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
