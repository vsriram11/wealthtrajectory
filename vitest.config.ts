import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror Next.js's `@/` path alias so tests can resolve the same
  // import specifiers as application code. Without this, any
  // component test that touches a module using `@/...` blows up at
  // module-resolution time before a single assertion runs.
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      include: ["lib/**/*.ts"],
      exclude: [
        "lib/**/*.test.ts",
        "lib/**/*.d.ts",
        // Static payloads: demo seed data + historical-return datasets
        // + preset catalogs. They don't carry executable invariants
        // worth gating coverage on.
        "lib/demo.ts",
        "lib/historicalReturns.ts",
        "lib/presets.ts",
        // Pure-type / re-export-only modules. v8 instruments them
        // and reports 0% of 0 statements, dragging the headline.
        // No executable code lives here — types only.
        "lib/store/uiTypes.ts",
        "lib/store/index.ts",
      ],
    },
  },
});
