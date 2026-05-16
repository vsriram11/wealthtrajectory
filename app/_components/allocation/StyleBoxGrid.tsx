import {
  STYLE_BOX_GRID,
  STYLE_BOX_SIZE_LABELS,
  STYLE_BOX_STYLE_LABELS,
  type StyleBoxAllocation,
  type StyleBoxCell,
} from "@/lib/types";
import { formatPercentTight } from "@/lib/format";

type Props = {
  allocation: StyleBoxAllocation;
  onCellTap?: (cell: StyleBoxCell) => void;
  highlightCell?: StyleBoxCell | null;
  size?: "sm" | "md";
};

export function StyleBoxGrid({
  allocation,
  onCellTap,
  highlightCell,
  size = "md",
}: Props) {
  const max = Math.max(...Object.values(allocation), 0.0001);

  return (
    <div className="inline-block">
      <div
        className={`grid ${size === "sm" ? "gap-0.5" : "gap-1"}`}
        style={{
          gridTemplateColumns: "auto repeat(3, minmax(0, 1fr))",
          gridTemplateRows: "auto repeat(3, minmax(0, 1fr))",
        }}
      >
        <div />
        {STYLE_BOX_STYLE_LABELS.map((s) => (
          <div
            key={s}
            className="text-center text-[10px] uppercase tracking-wider text-text-dim"
          >
            {s}
          </div>
        ))}
        {STYLE_BOX_GRID.map((row, r) => (
          <FragmentRow
            key={r}
            label={STYLE_BOX_SIZE_LABELS[r]}
            row={row}
            allocation={allocation}
            max={max}
            size={size}
            onCellTap={onCellTap}
            highlightCell={highlightCell}
          />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({
  label,
  row,
  allocation,
  max,
  size,
  onCellTap,
  highlightCell,
}: {
  label: string;
  row: StyleBoxCell[];
  allocation: StyleBoxAllocation;
  max: number;
  size: "sm" | "md";
  onCellTap?: (cell: StyleBoxCell) => void;
  highlightCell?: StyleBoxCell | null;
}) {
  return (
    <>
      <div className="flex items-center pr-2 text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      {row.map((cell) => {
        const v = allocation[cell];
        const intensity = v / max;
        const dim = size === "sm" ? "h-7 w-7" : "h-12 w-12 sm:h-14 sm:w-14";
        const interactive = onCellTap != null;
        const isHi = highlightCell === cell;
        return (
          <button
            key={cell}
            type="button"
            disabled={!interactive}
            onClick={() => onCellTap?.(cell)}
            className={`relative flex ${dim} items-center justify-center rounded-md border text-[10px] font-medium num transition ${
              v > 0
                ? "border-accent/30 text-text"
                : "border-border text-text-dim"
            } ${
              isHi
                ? "ring-2 ring-accent ring-offset-2 ring-offset-bg-surface"
                : ""
            } ${interactive ? "active:scale-95 hover:border-accent/60" : ""}`}
            style={{
              backgroundColor:
                v > 0
                  ? `rgba(56, 189, 248, ${0.08 + intensity * 0.55})`
                  : "transparent",
            }}
            aria-label={`${cell} ${formatPercentTight(v)}%`}
          >
            {v > 0 ? formatPercentTight(v) : ""}
          </button>
        );
      })}
    </>
  );
}
