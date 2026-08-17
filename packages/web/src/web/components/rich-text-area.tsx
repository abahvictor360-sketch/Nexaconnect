import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Eraser, Baseline,
} from "lucide-react";
import {
  applyMarks, clearMarks, marksInRange, reanchor, runStyle, toRunLines,
  type MarkPatch, type TextAlign, type TextFormat, type TextRun,
} from "../lib/rich-text";

/**
 * A text box whose words can be coloured and emphasised.
 *
 * The text itself stays in a plain <textarea>, which keeps every behaviour an
 * operator already expects for free: the caret, keyboard navigation, undo,
 * spellcheck, IME input, autoscroll. The formatting is painted by a div sitting
 * exactly behind it, rendering the same string with the same metrics, while the
 * textarea's own glyphs are made transparent. Because both layers wrap
 * identically, the painted words line up with the real ones.
 *
 * Selecting text raises the toolbar over the selection. It is positioned by
 * measuring the matching span in the backdrop, so it follows the words rather
 * than guessing at coordinates.
 */

/** Deliberately few, and picked to stay legible projected. */
const COLORS = [
  { hex: "#facc15", name: "Yellow" },
  { hex: "#fb923c", name: "Orange" },
  { hex: "#f87171", name: "Red" },
  { hex: "#a3e635", name: "Green" },
  { hex: "#38bdf8", name: "Blue" },
  { hex: "#c084fc", name: "Purple" },
  { hex: "#ffffff", name: "White" },
];

type Segment = TextRun & { selected: boolean };

/**
 * Split each line's runs at the selection edges, so the selected text can be
 * given a marker span to measure the toolbar against. Offsets are tracked as
 * the walk proceeds because runs carry no position of their own.
 */
function segmentLines(text: string, formats: TextFormat[], selStart: number, selEnd: number): Segment[][] {
  const runLines = toRunLines(text, formats);
  const out: Segment[][] = [];
  let offset = 0;

  for (const runs of runLines) {
    const segs: Segment[] = [];
    for (const run of runs) {
      const runStart = offset;
      const runEnd = offset + run.text.length;
      // Cut points inside this run where the selection starts or ends.
      const cuts = [runStart, ...[selStart, selEnd].filter((p) => p > runStart && p < runEnd), runEnd];
      for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i]!;
        const e = cuts[i + 1]!;
        segs.push({
          ...run,
          text: text.slice(s, e),
          selected: s >= selStart && e <= selEnd && selEnd > selStart,
        });
      }
      offset = runEnd;
    }
    out.push(segs);
    offset += 1; // the newline
  }
  return out;
}

