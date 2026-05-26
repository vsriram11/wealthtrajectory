// @vitest-environment jsdom
/**
 * WaypointEditor — focused tests.
 *
 * Pinned behaviors:
 *   1. Seeds from the Vanguard preset when there's no active path.
 *   2. Loads-from-preset replaces the draft with the picked preset.
 *   3. Add / remove waypoint mutations work; remove is disabled when
 *      only 2 remain (the engine works at 1, but the UI enforces 2
 *      since a 1-waypoint glide is just a static target).
 *   4. Editing equity auto-fills bond = 1 - equity (sum-to-1 is
 *      structural, not validated).
 *   5. Save delegates to the onSave callback with the current
 *      draft; cancel calls onCancel.
 *   6. Duplicate-age inline warning surfaces (non-blocking).
 *   7. Out-of-range age inline warning surfaces.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WaypointEditor } from "./WaypointEditor";
import { GLIDE_PATH_PRESETS } from "@/lib/portfolio/glidePath";

afterEach(() => cleanup());

describe("WaypointEditor — initial state", () => {
  it("seeds from Vanguard preset when initial is null", () => {
    render(
      <WaypointEditor
        initial={null}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    // Vanguard preset's first age is 25. Confirm one row reads 25.
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(ageInputs[0]).toBeDefined();
    expect(Number(ageInputs[0].value)).toBe(
      GLIDE_PATH_PRESETS.vanguard_target_retirement.waypoints[0].age,
    );
  });

  it("seeds from initial when it has ≥2 waypoints", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 35, allocation: { equity: 0.65, bond: 0.35 } },
            { age: 60, allocation: { equity: 0.45, bond: 0.55 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(ageInputs.length).toBe(2);
    expect(Number(ageInputs[0].value)).toBe(35);
    expect(Number(ageInputs[1].value)).toBe(60);
  });
});

describe("WaypointEditor — mutations", () => {
  it("editing equity auto-fills bond", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 40, allocation: { equity: 0.7, bond: 0.3 } },
            { age: 70, allocation: { equity: 0.5, bond: 0.5 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const equityInputs = screen
      .getAllByLabelText(/equity/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(equityInputs[0], { target: { value: "55" } });
    // Bond should now read 45% for row 0. Filter to the row-level
    // labels (the header copy "Bond fills the remainder" also
    // matches /Bond/, so target the percentage-bearing text
    // specifically).
    expect(
      screen.getAllByText((_, el) =>
        (el?.textContent ?? "").trim().startsWith("Bond 45"),
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("add waypoint appends a row +5 years from the last", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 30, allocation: { equity: 0.8, bond: 0.2 } },
            { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/Add waypoint/i));
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(ageInputs.length).toBe(3);
    expect(Number(ageInputs[2].value)).toBe(65); // 60 + 5
  });

  it("remove waypoint is DISABLED when only 2 remain", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 30, allocation: { equity: 0.8, bond: 0.2 } },
            { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const removeButtons = screen.getAllByRole("button", {
      name: /Remove waypoint/i,
    });
    // With 2 rows, both remove buttons should be disabled (can't
    // drop below the editor's minimum).
    for (const btn of removeButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("remove waypoint is enabled when 3+ remain", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 30, allocation: { equity: 0.8, bond: 0.2 } },
            { age: 50, allocation: { equity: 0.6, bond: 0.4 } },
            { age: 70, allocation: { equity: 0.4, bond: 0.6 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const removeButtons = screen.getAllByRole("button", {
      name: /Remove waypoint/i,
    });
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("WaypointEditor — save/cancel", () => {
  it("save calls onSave with the current draft (waypoints array)", () => {
    const onSave = vi.fn();
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 40, allocation: { equity: 0.6, bond: 0.4 } },
            { age: 70, allocation: { equity: 0.4, bond: 0.6 } },
          ],
        }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/Save custom path/i));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.waypoints.length).toBe(2);
    expect(saved.waypoints[0].age).toBe(40);
    expect(saved.waypoints[0].allocation.equity).toBeCloseTo(0.6, 5);
  });

  it("cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <WaypointEditor
        initial={null}
        onSave={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("WaypointEditor — load-from-preset", () => {
  it("selecting a preset replaces the draft", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 30, allocation: { equity: 0.5, bond: 0.5 } },
            { age: 60, allocation: { equity: 0.5, bond: 0.5 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const select = screen.getByLabelText(
      /Load preset/i,
    ) as HTMLSelectElement;
    fireEvent.change(select, {
      target: { value: "rising_equity_pfau" },
    });
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    const pfauWaypoints = GLIDE_PATH_PRESETS.rising_equity_pfau.waypoints;
    expect(ageInputs.length).toBe(pfauWaypoints.length);
    expect(Number(ageInputs[0].value)).toBe(pfauWaypoints[0].age);
  });
});

describe("WaypointEditor — validation hints", () => {
  it("surfaces a 'Duplicate age' warning when two rows share an age", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 50, allocation: { equity: 0.6, bond: 0.4 } },
            { age: 70, allocation: { equity: 0.4, bond: 0.6 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    // Type 50 into the second row to collide with the first.
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(ageInputs[1], { target: { value: "50" } });
    expect(screen.getByText(/Duplicate age/i)).toBeInTheDocument();
  });

  it("surfaces an age-out-of-range warning at age < 18", () => {
    render(
      <WaypointEditor
        initial={{
          waypoints: [
            { age: 30, allocation: { equity: 0.6, bond: 0.4 } },
            { age: 70, allocation: { equity: 0.4, bond: 0.6 } },
          ],
        }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const ageInputs = screen
      .getAllByLabelText(/age/i)
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    fireEvent.change(ageInputs[0], { target: { value: "10" } });
    expect(screen.getByText(/outside 18-110/)).toBeInTheDocument();
  });
});
