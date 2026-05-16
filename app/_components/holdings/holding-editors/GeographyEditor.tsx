"use client";

import {
  GEOGRAPHIES,
  GEOGRAPHY_LABELS,
  type GeographyAllocation,
} from "@/lib/types";
import { NormalizedSliderGroup } from "./NormalizedSliderGroup";

const GEOGRAPHY_ENTRIES = GEOGRAPHIES.map((key) => ({
  key,
  label: GEOGRAPHY_LABELS[key],
}));

/** US / Developed Intl / Emerging Intl. */
export function GeographyEditor({
  allocation,
  onChange,
}: {
  allocation: GeographyAllocation;
  onChange: (next: GeographyAllocation) => void;
}) {
  return (
    <NormalizedSliderGroup
      entries={GEOGRAPHY_ENTRIES}
      allocation={allocation}
      onChange={onChange}
    />
  );
}
