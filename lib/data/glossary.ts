/**
 * User-facing glossary entries — sourced from docs/Glossary.md but
 * rewritten for plain-language readability. The dev glossary is
 * the spec; this is the explanation a new user can actually use.
 *
 * Sources are added where:
 *   - The term has a canonical academic / regulatory reference
 *     (Trinity Study, IRS RMD rules, BLS CEX, etc.).
 *   - The term refers to a strategy with a well-known champion
 *     (Pfau / Kitces / Bengen).
 *
 * URLs included here must be stable + well-established. Don't add
 * speculative or low-confidence URLs — better to ship without a
 * source than with a dead link.
 */

export type GlossaryEntry = {
  /** Display name shown as the entry's heading. */
  term: string;
  /** Plain-language explanation, 1-3 sentences typical. */
  definition: string;
  /** Optional. External reference for further reading. */
  source?: {
    label: string;
    href: string;
  };
  /** Alternate names / search aliases (lowercase). */
  aliases?: string[];
};

export type GlossarySection = {
  id: string;
  title: string;
  blurb: string;
  entries: GlossaryEntry[];
};

export const GLOSSARY: GlossarySection[] = [
  {
    id: "core",
    title: "Core concepts",
    blurb:
      "The terms behind the headline numbers — what we're measuring and why.",
    entries: [
      {
        term: "Financial Independence",
        definition:
          "Your investment portfolio can sustainably cover your living expenses without further wage income. The term doesn't mean you have to stop working — it just means working becomes optional. Often abbreviated FIRE (Financial Independence, Retire Early).",
        source: {
          label: "Wikipedia: FIRE movement",
          href: "https://en.wikipedia.org/wiki/FIRE_movement",
        },
        aliases: ["fire", "financial independence", "retire early"],
      },
      {
        term: "Independence date",
        definition:
          "The earliest projected date your portfolio reaches its target value under your current plan — your savings rate, expected return, inflation, and withdrawal rate. Most cards in the app calculate this directly.",
        aliases: ["fi date", "retirement date"],
      },
      {
        term: "Independence target",
        definition:
          "The portfolio size — in today's dollars — that supports your planned annual spending at the chosen safe withdrawal rate. The simple rule of thumb is target = annual spending ÷ withdrawal rate. For $40k/yr spending at a 4% withdrawal, target ≈ $1M.",
        aliases: ["target net worth", "target nw", "fi number"],
      },
      {
        term: "Net worth (NW)",
        definition:
          "Assets minus liabilities. Real-estate equity is the home's market value minus the outstanding mortgage. All numbers in the app are in today's dollars (real terms) unless a card explicitly labels them as nominal.",
        aliases: ["nw", "wealth"],
      },
      {
        term: "Household vs member",
        definition:
          "A household is one or more people whose finances you're modeling together. Each account / liability has an owner. The member chip in the top nav lets you scope every number to just that person — useful for joint planning or comparing what-ifs across spouses.",
      },
    ],
  },

  {
    id: "rates",
    title: "Rates and dollars",
    blurb: "How returns, growth, and inflation are accounted for.",
    entries: [
      {
        term: "Real vs nominal",
        definition:
          "Nominal dollars are the face-value, sticker-price number. Real dollars are inflation-adjusted, in today's purchasing power. The entire app — projection engine, withdrawal rates, target NW, stress tests — runs in real terms. Cards that show nominal numbers always label them.",
        source: {
          label: "Investopedia: Real vs Nominal",
          href: "https://www.investopedia.com/ask/answers/032515/what-difference-between-real-and-nominal-interest-rates.asp",
        },
        aliases: ["inflation-adjusted", "today's dollars"],
      },
      {
        term: "CAGR",
        definition:
          "Compound Annual Growth Rate — the geometric average return that maps a starting balance to an ending balance over multiple years. A portfolio that goes from $100k to $200k over 10 years has a CAGR of roughly 7.2%, not 10% (the geometric average accounts for compounding).",
        source: {
          label: "Wikipedia: CAGR",
          href: "https://en.wikipedia.org/wiki/Compound_annual_growth_rate",
        },
        aliases: ["compound annual growth rate", "annualized return"],
      },
      {
        term: "Inflation rate",
        definition:
          "Your assumed annual CPI rate, used wherever the app converts between nominal and real dollars. The historical US average is ~3%, which is the default. Most planning research assumes 2.5–3.5%.",
        aliases: ["cpi", "inflation"],
      },
      {
        term: "Expected return",
        definition:
          "Your assumption about forward-looking annual returns — in real (after-inflation) terms. Conservative planning often uses 5–6% for diversified stocks; 1–2% for high-quality bonds. The app stores this per-holding so a TIPS bucket can be more conservative than a tech-heavy ETF.",
      },
      {
        term: "Variable share of retirement spend",
        definition:
          "The fraction of your retirement spending that's discretionary (food, travel, entertainment) and therefore subject to cuts in down years. The other fraction is fixed (housing, insurance, healthcare). The BLS pegs the median retiree at ~35% variable; the app defaults to that when you haven't entered budget items.",
        source: {
          label: "BLS Consumer Expenditure Survey",
          href: "https://www.bls.gov/cex/",
        },
      },
    ],
  },

  {
    id: "drawdown",
    title: "Withdrawal & drawdown",
    blurb: "How money comes back out of the portfolio in retirement.",
    entries: [
      {
        term: "Safe Withdrawal Rate (SWR)",
        definition:
          "The fraction of your starting portfolio you can withdraw annually (adjusted for inflation) with a high probability of surviving the planned horizon. 4% is the canonical Trinity Study number for 30 years; longer horizons (45+ years for early retirees) typically need 3.0–3.5%.",
        source: {
          label: "Trinity Study (Wikipedia)",
          href: "https://en.wikipedia.org/wiki/Trinity_study",
        },
        aliases: ["swr", "4 percent rule", "4% rule", "withdrawal rate"],
      },
      {
        term: "Drawdown horizon",
        definition:
          "How many years your portfolio must sustain withdrawals after retirement. 30 years is the Trinity baseline (retire at 65 → 95). For early retirees in their 30s or 40s, 45+ years is realistic and demands lower withdrawal rates or stronger income.",
      },
      {
        term: "Sequence-of-returns risk (SORR)",
        definition:
          "The risk that a poor sequence of returns EARLY in retirement causes failure even when long-run average returns are adequate. A 30% crash in year 1 of retirement is much more damaging than the same crash in year 25, because you've already sold equity at the bottom to fund spending. SORR is why the Stress test matters more than 'average return' projections.",
        source: {
          label: "Wikipedia: Sequence risk",
          href: "https://en.wikipedia.org/wiki/Sequence_risk",
        },
        aliases: ["sorr", "sequence risk", "sequence of returns"],
      },
      {
        term: "Drawdown phases",
        definition:
          "Distinct life stages of retirement spending — the 'go-go / slow-go / no-go' pattern researchers consistently observe (Pfau / Blanchett / Drak). Active early retirement spends more on travel; later years spend less on activities but more on healthcare. The app lets you model phase shifts so the projection doesn't assume a single flat withdrawal forever.",
        // (No source link: the file's own docstring says don't
        // ship low-confidence URLs. The canonical academic
        // citations are scattered across multiple Pfau and
        // Blanchett papers — better to name the researchers than
        // guess at a single article.)
      },
      {
        term: "Variable haircut",
        definition:
          "A planned reduction in your discretionary spending in retirement. Applied either every year (conservative; maximum survival but permanent lifestyle cut) OR only in years following a market drop (the 'spend less when scared' guardrail style, after Guyton & Klinger).",
        source: {
          label: "Kitces on Guyton-Klinger guardrails",
          href: "https://www.kitces.com/blog/guyton-klinger-decision-rules-for-safe-withdrawal-rates/",
        },
      },
      {
        term: "Fixed-nominal years",
        definition:
          "An SORR-mitigation tactic: freeze your withdrawal amount in nominal terms (no inflation adjustment) for the first N years of retirement. The cumulative real spend reduction over the early-retirement danger zone (typically 10 years at 3% inflation ≈ 14% of one year's spend) buys meaningful tail-risk relief. Configured on the Assumptions panel.",
      },
      {
        term: "Cash-bucket strategy",
        definition:
          "Sometimes called the 'bond tent' or 'two-bucket' approach (originally popularized by Harold Evensky). Hold a small cash slice (typically 5%) at retirement; in years following a market drop, fund the year's spending from this bucket instead of selling equity at depressed prices. The MC stress test exposes this as a 'Cash-bucket priority' toggle that's ORTHOGONAL to the rebalance policy: with Annual rebalance the bucket refills each year (Kitces 'refilling reserve' — within-year liquidity protection, observationally equivalent to no-bucket at year-end MC snapshots); with None rebalance the bucket is never refilled by rebalance and trends toward depletion (Pfau 'depleting reserve' — finite SORR shield for the early-retirement danger zone, observably divergent in MC outcomes).",
        // (No source link: the bond-tent literature is spread
        // across Evensky / Kitces / Pfau articles, no single
        // canonical URL covers what THIS engine implements.
        // Better to name the originator than guess at a link.)
        aliases: ["bond tent", "bucket strategy", "two-bucket"],
      },
      {
        term: "RMD (Required Minimum Distribution)",
        definition:
          "The minimum withdrawal the IRS requires you to take from tax-deferred accounts (traditional IRA / 401(k)) starting at age 73 (or 75 under SECURE 2.0, depending on birth year). RMDs reduce your discretion over which buckets to drain first in retirement.",
        source: {
          label: "IRS RMD overview",
          href: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-required-minimum-distributions-rmds",
        },
        aliases: ["required minimum distribution", "rmd"],
      },
    ],
  },

  {
    id: "allocation",
    title: "Allocation & exposure",
    blurb: "What you own and how it's classified for stress-testing.",
    entries: [
      {
        term: "Asset class",
        definition:
          "Top-level bucket for what kind of thing you own: equity (stocks), bond, cash, commodity (typically gold), real estate, crypto, private stock, or other. The Stress test treats each class with its own historical return series.",
      },
      {
        term: "Allocation",
        definition:
          "The percent of your net worth held in each asset class. Computed on EFFECTIVE exposure, not face value, when leverage is present — a $100k position in a 2x ETF counts as $200k of equity exposure.",
      },
      {
        term: "Glide path",
        definition:
          "A planned shift in allocation with age — typically more equity early, more bonds later. The app models glide paths as a sequence of {age, allocation} waypoints with linear interpolation. The Vanguard/Fidelity target-date fund families all use this shape.",
      },
      {
        term: "Rising-equity glide path (Pfau / Kitces)",
        definition:
          "An unusual but well-researched shape: dip equity at the START of retirement to insulate against the early-retirement SORR danger zone, then RAMP equity back up as the portfolio's survival becomes more established. Counterintuitive but solid math — published 2014.",
        source: {
          label: "Kitces: Rising-equity glide paths",
          href: "https://www.kitces.com/blog/rising-equity-glidepaths-in-retirement/",
        },
      },
      {
        term: "Leverage ratio",
        definition:
          "Effective exposure ÷ equity. A 2x leveraged ETF has leverage = 2. A home with an 80% loan-to-value mortgage has leverage ≈ 5x (you control $1 of housing exposure per $0.20 of equity). Cash and unlevered stocks have leverage = 1.",
      },
      {
        term: "Capital-efficient multi-asset wrappers",
        definition:
          "Funds like NTSX (90/60 stocks/bonds), GDE (90/90 stocks/gold), RSSB and RSST (100/100 return-stacked) combine equity with diversifying assets at mild leverage in one product. The app's stress test decomposes these across their real underlying classes — they're NOT flagged as 'risky leveraged ETFs' because the diversification offsets the mild leverage.",
      },
      {
        term: "Leveraged ETF restructure (3x deleveraging)",
        definition:
          "The stress test models a realistic retirement-date restructure for non-recognized leveraged ETFs: 3x S&P (UPRO/SPXL) → 2x S&P; 3x Nasdaq (TQQQ) → 2x Nasdaq; concentrated sector leverage (SOXL, FAS, …) → 1x broad equity. Capital-gains tax on the restructure (for taxable accounts) reduces starting NW for the simulation. Surfaced on the Allocation page when you hold these.",
      },
    ],
  },

  {
    id: "tax",
    title: "Tax treatment",
    blurb: "Where your assets are sheltered and where they're not.",
    entries: [
      {
        term: "Tax buckets",
        definition:
          "Each account maps to one tax treatment. Pre-tax (traditional 401(k), traditional IRA — taxed on withdrawal). Roth (after-tax contributions, tax-free growth). HSA (triple-tax-advantaged for medical). Taxable (brokerage, savings — capital gains and dividends taxed). Education (529 plans + Trump Accounts — tax-advantaged for kids' future).",
        source: {
          label: "IRS retirement-plan rules",
          href: "https://www.irs.gov/retirement-plans",
        },
      },
      {
        term: "Asset location",
        definition:
          "The discipline of placing tax-INEFFICIENT assets (bonds, REITs — they kick off taxable income) in tax-deferred or Roth accounts, and tax-EFFICIENT assets (broad equity index, qualified dividends) in taxable brokerage. Different from asset allocation, which is WHAT you own.",
        source: {
          label: "Bogleheads wiki: Tax-efficient fund placement",
          href: "https://www.bogleheads.org/wiki/Tax-efficient_fund_placement",
        },
      },
      {
        term: "Roth conversion ladder",
        definition:
          "A planning technique for early retirees: convert pre-tax dollars to Roth annually during low-income years; after a 5-year seasoning period, those conversions can be withdrawn penalty-free (before age 59½). Surfaced as a planning tool in the app, not automated.",
        source: {
          label: "Mad Fientist: Roth ladder explainer",
          href: "https://www.madfientist.com/how-to-access-retirement-funds-early/",
        },
        aliases: ["roth ladder", "conversion ladder"],
      },
    ],
  },

  {
    id: "tests",
    title: "Stress testing",
    blurb: "How the app stress-tests your plan against history.",
    entries: [
      {
        term: "Monte Carlo simulation",
        definition:
          "A simulation that runs your plan across many possible return sequences and reports how often it survives. The app runs HISTORICAL Monte Carlo by default — replaying actual 1928-2025 sequences — plus a block-bootstrap mode for wider distributions when you want more paths.",
        source: {
          label: "Wikipedia: Monte Carlo methods in finance",
          href: "https://en.wikipedia.org/wiki/Monte_Carlo_methods_in_finance",
        },
        aliases: ["mc", "historical monte carlo"],
      },
      {
        term: "Success rate",
        definition:
          "Fraction of simulated paths where the portfolio ends the drawdown horizon with positive balance (or above your legacy floor). 95% is the Trinity baseline at 4% / 30y / 60-40. Higher withdrawal rates and longer horizons push this down materially.",
      },
      {
        term: "Single-shock stress test",
        definition:
          "A one-off 'what if next year is 2008' test — distinct from Monte Carlo's full historical replay. Useful as a quick orientation; less informative than MC for long-horizon planning.",
      },
      {
        term: "Damodaran historical dataset",
        definition:
          "The annual real-returns dataset the app uses: S&P 500, 10-year T-bonds, 3-month T-bills, Baa corporate bonds, real estate, gold, plus an RYTNX-derived 2x SPY series. Sourced from Aswath Damodaran at NYU Stern's published refresh (Jan 2026).",
        source: {
          label: "Damodaran data archives",
          href: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/data.html",
        },
      },
    ],
  },

  {
    id: "scenarios",
    title: "Scenarios & what-ifs",
    blurb: "Modeling alternate plans side-by-side.",
    entries: [
      {
        term: "Scenario",
        definition:
          "A named alternate plan — different contribution amounts, different per-holding CAGRs, different target NW or withdrawal rate. Activate a scenario from the chip row on the Home page to see your projections through that lens. Stress test, allocation, and projection cards all respect the active scenario.",
      },
      {
        term: "Sensitivity",
        definition:
          "A quick strip showing how the Independence date moves under ±2 points of expected CAGR, or 0.5×–2× savings rate. Surfaces how brittle (or robust) your plan is to its inputs.",
      },
      {
        term: "What-if savings",
        definition:
          "Interactive slider: how much sooner (or later) does Independence arrive if you save an additional $X per month from today. Live recalculation as you drag.",
      },
      {
        term: "Income stream",
        definition:
          "A future-income source: consulting work, pension, Social Security, rental income, etc. Each stream has start year, end year, annual amount (real dollars), real growth rate, and owner. The Stress test consumes these — positive streams improve survival; negative streams (partial-coast distributions, sabbatical bridges) model a planned drain.",
      },
    ],
  },

  {
    id: "storage",
    title: "Storage & sync",
    blurb: "Where your data lives and how it moves between devices.",
    entries: [
      {
        term: "Local-first",
        definition:
          "All your data lives in your browser by default — never on a server. Cloud sync is opt-in via Google Drive (private per-app sandbox; only this app sees the file). Export-to-encrypted-file works without any sign-in.",
      },
      {
        term: "appDataFolder",
        definition:
          "Google Drive's per-app private sandbox. Each app sees only files it created; you can revoke access from your Google account to wipe it. The app uses this as its backup target.",
        source: {
          label: "Google Drive: appdata folder",
          href: "https://developers.google.com/drive/api/guides/appdata",
        },
      },
      {
        term: "Snapshot",
        definition:
          "A point-in-time record of your portfolio state, used for trailing growth-velocity and historical net-worth charts. Stored in nominal dollars (the prices at the time); the app converts to real terms when displayed.",
      },
      {
        term: "Encrypted export",
        definition:
          "Data → Export creates a passphrase-protected file (AES-256-GCM) you can move via AirDrop, Dropbox, email, USB — anything that transports a file. Import on another device to restore. No sign-in needed.",
      },
    ],
  },
];

