import {
  BOND_TYPES,
  EMPTY_BOND_TYPE,
  EMPTY_GEOGRAPHY,
  EMPTY_STYLE_BOX,
  GEOGRAPHIES,
  STYLE_BOX_CELLS,
  bondTypeOf,
  geographyOf,
  type BondTypeAllocation,
  type Geography,
  type GeographyAllocation,
  type Holding,
  type Household,
  type StyleBoxAllocation,
} from "@/lib/types";

export type ViewBasis = "face" | "exposure";
export type GeoScope = "ALL" | Geography;

export type ClassBreakdown = {
  equityUSD: number;
  bondUSD: number;
  cashUSD: number;
  cryptoUSD: number;
  commodityUSD: number;
  realEstateUSD: number;
  privateStockUSD: number;
  otherUSD: number;
  totalUSD: number;
  equityShare: number;
  bondShare: number;
  cashShare: number;
  cryptoShare: number;
  commodityShare: number;
  realEstateShare: number;
  privateStockShare: number;
  otherShare: number;
};

export type EquityMetrics = {
  totalUSD: number;
  effectiveExposureUSD: number;
  effectiveLeverage: number;
  styleBox: StyleBoxAllocation;
  styleBoxExposure: StyleBoxAllocation;
  geography: GeographyAllocation;
  geographyExposure: GeographyAllocation;
  styleBoxByGeo: Record<Geography, StyleBoxAllocation>;
  styleBoxByGeoExposure: Record<Geography, StyleBoxAllocation>;
};

export type BondMetrics = {
  totalUSD: number;
  effectiveExposureUSD: number;
  effectiveLeverage: number;
  bondType: BondTypeAllocation;
  bondTypeByGeo: Record<Geography, BondTypeAllocation>;
  geography: GeographyAllocation;
  weightedDurationYears: number;
};

export type CashMetrics = {
  totalUSD: number;
  weightedRealCAGR: number;
  geography: GeographyAllocation;
};

export type PortfolioMetrics = {
  netWorthUSD: number;
  weightedRealCAGR: number;
  effectiveLeverage: number;
  effectiveExposureUSD: number;
  classes: ClassBreakdown;
  equity: EquityMetrics;
  bond: BondMetrics;
  cash: CashMetrics;
  cryptoUSD: number;
  commodityUSD: number;
  realEstateUSD: number;
  privateStockUSD: number;
  otherUSD: number;
};

/**
 * Per-class contribution from a single holding. Multi-asset wrappers
 * (NTSX, GDE, RSST, …) emit one entry per composition leg so a single
 * face value can split across equity + bond + commodity columns.
 *
 *   NTSX, $100K, comp = [E 0.9, B 0.6], leverage sum = 1.5
 *     → equity:  face $60K, exposure $90K   (0.6 / 1.5 of face, 0.9 raw)
 *     → bond:    face $40K, exposure $60K
 *
 * Plain holdings emit a single entry (face = valueUSD, exposure =
 * valueUSD × leverage, class = kind).
 */
type EquityContribution = {
  faceUSD: number;
  exposureUSD: number;
  styleBox: StyleBoxAllocation;
  geography: GeographyAllocation;
  expectedRealCAGR: number;
};

type BondContribution = {
  faceUSD: number;
  exposureUSD: number;
  bondType: BondTypeAllocation;
  geography: GeographyAllocation;
  averageDurationYears: number;
  expectedRealCAGR: number;
};

type CashContribution = {
  faceUSD: number;
  exposureUSD: number;
  geography: GeographyAllocation;
  expectedRealCAGR: number;
};

type ClasslessContribution = {
  faceUSD: number;
  exposureUSD: number;
  expectedRealCAGR: number;
  /**
   * Geography is set for equity/bond/cash kinds (or composition legs
   * routed to those classes). null for crypto / real_estate /
   * private_stock / other — they have no geographic attribution and
   * are skipped under a region-scoped slice.
   */
  geography: GeographyAllocation | null;
};

type Decomposed = {
  equity: EquityContribution[];
  bond: BondContribution[];
  cash: CashContribution[];
  crypto: ClasslessContribution[];
  commodity: ClasslessContribution[];
  realEstate: ClasslessContribution[];
  privateStock: ClasslessContribution[];
  other: ClasslessContribution[];
  // Per-holding CAGR contribution, weighted by holding face. Used for
  // portfolio-level weightedRealCAGR.
  cagrWeightedFaceSum: number;
};

