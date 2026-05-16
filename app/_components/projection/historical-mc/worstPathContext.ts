/**
 * Map a historical start-year to its human-recognizable downturn
 * label. Used by the "worst historical start" narrative in
 * HistoricalMonteCarloCard ("This was likely the …").
 *
 * The windows are intentionally fuzzy at the edges — they include
 * the lead-up year for crashes that bottomed across two calendar
 * years (e.g. 2007 vs 2008 for the GFC).
 */
export function worstPathContext(yearStr: string): string {
  const year = parseInt(yearStr, 10);
  if (year >= 1928 && year <= 1932) return "Great Depression";
  if (year >= 1965 && year <= 1972) return "1970s stagflation period";
  if (year >= 1999 && year <= 2002) {
    return "dot-com bust + early-2000s lost decade";
  }
  if (year >= 2007 && year <= 2009) return "Global Financial Crisis";
  if (year >= 2020 && year <= 2022) return "post-COVID inflation shock";
  return "historical drawdown period";
}