/**
 * Module-scope flattened cache. The glossary is static at build
 * time; `searchGlossary` runs once per keystroke inside the page's
 * useMemo, so rebuilding the flat array each call would allocate
 * O(N) per stroke. Hoist + freeze once.
 */
const FLATTENED: ReadonlyArray<
  GlossaryEntry & { sectionId: string; sectionTitle: string }
> = (() => {
  const out: Array<GlossaryEntry & { sectionId: string; sectionTitle: string }> =
    [];
  for (const section of GLOSSARY) {
    for (const entry of section.entries) {
      out.push({
        ...entry,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }
  return out;
})();

/**
 * Flatten all entries for search. Each entry's metadata (section
 * title + section id) is attached so search results can show the
 * section context.
 */
export function flattenGlossary(): ReadonlyArray<
  GlossaryEntry & { sectionId: string; sectionTitle: string }
> {
  return FLATTENED;
}

/**
 * Filter glossary by a free-text query — matches against term,
 * definition, and aliases. Case-insensitive. Empty query returns
 * everything.
 */
export function searchGlossary(
  query: string,
): ReadonlyArray<GlossaryEntry & { sectionId: string; sectionTitle: string }> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return FLATTENED;
  return FLATTENED.filter((e) => {
    if (e.term.toLowerCase().includes(q)) return true;
    if (e.definition.toLowerCase().includes(q)) return true;
    if (e.aliases?.some((a) => a.includes(q))) return true;
    return false;
  });
}