const DEFAULT_BOND_LEG_TYPE: BondTypeAllocation = bondTypeOf({ GOVT: 1 });
const DEFAULT_BOND_LEG_GEO: GeographyAllocation = geographyOf({ US: 1 });
const DEFAULT_BOND_LEG_DURATION = 7;

function decompose(holdings: Holding[]): Decomposed {
  const out: Decomposed = {
    equity: [],
    bond: [],
    cash: [],
    crypto: [],
    commodity: [],
    realEstate: [],
    privateStock: [],
    other: [],
    cagrWeightedFaceSum: 0,
  };

  // Helper: redistribute a wrapper holding's face value across its
  // composition legs. Used by equity / bond / crypto / commodity
  // wrappers (e.g. NTSX is equity-kind, WTIP-style multi-asset is
  // bond-kind, a BTC-overlay holding could be crypto-kind). The
  // wrapper's class-specific metadata (equity styleBox, bond
  // bondType/duration) is inherited by legs of the matching class —
  // so an equity wrapper's equity leg keeps the wrapper's styleBox,
  // and a bond wrapper's bond leg keeps the wrapper's duration.
  /**
   * Redistribute a wrapper holding's face value across its
   * composition legs. Composition is passed explicitly so callers
   * don't have to satisfy a structural `composition: NonNullable<…>`
   * contract — each variant of the discriminated Holding union
   * carries `composition?: …` (optional), and TS can't track a
   * truthiness narrowing through a function call.
   *
   * `inherited` carries class-specific wrapper metadata that legs of
   * the matching class should inherit (equity wrapper's styleBox →
   * equity leg's styleBox; bond wrapper's duration → bond leg's
   * duration). Each field is optional because the wrapper's kind
   * determines which apply.
   */
  const expandComposition = (
    valueUSD: number,
    composition: import("@/lib/types").CompositionLeg[],
    inherited: {
      styleBox?: import("@/lib/types").StyleBoxAllocation;
      geography?: import("@/lib/types").GeographyAllocation;
      bondType?: import("@/lib/types").BondTypeAllocation;
      averageDurationYears?: number;
    },
  ): boolean => {
    const sumW = composition.reduce((s, l) => s + l.weight, 0);
    if (sumW <= 0) return false;
    let cagr = 0;
    for (const leg of composition) {
      const faceShare = (valueUSD * leg.weight) / sumW; // normalized
      const exposureShare = valueUSD * leg.weight; // raw
      const legCAGR =
        leg.expectedRealCAGR ?? defaultLegCAGRLocal(leg.kind);
      cagr += (leg.weight / sumW) * legCAGR;
      if (leg.kind === "equity") {
        out.equity.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          // Inherit wrapper's styleBox/geography if it's an equity
          // wrapper. Otherwise use Large Blend US defaults.
          styleBox: inherited.styleBox ?? { ...EMPTY_STYLE_BOX, LARGE_BLEND: 1 },
          geography: inherited.geography ?? { ...EMPTY_GEOGRAPHY, US: 1 },
          expectedRealCAGR: legCAGR,
        });
      } else if (leg.kind === "bond") {
        out.bond.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          bondType: inherited.bondType ?? DEFAULT_BOND_LEG_TYPE,
          geography: inherited.geography ?? DEFAULT_BOND_LEG_GEO,
          averageDurationYears:
            inherited.averageDurationYears ?? DEFAULT_BOND_LEG_DURATION,
          expectedRealCAGR: legCAGR,
        });
      } else if (leg.kind === "cash") {
        out.cash.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          geography: inherited.geography ?? DEFAULT_BOND_LEG_GEO,
          expectedRealCAGR: legCAGR,
        });
      } else if (leg.kind === "commodity") {
        out.commodity.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          expectedRealCAGR: legCAGR,
          geography: null,
        });
      } else if (leg.kind === "crypto") {
        out.crypto.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          expectedRealCAGR: legCAGR,
          geography: null,
        });
      } else {
        // "other" → other bucket
        out.other.push({
          faceUSD: faceShare,
          exposureUSD: exposureShare,
          expectedRealCAGR: legCAGR,
          geography: null,
        });
      }
    }
    out.cagrWeightedFaceSum += valueUSD * cagr;
    return true;
  };

  for (const h of holdings) {
    if (h.kind === "equity") {
      if (
        h.composition &&
        h.composition.length > 0 &&
        expandComposition(h.valueUSD, h.composition, {
          styleBox: h.styleBox,
          geography: h.geography,
        })
      ) {
        continue;
      }
      // Plain equity holding (no composition or empty composition)
      out.equity.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD * h.leverage,
        styleBox: h.styleBox,
        geography: h.geography,
        expectedRealCAGR: h.expectedRealCAGR,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "bond") {
      if (
        h.composition &&
        h.composition.length > 0 &&
        expandComposition(h.valueUSD, h.composition, {
          bondType: h.bondType,
          geography: h.geography,
          averageDurationYears: h.averageDurationYears,
        })
      ) {
        continue;
      }
      out.bond.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD * h.leverage,
        bondType: h.bondType,
        geography: h.geography,
        averageDurationYears: h.averageDurationYears,
        expectedRealCAGR: h.expectedRealCAGR,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "cash") {
      out.cash.push({
        faceUSD: h.valueUSD,
        exposureUSD: 0, // cash carries no market exposure
        geography: h.geography,
        expectedRealCAGR: h.expectedRealCAGR,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "crypto") {
      if (
        h.composition &&
        h.composition.length > 0 &&
        expandComposition(h.valueUSD, h.composition, {})
      ) {
        continue;
      }
      // Plain crypto. exposureUSD = face × leverage (default 1; 2 for BITX-like).
      const lev = h.leverage ?? 1;
      out.crypto.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD * lev,
        expectedRealCAGR: h.expectedRealCAGR,
        geography: null,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "commodity") {
      if (
        h.composition &&
        h.composition.length > 0 &&
        expandComposition(h.valueUSD, h.composition, {})
      ) {
        continue;
      }
      out.commodity.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD,
        expectedRealCAGR: h.expectedRealCAGR,
        geography: null,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "real_estate") {
      out.realEstate.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD * h.leverage,
        expectedRealCAGR: h.expectedRealCAGR,
        geography: null,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else if (h.kind === "private_stock") {
      out.privateStock.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD * (h.leverage ?? 1),
        expectedRealCAGR: h.expectedRealCAGR,
        geography: null,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    } else {
      // other
      out.other.push({
        faceUSD: h.valueUSD,
        exposureUSD: h.valueUSD,
        expectedRealCAGR: h.expectedRealCAGR,
        geography: null,
      });
      out.cagrWeightedFaceSum += h.valueUSD * h.expectedRealCAGR;
    }
  }
  return out;
}

// Mirror of types.ts/defaultLegCAGR; kept local to avoid a cross-module
// import cycle with types.ts and to keep portfolio.ts self-contained.
function defaultLegCAGRLocal(kind: string): number {
  switch (kind) {
    case "equity":
      return 0.07;
    case "bond":
      return 0.015;
    case "cash":
      return 0;
    case "crypto":
      return 0.05;
    case "commodity":
      return 0.01;
    case "other":
      return 0.03;
    default:
      return 0;
  }
}

export function computePortfolio(h: Household): PortfolioMetrics {
  const allHoldings: Holding[] = h.accounts.flatMap((a) => a.holdings);
  const d = decompose(allHoldings);

  const equityUSD = d.equity.reduce((s, x) => s + x.faceUSD, 0);
  const bondUSD = d.bond.reduce((s, x) => s + x.faceUSD, 0);
  const cashUSD = d.cash.reduce((s, x) => s + x.faceUSD, 0);
  const cryptoUSD = d.crypto.reduce((s, x) => s + x.faceUSD, 0);
  const commodityUSD = d.commodity.reduce((s, x) => s + x.faceUSD, 0);
  const realEstateUSD = d.realEstate.reduce((s, x) => s + x.faceUSD, 0);
  const privateStockUSD = d.privateStock.reduce((s, x) => s + x.faceUSD, 0);
  const otherUSD = d.other.reduce((s, x) => s + x.faceUSD, 0);
  const totalUSD =
    equityUSD +
    bondUSD +
    cashUSD +
    cryptoUSD +
    commodityUSD +
    realEstateUSD +
    privateStockUSD +
    otherUSD;

  const equity = computeEquity(d.equity, equityUSD);
  const bond = computeBond(d.bond, bondUSD);
  const cashM = computeCash(d.cash, cashUSD);

  const realEstateExposureUSD = d.realEstate.reduce(
    (s, r) => s + r.exposureUSD,
    0,
  );
  const privateStockExposureUSD = d.privateStock.reduce(
    (s, p) => s + p.exposureUSD,
    0,
  );
  // Cash and crypto carry no market leverage on their own (decompose
  // sets cash exposure to 0; crypto exposure = face). But composition
  // legs routed to these buckets *can* carry leverage. We still sum
  // exposureUSD so e.g. an NTSX-style holding with a cash leg would be
  // accounted for honestly.
  const cryptoExposureUSD = d.crypto.reduce((s, x) => s + x.exposureUSD, 0);
  const commodityExposureUSD = d.commodity.reduce(
    (s, x) => s + x.exposureUSD,
    0,
  );
  const cashExposureUSD = d.cash.reduce((s, x) => s + x.exposureUSD, 0);
  // "Other" exposure tracks plain OtherHolding (exposure == face, 0×)
  // plus composition "other" legs (e.g. RSST's managed-futures leg,
  // exposure > face from wrapper leverage). Commodity legs now route
  // to the dedicated commodity bucket — GDE's 90% gold leg lands in
  // commodityExposureUSD, not here.
  const otherExposureUSD = d.other.reduce((s, x) => s + x.exposureUSD, 0);

  const totalAssets = totalUSD;
  // Total *gross* exposure across every class. This is the numerator
  // for portfolio-level effective leverage and is what the home-page
  // "Effective exposure" tile should show.
  const grossExposureUSD =
    equity.effectiveExposureUSD +
    bond.effectiveExposureUSD +
    realEstateExposureUSD +
    privateStockExposureUSD +
    cryptoExposureUSD +
    commodityExposureUSD +
    cashExposureUSD +
    otherExposureUSD;
  const effectiveLeverage =
    totalAssets > 0 ? grossExposureUSD / totalAssets : 1;

  // Composition-aware weighted CAGR. For multi-asset wrappers, the
  // contribution is the weight-blended leg CAGR (e.g. NTSX = 0.6 × 7%
  // equity + 0.4 × 1.5% bond = 4.5%) rather than the wrapper's stale
  // top-level expectedRealCAGR. decompose() pre-sums this for us.
  const weightedRealCAGR = totalUSD > 0 ? d.cagrWeightedFaceSum / totalUSD : 0;

  // True net worth = gross assets minus all liabilities. Until now
  // computePortfolio returned `totalUSD` (gross) under the
  // misleading `netWorthUSD` field, which silently inflated
  // anything reading from it: AllocationFutureCard's headline,
  // MilestonesCard's projection comparison, the home-page Effective
  // Exposure tile, etc. Aligning the field with its name fixes
  // those AND lets projectIndependence / projectAllocation reconcile.
  const liabilitiesTotal = h.liabilities.reduce(
    (s, l) => s + l.balanceUSD,
    0,
  );
  const netWorthUSD = totalUSD - liabilitiesTotal;

  return {
    netWorthUSD,
    weightedRealCAGR,
    effectiveLeverage,
    // grossExposureUSD is the total leveraged exposure across every
    // class (face × leverage for each). For plain holdings face ==
    // exposure; for composition wrappers and mortgaged real-estate the
    // exposure exceeds face by the leverage multiplier.
    effectiveExposureUSD: grossExposureUSD,
    classes: {
      equityUSD,
      bondUSD,
      cashUSD,
      cryptoUSD,
      commodityUSD,
      realEstateUSD,
      privateStockUSD,
      otherUSD,
      totalUSD,
      equityShare: totalUSD > 0 ? equityUSD / totalUSD : 0,
      bondShare: totalUSD > 0 ? bondUSD / totalUSD : 0,
      cashShare: totalUSD > 0 ? cashUSD / totalUSD : 0,
      cryptoShare: totalUSD > 0 ? cryptoUSD / totalUSD : 0,
      commodityShare: totalUSD > 0 ? commodityUSD / totalUSD : 0,
      realEstateShare: totalUSD > 0 ? realEstateUSD / totalUSD : 0,
      privateStockShare:
        totalUSD > 0 ? privateStockUSD / totalUSD : 0,
      otherShare: totalUSD > 0 ? otherUSD / totalUSD : 0,
    },
    equity,
    bond,
    cash: cashM,
    cryptoUSD,
    commodityUSD,
    realEstateUSD,
    privateStockUSD,
    otherUSD,
  };
}

function computeEquity(
  equities: EquityContribution[],
  equityUSD: number,
): EquityMetrics {
  const styleBox = { ...EMPTY_STYLE_BOX };
  const styleBoxExposure = { ...EMPTY_STYLE_BOX };
  const geography = { ...EMPTY_GEOGRAPHY };
  const geographyExposure = { ...EMPTY_GEOGRAPHY };
  const byGeo: Record<Geography, StyleBoxAllocation> = {
    US: { ...EMPTY_STYLE_BOX },
    DEVELOPED: { ...EMPTY_STYLE_BOX },
    EMERGING: { ...EMPTY_STYLE_BOX },
  };
  const byGeoExposure: Record<Geography, StyleBoxAllocation> = {
    US: { ...EMPTY_STYLE_BOX },
    DEVELOPED: { ...EMPTY_STYLE_BOX },
    EMERGING: { ...EMPTY_STYLE_BOX },
  };

  const exposureUSD = equities.reduce((s, x) => s + x.exposureUSD, 0);
  const effectiveLeverage = equityUSD > 0 ? exposureUSD / equityUSD : 1;

  if (equityUSD > 0) {
    for (const e of equities) {
      const wFace = e.faceUSD / equityUSD;
      const wExp = exposureUSD > 0 ? e.exposureUSD / exposureUSD : 0;
      for (const c of STYLE_BOX_CELLS) {
        styleBox[c] += wFace * e.styleBox[c];
        styleBoxExposure[c] += wExp * e.styleBox[c];
      }
      for (const g of GEOGRAPHIES) {
        geography[g] += wFace * e.geography[g];
        geographyExposure[g] += wExp * e.geography[g];
      }
      for (const g of GEOGRAPHIES) {
        const gShareFace = e.geography[g] * wFace;
        const gShareExp = e.geography[g] * wExp;
        for (const c of STYLE_BOX_CELLS) {
          byGeo[g][c] += gShareFace * e.styleBox[c];
          byGeoExposure[g][c] += gShareExp * e.styleBox[c];
        }
      }
    }
  }

  return {
    totalUSD: equityUSD,
    effectiveExposureUSD: exposureUSD,
    effectiveLeverage,
    styleBox,
    styleBoxExposure,
    geography,
    geographyExposure,
    styleBoxByGeo: byGeo,
    styleBoxByGeoExposure: byGeoExposure,
  };
}

function computeBond(
  bonds: BondContribution[],
  bondUSD: number,
): BondMetrics {
  const bondType = { ...EMPTY_BOND_TYPE };
  const geography = { ...EMPTY_GEOGRAPHY };
  const byGeo: Record<Geography, BondTypeAllocation> = {
    US: { ...EMPTY_BOND_TYPE },
    DEVELOPED: { ...EMPTY_BOND_TYPE },
    EMERGING: { ...EMPTY_BOND_TYPE },
  };

  const exposureUSD = bonds.reduce((s, x) => s + x.exposureUSD, 0);
  const effectiveLeverage = bondUSD > 0 ? exposureUSD / bondUSD : 1;
  let weightedDuration = 0;

  if (bondUSD > 0) {
    for (const b of bonds) {
      const w = b.faceUSD / bondUSD;
      for (const t of BOND_TYPES) bondType[t] += w * b.bondType[t];
      for (const g of GEOGRAPHIES) geography[g] += w * b.geography[g];
      for (const g of GEOGRAPHIES) {
        for (const t of BOND_TYPES) {
          byGeo[g][t] += w * b.geography[g] * b.bondType[t];
        }
      }
      weightedDuration += w * b.averageDurationYears;
    }
  }

  return {
    totalUSD: bondUSD,
    effectiveExposureUSD: exposureUSD,
    effectiveLeverage,
    bondType,
    bondTypeByGeo: byGeo,
    geography,
    weightedDurationYears: weightedDuration,
  };
}

function computeCash(
  cash: CashContribution[],
  cashUSD: number,
): CashMetrics {
  let weighted = 0;
  const geography = { ...EMPTY_GEOGRAPHY };
  if (cashUSD > 0) {
    for (const c of cash) {
      const w = c.faceUSD / cashUSD;
      weighted += w * c.expectedRealCAGR;
      for (const g of GEOGRAPHIES) geography[g] += w * c.geography[g];
    }
  }
  return { totalUSD: cashUSD, weightedRealCAGR: weighted, geography };
}

export function pickEquityStyleBox(
  m: EquityMetrics,
  basis: ViewBasis,
  scope: GeoScope,
): StyleBoxAllocation {
  if (scope === "ALL") {
    return basis === "exposure" ? m.styleBoxExposure : m.styleBox;
  }
  return basis === "exposure"
    ? m.styleBoxByGeoExposure[scope]
    : m.styleBoxByGeo[scope];
}

export function pickBondType(
  m: BondMetrics,
  scope: GeoScope,
): BondTypeAllocation {
  if (scope === "ALL") return m.bondType;
  return m.bondTypeByGeo[scope];
}

export function geoScopeWeight(
  m: EquityMetrics | BondMetrics,
  scope: GeoScope,
): number {
  if (scope === "ALL") return 1;
  return m.geography[scope];
}

/**
 * Effective leverage and weighted real CAGR for an arbitrary slice
 * of the household. Cash is treated as 0× leverage (it has no exposure
 * to market growth via leverage). When a region scope is set, each
 * holding contributes only its weighted share to that geography.
 */
export function sliceMetrics(
  household: Household,
  classFilter:
    | "ALL"
    | "equity"
    | "bond"
    | "cash"
    | "crypto"
    | "commodity"
    | "real_estate"
    | "private_stock"
    | "other",
  geoScope: GeoScope,
): {
  effectiveLeverage: number;
  weightedRealCAGR: number;
  totalUSD: number;
  effectiveExposureUSD: number;
} {
  // Walk the same decomposition computePortfolio uses so multi-asset
  // wrappers (NTSX, GDE, …) split correctly across class buckets. A
  // classFilter="bond" picks up the bond leg of NTSX even though the
  // wrapper holding's top-level kind is "equity".
  const allHoldings = household.accounts.flatMap((a) => a.holdings);
  const d = decompose(allHoldings);

  let totalValue = 0;
  let totalExposure = 0;
  let weightedCAGRSum = 0;

  const include = (
    cls: "equity" | "bond" | "cash" | "crypto" | "commodity" | "real_estate" | "private_stock" | "other",
  ): boolean => classFilter === "ALL" || classFilter === cls;

  const walk = (
    contributions: Array<{
      faceUSD: number;
      exposureUSD: number;
      expectedRealCAGR: number;
      geography: GeographyAllocation | null;
    }>,
  ) => {
    for (const c of contributions) {
      let value = c.faceUSD;
      let exposure = c.exposureUSD;
      if (geoScope !== "ALL") {
        if (!c.geography) continue; // class has no geography → skipped under region
        const w = c.geography[geoScope];
        if (w <= 0) continue;
        value *= w;
        exposure *= w;
      }
      if (value <= 0) continue;
      totalValue += value;
      totalExposure += exposure;
      weightedCAGRSum += value * c.expectedRealCAGR;
    }
  };

  if (include("equity")) walk(d.equity);
  if (include("bond")) walk(d.bond);
  if (include("cash")) walk(d.cash);
  if (include("crypto")) walk(d.crypto);
  if (include("commodity")) walk(d.commodity);
  if (include("real_estate")) walk(d.realEstate);
  if (include("private_stock")) walk(d.privateStock);
  if (include("other")) walk(d.other);

  return {
    effectiveLeverage: totalValue > 0 ? totalExposure / totalValue : 0,
    weightedRealCAGR: totalValue > 0 ? weightedCAGRSum / totalValue : 0,
    totalUSD: totalValue,
    effectiveExposureUSD: totalExposure,
  };
}
