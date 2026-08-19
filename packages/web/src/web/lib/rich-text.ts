/**
 * Formatting a span of text.
 *
 * Formatting is stored as character ranges alongside the text rather than as
 * markup inside it: the text stays plain, so it remains searchable, can be
 * measured for auto-fit, and can be re-exported or re-imported without a
 * parser; and a colour can be changed, or emphasis dropped, without rewriting
 * a single character of what was actually written.
 *
 * Offsets index into the plain string, counting newlines, exactly as
 * selectionStart/selectionEnd do on a textarea.
 */

export type TextFormat = {
  start: number;
  end: number;
  /** Text colour as #rrggbb. Absent = inherit the slide's colour. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

/** The marks a range can carry, i.e. everything except its position. */
export type FormatMarks = Omit<TextFormat, "start" | "end">;

/**
 * A change to a range's marks. `color: null` clears the colour, which is
 * distinct from omitting `color` entirely (leave whatever is there alone) -
 * hence the explicit null rather than reusing Partial<FormatMarks>, whose
 * optional `color?: string` cannot express "remove it".
 */
export type MarkPatch = Omit<Partial<FormatMarks>, "color"> & { color?: string | null };

/** A stretch of text sharing one set of marks. What actually gets rendered. */
export type TextRun = FormatMarks & { text: string };

export type TextAlign = "left" | "center" | "right";

/* ---------------- parsing / serialising ---------------- */

export function parseFormats(raw: string | null | undefined): TextFormat[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: this JSON may predate the current shape, or have been edited
    // by hand in the database. Anything without a usable range is dropped.
    return (parsed as TextFormat[]).filter(
      (f) => f && Number.isFinite(f.start) && Number.isFinite(f.end) && f.end > f.start,
    );
  } catch {
    return [];
  }
}

export function serializeFormats(formats: TextFormat[]): string {
  return JSON.stringify(normalize(formats));
}

/** Does this range actually carry anything worth storing? */
function hasMarks(f: FormatMarks): boolean {
  return Boolean(f.color || f.bold || f.italic || f.underline);
}

/**
 * Tidy a format list: drop empty ranges, sort by position, and merge
 * neighbours that are adjacent and identical. Without the merge, applying bold
 * to two halves of a word in separate gestures leaves two ranges that behave
 * identically but compare unequal, which makes toggling look broken.
 */
export function normalize(formats: TextFormat[]): TextFormat[] {
  const kept = formats
    .filter((f) => f.end > f.start && hasMarks(f))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: TextFormat[] = [];
  for (const f of kept) {
    const prev = out[out.length - 1];
    if (prev && prev.end === f.start && sameMarks(prev, f)) prev.end = f.end;
    else out.push({ ...f });
  }
  return out;
}

export function sameMarks(a: FormatMarks, b: FormatMarks): boolean {
  return (
    (a.color ?? null) === (b.color ?? null) &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline)
  );
}

/* ---------------- applying marks ---------------- */

/**
 * Split every existing range at `start` and `end` so nothing straddles the
 * edges of the selection. Once that holds, a range is either entirely inside
 * the selection or entirely outside it, and the caller can treat the two
 * groups separately instead of reasoning about partial overlaps.
 */
function splitAt(formats: TextFormat[], start: number, end: number): TextFormat[] {
  const out: TextFormat[] = [];
  for (const f of formats) {
    const marks: FormatMarks = { color: f.color, bold: f.bold, italic: f.italic, underline: f.underline };
    const edges = [f.start, ...[start, end].filter((p) => p > f.start && p < f.end), f.end];
    for (let i = 0; i < edges.length - 1; i++) {
      out.push({ ...marks, start: edges[i]!, end: edges[i + 1]! });
    }
  }
  return out;
}

/**
 * Apply marks to a selection.
 *
 * Marks are merged onto whatever is already there rather than replacing it, so
 * coloring a phrase that is already bold keeps it bold. Setting a mark to
 * `false` (or colour to null) clears just that one, which is what a toolbar
 * button needs when it is toggled off.
 */
export function applyMarks(
  formats: TextFormat[],
  start: number,
  end: number,
  marks: MarkPatch,
): TextFormat[] {
  if (end <= start) return formats;

  const pieces = splitAt(formats, start, end);
  const covered: TextFormat[] = [];
  const out: TextFormat[] = [];

  for (const p of pieces) {
    if (p.start >= start && p.end <= end) covered.push(p);
    else out.push(p);
  }

  // Anywhere in the selection with no existing range yet still needs the marks,
  // so walk the gaps between the covered pieces and fill them in.
  const merged: TextFormat[] = [];
  let cursor = start;
  for (const p of covered.sort((a, b) => a.start - b.start)) {
    if (p.start > cursor) merged.push({ start: cursor, end: p.start });
    merged.push(p);
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < end) merged.push({ start: cursor, end });

  for (const piece of merged) {
    const next: TextFormat = { ...piece };
    if ("color" in marks) {
      if (marks.color) next.color = marks.color;
      else delete next.color;
    }
    for (const key of ["bold", "italic", "underline"] as const) {
      if (key in marks) {
        if (marks[key]) next[key] = true;
        else delete next[key];
      }
    }
    out.push(next);
  }

  return normalize(out);
}

