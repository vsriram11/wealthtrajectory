/**
 * UI-related type aliases used across the AppStore. Kept in a
 * leaf module to avoid pulling the entire store into every
 * consumer that only wants the type ("which class tab is
 * currently active?").
 */

// ViewBasis lives in lib/portfolio.ts (it's used by portfolio
// math too); re-exported here so UI consumers can import all
// their UI types from one place.
export type { ViewBasis } from "@/lib/portfolio/portfolio";

export type PageId =
  | "home"
  | "accounts"
  | "allocation"
  | "projections"
  | "plan"
  | "data";

export type AllocClassTab =
  | "ALL"
  | "equity"
  | "bond"
  | "cash"
  | "crypto"
  | "commodity"
  | "real_estate"
  | "private_stock"
  | "other";

export type AllocGeoScope = "ALL" | "US" | "DEVELOPED" | "EMERGING";
