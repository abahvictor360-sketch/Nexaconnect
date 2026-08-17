import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, Underline, Eraser, Baseline } from "lucide-react";
import {
  applyMarks, clearMarks, marksInRange, runStyle, toRunLines,
  type MarkPatch, type TextFormat,
} from "../lib/rich-text";

/**
 * Read-only text that can still be coloured and emphasised.
 *
 * The counterpart to RichTextArea, for text the operator does not type: a Bible
 * verse comes out of a version file and is never edited, but the phrase worth
 * emphasising on screen is chosen fresh for each service. So the words are
 * rendered rather than typed, and the selection is read from the DOM instead of
 * from a textarea's selectionStart.
 *
 * Offsets are measured against the container's full text content, not the node
 * that happens to be clicked, because formatting has already split the text
 * into several spans.
 */

const COLORS = [
  { hex: "#facc15", name: "Yellow" },
  { hex: "#fb923c", name: "Orange" },
  { hex: "#f87171", name: "Red" },
  { hex: "#a3e635", name: "Green" },
  { hex: "#38bdf8", name: "Blue" },
  { hex: "#c084fc", name: "Purple" },
  { hex: "#ffffff", name: "White" },
];

export function FormattableText({
  text,
  formats,
  onFormatsChange,
  className = "",
}: {
  text: string;
  formats: TextFormat[];
  onFormatsChange: (next: TextFormat[]) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [palette, setPalette] = useState(false);

  const readSelection = useCallback(() => {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSel(null);
      setPalette(false);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setSel(null);
      setPalette(false);
      return;
    }
    const pre = range.cloneRange();
    pre.selectNodeContents(host);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + range.toString().length;
    if (end <= start) {
      setSel(null);
      return;
    }
    setSel({ start, end });

    // Position against the page, then convert to the host's own coordinates so
    // the toolbar rides with the text if the list behind it scrolls.
    const r = range.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({ top: r.top - h.top, left: r.left - h.left + r.width / 2 });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  // Nudge the toolbar back into place if the formatting it just applied
  // reflowed the text under it.
  useLayoutEffect(() => {
    if (!sel) setPos(null);
  }, [sel]);

  const active = sel ? marksInRange(formats, sel.start, sel.end) : {};
  const runLines = toRunLines(text, formats);

  const setMarks = (marks: MarkPatch) => {
    if (!sel) return;
    onFormatsChange(applyMarks(formats, sel.start, sel.end, marks));
  };

  return (
    <span ref={hostRef} className={`relative ${className}`}>
      {runLines.map((runs, li) => (
        <span key={li}>
          {li > 0 && "\n"}
          {runs.map((run, ri) => (
            <span key={ri} style={runStyle(run)}>
              {run.text}
            </span>
          ))}
        </span>
      ))}

      {sel && pos && (
        <span
          contentEditable={false}
          // preventDefault keeps the selection alive through the press;
          // stopPropagation keeps a click on a toolbar button from also
          // reaching whatever row this text is sitting inside.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left }}
          className="animate-fade-in absolute z-30 flex -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center gap-0.5 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-1 shadow-xl"
        >
          <Btn label="Bold" active={!!active.bold} onClick={() => setMarks({ bold: !active.bold })}>
            <Bold className="h-3.5 w-3.5" />
          </Btn>
          <Btn label="Italic" active={!!active.italic} onClick={() => setMarks({ italic: !active.italic })}>
            <Italic className="h-3.5 w-3.5" />
          </Btn>
          <Btn
            label="Underline"
            active={!!active.underline}
            onClick={() => setMarks({ underline: !active.underline })}
          >
            <Underline className="h-3.5 w-3.5" />
          </Btn>

          <span className="mx-0.5 h-4 w-px bg-[var(--v-border)]" />

          <span className="relative">
            <Btn label="Text colour" active={!!active.color} onClick={() => setPalette((p) => !p)}>
              <Baseline className="h-3.5 w-3.5" style={active.color ? { color: active.color } : undefined} />
            </Btn>
            {palette && (
              <span className="absolute left-1/2 top-full z-40 mt-1.5 flex -translate-x-1/2 gap-1 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-1.5 shadow-xl">
                {COLORS.map((c) => (
                  <button
                    key={c.hex}
                    title={c.name}
                    onClick={() => {
                      setMarks({ color: c.hex });
                      setPalette(false);
                    }}
                    style={{ background: c.hex }}
                    className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                      active.color === c.hex ? "border-white ring-2 ring-white/60" : "border-black/30"
                    }`}
                  />
                ))}
                <button
                  title="Default colour"
                  onClick={() => {
                    setMarks({ color: null });
                    setPalette(false);
                  }}
                  className="grid h-5 w-5 place-items-center rounded-full border border-[var(--v-border)] bg-[var(--v-surface)] text-[var(--v-text-faint)] hover:text-[var(--v-text)]"
                >
                  <Eraser className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </span>

          <span className="mx-0.5 h-4 w-px bg-[var(--v-border)]" />
          <Btn
            label="Clear formatting"
            onClick={() => onFormatsChange(clearMarks(formats, sel.start, sel.end))}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Btn>
        </span>
      )}
    </span>
  );
}

function Btn({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded transition-colors ${
        active
          ? "bg-[var(--v-accent-soft)] text-[var(--v-accent)]"
          : "text-[var(--v-text-dim)] hover:bg-[var(--v-surface-2)] hover:text-[var(--v-text)]"
      }`}
    >
      {children}
    </button>
  );
}
