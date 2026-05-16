import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0d12",
          surface: "#11161d",
          elevated: "#161c25",
        },
        border: {
          DEFAULT: "#1f2730",
          strong: "#2a3340",
        },
        // Contrast budget against bg #0a0d12 (WCAG AA = 4.5:1 for
        // normal text, 3:1 for large text). All three text shades
        // here clear the 4.5 threshold against the default bg:
        //   DEFAULT — #e7eaef ≈ 14.3:1  (AAA on normal + large)
        //   muted   — #8a94a3 ≈  5.9:1  (AA on normal + large)
        //   dim     — #80899a ≈  5.0:1  (AA on normal + large)
        // The previous dim (#5b6573) sat at ~3.2:1 — fine for
        // large text but failed AA on the many [11px] uses
        // throughout the dashboard. Caught by the axe-core E2E
        // audit (color-contrast, 35 nodes on home alone).
        text: {
          DEFAULT: "#e7eaef",
          muted: "#8a94a3",
          dim: "#80899a",
        },
        accent: {
          DEFAULT: "#38bdf8",
          strong: "#0ea5e9",
        },
        positive: "#4ade80",
        negative: "#f87171",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
