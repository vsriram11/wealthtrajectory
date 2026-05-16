/**
 * Vitest global setup. Loaded via `test.setupFiles` in
 * vitest.config.ts before every test file.
 *
 *  - @testing-library/jest-dom adds DOM-aware matchers
 *    (toHaveValue, toBeInTheDocument, toHaveTextContent, ...).
 *    Vitest's expect inherits Jest matchers via this import.
 *  - cleanup() auto-runs after each test so RTL renders don't
 *    accumulate in the document body. Without this, two tests
 *    rendering a component with the same aria-label trip
 *    "Found multiple elements" on the second one.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
