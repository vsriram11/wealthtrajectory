"use client";

/**
 * The footer "Add holding" button shared across every per-kind
 * form. Each form computes its own `canSave` from its local state
 * and passes it in; the button handles disabled styling +
 * click-handler wiring uniformly.
 */
export function SubmitButton({
  canSave,
  onClick,
  label = "Add holding",
}: {
  canSave: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canSave}
      className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg disabled:opacity-40 active:opacity-80"
    >
      {label}
    </button>
  );
}
