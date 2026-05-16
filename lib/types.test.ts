/**
 * Account-category contract — pin every AccountCategory's label +
 * tax-treatment mapping so a careless rename or a forgotten entry in
 * the parallel maps fails loudly in CI.
 *
 * Why this file exists: TAX_TREATMENT_BY_CATEGORY and
 * ACCOUNT_CATEGORY_LABELS are two `Record<AccountCategory, ...>`
 * structures. TypeScript's `Record<>` exhaustiveness flags missing
 * keys at compile time, but it does NOT catch:
 *   - A new category that compiles but is silently misrouted
 *     (e.g. mapped to "TAXABLE" when it should be "EDUCATION")
 *   - A label drift that breaks UI copy after a rename
 *
 * Each test below acts as a small contract pin: the value documented
 * in the test IS the spec. Change one of these intentionally? Update
 * the test in the same commit.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CATEGORY_LABELS,
  TAX_TREATMENT_BY_CATEGORY,
  type AccountCategory,
  type TaxTreatment,
} from "./types";

const PINNED: Record<AccountCategory, { label: string; bucket: TaxTreatment }> = {
  "401K": { label: "401(k)", bucket: "PRE_TAX" },
  ROTH_401K: { label: "Roth 401(k)", bucket: "ROTH" },
  TRAD_IRA: { label: "Traditional IRA", bucket: "PRE_TAX" },
  ROTH_IRA: { label: "Roth IRA", bucket: "ROTH" },
  HSA: { label: "HSA", bucket: "HSA" },
  BROKERAGE: { label: "Brokerage", bucket: "TAXABLE" },
  SAVINGS: { label: "Savings", bucket: "TAXABLE" },
  CHECKING: { label: "Checking", bucket: "TAXABLE" },
  FIVE_29: { label: "529", bucket: "EDUCATION" },
  // Trump Account: federally-seeded tax-deferred account for newborn
  // US citizens (One Big Beautiful Bill Act, launching 2026-07-04).
  // Routes through EDUCATION because it shares the "dedicated to a
  // child's future use, locked until majority" semantic with 529s.
  TRUMP_ACCOUNT: { label: "Trump Account", bucket: "EDUCATION" },
  CRYPTO: { label: "Crypto", bucket: "TAXABLE" },
  REAL_ESTATE: { label: "Real estate", bucket: "TAXABLE" },
  OTHER: { label: "Other", bucket: "TAXABLE" },
};

describe("AccountCategory contract", () => {
  for (const [category, { label, bucket }] of Object.entries(PINNED) as Array<
    [AccountCategory, { label: string; bucket: TaxTreatment }]
  >) {
    it(`${category} renders as "${label}" and routes to ${bucket}`, () => {
      expect(ACCOUNT_CATEGORY_LABELS[category]).toBe(label);
      expect(TAX_TREATMENT_BY_CATEGORY[category]).toBe(bucket);
    });
  }

  it("the two maps have the same keys (no orphans)", () => {
    const labelKeys = Object.keys(ACCOUNT_CATEGORY_LABELS).sort();
    const bucketKeys = Object.keys(TAX_TREATMENT_BY_CATEGORY).sort();
    expect(labelKeys).toEqual(bucketKeys);
  });
});
