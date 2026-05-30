// @vitest-environment jsdom
/**
 * Sparkline-specific edge-case tests. Sparkline is a small inline
 * SVG generator on the HistoryTab — these pin the flat-series
 * div-by-zero defense, 2-point minimum, and aria-label plumbing
 * (round-3 audit gaps #15 + UI#3 regression).
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Sparkline } from "./HistoryTab";

afterEach(cleanup);

describe("Sparkline — edge cases", () => {
  it("renders null for a single-point series (< 2 points)", () => {
    const { container } = render(
      <Sparkline
        series={[{ t: 0, valueUSD: 100 }]}
        color="#000"
        label="X"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("handles a flat series (min === max) without div-by-zero", () => {
    // Round-3 audit gap #15: the `range === 0 ? 0.5 : ...` branch
    // guards against NaN in the polyline points. Without it, a
    // series of identical values would produce NaN coords and a
    // broken SVG.
    const { container } = render(
      <Sparkline
        series={[
          { t: 0, valueUSD: 100 },
          { t: 1000, valueUSD: 100 },
        ]}
        color="#000"
        label="Flat"
      />,
    );
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute("points")!;
    // Both y values should be at mid-height (height=40, so y=20).
    // Neither should be NaN.
    expect(points).not.toContain("NaN");
    expect(points.split(" ").every((p) => p.includes(","))).toBe(true);
  });

  it("plumbs the aria-label per-class (audit UI#3 regression pin)", () => {
    const { container } = render(
      <Sparkline
        series={[
          { t: 0, valueUSD: 50 },
          { t: 1, valueUSD: 100 },
        ]}
        color="#3b82f6"
        label="Stocks bucket trajectory, +50% total return"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBe(
      "Stocks bucket trajectory, +50% total return",
    );
    // Also inside as <title> for hover tooltip support.
    const title = svg!.querySelector("title");
    expect(title?.textContent).toBe(
      "Stocks bucket trajectory, +50% total return",
    );
  });

  it("renders a polygon (area fill) + polyline (line) for normal series", () => {
    const { container } = render(
      <Sparkline
        series={[
          { t: 0, valueUSD: 50 },
          { t: 1, valueUSD: 75 },
          { t: 2, valueUSD: 100 },
        ]}
        color="#3b82f6"
        label="OK"
      />,
    );
    expect(container.querySelector("polygon")).not.toBeNull();
    expect(container.querySelector("polyline")).not.toBeNull();
  });
});
