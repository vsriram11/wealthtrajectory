// @vitest-environment jsdom
/**
 * Reference-data viewer modal tests. What's pinned:
 *
 *   1. Renders nothing when `open` is false (no DOM leak).
 *   2. Renders all 98 historical rows when open.
 *   3. Pre-2001 rows show the projected-2x "P" badge.
 *   4. 2001+ rows do NOT show the badge.
 *   5. Calls onClose when the close button is clicked.
 *   6. Calls onClose when the backdrop is clicked.
 *   7. Calls onClose on Escape keypress.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistoricalReturnsTableModal } from "./HistoricalReturnsTableModal";
import {
  HISTORICAL_REAL_RETURNS,
  LEVERAGED_2X_REAL_DATA_START_YEAR,
} from "@/lib/data/historicalReturns";

describe("HistoricalReturnsTableModal", () => {
  afterEach(() => cleanup());

  it("renders nothing when open=false (no DOM leak)", () => {
    const { container } = render(
      <HistoricalReturnsTableModal open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title and all 98 historical-data rows when open", () => {
    render(<HistoricalReturnsTableModal open={true} onClose={() => {}} />);
    expect(screen.getByText(/Real annual returns/)).toBeTruthy();
    // Year cells — one per row + the header. We assert presence of the
    // first and last covered years.
    expect(screen.getByText(String(HISTORICAL_REAL_RETURNS[0].year))).toBeTruthy();
    expect(
      screen.getByText(
        String(HISTORICAL_REAL_RETURNS[HISTORICAL_REAL_RETURNS.length - 1].year),
      ),
    ).toBeTruthy();
  });

  it("shows the 'P' badge on every pre-2001 row and none on 2001+ rows", () => {
    render(<HistoricalReturnsTableModal open={true} onClose={() => {}} />);
    // Count the "P" projected badges; should equal the count of
    // projected rows in the dataset.
    const projectedCount = HISTORICAL_REAL_RETURNS.filter(
      (r) => r.year < LEVERAGED_2X_REAL_DATA_START_YEAR,
    ).length;
    // The badge has aria-label="projected" — query by that, which
    // is also accessible-friendly.
    const badges = screen.getAllByLabelText("projected");
    expect(badges).toHaveLength(projectedCount);
  });

  it("invokes onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(<HistoricalReturnsTableModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <HistoricalReturnsTableModal open={true} onClose={onClose} />,
    );
    const backdrop = container.querySelector('[aria-hidden]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose on Escape keypress", () => {
    const onClose = vi.fn();
    render(<HistoricalReturnsTableModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onClose on non-Escape keys", () => {
    const onClose = vi.fn();
    render(<HistoricalReturnsTableModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
