/**
 * Print-friendly primitives for the Annual Independence Review
 * page. Each component is purely presentational and side-effect-
 * free; the page composes them.
 *
 * Every component pairs a screen color class with an explicit
 * print-color class so the rendered PDF retains contrast even
 * when the dark theme is suppressed by the browser's print
 * pipeline.
 */

import type { ReactNode } from "react";
import { formatUSDCompact } from "@/lib/format";
import { leverageBuckets } from "@/lib/portfolio/leverageBuckets";

/** Bordered, break-resistant section wrapper. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-base font-semibold text-text print:text-lg print:text-black">
        {title}
      </h2>
      <div className="mt-2 space-y-1.5">{children}</div>
    </section>
  );
}

/** Tone-coded "label : value" row used inside every section. */
export function KV({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: "positive" | "negative" | "neutral" | "amber";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive print:text-green-700"
      : tone === "negative"
        ? "text-negative print:text-red-700"
        : tone === "amber"
          ? "text-amber-300 print:text-amber-700"
          : "text-text print:text-black";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5 print:border-gray-300">
      <span className="text-[12px] text-text-muted print:text-gray-700">
        {label}
      </span>
      <span
        className={`num font-semibold ${big ? "text-base" : "text-sm"} ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Stacked-bar allocation breakdown (stocks/bonds/cash/other). */
export function AllocBar({
  stocks,
  bonds,
  cash,
  other,
}: {
  stocks: number;
  bonds: number;
  cash: number;
  other: number;
}) {
  const segments = [
    { key: "Stocks", value: stocks, color: "bg-accent print:bg-blue-600" },
    { key: "Bonds", value: bonds, color: "bg-positive print:bg-green-600" },
    { key: "Cash", value: cash, color: "bg-text-muted print:bg-gray-500" },
    { key: "Other", value: other, color: "bg-amber-300 print:bg-amber-500" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full border border-border print:border-black">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value * 100).toFixed(2)}%` }}
            title={`${s.key}: ${(s.value * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        {segments.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between">
            <span className="text-text-muted print:text-gray-700">{s.key}</span>
            <span className="num text-text print:text-black">
              {(s.value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Leverage breakdown bar — same 4-bucket model as the Allocation
 * page. Print-friendly colors: green / amber / red / blue.
 */
export function LeverageBar({
  buckets,
}: {
  buckets: ReturnType<typeof leverageBuckets>["buckets"];
}) {
  const colors: Record<string, { screen: string; print: string }> = {
    low: { screen: "bg-positive", print: "print:bg-green-600" },
    mid: { screen: "bg-amber-400", print: "print:bg-amber-500" },
    high: { screen: "bg-negative", print: "print:bg-red-600" },
    re_levered: { screen: "bg-accent", print: "print:bg-blue-600" },
  };
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full border border-border print:border-black">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`${colors[b.key].screen} ${colors[b.key].print}`}
            style={{ width: `${(b.share * 100).toFixed(2)}%` }}
            title={`${b.label}: ${(b.share * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        {buckets.map((b) => (
          <div key={b.key} className="flex items-baseline justify-between">
            <span className="text-text-muted print:text-gray-700">
              {b.label}
            </span>
            <span className="num text-text print:text-black">
              {(b.share * 100).toFixed(0)}%
              <span className="ml-1.5 text-[10px] text-text-dim print:text-gray-600">
                {formatUSDCompact(b.faceUSD)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tax-bucket bar — simpler than AllocBar / LeverageBar (no
 * per-segment color overrides, just a stacked print-friendly
 * palette).
 */
export function TaxBar({
  buckets,
}: {
  buckets: Array<{ label: string; usd: number; share: number }>;
}) {
  const colors = [
    "bg-accent print:bg-purple-600",
    "bg-positive print:bg-green-600",
    "bg-amber-400 print:bg-cyan-600",
    "bg-text-muted print:bg-gray-500",
    "bg-text-dim print:bg-amber-500",
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full border border-border print:border-black">
        {buckets.map((b, i) => (
          <div
            key={b.label}
            className={colors[i % colors.length]}
            style={{ width: `${(b.share * 100).toFixed(2)}%` }}
            title={`${b.label}: ${(b.share * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        {buckets
          .filter((b) => b.usd > 0)
          .map((b) => (
            <div
              key={b.label}
              className="flex items-baseline justify-between"
            >
              <span className="text-text-muted print:text-gray-700">
                {b.label}
              </span>
              <span className="num text-text print:text-black">
                {(b.share * 100).toFixed(0)}%
                <span className="ml-1.5 text-[10px] text-text-dim print:text-gray-600">
                  {formatUSDCompact(b.usd)}
                </span>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
