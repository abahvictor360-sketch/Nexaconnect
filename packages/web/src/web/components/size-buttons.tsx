import { AArrowDown, AArrowUp } from "lucide-react";
import type { MarkPatch } from "../lib/rich-text";

/**
 * The steps A- and A+ walk through.
 *
 * Coarse on purpose. An operator sizing a line on a slide is choosing
 * "smaller", "bigger" or "much bigger", not dialling in 7%, and a fine step
 * would mean six presses to see a difference from the back of a hall.
 */
export const SIZE_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.8, 2.2] as const;

export function stepSize(current: number, dir: -1 | 1): number {
  // Nearest step to where it is now, so text sized before these steps
  // existed still moves sensibly.
  let at = 0;
  for (let i = 1; i < SIZE_STEPS.length; i++) {
    if (Math.abs(SIZE_STEPS[i]! - current) < Math.abs(SIZE_STEPS[at]! - current)) at = i;
  }
  const next = Math.min(SIZE_STEPS.length - 1, Math.max(0, at + dir));
  return SIZE_STEPS[next]!;
}

/**
 * Smaller / bigger for the highlighted words, with the current size between
 * them.
 *
 * The percentage is shown rather than left implicit because the size is
 * relative to the slide, not absolute: "140%" says what it actually means,
 * where a point size would be a number that is true on no screen in
 * particular. Clicking it returns the text to the slide's own size.
 */
export function SizeButtons({
  scale,
  onApply,
}: {
  /** Current size of the selection, 1 when it is the slide's own size. */
  scale: number;
  onApply: (marks: MarkPatch) => void;
}) {
  const atFloor = scale <= SIZE_STEPS[0]!;
  const atCeiling = scale >= SIZE_STEPS[SIZE_STEPS.length - 1]!;
  return (
    <>
      <button
        type="button"
        title="Smaller"
        aria-label="Make the highlighted text smaller"
        disabled={atFloor}
        onClick={() => onApply({ scale: stepSize(scale, -1) })}
        className="grid h-6 w-6 place-items-center rounded text-[var(--v-text-dim)] transition-colors hover:bg-[var(--v-surface-2)] hover:text-[var(--v-text)] disabled:opacity-30"
      >
        <AArrowDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title={scale === 1 ? "Slide's own size" : "Back to the slide's own size"}
        aria-label="Text size, click to reset"
        onClick={() => onApply({ scale: null })}
        className={`h-6 min-w-[2.4rem] rounded px-1 font-mono text-[11px] tabular-nums transition-colors hover:bg-[var(--v-surface-2)] ${
          scale === 1 ? "text-[var(--v-text-faint)]" : "text-[var(--v-accent)]"
        }`}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        title="Bigger"
        aria-label="Make the highlighted text bigger"
        disabled={atCeiling}
        onClick={() => onApply({ scale: stepSize(scale, 1) })}
        className="grid h-6 w-6 place-items-center rounded text-[var(--v-text-dim)] transition-colors hover:bg-[var(--v-surface-2)] hover:text-[var(--v-text)] disabled:opacity-30"
      >
        <AArrowUp className="h-3.5 w-3.5" />
      </button>
    </>
  );
}
