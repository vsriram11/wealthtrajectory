/**
 * Glossary content + search tests.
 *
 * Pinned invariants:
 *   1. Every entry has a non-empty term and definition.
 *   2. Every source URL is well-formed (https://) — no relative or
 *      placeholder links.
 *   3. Section ids are unique.
 *   4. Term names are unique across the whole glossary (no
 *      cross-section dupes — would silently shadow each other in
 *      search results).
 *   5. searchGlossary returns expected matches for common queries
 *      that came from the user request (Reddit "totally green"
 *      visitor): "SORR", "4% rule", "Roth ladder", "Trinity",
 *      "withdrawal".
 *   6. Empty / whitespace-only query returns everything.
 *   7. No-match query returns empty array (UI shows "no matches"
 *      copy in that branch).
 */

import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  flattenGlossary,
  searchGlossary,
} from "@/lib/data/glossary";

describe("GLOSSARY — content invariants", () => {
  it("every entry has a non-empty term and definition", () => {
    for (const section of GLOSSARY) {
      for (const entry of section.entries) {
        expect(entry.term.trim().length).toBeGreaterThan(0);
        expect(entry.definition.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("section ids are unique", () => {
    const ids = GLOSSARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("term names are unique across the whole glossary", () => {
    const flat = flattenGlossary();
    const names = flat.map((e) => e.term);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every source URL is well-formed https://", () => {
    for (const section of GLOSSARY) {
      for (const entry of section.entries) {
        if (entry.source) {
          expect(entry.source.label.trim().length).toBeGreaterThan(0);
          expect(entry.source.href).toMatch(/^https:\/\//);
        }
      }
    }
  });
});

describe("searchGlossary", () => {
  it("returns everything when query is empty / whitespace", () => {
    const all = flattenGlossary().length;
    expect(searchGlossary("").length).toBe(all);
    expect(searchGlossary("   ").length).toBe(all);
    expect(searchGlossary("\t\n").length).toBe(all);
  });

  it("finds SORR (alias for sequence-of-returns risk)", () => {
    const r = searchGlossary("SORR");
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((e) => e.term.toLowerCase().includes("sequence"))).toBe(
      true,
    );
  });

  it("finds the 4% rule via 'withdrawal' search", () => {
    const r = searchGlossary("withdrawal");
    expect(r.length).toBeGreaterThan(0);
    // SWR entry must be present.
    expect(
      r.some((e) => e.term.toLowerCase().includes("safe withdrawal")),
    ).toBe(true);
  });

  it("finds the Roth ladder entry via partial match", () => {
    const r = searchGlossary("roth");
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((e) => e.term.toLowerCase().includes("roth"))).toBe(true);
  });

  it("finds Trinity Study references", () => {
    // Trinity appears in the SWR entry's definition.
    const r = searchGlossary("Trinity");
    expect(r.length).toBeGreaterThan(0);
  });

  it("returns empty array for a no-match query", () => {
    const r = searchGlossary("zzzqqqxxxnotaterm");
    expect(r.length).toBe(0);
  });

  it("is case-insensitive (same RESULT SET, not just same count)", () => {
    const upper = searchGlossary("MONTE CARLO");
    const lower = searchGlossary("monte carlo");
    expect(upper.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);
    // The vacuous-zero case (BOTH return 0) would pass a count-only
    // check. Pin the actual term sets so a regression that breaks
    // case-folding for one path can't silently pass.
    const upperTerms = upper.map((e) => e.term).sort();
    const lowerTerms = lower.map((e) => e.term).sort();
    expect(upperTerms).toEqual(lowerTerms);
  });

  it("each result carries its source-section metadata", () => {
    const r = searchGlossary("equity");
    expect(r.length).toBeGreaterThan(0);
    for (const entry of r) {
      expect(entry.sectionId.length).toBeGreaterThan(0);
      expect(entry.sectionTitle.length).toBeGreaterThan(0);
      // sectionId must match an actual section.
      expect(GLOSSARY.some((s) => s.id === entry.sectionId)).toBe(true);
    }
  });
});

describe("GLOSSARY — Reddit-feedback coverage", () => {
  // The user noted a Reddit commenter ("totally green") asking
  // for a 101 paper or book that explains the terms. The glossary
  // is the in-app answer. These tests pin that the glossary
  // actually covers the headline FIRE-research terms a green
  // visitor would search for.
  const REQUIRED_TERMS = [
    "Financial Independence",
    "FIRE",
    "Net worth",
    "Safe Withdrawal Rate",
    "4% rule",
    "Sequence-of-returns risk",
    "SORR",
    "Monte Carlo simulation",
    "Asset class",
    "Allocation",
    "Glide path",
    "Rebalance",
    "CAGR",
    "Real vs nominal",
    "Roth ladder",
    "RMD",
  ];

  for (const required of REQUIRED_TERMS) {
    it(`covers "${required}"`, () => {
      const r = searchGlossary(required);
      expect(r.length).toBeGreaterThan(0);
    });
  }
});
