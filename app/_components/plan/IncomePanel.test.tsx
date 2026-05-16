// @vitest-environment jsdom
/**
 * Plan → Income tab — focused tests.
 *
 * What's pinned:
 *
 *   1. Empty state renders explanatory copy when there are no
 *      streams + at least one household member exists.
 *   2. Add affordance dispatches addIncomeStream with the form
 *      values (start year, end year, amount, growth, owner).
 *   3. Inline label edit triggers updateIncomeStream on blur.
 *   4. Inline year / amount / growth edits dispatch a partial
 *      patch to updateIncomeStream.
 *   5. Delete is two-step (Cancel + Delete forever) — a stray
 *      tap shouldn't lose data.
 *   6. Add affordance is DISABLED when the household has zero
 *      members (no one to own the stream).
 *   7. End-year < start-year validation surfaces inline (the
 *      creator sheet's Add button stays disabled).
 *   8. Aggregate summary card renders the per-year preview when
 *      at least one stream is active.
 *
 * Drives the real Zustand store via setState rather than mocking
 * it — same approach used by the MembersSheet tests.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { IncomePanel } from "./IncomePanel";
import type { IncomeStream } from "@/lib/budget/incomeStreams";
import type { Household } from "@/lib/types";

const TEST_HOUSEHOLD: Household = {
  id: "h",
  members: [
    { id: "m1", displayName: "Alex" },
    { id: "m2", displayName: "Bob" },
  ],
  accounts: [],
  liabilities: [],
};

function seed(opts: {
  household?: Household;
  incomeStreams?: IncomeStream[];
  selectedMemberId?: string | null;
}) {
  useAppStore.setState({
    household: opts.household ?? TEST_HOUSEHOLD,
    incomeStreams: opts.incomeStreams ?? [],
    selectedMemberId: opts.selectedMemberId ?? null,
  });
}

afterEach(() => {
  cleanup();
  // Reset the singleton's collections so the next test starts
  // from a known empty state.
  useAppStore.setState({ incomeStreams: [], selectedMemberId: null });
});

describe("IncomePanel — empty state + creation", () => {
  it("renders empty-state copy when there are no streams", () => {
    seed({});
    render(<IncomePanel />);
    expect(screen.getByText(/No income streams yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/consulting.*pension.*Social Security/i),
    ).toBeInTheDocument();
  });

  it("disables the Add button when the household has zero members", () => {
    // No active members → nobody to own the stream → Add must
    // be disabled. UX: it's better to disable than to let the
    // user open the creator and find a blank owner picker.
    seed({
      household: {
        id: "h",
        members: [
          // Both excluded from rollups → no active members in
          // the household view.
          { id: "m1", displayName: "Alex", includeInRollup: false },
          { id: "m2", displayName: "Bob", includeInRollup: false },
        ],
        accounts: [],
        liabilities: [],
      },
    });
    render(<IncomePanel />);
    const addBtn = screen.getByRole("button", {
      name: /Add an income stream/i,
    });
    expect(addBtn).toBeDisabled();
  });

  it("opens the creator and adds a stream with form values", () => {
    seed({});
    render(<IncomePanel />);

    fireEvent.click(
      screen.getByRole("button", { name: /Add an income stream/i }),
    );
    // Creator sheet now visible.
    expect(
      screen.getByRole("dialog", { name: /Add income stream/i }),
    ).toBeInTheDocument();

    // Fill the form.
    fireEvent.change(screen.getByLabelText(/Stream label/i), {
      target: { value: "Consulting" },
    });
    fireEvent.change(screen.getByLabelText(/^Start year$/i), {
      target: { value: "2032" },
    });
    fireEvent.change(screen.getByLabelText(/^End year$/i), {
      target: { value: "2037" },
    });
    fireEvent.change(
      screen.getByLabelText(/Annual amount in real dollars/i),
      { target: { value: "80000" } },
    );
    // Real growth rate stays at 0 (default).

    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

    const streams = useAppStore.getState().incomeStreams;
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      label: "Consulting",
      startYear: 2032,
      endYear: 2037,
      annualUSD: 80_000,
      realGrowthRate: 0,
    });
  });

  it("disables the creator Add button when end-year precedes start-year", () => {
    seed({});
    render(<IncomePanel />);
    fireEvent.click(
      screen.getByRole("button", { name: /Add an income stream/i }),
    );

    fireEvent.change(screen.getByLabelText(/Stream label/i), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByLabelText(/^Start year$/i), {
      target: { value: "2040" },
    });
    fireEvent.change(screen.getByLabelText(/^End year$/i), {
      target: { value: "2030" },
    });

    // Inline validation message.
    expect(
      screen.getByText(/End year must be on or after start year/i),
    ).toBeInTheDocument();
    // The Add button (in the dialog footer) is disabled.
    const addInDialog = screen.getAllByRole("button", { name: /^Add$/i })[0];
    expect(addInDialog).toBeDisabled();
  });
});

describe("IncomePanel — list row inline edits", () => {
  const aStream: IncomeStream = {
    id: "inc-1",
    label: "Consulting",
    startYear: 2032,
    endYear: 2037,
    annualUSD: 80_000,
    realGrowthRate: 0,
    ownerId: "m1",
  };

  it("renames the stream on label-input blur", () => {
    seed({ incomeStreams: [aStream] });
    render(<IncomePanel />);

    const labelInput = screen.getByLabelText(/^Stream label$/i);
    fireEvent.change(labelInput, { target: { value: "Side gig" } });
    fireEvent.blur(labelInput);

    expect(useAppStore.getState().incomeStreams[0].label).toBe("Side gig");
  });

  it("updates the annual amount inline", () => {
    seed({ incomeStreams: [aStream] });
    render(<IncomePanel />);

    const amountInput = screen.getByLabelText(
      /Annual amount in real dollars/i,
    );
    fireEvent.change(amountInput, { target: { value: "120000" } });
    // NumberField dispatches on change after parsing.
    expect(useAppStore.getState().incomeStreams[0].annualUSD).toBe(120_000);
  });

  it("delete is two-step (cancel + confirm)", () => {
    seed({ incomeStreams: [aStream] });
    render(<IncomePanel />);

    // First click reveals confirmation buttons; doesn't delete.
    fireEvent.click(screen.getByRole("button", { name: /Delete Consulting/i }));
    expect(useAppStore.getState().incomeStreams).toHaveLength(1);

    // Cancel walks it back.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(useAppStore.getState().incomeStreams).toHaveLength(1);

    // Re-open and confirm.
    fireEvent.click(screen.getByRole("button", { name: /Delete Consulting/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Delete forever/i }),
    );
    expect(useAppStore.getState().incomeStreams).toHaveLength(0);
  });
});

describe("IncomePanel — aggregate summary", () => {
  it("renders the per-year preview when at least one stream is active", () => {
    const thisYear = new Date().getFullYear();
    seed({
      incomeStreams: [
        {
          id: "inc-1",
          label: "Active now",
          startYear: thisYear,
          endYear: thisYear + 2,
          annualUSD: 50_000,
          realGrowthRate: 0,
          ownerId: "m1",
        },
      ],
    });
    render(<IncomePanel />);
    expect(
      screen.getByLabelText(/Income summary by year/i),
    ).toBeInTheDocument();
    // The current year + the two following years should appear
    // as rows in the summary.
    expect(screen.getByText(String(thisYear))).toBeInTheDocument();
    expect(screen.getByText(String(thisYear + 1))).toBeInTheDocument();
  });

  it("hides the summary when the user's only stream is in the past (zero current/future years)", () => {
    seed({
      incomeStreams: [
        {
          id: "inc-1",
          label: "Past gig",
          startYear: 1990,
          endYear: 2000,
          annualUSD: 10_000,
          realGrowthRate: 0,
          ownerId: "m1",
        },
      ],
    });
    render(<IncomePanel />);
    expect(screen.queryByLabelText(/Income summary by year/i)).toBeNull();
  });
});

describe("IncomePanel — rollup-include composition", () => {
  it("hides streams owned by excluded members in the household view", () => {
    seed({
      household: {
        id: "h",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob", includeInRollup: false },
        ],
        accounts: [],
        liabilities: [],
      },
      incomeStreams: [
        {
          id: "inc-1",
          label: "Alex consulting",
          startYear: 2030,
          endYear: 2035,
          annualUSD: 80_000,
          realGrowthRate: 0,
          ownerId: "m1",
        },
        {
          id: "inc-2",
          label: "Bob pension",
          startYear: 2030,
          endYear: 2035,
          annualUSD: 24_000,
          realGrowthRate: 0,
          ownerId: "m2",
        },
      ],
    });
    render(<IncomePanel />);
    expect(screen.getByDisplayValue("Alex consulting")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Bob pension")).toBeNull();
  });

  it("shows an excluded member's stream when that member is explicitly picked", () => {
    // Per-member view always shows that member's data — even
    // if they're rollup-excluded — so the user can inspect.
    seed({
      household: {
        id: "h",
        members: [
          { id: "m1", displayName: "Alex" },
          { id: "m2", displayName: "Bob", includeInRollup: false },
        ],
        accounts: [],
        liabilities: [],
      },
      incomeStreams: [
        {
          id: "inc-1",
          label: "Alex consulting",
          startYear: 2030,
          endYear: 2035,
          annualUSD: 80_000,
          realGrowthRate: 0,
          ownerId: "m1",
        },
        {
          id: "inc-2",
          label: "Bob pension",
          startYear: 2030,
          endYear: 2035,
          annualUSD: 24_000,
          realGrowthRate: 0,
          ownerId: "m2",
        },
      ],
      selectedMemberId: "m2",
    });
    render(<IncomePanel />);
    expect(screen.getByDisplayValue("Bob pension")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alex consulting")).toBeNull();
  });
});
