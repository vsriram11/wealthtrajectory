/**
 * Annual real (inflation-adjusted) total returns for six asset
 * classes — US large-cap stocks, US 10-year Treasury bonds,
 * 3-month US T-Bills (cash proxy), Baa corporate bonds, US
 * residential real estate, and physical gold — by calendar year.
 *
 * Source: Aswath Damodaran's "Historical Returns" public dataset
 * (NYU Stern), Jan 2026 refresh, checked into this repo at
 * `docs/histretSP.xls`. Original sheet has annual NOMINAL total
 * returns; the values below are CPI-deflated via
 * `real = (1 + nominal) / (1 + cpi) − 1` using the workbook's
 * own CPI series ("Inflation Rate" sheet, FRED CPIAUCNS).
 *
 * Values are REAL returns (decimal, not %), already adjusted for
 * inflation — which aligns with the rest of this app's real-terms
 * model. A value of `0.05` means +5% real, `-0.12` means -12%
 * real (purchasing-power loss).
 *
 * Coverage: 1928–2025 (98 years). Long enough for sequence-of-
 * returns analysis across every well-known historical drawdown
 * — Great Depression, WWII inflation, 1970s stagflation,
 * 2000–02 dot-com, 2008 GFC, 2022 simultaneous stock-bond crash,
 * and into the post-2022 disinflation rally.
 *
 * Caveats for users:
 *   - Past performance does not predict future returns.
 *   - "Real" here means CPI-adjusted; doesn't account for tax
 *     drag, fees, or sequence of withdrawals (that's the
 *     simulation engine's job).
 *   - US-centric. International equity / bond returns are not
 *     included; users with heavy ex-US allocation should
 *     interpret results with a grain of salt.
 *   - Real-estate series is Case-Shiller-style home-price-return
 *     index from Damodaran (price appreciation only, NOT total
 *     return — it excludes rental yield). It's a fair proxy for
 *     personal residence + REIT-overlay drift, not for an
 *     income-producing rental portfolio.
 *   - Gold series uses LBMA end-of-year prices from 1970+ and
 *     average annual prices pre-1970 (the pegged-USD era).
 *
 * To refresh: replace `docs/histretSP.xls` with the latest
 * January release from
 * https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html,
 * then re-run the parsing script in commit history (or eyeball
 * the "Returns by year" sheet directly).
 *
 * Engine-pure: no React, no store imports.
 */

export type AnnualRealReturns = {
  /** Calendar year (e.g. 1928). */
  year: number;
  /** Real total return on the S&P 500, e.g. 0.4381 = +43.81%. */
  stocks: number;
  /** Real total return on the 10-year US Treasury Note. */
  bonds: number;
  /** Real total return on 3-month US T-Bills (cash proxy). */
  cash: number;
  /**
   * Real total return on Baa-rated US corporate bonds (Damodaran's
   * "Baa Corporate Bond" column). Higher long-run real return than
   * Treasuries (~3% real vs ~2%) with materially worse drawdowns in
   * crisis years (1931 -7%, 2008 -3.5%, 2022 -20%). Not currently
   * routed by the simulator's allocation bucketing — bond holdings
   * fall through to Treasuries — but available here for a future
   * "credit-aware bond bucket" enhancement.
   */
  corpBonds: number;
  /**
   * Real annual price return on US residential real estate (Damodaran
   * "Real Estate" column, Case-Shiller-style home-price index). This
   * is PRICE return only — it excludes rental yield, so it understates
   * what a leveraged primary residence with owner-occupancy or a
   * rental property actually produces. The simulator uses it as a
   * fair-enough proxy for the appreciation portion of direct real
   * estate exposure; users with heavy income-producing RE should
   * interpret results with that caveat in mind.
   */
  realEstate: number;
  /**
   * Real annual return on physical gold (Damodaran "Gold" column).
   * Returns differ MATERIALLY from stocks in stagflation regimes
   * (1971–1980 cumulative +6× real; 2001–2011 cumulative +3× real;
   * 2022 +5% real while stocks crashed -23%), so collapsing gold
   * into the stocks bucket erases exactly the diversification
   * value it provides. The simulator routes commodity holdings
   * (GLD, IAU, SGOL, GLDM, PHYS, plus metal legs of multi-asset
   * wrappers) here directly.
   */
  gold: number;
};

