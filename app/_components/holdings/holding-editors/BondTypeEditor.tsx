"use client";

import {
  BOND_TYPES,
  BOND_TYPE_LABELS,
  type BondTypeAllocation,
} from "@/lib/types";
import { NormalizedSliderGroup } from "./NormalizedSliderGroup";

const BOND_TYPE_ENTRIES = BOND_TYPES.map((key) => ({
  key,
  label: BOND_TYPE_LABELS[key],
}));

/** Government vs Corporate (plus any future bond-type categories). */
export function BondTypeEditor({
  allocation,
  onChange,
}: {
  allocation: BondTypeAllocation;
  onChange: (next: BondTypeAllocation) => void;
}) {
  return (
    <NormalizedSliderGroup
      entries={BOND_TYPE_ENTRIES}
      allocation={allocation}
      onChange={onChange}
    />
  );
}
