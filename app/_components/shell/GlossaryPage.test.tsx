// @vitest-environment jsdom
/**
 * GlossaryPage — focused UI tests.
 *
 * Component tests for the page complement the engine-level
 * `lib/data/glossary.test.ts` (which already pins content +
 * search-helper behavior). What this file pins specifically:
 *
 *   1. Initial render shows the sectioned layout (multiple
 *      sections + entries), not the filtered-list layout.
 *   2. Typing a known term in the search box switches to the
 *      filtered layout AND surfaces the matching entry.
 *   3. A no-match query renders the "No matches" status with
 *      the `role="status"` accessibility hook in place.
 *   4. External-source links have an `aria-label` that includes
 *      "opens in new tab" (so screen readers announce the
 *      out-of-app navigation).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlossaryPage } from "./GlossaryPage";

afterEach(() => cleanup());

describe("GlossaryPage — initial render", () => {
  it("renders the sectioned layout when no search query is active", () => {
    render(<GlossaryPage />);
    // Header.
    expect(screen.getByText(/^Glossary$/)).toBeInTheDocument();
    // Section headings (a sampling from `GLOSSARY`).
    expect(screen.getByText(/^Core concepts$/)).toBeInTheDocument();
    expect(screen.getByText(/^Stress testing$/)).toBeInTheDocument();
  });

  it("renders entries inside each section", () => {
    render(<GlossaryPage />);
    // A representative term from the core section.
    expect(screen.getByText(/^Financial Independence$/)).toBeInTheDocument();
    // A representative term from stress-testing.
    expect(screen.getByText(/^Monte Carlo simulation$/)).toBeInTheDocument();
  });
});

describe("GlossaryPage — search", () => {
  it("filters to matching entries when the user types a term", () => {
    render(<GlossaryPage />);
    const search = screen.getByLabelText(/Search glossary/i);
    fireEvent.change(search, { target: { value: "SWR" } });
    // The SWR (Safe Withdrawal Rate) entry has SWR as an alias.
    expect(
      screen.getByText(/^Safe Withdrawal Rate \(SWR\)$/),
    ).toBeInTheDocument();
    // A clearly-non-matching entry should NOT appear.
    expect(screen.queryByText(/^appDataFolder$/)).not.toBeInTheDocument();
  });

  it("renders no-match status with role='status' for accessibility", () => {
    render(<GlossaryPage />);
    const search = screen.getByLabelText(/Search glossary/i);
    fireEvent.change(search, { target: { value: "zzznotaterm" } });
    const noMatch = screen.getByRole("status");
    expect(noMatch).toBeInTheDocument();
    expect(noMatch.textContent).toMatch(/No matches/i);
  });

  it("is case-insensitive", () => {
    render(<GlossaryPage />);
    const search = screen.getByLabelText(/Search glossary/i);
    fireEvent.change(search, { target: { value: "fire" } });
    expect(screen.getByText(/^Financial Independence$/)).toBeInTheDocument();
  });
});

describe("GlossaryPage — accessibility on external links", () => {
  it("external-source anchors carry an 'opens in new tab' aria-label", () => {
    render(<GlossaryPage />);
    // The footer + the SWR entry both link to "Trinity Study
    // (Wikipedia)"; both must carry the "(opens in new tab)"
    // aria-label so SR users get the out-of-app navigation
    // warning at either entry point.
    const search = screen.getByLabelText(/Search glossary/i);
    fireEvent.change(search, { target: { value: "Safe Withdrawal" } });
    const trinityLinks = screen.getAllByLabelText(
      /Trinity Study \(Wikipedia\) \(opens in new tab\)/,
    );
    expect(trinityLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of trinityLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });
});
