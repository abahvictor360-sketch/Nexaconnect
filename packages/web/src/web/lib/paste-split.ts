/**
 * Splitting pasted text into slides.
 *
 * Someone preparing a service almost always has the content already written
 * somewhere else - a Word document, a notes app, a message from the pastor -
 * and it is written in paragraphs. Pasting that into one slide gives a wall of
 * text that has to be cut apart by hand, so a paste whose text is clearly
 * several paragraphs fills the slide it landed on and creates the rest.
 *
 * A blank line is the separator, because that is what a paragraph break is in
 * plain text. Text with no blank lines is left alone: short line breaks inside
 * a verse or a stanza are deliberate, and turning each of them into its own
 * slide would be worse than doing nothing.
 */

/**
 * Split on blank lines. Trailing whitespace is stripped per line so a paste
 * carrying "\n   \n" (very common out of Word) still reads as a paragraph
 * break rather than a line containing spaces.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter(Boolean);
}

/**
 * Does this paste warrant being broken up? Only when it genuinely holds more
 * than one paragraph - a single paragraph pastes normally so the browser's own
 * undo, cursor position and selection-replace behaviour are left untouched.
 */
export function isMultiParagraph(text: string): boolean {
  return splitParagraphs(text).length > 1;
}

/**
 * A song pasted as plain text usually carries its own section headings, either
 * on their own line ("Chorus") or as a bracketed tag ("[Verse 2]"). Recognising
 * them means a pasted song lands as labelled sections instead of a stack of
 * anonymous verses.
 */
const SONG_HEADING =
  /^\s*[[(]?\s*(verse|chorus|pre[- ]?chorus|bridge|refrain|tag|intro|outro|ending|coda|interlude|vamp)\s*(\d{0,2})\s*[\])]?\s*:?\s*$/i;

export type ParsedSongSection = { type: string; label: string; number: number | null; lyrics: string };

/** Map a matched heading word onto the app's section type values. */
function sectionType(word: string): string {
  const w = word.toLowerCase().replace(/[-\s]/g, "_");
  if (w === "pre_chorus" || w === "prechorus") return "pre_chorus";
  if (w === "outro" || w === "coda") return "ending";
  if (w === "interlude" || w === "vamp") return "intro";
  const known = ["verse", "chorus", "bridge", "refrain", "tag", "intro", "ending"];
  return known.includes(w) ? w : "verse";
}

function titleCase(word: string): string {
  if (/^pre/i.test(word)) return "Pre-Chorus";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Turn pasted lyrics into sections.
 *
 * Explicit headings win when they are present. Otherwise each paragraph becomes
 * a verse, numbered in order, which is the shape of the overwhelming majority
 * of lyrics copied off a website.
 */
export function parsePastedSong(text: string): ParsedSongSection[] {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return [];

  const out: ParsedSongSection[] = [];
  // Per-type counters, so two unnumbered verses become Verse 1 and Verse 2
  // while a lone chorus stays "Chorus" rather than "Chorus 1".
  const counts = new Map<string, number>();

  const push = (type: string, word: string, explicitNum: number | null, lyrics: string) => {
    const body = lyrics.trim();
    if (!body) return;
    const n = (counts.get(type) ?? 0) + 1;
    counts.set(type, n);
    const num = explicitNum ?? n;
    // Only verses get numbered by default; the rest are usually sung once.
    const numbered = type === "verse" || explicitNum !== null || n > 1;
    out.push({
      type,
      label: numbered ? `${titleCase(word)} ${num}` : titleCase(word),
      number: numbered ? num : null,
      lyrics: body,
    });
  };

  for (const para of paragraphs) {
    const lines = para.split("\n");
    const headMatch = SONG_HEADING.exec(lines[0] ?? "");

    if (headMatch) {
      // "Verse 2" on its own line, lyrics underneath.
      const word = headMatch[1] ?? "verse";
      const num = headMatch[2] ? Number(headMatch[2]) : null;
      push(sectionType(word), word, num, lines.slice(1).join("\n"));
      continue;
    }

    // A paragraph with no heading: a plain verse.
    push("verse", "verse", null, para);
  }

  return out;
}
