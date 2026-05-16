"use client";

import { useMemo, useState } from "react";

/**
 * Controlled-by-value number input that keeps its own string state so
 * the user can backspace through the last digit (or paste a partial
 * value like "-" or ".") without the parent's controlled value
 * snapping back. Commits to the parent on every successful parse and
 * snaps back on blur if the string is empty / unparseable.
 *
 * Sync model: the typing buffer (`str`) lives in local state. When the
 * external `value` prop changes from somewhere other than this input,
 * we resync — but only if the buffer doesn't already parse to the
 * new value. Done as an in-render state adjustment (the React 19
 * canonical "Adjusting Some State When a Prop Changes" pattern) so
 * we don't bounce through useEffect.
 */
export function NumberField({
  value,
  onChange,
  precision = 4,
  allowNegative = true,
  className,
  inputMode = "decimal",
  ariaLabel,
  readOnly = false,
}: {
  value: number;
  onChange: (v: number) => void;
  precision?: number;
  allowNegative?: boolean;
  className?: string;
  inputMode?: "decimal" | "numeric";
  ariaLabel?: string;
  readOnly?: boolean;
}) {
  const formatted = useMemo(() => {
    if (!Number.isFinite(value)) return "";
    const rounded = +value.toFixed(precision);
    return rounded.toString();
  }, [value, precision]);

  const [str, setStr] = useState(formatted);
  const [prevValue, setPrevValue] = useState(value);
  // Sync when the parent-controlled `value` shifts to something the
  // typing buffer doesn't already represent. Strings like "1.5000" or
  // "1." parse to the same number as "1.5" / "1", so we don't stomp
  // them mid-edit.
  if (value !== prevValue) {
    setPrevValue(value);
    const currentParsed = parseFloat(str);
    if (!(Number.isFinite(currentParsed) && currentParsed === value)) {
      setStr(formatted);
    }
  }

  const pattern = allowNegative
    ? /^-?\d*\.?\d*$/
    : /^\d*\.?\d*$/;

  return (
    <input
      type="text"
      inputMode={inputMode}
      value={str}
      aria-label={ariaLabel}
      readOnly={readOnly}
      onChange={(e) => {
        if (readOnly) return;
        const v = e.target.value;
        if (!pattern.test(v)) return;
        setStr(v);
        const parsed = parseFloat(v);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        const parsed = parseFloat(str);
        if (!Number.isFinite(parsed)) setStr(formatted);
      }}
      className={className}
    />
  );
}
