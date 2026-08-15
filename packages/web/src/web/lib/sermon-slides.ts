import type { StageSlide } from "./stage";
import type { SermonHighlight } from "../hooks/use-sermons";

/**
 * Turning a sermon into slides.
 *
 * Sermons are written as labelled blocks - TEXT, TOPIC, FOCUS, NOTE, then
 * numbered points - so each block becomes its own slide carrying its label,
 * exactly the way a song slide carries "Verse 1" or "Chorus". The label rides
 * in `caption`, which is the same field lyrics use for the section name.
 *
 * Sermon prose also differs from lyrics in that a paragraph arrives as one
 * long line rather than pre-broken short ones, so anything too long for a
 * slide is split at sentence boundaries rather than chopped by line.
 */

/** Rough character budget per slide, tuned to stay readable at projector size. */
const CHARS_PER_SLIDE = 180;

/**
 * A heading line: an all-caps-ish label followed by a colon, optionally with
 * its content on the same line ("TEXT: Genesis 1:26"). Kept deliberately tight
 * so an ordinary sentence containing a colon is not mistaken for a heading.
 */
const HEADING = /^\s*([A-Z][A-Z0-9 \t/&'’-]{1,28}):\s*(.*)$/;

/** A numbered point: "1. He is ..." or "2) He is ...". */
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;

export type SermonSection = { label: string; text: string };

/** Title-case a shouted heading so the screen is not all capitals. */
function tidyLabel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length <= 3) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Split the body into labelled sections. Text before any heading becomes an
 * unlabelled opening section rather than being dropped, since plenty of
 * sermons start straight into prose.
 */
export function parseSections(body: string): SermonSection[] {
  const out: SermonSection[] = [];
  let label = "";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text || label) out.push({ label, text });
    buf = [];
  };

  for (const line of body.split("\n")) {
    const heading = HEADING.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      flush();
      label = tidyLabel(heading[1]!);
      if (heading[2]!.trim()) buf.push(heading[2]!.trim());
    } else if (numbered) {
      flush();
      label = `Point ${numbered[1]}`;
      if (numbered[2]!.trim()) buf.push(numbered[2]!.trim());
    } else {
      buf.push(line);
    }
  }
  flush();

  return out.filter((s) => s.text || s.label);
}

/** Split prose into sentences, keeping the terminator attached. */
function toSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Group a block into slide-sized pieces. A sentence longer than the budget on
 * its own still gets its own slide rather than being cut mid-thought.
 */
function chunk(text: string, maxChars: number): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Pre-broken text (someone pasted an outline): honour their line breaks.
  const units = lines.length > 1 ? lines : toSentences(lines[0]!);
  const joiner = lines.length > 1 ? "\n" : " ";

  const out: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const u of units) {
    if (buf.length && len + u.length > maxChars) {
      out.push(buf.join(joiner));
      buf = [];
      len = 0;
    }
    buf.push(u);
    len += u.length;
  }
  if (buf.length) out.push(buf.join(joiner));
  return out;
}

export type SermonSlideSource = "all" | "highlights";

/** Which section a character offset falls inside, for labelling highlights. */
function labelAt(sections: SermonSection[], body: string, offset: number): string {
  let cursor = 0;
  for (const s of sections) {
    const idx = body.indexOf(s.text, cursor);
    if (idx === -1) continue;
    if (offset >= idx && offset < idx + s.text.length) return s.label;
    cursor = idx + s.text.length;
  }
  return "";
}

/**
 * Build stage slides from a sermon.
 *
 * "highlights" is the mode most operators want: a full manuscript is far too
 * much to project, but the lines the pastor marked are exactly the points
 * meant for the screen. "all" turns the whole message into labelled slides.
 */
export function buildSermonSlides(
  body: string,
  highlights: SermonHighlight[],
  mode: SermonSlideSource,
  title: string,
  idPrefix: string,
): StageSlide[] {
  const sections = parseSections(body);
  const pieces: { label: string; text: string }[] = [];

  if (mode === "highlights") {
    // Sorted so slides follow the order the words appear in the message, not
    // the order they happened to be highlighted in.
    for (const h of [...highlights].sort((a, b) => a.start - b.start)) {
      const text = body.slice(Math.max(0, h.start), Math.max(0, h.end)).trim();
      if (!text) continue;
      const label = labelAt(sections, body, h.start);
      for (const part of chunk(text, CHARS_PER_SLIDE)) pieces.push({ label, text: part });
    }
  } else {
    for (const s of sections) {
      // A heading with nothing under it ("NOTE:" above a list of points) is
      // structure, not content. Projecting a slide whose only word is "Note"
      // helps nobody, so it is skipped and its label carries onto the pieces
      // that follow it instead.
      for (const part of chunk(s.text, CHARS_PER_SLIDE)) pieces.push({ label: s.label, text: part });
    }
  }

  return pieces.map((p, i) => ({
    kind: "sermon" as const,
    sourceLines: p.text.split("\n"),
    translationLines: [],
    caption: p.label,
    title,
    // Index-based so the id is stable while the text is unchanged, which keeps
    // the preview/live marker pinned to the same slide across re-renders.
    slideId: `${idPrefix}-${i}`,
    slideIndex: i,
    slideCount: pieces.length,
  }));
}