/** Strip all formatting from a selection. */
export function clearMarks(formats: TextFormat[], start: number, end: number): TextFormat[] {
  if (end <= start) return formats;
  return normalize(splitAt(formats, start, end).filter((f) => f.end <= start || f.start >= end));
}

/**
 * What is already true of the whole selection, for showing a toolbar button as
 * active. A mark counts as on only when every character carries it, matching
 * how a word processor shows its buttons: partially-bold text reads as not
 * bold, so pressing the button bolds all of it rather than clearing it.
 */
export function marksInRange(formats: TextFormat[], start: number, end: number): FormatMarks {
  if (end <= start) return {};
  const covering = (pos: number) => formats.find((f) => f.start <= pos && f.end > pos);

  let bold = true, italic = true, underline = true;
  let color: string | undefined;
  let colorConsistent = true;

  for (let i = start; i < end; i++) {
    const f = covering(i);
    if (!f?.bold) bold = false;
    if (!f?.italic) italic = false;
    if (!f?.underline) underline = false;
    if (i === start) color = f?.color;
    else if (f?.color !== color) colorConsistent = false;
  }

  return {
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
    ...(underline ? { underline: true } : {}),
    ...(colorConsistent && color ? { color } : {}),
  };
}

/* ---------------- editing the underlying text ---------------- */

/**
 * Move ranges to follow an edit to the text.
 *
 * Without this, typing one character at the top of the text shifts every word
 * out from under its highlight. `from`..`to` is the replaced span and
 * `insertedLength` how much went in its place.
 */
export function shiftFormats(
  formats: TextFormat[],
  from: number,
  to: number,
  insertedLength: number,
): TextFormat[] {
  const delta = insertedLength - (to - from);

  // The two edges treat an insertion sitting exactly on them differently, and
  // the asymmetry is the point: text typed immediately BEFORE a bold phrase
  // should not become bold, and neither should text typed immediately after
  // it. So a start on the insertion point is pushed along, while an end on it
  // stays put. Handling both edges identically makes formatting creep outwards
  // a character at a time as the text around it is edited.
  const moveStart = (pos: number) => {
    if (pos < from) return pos;
    if (pos >= to) return pos + delta;
    return from; // inside a replaced span - collapse to where it began
  };
  const moveEnd = (pos: number) => {
    if (pos <= from) return pos;
    if (pos >= to) return pos + delta;
    return from;
  };

  return normalize(formats.map((f) => ({ ...f, start: moveStart(f.start), end: moveEnd(f.end) })));
}

/**
 * Work out what changed between two versions of a string.
 *
 * A textarea reports its whole new value, not an edit, so the common prefix and
 * suffix are compared to recover the span that actually changed. That is enough
 * to keep formatting anchored through ordinary typing, pasting and deleting
 * without wiring a full editing model into every text box.
 */
export function diffRange(before: string, after: string): { from: number; to: number; inserted: number } {
  let from = 0;
  const max = Math.min(before.length, after.length);
  while (from < max && before[from] === after[from]) from++;

  let tail = 0;
  while (
    tail < max - from &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  return { from, to: before.length - tail, inserted: after.length - tail - from };
}

/** Re-anchor formatting after a text edit reported as a whole new value. */
export function reanchor(formats: TextFormat[], before: string, after: string): TextFormat[] {
  if (before === after) return formats;
  const { from, to, inserted } = diffRange(before, after);
  return shiftFormats(formats, from, to, inserted);
}

/* ---------------- rendering ---------------- */

/**
 * Break text into runs, one per stretch sharing the same marks. Returned per
 * line so the renderer can keep its existing line-by-line layout, which the
 * auto-fit measurement depends on.
 */
export function toRunLines(text: string, formats: TextFormat[]): TextRun[][] {
  const norm = normalize(formats);
  const lines: TextRun[][] = [];
  let offset = 0;

  for (const line of text.split("\n")) {
    const runs: TextRun[] = [];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    let cursor = lineStart;

    for (const f of norm) {
      if (f.end <= lineStart || f.start >= lineEnd) continue;
      const s = Math.max(f.start, lineStart);
      const e = Math.min(f.end, lineEnd);
      if (s > cursor) runs.push({ text: text.slice(cursor, s) });
      runs.push({
        text: text.slice(s, e),
        ...(f.color ? { color: f.color } : {}),
        ...(f.bold ? { bold: true } : {}),
        ...(f.italic ? { italic: true } : {}),
        ...(f.underline ? { underline: true } : {}),
      });
      cursor = e;
    }
    if (cursor < lineEnd) runs.push({ text: text.slice(cursor, lineEnd) });

    lines.push(runs);
    offset = lineEnd + 1; // step over the newline
  }

  return lines;
}

/** True when a run list carries no formatting at all, i.e. plain text. */
export function runsArePlain(lines: TextRun[][]): boolean {
  return lines.every((runs) => runs.every((r) => !hasMarks(r)));
}

/** CSS for a run. Shared by the editor overlay and the live output. */
export function runStyle(run: FormatMarks): React.CSSProperties {
  return {
    ...(run.color ? { color: run.color } : {}),
    ...(run.bold ? { fontWeight: 800 } : {}),
    ...(run.italic ? { fontStyle: "italic" } : {}),
    ...(run.underline ? { textDecoration: "underline" } : {}),
  };
}