export function RichTextArea({
  value,
  onChange,
  formats,
  onFormatsChange,
  align,
  onAlignChange,
  placeholder,
  rows = 3,
  className = "",
  textClassName = "",
  onPaste,
}: {
  value: string;
  onChange: (next: string) => void;
  formats: TextFormat[];
  onFormatsChange: (next: TextFormat[]) => void;
  /** Omit both align props to hide the alignment buttons. */
  align?: TextAlign | null;
  onAlignChange?: (next: TextAlign | null) => void;
  placeholder?: string;
  rows?: number;
  /** Applied to the wrapper: border, background, focus ring. */
  className?: string;
  /** Typography, applied identically to the textarea and the backdrop. */
  textClassName?: string;
  /** Lets the host intercept a paste, e.g. to split paragraphs into slides. */
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [palette, setPalette] = useState(false);

  const readSelection = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    setSel({ start: ta.selectionStart, end: ta.selectionEnd });
    if (ta.selectionStart === ta.selectionEnd) setPalette(false);
  }, []);

  // The textarea scrolls independently of the backdrop, which does not scroll
  // at all on its own - keeping them in step is what holds the paint aligned
  // once the text is taller than the box.
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const bd = backdropRef.current;
    if (ta && bd) {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Position the toolbar over the selection by measuring the marker span the
  // backdrop rendered for it. Layout effect so it never paints at a stale spot.
  useLayoutEffect(() => {
    if (sel.end <= sel.start) {
      setToolbar(null);
      return;
    }
    const marker = markerRef.current;
    const wrap = wrapRef.current;
    if (!marker || !wrap) return;
    const m = marker.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    setToolbar({
      top: m.top - w.top,
      left: Math.max(0, Math.min(m.left - w.left + m.width / 2, w.width)),
    });
  }, [sel, value, formats]);

  // A selection made with the mouse ends outside React's own events, and one
  // made with the keyboard fires no input event, so the document-level
  // selectionchange is the only signal that catches both.
  useEffect(() => {
    const onSelChange = () => {
      if (document.activeElement === taRef.current) readSelection();
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [readSelection]);

  const active = marksInRange(formats, sel.start, sel.end);
  const hasSelection = sel.end > sel.start;

  const setMarks = (marks: MarkPatch) => {
    onFormatsChange(applyMarks(formats, sel.start, sel.end, marks));
    taRef.current?.focus();
  };

  const segments = segmentLines(value, formats, sel.start, sel.end);
  let markerPlaced = false;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {/* Painted formatting. Mirrors the textarea exactly and is never
          interactive - the real text box sits on top of it. */}
      <div
        ref={backdropRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words ${textClassName}`}
      >
        {segments.map((segs, li) => (
          <div key={li}>
            {segs.length === 0 ? (
              " "
            ) : (
              segs.map((seg, si) => {
                // Only the first selected segment carries the ref: it is the
                // anchor the toolbar is measured against.
                const isMarker = seg.selected && !markerPlaced;
                if (isMarker) markerPlaced = true;
                return (
                  <span key={si} ref={isMarker ? markerRef : undefined} style={runStyle(seg)}>
                    {seg.text}
                  </span>
                );
              })
            )}
          </div>
        ))}
      </div>

      <textarea
        ref={taRef}
        value={value}
        rows={rows}
        placeholder={placeholder}
        spellCheck
        onChange={(e) => {
          // Re-anchor first, against the text as it was, or the ranges end up
          // measured against a string that no longer exists.
          onFormatsChange(reanchor(formats, value, e.target.value));
          onChange(e.target.value);
        }}
        onPaste={onPaste}
        onScroll={syncScroll}
        onSelect={readSelection}
        onKeyUp={readSelection}
        onMouseUp={readSelection}
        onBlur={() => setPalette(false)}
        className={`v-rich-input relative w-full resize-y bg-transparent outline-none ${textClassName}`}
      />

      {toolbar && hasSelection && (
        <div
          // Keeping focus in the textarea is what preserves the selection; a
          // toolbar button that stole it would clear the very range it acts on.
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: toolbar.top, left: toolbar.left }}
          className="animate-fade-in absolute z-30 flex -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center gap-0.5 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-1 shadow-xl"
        >
          <ToolBtn label="Bold" active={!!active.bold} onClick={() => setMarks({ bold: !active.bold })}>
            <Bold className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn label="Italic" active={!!active.italic} onClick={() => setMarks({ italic: !active.italic })}>
            <Italic className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            label="Underline"
            active={!!active.underline}
            onClick={() => setMarks({ underline: !active.underline })}
          >
            <Underline className="h-3.5 w-3.5" />
          </ToolBtn>

          <span className="mx-0.5 h-4 w-px bg-[var(--v-border)]" />

          <div className="relative">
            <ToolBtn label="Text colour" active={!!active.color} onClick={() => setPalette((p) => !p)}>
              <Baseline className="h-3.5 w-3.5" style={active.color ? { color: active.color } : undefined} />
            </ToolBtn>
            {palette && (
              <div className="absolute left-1/2 top-full z-40 mt-1.5 flex -translate-x-1/2 gap-1 rounded-lg border border-[var(--v-border)] bg-[var(--v-surface-3)] p-1.5 shadow-xl">
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
              </div>
            )}
          </div>

          {onAlignChange && (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--v-border)]" />
              {([
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as const).map(([a, Icon]) => (
                <ToolBtn
                  key={a}
                  label={`Align ${a}`}
                  active={align === a}
                  // Pressing the active alignment returns the slide to
                  // inheriting the theme, rather than pinning it to a value
                  // that happens to match today's theme and silently diverges
                  // when the theme changes.
                  onClick={() => onAlignChange(align === a ? null : a)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </ToolBtn>
              ))}
            </>
          )}

          <span className="mx-0.5 h-4 w-px bg-[var(--v-border)]" />
          <ToolBtn
            label="Clear formatting"
            onClick={() => {
              onFormatsChange(clearMarks(formats, sel.start, sel.end));
              taRef.current?.focus();
            }}
          >
            <Eraser className="h-3.5 w-3.5" />
          </ToolBtn>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
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
