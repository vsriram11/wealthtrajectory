import { describe, expect, it } from "vitest";
import { isPastOrToday, parseISODate, todayISODate } from "./dateInput";

describe("parseISODate", () => {
  it("parses a well-formed past date to noon UTC", () => {
    const t = parseISODate("2020-06-15");
    expect(t).toBe(Date.UTC(2020, 5, 15, 12, 0, 0, 0));
  });

  it("returns null for malformed strings", () => {
    expect(parseISODate("")).toBeNull();
    expect(parseISODate("abc")).toBeNull();
    expect(parseISODate("2024-6-15")).toBeNull(); // missing leading zero
    expect(parseISODate("2024/06/15")).toBeNull(); // wrong separator
    expect(parseISODate("2024-06-15T12:00")).toBeNull(); // not pure date
  });

  it("returns null for OVER-NORMALIZED invalid dates (audit BLOCK fix)", () => {
    // The silent-overwrite bug: JS Date silently shifts
    // "2024-02-31" to March 2, "2024-13-01" to January 1, 2025.
    // The round-trip check rejects these.
    expect(parseISODate("2024-02-31")).toBeNull(); // Feb has 29 days in 2024
    expect(parseISODate("2024-02-30")).toBeNull();
    expect(parseISODate("2023-02-29")).toBeNull(); // 2023 not leap
    expect(parseISODate("2024-13-01")).toBeNull(); // month 13
    expect(parseISODate("2024-04-31")).toBeNull(); // Apr has 30
    expect(parseISODate("2024-06-00")).toBeNull(); // day 0
    expect(parseISODate("2024-00-15")).toBeNull(); // month 0
  });

  it("accepts leap-year Feb 29", () => {
    expect(parseISODate("2024-02-29")).toBe(Date.UTC(2024, 1, 29, 12));
  });

  it("returns null for NaN-shaped inputs", () => {
    expect(parseISODate("aaaa-bb-cc")).toBeNull();
    expect(parseISODate("9999-99-99")).toBeNull();
  });
});

describe("todayISODate", () => {
  it("returns a well-formed YYYY-MM-DD parseable by parseISODate", () => {
    const today = todayISODate();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseISODate(today)).not.toBeNull();
  });
});

describe("isPastOrToday", () => {
  it("accepts today's date", () => {
    expect(isPastOrToday(todayISODate())).toBe(true);
  });

  it("accepts a date in the past", () => {
    expect(isPastOrToday("2020-01-01")).toBe(true);
  });

  it("rejects a date in the future", () => {
    expect(isPastOrToday("2099-12-31")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isPastOrToday("not-a-date")).toBe(false);
    expect(isPastOrToday("2024-02-31")).toBe(false); // over-normalized
  });

  it("is independent of clock hour (accepts today even at 3am UTC) — user-reported bug regression pin", () => {
    // Reproduces the no-op-Confirm-button bug: the prior
    // implementation compared the parsed timestamp (noon UTC)
    // against Date.now() at moment precision. At 3am UTC, today's
    // noon-UTC anchor is in the future → comparison failed.
    // isPastOrToday uses lexicographic date-string comparison,
    // so "today" always passes regardless of hour.
    const today = todayISODate();
    expect(isPastOrToday(today)).toBe(true);
  });
});