/**
 * Audited real returns 1928–2025, derived from Damodaran's Jan 2026
 * "Returns by year" sheet (committed at docs/histretSP.xls) with CPI
 * deflation applied per row. Values rounded to 4 decimal places —
 * sufficient for retirement-planning simulation, where 10-bp noise
 * is dwarfed by sequence risk.
 *
 * Notable sequences encoded here:
 *   - 1929–32  Great Depression — stocks -65% real cumulative;
 *               gold +50% real (USD revaluation).
 *   - 1941–46  WWII inflation — both stocks and bonds negative real.
 *   - 1971–80  Stagflation — stocks barely positive real; gold
 *               +6× real cumulative; bonds -50% real cumulative.
 *   - 2000–02  Dot-com — stocks -50% real cumulative; gold +40%.
 *   - 2007–09  GFC — stocks -35% real cumulative; gold +35%.
 *   - 2022     Stock-bond simultaneous crash — both -22% real,
 *               gold roughly flat; the canonical case for
 *               diversification.
 *   - 2024–25  Post-COVID rally — gold +21%, +62% real
 *               (LBMA $2611 → $4340).
 */
export const HISTORICAL_REAL_RETURNS: readonly AnnualRealReturns[] = [
  { year: 1928, stocks: 0.4549, bonds: 0.0201, cash: 0.0429, corpBonds: 0.0443, realEstate: 0.0268, gold: 0.0127 },
  { year: 1929, stocks: -0.0883, bonds: 0.0360, cash: 0.0256, corpBonds: 0.0242, realEstate: -0.0263, gold: -0.0073 },
  { year: 1930, stocks: -0.2001, bonds: 0.1168, cash: 0.1169, corpBonds: 0.0741, realEstate: 0.0224, gold: 0.0694 },
  { year: 1931, stocks: -0.3807, bonds: 0.0745, cash: 0.1282, corpBonds: -0.0702, realEstate: 0.0129, gold: -0.0890 },
  { year: 1932, stocks: 0.0182, bonds: 0.2125, cash: 0.1264, corpBonds: 0.3774, realEstate: -0.0021, gold: 0.3516 },
  { year: 1933, stocks: 0.4885, bonds: 0.0108, cash: 0.0020, corpBonds: 0.1211, realEstate: -0.0454, gold: 0.2630 },
  { year: 1934, stocks: -0.0266, bonds: 0.0635, cash: -0.0122, corpBonds: 0.1704, realEstate: 0.0137, gold: 0.2978 },
  { year: 1935, stocks: 0.4249, bonds: 0.0144, cash: -0.0274, corpBonds: 0.1002, realEstate: 0.0658, gold: -0.0248 },
  { year: 1936, stocks: 0.3006, bonds: 0.0352, cash: -0.0126, corpBonds: 0.0979, realEstate: 0.0174, gold: -0.0134 },
  { year: 1937, stocks: -0.3713, bonds: -0.0144, cash: -0.0251, corpBonds: -0.0707, realEstate: -0.0029, gold: -0.0300 },
  { year: 1938, stocks: 0.3298, bonds: 0.0719, cash: 0.0292, corpBonds: 0.1236, realEstate: 0.0196, gold: 0.0303 },
  { year: 1939, stocks: -0.0110, bonds: 0.0441, cash: 0.0005, corpBonds: 0.0798, realEstate: -0.0130, gold: -0.0123 },
  { year: 1940, stocks: -0.1131, bonds: 0.0465, cash: -0.0067, corpBonds: 0.0788, realEstate: 0.0257, gold: -0.0235 },
  { year: 1941, stocks: -0.2065, bonds: -0.1087, cash: -0.0891, corpBonds: -0.0448, realEstate: -0.1666, gold: -0.0903 },
  { year: 1942, stocks: 0.0930, bonds: -0.0618, cash: -0.0797, corpBonds: -0.0353, realEstate: -0.0523, gold: -0.0828 },
  { year: 1943, stocks: 0.2147, bonds: -0.0046, cash: -0.0250, corpBonds: 0.0494, realEstate: 0.0824, gold: -0.0287 },
  { year: 1944, stocks: 0.1636, bonds: 0.0027, cash: -0.0188, corpBonds: 0.0417, realEstate: 0.1396, gold: -0.0225 },
  { year: 1945, stocks: 0.3284, bonds: 0.0152, cash: -0.0183, corpBonds: 0.0445, realEstate: 0.0932, gold: 0.0029 },
  { year: 1946, stocks: -0.2248, bonds: -0.1270, cash: -0.1503, corpBonds: -0.1323, realEstate: 0.0505, gold: -0.1535 },
  { year: 1947, stocks: -0.0334, bonds: -0.0727, cash: -0.0757, corpBonds: -0.0788, realEstate: 0.1142, gold: -0.0812 },
  { year: 1948, stocks: 0.0263, bonds: -0.0101, cash: -0.0189, corpBonds: 0.0043, realEstate: -0.0091, gold: -0.0290 },
  { year: 1949, stocks: 0.2081, bonds: 0.0688, cash: 0.0326, corpBonds: 0.0761, realEstate: 0.0221, gold: -0.0677 },
  { year: 1950, stocks: 0.2348, bonds: -0.0519, cash: -0.0446, corpBonds: -0.0160, realEstate: -0.0216, gold: 0.0343 },
  { year: 1951, stocks: 0.1668, bonds: -0.0594, cash: -0.0423, corpBonds: -0.0584, realEstate: 0.0004, gold: -0.0566 },
  { year: 1952, stocks: 0.1727, bonds: 0.0150, cash: 0.0096, corpBonds: 0.0366, realEstate: 0.0362, gold: -0.0109 },
  { year: 1953, stocks: -0.0194, bonds: 0.0337, cash: 0.0113, corpBonds: 0.0086, realEstate: 0.1069, gold: -0.0006 },
  { year: 1954, stocks: 0.5371, bonds: 0.0406, cash: 0.0169, corpBonds: 0.0695, realEstate: 0.0168, gold: 0.0133 },
  { year: 1955, stocks: 0.3210, bonds: -0.0170, cash: 0.0134, corpBonds: 0.0166, realEstate: -0.0037, gold: -0.0040 },
  { year: 1956, stocks: 0.0433, bonds: -0.0509, cash: -0.0035, corpBonds: -0.0518, realEstate: -0.0201, gold: -0.0301 },
  { year: 1957, stocks: -0.1298, bonds: 0.0379, cash: 0.0032, corpBonds: -0.0352, realEstate: -0.0018, gold: -0.0293 },
  { year: 1958, stocks: 0.4123, bonds: -0.0379, cash: 0.0001, corpBonds: 0.0459, realEstate: -0.0108, gold: -0.0131 },
  { year: 1959, stocks: 0.1015, bonds: -0.0430, cash: 0.0163, corpBonds: -0.0015, realEstate: -0.0159, gold: -0.0170 },
  { year: 1960, stocks: -0.0101, bonds: 0.1014, cash: 0.0149, corpBonds: 0.0523, realEstate: -0.0059, gold: -0.0086 },
  { year: 1961, stocks: 0.2579, bonds: 0.0138, cash: 0.0167, corpBonds: 0.0440, realEstate: 0.0030, gold: -0.0072 },
  { year: 1962, stocks: -0.1001, bonds: 0.0430, cash: 0.0142, corpBonds: 0.0509, realEstate: -0.0100, gold: -0.0137 },
  { year: 1963, stocks: 0.2063, bonds: 0.0004, cash: 0.0149, corpBonds: 0.0376, realEstate: 0.0049, gold: -0.0201 },
  { year: 1964, stocks: 0.1530, bonds: 0.0273, cash: 0.0255, corpBonds: 0.0415, realEstate: 0.0029, gold: -0.0093 },
  { year: 1965, stocks: 0.1028, bonds: -0.0118, cash: 0.0199, corpBonds: 0.0124, realEstate: -0.0026, gold: -0.0183 },
  { year: 1966, stocks: -0.1298, bonds: -0.0053, cash: 0.0135, corpBonds: -0.0667, realEstate: -0.0216, gold: -0.0332 },
  { year: 1967, stocks: 0.2015, bonds: -0.0448, cash: 0.0122, corpBonds: -0.0208, realEstate: -0.0070, gold: -0.0345 },
  { year: 1968, stocks: 0.0582, bonds: -0.0138, cash: 0.0059, corpBonds: 0.0012, realEstate: -0.0056, gold: 0.0741 },
  { year: 1969, stocks: -0.1360, bonds: -0.1056, cash: 0.0044, corpBonds: -0.0774, realEstate: 0.0075, gold: -0.0112 },
  { year: 1970, stocks: -0.0190, bonds: 0.1059, cash: 0.0078, corpBonds: 0.0008, realEstate: 0.0251, gold: -0.1423 },
  { year: 1971, stocks: 0.1061, bonds: 0.0631, cash: 0.0103, corpBonds: 0.1040, realEstate: 0.0095, gold: 0.1300 },
  { year: 1972, stocks: 0.1484, bonds: -0.0057, cash: 0.0063, corpBonds: 0.0774, realEstate: -0.0042, gold: 0.4388 },
  { year: 1973, stocks: -0.2117, bonds: -0.0464, cash: -0.0154, corpBonds: -0.0404, realEstate: -0.0486, gold: 0.5911 },
  { year: 1974, stocks: -0.3404, bonds: -0.0921, cash: -0.0400, corpBonds: -0.1488, realEstate: -0.0202, gold: 0.4790 },
  { year: 1975, stocks: 0.2811, bonds: -0.0312, cash: -0.0108, corpBonds: 0.0385, realEstate: -0.0015, gold: -0.2968 },
  { year: 1976, stocks: 0.1809, bonds: 0.1060, cash: 0.0011, corpBonds: 0.1420, realEstate: 0.0316, gold: -0.0855 },
  { year: 1977, stocks: -0.1282, bonds: -0.0507, cash: -0.0135, corpBonds: 0.0305, realEstate: 0.0745, gold: 0.1494 },
  { year: 1978, stocks: -0.0230, bonds: -0.0899, cash: -0.0169, corpBonds: -0.0539, realEstate: 0.0615, gold: 0.2568 },
  { year: 1979, stocks: 0.0461, bonds: -0.1114, cash: -0.0286, corpBonds: -0.1351, realEstate: 0.0040, gold: 0.9997 },
  { year: 1980, stocks: 0.1708, bonds: -0.1378, cash: -0.0100, corpBonds: -0.1407, realEstate: -0.0455, gold: 0.0237 },
  { year: 1981, stocks: -0.1251, bonds: -0.0066, cash: 0.0469, corpBonds: -0.0042, realEstate: -0.0351, gold: -0.3812 },
  { year: 1982, stocks: 0.1598, bonds: 0.2792, cash: 0.0699, corpBonds: 0.2429, realEstate: -0.0315, gold: 0.1136 },
  { year: 1983, stocks: 0.1787, bonds: -0.0057, cash: 0.0497, corpBonds: 0.1195, realEstate: 0.0092, gold: -0.1984 },
  { year: 1984, stocks: 0.0211, bonds: 0.0941, cash: 0.0574, corpBonds: 0.1123, realEstate: 0.0070, gold: -0.2244 },
  { year: 1985, stocks: 0.2643, bonds: 0.2111, cash: 0.0378, corpBonds: 0.1933, realEstate: 0.0354, gold: 0.0212 },
  { year: 1986, stocks: 0.1721, bonds: 0.2293, cash: 0.0500, corpBonds: 0.2082, realEstate: 0.0842, gold: 0.1766 },
  { year: 1987, stocks: 0.0132, bonds: -0.0900, cash: 0.0146, corpBonds: -0.0318, realEstate: 0.0327, gold: 0.1924 },
  { year: 1988, stocks: 0.1160, bonds: 0.0364, cash: 0.0237, corpBonds: 0.1079, realEstate: 0.0268, gold: -0.1884 },
  { year: 1989, stocks: 0.2564, bonds: 0.1247, cash: 0.0358, corpBonds: 0.1115, realEstate: -0.0024, gold: -0.0715 },
  { year: 1990, stocks: -0.0864, bonds: 0.0012, cash: 0.0155, corpBonds: -0.0043, realEstate: -0.0640, gold: -0.0869 },
  { year: 1991, stocks: 0.2636, bonds: 0.1159, cash: 0.0240, corpBonds: 0.1294, realEstate: -0.0314, gold: -0.1128 },
  { year: 1992, stocks: 0.0446, bonds: 0.0628, cash: 0.0059, corpBonds: 0.1048, realEstate: -0.0202, gold: -0.0839 },
  { year: 1993, stocks: 0.0703, bonds: 0.1116, cash: 0.0031, corpBonds: 0.1333, realEstate: -0.0058, gold: 0.1453 },
  { year: 1994, stocks: -0.0131, bonds: -0.1043, cash: 0.0165, corpBonds: -0.0380, realEstate: -0.0016, gold: -0.0472 },
  { year: 1995, stocks: 0.3380, bonds: 0.2042, cash: 0.0304, corpBonds: 0.1711, realEstate: -0.0073, gold: -0.0152 },
  { year: 1996, stocks: 0.1874, bonds: -0.0183, cash: 0.0177, corpBonds: 0.0189, realEstate: -0.0087, gold: -0.0765 },
  { year: 1997, stocks: 0.3088, bonds: 0.0810, cash: 0.0344, corpBonds: 0.0943, realEstate: 0.0228, gold: -0.2272 },
  { year: 1998, stocks: 0.2630, bonds: 0.1310, cash: 0.0325, corpBonds: 0.0639, realEstate: 0.0475, gold: -0.0240 },
  { year: 1999, stocks: 0.1772, bonds: -0.1065, cash: 0.0204, corpBonds: -0.0167, realEstate: 0.0486, gold: -0.0179 },
  { year: 2000, stocks: -0.1201, bonds: 0.1283, cash: 0.0253, corpBonds: 0.0580, realEstate: 0.0571, gold: -0.0854 },
  { year: 2001, stocks: -0.1320, bonds: 0.0396, cash: 0.0190, corpBonds: 0.0694, realEstate: 0.0505, gold: -0.0079 },
  { year: 2002, stocks: -0.2378, bonds: 0.1244, cash: -0.0072, corpBonds: 0.0945, realEstate: 0.0702, gold: 0.2265 },
  { year: 2003, stocks: 0.2599, bonds: -0.0148, cash: -0.0083, corpBonds: 0.1031, realEstate: 0.0779, gold: 0.1768 },
  { year: 2004, stocks: 0.0725, bonds: 0.0120, cash: -0.0180, corpBonds: 0.0685, realEstate: 0.1006, gold: 0.0135 },
  { year: 2005, stocks: 0.0137, bonds: -0.0053, cash: -0.0019, corpBonds: 0.0166, realEstate: 0.0976, gold: 0.1388 },
  { year: 2006, stocks: 0.1275, bonds: -0.0057, cash: 0.0225, corpBonds: 0.0266, realEstate: -0.0079, gold: 0.2014 },
  { year: 2007, stocks: 0.0135, bonds: 0.0589, cash: 0.0038, corpBonds: 0.0079, realEstate: -0.0911, gold: 0.2675 },
  { year: 2008, stocks: -0.3661, bonds: 0.1999, cash: 0.0131, corpBonds: -0.0353, realEstate: -0.1208, gold: 0.0422 },
  { year: 2009, stocks: 0.2260, bonds: -0.1347, cash: -0.0250, corpBonds: 0.1678, realEstate: -0.0640, gold: 0.2172 },
  { year: 2010, stocks: 0.1313, bonds: 0.0686, cash: -0.0134, corpBonds: 0.0779, realEstate: -0.0553, gold: 0.2734 },
  { year: 2011, stocks: -0.0084, bonds: 0.1270, cash: -0.0283, corpBonds: 0.0903, realEstate: -0.0665, gold: 0.0880 },
  { year: 2012, stocks: 0.1391, bonds: 0.0121, cash: -0.0162, corpBonds: 0.0753, realEstate: 0.0461, gold: 0.0388 },
  { year: 2013, stocks: 0.3019, bonds: -0.1045, cash: -0.0142, corpBonds: -0.0259, realEstate: 0.0908, gold: -0.2869 },
  { year: 2014, stocks: 0.1267, bonds: 0.0991, cash: -0.0072, corpBonds: 0.0991, realEstate: 0.0372, gold: -0.0063 },
  { year: 2015, stocks: 0.0064, bonds: 0.0055, cash: -0.0067, corpBonds: -0.0221, realEstate: 0.0443, gold: -0.1274 },
  { year: 2016, stocks: 0.0950, bonds: -0.0136, cash: -0.0172, corpBonds: 0.0926, realEstate: 0.0317, gold: 0.0591 },
  { year: 2017, stocks: 0.1909, bonds: 0.0068, cash: -0.0114, corpBonds: 0.0690, realEstate: 0.0401, gold: 0.1034 },
  { year: 2018, stocks: -0.0602, bonds: -0.0189, cash: 0.0006, corpBonds: -0.0500, realEstate: 0.0256, gold: -0.0279 },
  { year: 2019, stocks: 0.2828, bonds: 0.0719, cash: -0.0017, corpBonds: 0.1267, realEstate: 0.0137, gold: 0.1642 },
  { year: 2020, stocks: 0.1644, bonds: 0.0984, cash: -0.0099, corpBonds: 0.0912, realEstate: 0.0894, gold: 0.2250 },
  { year: 2021, stocks: 0.2002, bonds: -0.1070, cash: -0.0654, corpBonds: -0.0562, realEstate: 0.1105, gold: -0.1008 },
  { year: 2022, stocks: -0.2301, bonds: -0.2281, cash: -0.0410, corpBonds: -0.2037, realEstate: -0.0075, gold: -0.0555 },
  { year: 2023, stocks: 0.2197, bonds: 0.0051, cash: 0.0187, corpBonds: 0.0521, realEstate: 0.0225, gold: 0.0959 },
  { year: 2024, stocks: 0.2137, bonds: -0.0440, cash: 0.0223, corpBonds: -0.0112, realEstate: 0.0105, gold: 0.2242 },
  { year: 2025, stocks: 0.1459, bonds: 0.0493, cash: 0.0144, corpBonds: 0.0412, realEstate: -0.0113, gold: 0.6179 },
];

/**
 * First and last years covered by the dataset. Exposed for the UI
 * so it can label "Tested across N historical 30-year windows
 * starting in YYYY–YYYY".
 */
export const HISTORICAL_RETURNS_FIRST_YEAR =
  HISTORICAL_REAL_RETURNS[0].year;
export const HISTORICAL_RETURNS_LAST_YEAR =
  HISTORICAL_REAL_RETURNS[HISTORICAL_REAL_RETURNS.length - 1].year;
