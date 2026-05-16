// Flat config for ESLint v9+. Next 16's eslint-config-next ships
// a flat-config-compatible export, so we consume it directly
// without the FlatCompat shim.
//
// All react-hooks v7 strict rules (purity, set-state-in-effect,
// component-creation-in-render, static-components) are enforced
// — call sites either follow the idiomatic React 19 pattern
// (lazy-initialized state, derived useMemo, useSyncExternalStore)
// or carry a justified inline disable.

import next from "eslint-config-next";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  ...next,
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "e2e/**/__screenshots__/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // Plugin must be loaded in the same config object as the
    // rule that references it. eslint-plugin-react-hooks v7
    // tightened this — the ...next spread doesn't propagate
    // plugin definitions into downstream config objects.
    plugins: { "react-hooks": reactHooks },
    rules: {
      // useMemo / useEffect dep warnings are diagnostic, not
      // build-blocking — resolve case-by-case.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
