"use client";

import { useMemo, useState } from "react";
import {
  GLOSSARY,
  searchGlossary,
  type GlossaryEntry,
} from "@/lib/data/glossary";

/**
 * User-facing glossary. Plain-language definitions of every term
 * the app uses, plus external references for further reading.
 *
 * Sourced from `lib/data/glossary.ts` (which in turn sources from
 * docs/Glossary.md but rewrites for end-user readability). Search
 * matches term + definition + aliases, case-insensitive.
 *
 * UX choices:
 *   1. Search bar at the top is sticky-ish (top of scroll) so a
 *      user looking for "SORR" can find it without scrolling
 *      through the whole list.
 *   2. Sectioned layout matches the conceptual grouping in the
 *      dev glossary — Core / Rates / Drawdown / Allocation / Tax /
 *      Tests / Scenarios / Storage. Section headers stick during
 *      scroll on long lists so the user keeps their context.
 *   3. External sources render as small underlined links. Only
 *      sources with stable, well-established URLs are included
 *      (Wikipedia / IRS / Kitces / Damodaran / Bogleheads). We
 *      don't ship speculative links.
 */
export function GlossaryPage() {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();

  // When the user hasn't typed anything, render the full sectioned
  // layout. When they have, switch to a flat filtered list grouped
  // by section heading.
  const results = useMemo(() => searchGlossary(trimmedQuery), [trimmedQuery]);
  const hasQuery = trimmedQuery.length > 0;

  return (
    <section className="px-5 pb-8 pt-3">
      <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Glossary
          </h2>
          <div className="mt-0.5 text-[11px] text-text-dim">
            Plain-language definitions of every term in the app.
          </div>
        </div>
        <div className="text-[11px] text-text-dim">
          {flattenedCount()} terms
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-1 mb-3 bg-bg/95 px-1 pb-2 pt-1 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — SORR, glide path, Roth ladder, bucket…"
          aria-label="Search glossary"
          className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>

      {hasQuery ? (
        <FilteredList results={results} />
      ) : (
        <SectionedList />
      )}

      <div className="mt-6 rounded-md border border-border bg-bg-elevated px-3 py-2.5 text-[11px] leading-snug text-text-dim">
        Coming from a Reddit thread or a friend&apos;s pitch? Two
        good starting points: the{" "}
        <a
          href="https://en.wikipedia.org/wiki/Trinity_study"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          Trinity Study (Wikipedia)
        </a>{" "}
        for the 4% rule background, and{" "}
        <a
          href="https://www.kitces.com/blog/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          Michael Kitces&apos; blog
        </a>{" "}
        for deep dives on every drawdown / SORR / allocation
        question this app surfaces.
      </div>
    </section>
  );
}

function flattenedCount(): number {
  return GLOSSARY.reduce((n, s) => n + s.entries.length, 0);
}

function SectionedList() {
  return (
    <>
      {GLOSSARY.map((section) => (
        <div key={section.id} className="mb-6">
          <div className="mb-2 px-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              {section.title}
            </h3>
            <div className="mt-0.5 text-[11px] text-text-dim">
              {section.blurb}
            </div>
          </div>
          <ul className="space-y-2">
            {section.entries.map((entry) => (
              <EntryCard key={entry.term} entry={entry} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function FilteredList({
  results,
}: {
  results: Array<GlossaryEntry & { sectionId: string; sectionTitle: string }>;
}) {
  if (results.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-strong bg-bg-elevated px-4 py-6 text-center text-[12px] text-text-dim">
        No matches. Try a broader term — &ldquo;equity&rdquo;,
        &ldquo;tax&rdquo;, &ldquo;withdrawal&rdquo;.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {results.map((entry) => (
        <EntryCard
          key={`${entry.sectionId}-${entry.term}`}
          entry={entry}
          sectionLabel={entry.sectionTitle}
        />
      ))}
    </ul>
  );
}

function EntryCard({
  entry,
  sectionLabel,
}: {
  entry: GlossaryEntry;
  sectionLabel?: string;
}) {
  return (
    <li className="rounded-md border border-border bg-bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-text">{entry.term}</div>
        {sectionLabel && (
          <span className="shrink-0 rounded-full bg-bg-elevated px-2 py-0.5 text-[9px] uppercase tracking-wider text-text-muted">
            {sectionLabel}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-text">
        {entry.definition}
      </p>
      {entry.source && (
        <a
          href={entry.source.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {entry.source.label}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
    </li>
  );
}
