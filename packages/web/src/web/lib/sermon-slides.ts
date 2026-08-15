import type { StageSlide } from "./stage";
import type { SermonHighlight } from "../hooks/use-sermons";

/**
 * Turning a sermon into slides.
 *
 * Sermon text is prose, not song lyrics: paragraphs arrive as one long line
 * rather than pre-broken short ones. Chunking purely by line would put a whole
 * paragraph on a single slide, so long paragraphs are split at sentence
 * boundaries and regrouped to roughly the same weight as a lyric slide.
 */

/** Rough character budget per slide, tuned to stay readable at projector size. */
const CHARS_PER_SLIDE = 180;

/** Split prose into sentences, keeping the terminator attached. */
function toSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Group a paragraph into slide-sized pieces. A sentence longer than the budget
 * on its own still gets its own slide rather than being cut mid-thought -
 * splitting a sentence across slides reads far worse than one busy slide.
 */
function chunkParagraph(paragraph: string, maxChars: number): string[] {
  const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
  // Pre-broken text (someone pasted an outline): honour their line breaks.
  if (lines.length > 1) {
    const out: string[] = [];
    let buf: string[] = [];
    let len = 0;
    for (const line of lines) {
      if (buf.length && len + line.length > maxChars) {
        out.push(buf.join("\n"));
        buf = [];
        len = 0;
      }
      buf.push(line);
      len += line.length;
    }
    if (buf.length) out.push(buf.join("\n"));
    return out;
  }

  const sentences = toSentences(paragraph);
  const out: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const s of sentences) {
    if (buf.length && len + s.length > maxChars) {
      out.push(buf.join(" "));
      buf = [];
      len = 0;
    }
    buf.push(s);
    len += s.length;
  }
  if (buf.length) out.push(buf.join(" "));
  return out;
}

export type SermonSlideSource = "all" | "highlights";

/**
 * Build stage slides from a sermon.
 *
 * "highlights" is the mode most operators want: a full manuscript is far too
 * much to project, but the lines the pastor marked are exactly the points
 * meant for the screen. "all" paginates the whole text for churches that
 * project the outline as it is preached.
 */
export function buildSermonSlides(
  body: string,
  highlights: SermonHighlight[],
  mode: SermonSlideSource,
  title: string,
  idPrefix: string,
): StageSlide[] {
  const pieces: string[] = [];

  if (mode === "highlights") {
    // Sorted so slides follow the order the words appear in the message, not
    // the order they happened to be highlighted in.
    for (const h of [...highlights].sort((a, b) => a.start - b.start)) {
      const text = body.slice(Math.max(0, h.start), Math.max(0, h.end)).trim();
      if (text) pieces.push(...chunkParagraph(text, CHARS_PER_SLIDE));
    }
  } else {
    for (const para of body.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (trimmed) pieces.push(...chunkParagraph(trimmed, CHARS_PER_SLIDE));
    }
  }

  return pieces.map((text, i) => ({
    kind: "sermon" as const,
    sourceLines: text.split("\n"),
    translationLines: [],
    caption: "",
    title,
    // Index-based so the id is stable while the text is unchanged, which keeps
    // the preview/live highlight pinned to the same slide across re-renders.
    slideId: `${idPrefix}-${i}`,
    slideIndex: i,
    slideCount: pieces.length,
  }));
}
